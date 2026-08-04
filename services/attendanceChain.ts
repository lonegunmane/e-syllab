/**
 * attendanceChain.ts — E-SYLLAB Blockchain Attendance Service
 *
 * TASK 1 UPGRADE: Offline → blockchain auto-sync via Service Worker Background Sync
 *
 * Old behaviour: offline records sat in localStorage until teacher manually synced.
 * New behaviour:
 *   1. Offline record saved to IndexedDB (survives browser close)
 *   2. Service worker registered for Background Sync tag 'esyllab-attendance-sync'
 *   3. When internet returns (even if app tab is closed), SW fires, reads IndexedDB,
 *      POSTs each record to /api/blockchain/attendance/sync-offline (server does the
 *      full Solana transaction server-side — no Phantom needed for offline sync)
 *   4. SW posts a message back to any open tabs so the UI updates
 *
 * The app listens for SW messages via useSyncListener() hook (exported below).
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import type { AttendanceStatus } from './blockchain';

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMO_PROGRAM_ID  = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const SYNC_TAG         = 'esyllab-attendance-sync';
const DB_NAME          = 'esyllab-sync-db';
const DB_VERSION       = 1;
const STORE_NAME       = 'attendance-queue';

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhantomProvider {
  isPhantom: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  connect: () => Promise<{ publicKey: PublicKey }>;
  disconnect: () => Promise<void>;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
}

export interface AttendanceInput {
  staffId: string;
  staffName: string;
  date: string;
  status: AttendanceStatus;
  schoolId: string;
}

export interface BlockchainResult {
  success: boolean;
  mode: 'online' | 'offline';
  signature?: string;
  offlineHash?: string;
  slot?: number;
  queueId?: string;
  error?: string;
}

export interface SyncMessage {
  type: 'SYNC_COMPLETE' | 'SYNC_BATCH_DONE';
  id?: string;
  staffId?: string;
  date?: string;
  status?: string;
  signature?: string;
  slot?: number;
  count?: number;
}

// ─── IndexedDB helpers ────────────────────────────────────────────────────────
// The SW uses IndexedDB too (same DB) — they share data across the boundary.

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = e => reject((e.target as IDBOpenDBRequest).error);
  });
}

export async function getQueuedRecords(): Promise<any[]> {
  const db    = await openDB();
  const tx    = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

export async function getOfflineQueueCount(): Promise<number> {
  const records = await getQueuedRecords();
  return records.length;
}

async function saveToIndexedDB(item: any): Promise<void> {
  const db    = await openDB();
  const tx    = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.put(item);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ─── Service Worker messaging ─────────────────────────────────────────────────

async function getServiceWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.active;
}

/**
 * Sends a record to the service worker to queue + register Background Sync.
 * Falls back to direct IndexedDB write if SW is unavailable.
 */
async function queueViaServiceWorker(item: any): Promise<void> {
  const sw = await getServiceWorker();

  if (sw) {
    // Use MessageChannel for a reply from the SW
    await new Promise<void>((resolve, reject) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = e => e.data?.success ? resolve() : reject(new Error('SW queue failed'));
      sw.postMessage({ type: 'QUEUE_ATTENDANCE', payload: item }, [channel.port2]);
      setTimeout(() => reject(new Error('SW timeout')), 3000);
    });
  } else {
    // Fallback: write directly to IndexedDB; sync will happen next app open
    await saveToIndexedDB(item);
    console.warn('[Attendance] SW unavailable — saved to IndexedDB directly');
  }
}

/**
 * React hook: subscribe to SW sync messages so the UI updates when records
 * auto-sync in the background (even if the tab was in the background).
 *
 * Usage in any component:
 *   useSyncListener((msg) => {
 *     if (msg.type === 'SYNC_COMPLETE') refreshAttendanceList();
 *   });
 */
export function useSyncListener(onMessage: (msg: SyncMessage) => void): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  // This is called at component mount — caller manages cleanup via useEffect
  const handler = (event: MessageEvent) => {
    const msg = event.data as SyncMessage;
    if (msg?.type === 'SYNC_COMPLETE' || msg?.type === 'SYNC_BATCH_DONE') {
      onMessage(msg);
    }
  };

  navigator.serviceWorker.addEventListener('message', handler);
  // Return a cleanup fn — caller should call this in useEffect cleanup
  // We cast to satisfy TypeScript since this isn't a real hook return
  (useSyncListener as any)._cleanup = () =>
    navigator.serviceWorker.removeEventListener('message', handler);
}

// ─── Phantom helpers ──────────────────────────────────────────────────────────

function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  const p = (window as any)?.solana;
  return p?.isPhantom ? (p as PhantomProvider) : null;
}

export async function connectPhantom(): Promise<string | null> {
  const phantom = getPhantom();
  if (!phantom) {
    alert('Phantom wallet not found. Install it from https://phantom.app');
    return null;
  }
  try {
    const resp = await phantom.connect();
    return resp.publicKey.toBase58();
  } catch (err) {
    console.error('[Phantom] Connection rejected:', err);
    return null;
  }
}

export function getPhantomPublicKey(): string | null {
  return getPhantom()?.publicKey?.toBase58() ?? null;
}

export function isPhantomConnected(): boolean {
  const p = getPhantom();
  return !!(p?.isConnected && p.publicKey);
}

// ─── Blockhash proxy ──────────────────────────────────────────────────────────

async function fetchBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const res = await fetch('/api/blockchain/blockhash');
  const d   = await res.json();
  if (!d.success) throw new Error(d.error || 'Failed to fetch blockhash');
  return { blockhash: d.blockhash, lastValidBlockHeight: d.lastValidBlockHeight };
}

// ─── Online flow — Phantom signs client-side ──────────────────────────────────

async function submitOnline(input: AttendanceInput): Promise<BlockchainResult> {
  const phantom = getPhantom();
  if (!phantom?.publicKey) throw new Error('Phantom wallet not connected');

  const signerPublicKey = phantom.publicKey.toBase58();

  // Step 1: Backend computes offlineHash + memoPayload
  const prepRes  = await fetch('/api/blockchain/attendance/prepare', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      signerPublicKey,
      syncedFromOffline: false,
      localTimestamp: new Date().toISOString(),
    }),
  });
  const prepData = await prepRes.json();
  if (!prepData.success) throw new Error(prepData.error || 'Failed to prepare transaction');

  // Step 2: Build tx client-side with fresh blockhash
  const feePayer = new PublicKey(signerPublicKey);
  const { blockhash, lastValidBlockHeight } = await fetchBlockhash();

  const memoInstruction = new TransactionInstruction({
    keys:      [{ pubkey: feePayer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data:      Buffer.from(prepData.memoPayload),
  });

  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(memoInstruction);

  // Step 3: Phantom signs + broadcasts
  const { signature } = await phantom.signAndSendTransaction(tx);
  console.log('[Phantom] Attendance tx sent:', signature);

  // Step 4: Backend confirms
  const confirmRes  = await fetch('/api/blockchain/attendance/confirm', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature, offlineHash: prepData.offlineHash }),
  });
  const confirmData = await confirmRes.json();
  if (!confirmData.success) throw new Error(confirmData.error || 'Confirmation failed');

  return {
    success: true, mode: 'online',
    signature, offlineHash: prepData.offlineHash,
    slot: confirmData.receipt.slot,
  };
}

// ─── Offline flow — queued to IndexedDB + Background Sync ────────────────────

async function queueOffline(input: AttendanceInput): Promise<BlockchainResult> {
  // Generate an offline hash via backend if reachable, else skip hash for now
  let offlineHash = '';
  try {
    const hashRes  = await fetch('/api/blockchain/attendance/hash', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ staffId: input.staffId, date: input.date, status: input.status }),
    });
    const hashData = await hashRes.json();
    if (hashData.success) offlineHash = hashData.offlineHash;
  } catch { /* backend unreachable — hash will be computed on sync */ }

  const queueId = `${input.staffId}-${input.date}-${Date.now()}`;
  const item = {
    ...input,
    id:          queueId,
    offlineHash,
    retries:     0,
    queuedAt:    new Date().toISOString(),
    localTimestamp: new Date().toISOString(),
  };

  await queueViaServiceWorker(item);
  console.log(`[Attendance] Queued offline: ${queueId}`);

  return { success: true, mode: 'offline', queueId, offlineHash };
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Record attendance. Automatically chooses online or offline path.
 * If online fails for any reason, falls back to offline queue.
 */
export async function recordAttendance(input: AttendanceInput): Promise<BlockchainResult> {
  if (navigator.onLine && isPhantomConnected()) {
    try {
      return await submitOnline(input);
    } catch (err: any) {
      console.warn('[Attendance] Online failed, queuing offline:', err.message);
      return queueOffline(input);
    }
  }
  return queueOffline(input);
}

/**
 * Force an immediate sync attempt from the app (e.g. user taps "Sync now").
 * The SW will also sync automatically when internet returns.
 */
export async function forceSyncNow(): Promise<{ triggered: boolean }> {
  const sw = await getServiceWorker();
  if (!sw) return { triggered: false };

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = e => resolve(e.data || { triggered: false });
    sw.postMessage({ type: 'FORCE_SYNC' }, [channel.port2]);
    setTimeout(() => resolve({ triggered: false }), 2000);
  });
}

/**
 * Ask the SW how many records are pending.
 * Falls back to reading IndexedDB directly if SW is unavailable.
 */
export async function getPendingCount(): Promise<number> {
  try {
    const sw = await getServiceWorker();
    if (sw) {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = e => resolve(e.data?.count ?? 0);
        sw.postMessage({ type: 'GET_QUEUE_COUNT' }, [channel.port2]);
        setTimeout(() => resolve(0), 2000);
      });
    }
  } catch { /* fall through */ }
  const records = await getQueuedRecords();
  return records.length;
}

export async function getBlockchainStatus() {
  try {
    const res = await fetch('/api/blockchain/status');
    return await res.json();
  } catch {
    return { success: false, connected: false };
  }
}
