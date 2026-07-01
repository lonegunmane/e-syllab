/**
 * E-SYLLAB Service Worker — sw.js (v6 — bulletproof)
 */

const CACHE_NAME = 'esyllab-v6';
const SYNC_TAG   = 'esyllab-attendance-sync';
const MAX_RETRIES = 5;
const DB_NAME    = 'esyllab-sync-db';
const DB_VERSION = 1;
const STORE_NAME = 'attendance-queue';

// ─── IndexedDB ────────────────────────────────────────────────────────────────

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      if (!e.target.result.objectStoreNames.contains(STORE_NAME))
        e.target.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}
async function dbPut(item) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME,'readwrite').objectStore(STORE_NAME).put(item);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME,'readwrite').objectStore(STORE_NAME).delete(id);
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}
async function dbCount() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction(STORE_NAME,'readonly').objectStore(STORE_NAME).count();
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

// ─── Install ──────────────────────────────────────────────────────────────────

self.addEventListener('install', event => {
  console.log('[SW v6] Installing');
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(['./', './index.html']).catch(() => {}))
  );
});

// ─── Activate ─────────────────────────────────────────────────────────────────

self.addEventListener('activate', event => {
  console.log('[SW v6] Activating — clearing old caches');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ─── Fetch — safe caching only, never crash ───────────────────────────────────
// Only cache same-origin GET requests for app shell.
// External requests (fonts, CDN) are passed through without caching.
// API calls are never intercepted.

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Never touch POST, non-HTTP, or API calls
  if (event.request.method !== 'GET') return;
  if (!url.startsWith('http')) return;
  if (url.includes('/api/')) return;

  // External requests — pass through, no caching (prevents opaque response crash)
  const isExternal = !url.startsWith(self.location.origin);
  if (isExternal) {
    event.respondWith(fetch(event.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Same-origin — stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then(cache =>
      cache.match(event.request).then(cached => {
        const fresh = fetch(event.request)
          .then(res => {
            // Only cache valid, non-opaque responses
            if (res && res.status === 200 && res.type === 'basic') {
              cache.put(event.request, res.clone());
            }
            return res;
          })
          .catch(() => cached || new Response('Offline', { status: 503 }));
        return cached || fresh;
      })
    )
  );
});

// ─── Background Sync ──────────────────────────────────────────────────────────

self.addEventListener('sync', event => {
  console.log('[SW v6] Sync event:', event.tag);
  if (event.tag === SYNC_TAG) event.waitUntil(runSync());
});

async function runSync() {
  let records;
  try { records = await dbGetAll(); }
  catch (e) { console.error('[SW v6] IndexedDB read failed:', e); return; }

  if (!records.length) { console.log('[SW v6] Nothing to sync'); return; }

  console.log(`[SW v6] Syncing ${records.length} record(s)...`);
  let synced = 0;

  for (const item of records) {
    if ((item.retries || 0) >= MAX_RETRIES) {
      console.warn('[SW v6] Giving up on', item.id);
      await dbDelete(item.id).catch(() => {});
      continue;
    }
    try {
      const res  = await fetch('/api/blockchain/attendance/sync-offline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Server error');

      console.log('[SW v6] ✓ Synced:', item.staffId, item.date);
      await dbDelete(item.id);
      synced++;
      notifyClients({
        type: 'SYNC_COMPLETE',
        id: item.id, staffId: item.staffId, date: item.date, status: item.status,
        signature: data.signature, slot: data.slot, explorerUrl: data.explorerUrl,
      });
    } catch (err) {
      console.warn('[SW v6] ✗ Failed:', item.id, err.message);
      await dbPut({ ...item, retries: (item.retries||0)+1, lastAttempt: new Date().toISOString() }).catch(()=>{});
      throw err; // rethrow → browser will retry
    }
  }

  if (synced > 0) notifyClients({ type: 'SYNC_BATCH_DONE', count: synced });
}

// ─── Notify open tabs ─────────────────────────────────────────────────────────

async function notifyClients(msg) {
  try {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(c => c.postMessage(msg));
  } catch {}
}

// ─── Messages from the app ────────────────────────────────────────────────────

self.addEventListener('message', async event => {
  const { type, payload } = event.data || {};
  console.log('[SW v6] Message:', type);

  if (type === 'QUEUE_ATTENDANCE') {
    try {
      await dbPut({
        ...payload,
        id:          payload.id || `${payload.staffId}-${payload.date}-${Date.now()}`,
        retries:     0,
        queuedAt:    new Date().toISOString(),
        lastAttempt: null,
      });
      if ('sync' in self.registration) {
        await self.registration.sync.register(SYNC_TAG);
        console.log('[SW v6] Background sync registered');
      } else {
        // Older browser fallback
        runSync().catch(e => console.warn('[SW v6] Fallback sync failed:', e.message));
      }
      event.ports[0]?.postMessage({ success: true });
    } catch (err) {
      console.error('[SW v6] Queue failed:', err);
      event.ports[0]?.postMessage({ success: false, error: err.message });
    }
    return;
  }

  if (type === 'GET_QUEUE_COUNT') {
    const count = await dbCount().catch(() => 0);
    event.ports[0]?.postMessage({ count });
    return;
  }

  if (type === 'FORCE_SYNC') {
    runSync().catch(e => console.warn('[SW v6] Force sync error:', e.message));
    event.ports[0]?.postMessage({ triggered: true });
    return;
  }

  if (type === 'GET_ALL_QUEUED') {
    const records = await dbGetAll().catch(() => []);
    event.ports[0]?.postMessage({ records });
    return;
  }
});
