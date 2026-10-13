import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, Clock, Loader2,
  ExternalLink, RefreshCw,
  UserCheck, BookOpen, CalendarCheck, Wifi, WifiOff,
  ChevronDown, MapPin,
} from 'lucide-react';
import { User } from '../types';
import { authFetch, recordAttendanceOnline, syncAllAttendance, retryAttendanceLock } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type AttendanceStatus = 'Present' | 'Absent' | 'Late' | 'OnLeave';

interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  time: string;
  className: string;
  status: AttendanceStatus;
  offlineHash: string;
  signature?: string;
  slot?: number;
  syncedFromOffline: boolean;
  confirmedOnChain: boolean;
  lockError?: string | null;
  lockReason?: string | null;
  timestamp: string;
  explorerUrl?: string;
  latitude?: number | null;
  longitude?: number | null;
  locationFlagged?: boolean;
  distanceMeters?: number | null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECORDS_KEY = 'esyllab_attendance_records';

const STATUS_CONFIG: Record<AttendanceStatus, {
  label: string; color: string; bg: string; border: string; emoji: string;
}> = {
  Present:  { label: 'Present',  emoji: '✓', color: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/20' },
  Absent:   { label: 'Absent',   emoji: '✗', color: 'text-rose-400',    bg: 'bg-rose-950/40',    border: 'border-rose-500/20'    },
  Late:     { label: 'Late',     emoji: '◷', color: 'text-amber-400',   bg: 'bg-amber-950/40',   border: 'border-amber-500/20'   },
  OnLeave:  { label: 'On Leave', emoji: '⊘', color: 'text-sky-400',     bg: 'bg-sky-950/40',     border: 'border-sky-500/20'     },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Non-blocking location capture with a strict 5-second timeout.
 * Fails gracefully and silently returns null if denied or unavailable.
 */
async function getCurrentLocation(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof window === 'undefined' || !navigator.geolocation) {
    return null;
  }
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    }, 5000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          resolve({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        }
      },
      (err) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          console.warn('[Geolocation] Non-blocking coordinate capture note:', err.message);
          resolve(null);
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 60000,
      }
    );
  });
}

function isValidSolanaSig(sig?: string | null): boolean {
  if (!sig || typeof sig !== 'string') return false;
  const s = sig.trim();
  return (
    s.length >= 44 &&
    !s.startsWith('ledger-') &&
    !s.startsWith('cred-') &&
    !s.startsWith('queue-') &&
    !s.startsWith('recorded-') &&
    !s.startsWith('pending-') &&
    !s.startsWith('dummy-') &&
    !s.startsWith('att-') &&
    !s.startsWith('mock-') &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s)
  );
}

function loadRecords(): AttendanceRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]');
    if (!Array.isArray(raw)) return [];
    return raw.map((r: any) => {
      const isLocked = Boolean(r.confirmedOnChain) && isValidSolanaSig(r.signature);
      return {
        ...r,
        confirmedOnChain: isLocked,
        signature: isLocked ? r.signature : undefined,
        lockReason: isLocked ? null : (r.lockReason || 'The school lock wallet is not set'),
        explorerUrl: isLocked && r.signature ? `https://explorer.solana.com/tx/${r.signature}?cluster=devnet` : undefined,
      };
    });
  } catch { return []; }
}
function saveRecords(r: AttendanceRecord[]) {
  localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
}
function friendlyDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}
function friendlyError(err: any): string {
  const msg: string =
    err?.message || err?.error?.message ||
    (typeof err === 'string' ? err : '') ||
    JSON.stringify(err) || '';
  console.error('[Attendance] Error:', err);

  if (msg.includes('faucet') || msg.toLowerCase().includes('lamport') || msg.toLowerCase().includes('insufficient'))
    return 'The school record system needs a quick check by your administrator.';
  if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.includes('ECONNREFUSED'))
    return 'Cannot reach the server. Please check your internet connection and try again.';
  return 'Something went wrong saving this — please try again or check with your teacher or admin.';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { user: User; }

export const BlockchainAttendance: React.FC<Props> = ({ user }) => {
  // Pull the teacher's assigned classes, restricting strictly to Class A, Class B, Class C
  const rawClasses = user.teachingClasses && user.teachingClasses.length > 0
    ? user.teachingClasses
    : ['A', 'B', 'C'];
  const teachingClasses: string[] = rawClasses
    .filter(c => !['D', 'E', 'Class D', 'Class E', 'd', 'e'].includes(c.trim()))
    .map(c => c.startsWith('Class ') ? c : `Class ${c}`);

  const [records, setRecords]           = useState<AttendanceRecord[]>(loadRecords);
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);

  // Class is a dropdown of the teacher's assigned classes — not a free-text field
  const [className, setClassName]       = useState(teachingClasses[0] || '');
  const [status, setStatus]             = useState<AttendanceStatus>('Present');

  const [txState, setTxState]           = useState<'idle' | 'working' | 'done' | 'error'>('idle');
  const [txError, setTxError]           = useState('');
  const [lastRecord, setLastRecord]     = useState<AttendanceRecord | null>(null);
  const [showHistory, setShowHistory]   = useState(false);

  // Sync status banner — shows while offline records are being submitted
  const [syncStatus, setSyncStatus]     = useState<'idle' | 'syncing' | 'done'>('idle');
  const [syncMessage, setSyncMessage]   = useState('');
  const [retryingId, setRetryingId]     = useState<string | null>(null);

  // ── Load server records ───────────────────────────────────────────────────
  const loadServerRecords = useCallback(async () => {
    try {
      const res = await authFetch('/api/blockchain/attendance/my-records');
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.records) && data.records.length > 0) {
          const mapped: AttendanceRecord[] = data.records.map((r: any) => {
            const isLocked = Boolean(r.confirmedOnChain) && isValidSolanaSig(r.signature);
            return {
              id: r.id,
              staffId: r.staffId,
              staffName: r.staffName,
              date: r.date,
              time: r.time || '',
              className: r.className || '',
              status: r.status,
              offlineHash: r.offlineHash || '',
              signature: isLocked ? r.signature : undefined,
              slot: isLocked ? r.slot : undefined,
              syncedFromOffline: false,
              confirmedOnChain: isLocked,
              lockError: r.lockError,
              lockReason: isLocked ? null : (r.lockReason || 'The school lock wallet is not set'),
              timestamp: r.createdAt || new Date().toISOString(),
              latitude: r.latitude,
              longitude: r.longitude,
              locationFlagged: r.locationFlagged,
              distanceMeters: r.distanceMeters,
              explorerUrl: isLocked && r.signature ? `https://explorer.solana.com/tx/${r.signature}?cluster=devnet` : undefined,
            };
          });
          setRecords(mapped);
        }
      }
    } catch (err) {
      console.warn('[Attendance] Could not load server records:', err);
    }
  }, []);

  // ── Retry locking a record ────────────────────────────────────────────────
  const handleRetryLock = async (id: string) => {
    setRetryingId(id);
    try {
      const res = await retryAttendanceLock(id);
      if (res.success && res.results?.[0]?.success && isValidSolanaSig(res.results[0].signature)) {
        const result = res.results[0];
        setRecords(prev => prev.map(r => r.id === id ? {
          ...r,
          confirmedOnChain: true,
          signature: result.signature,
          slot: result.slot,
          lockError: null,
          lockReason: null,
          explorerUrl: result.explorerUrl || `https://explorer.solana.com/tx/${result.signature}?cluster=devnet`,
        } : r));
      } else if (res.results?.[0]) {
        const result = res.results[0];
        setRecords(prev => prev.map(r => r.id === id ? {
          ...r,
          confirmedOnChain: false,
          lockError: result.lockError,
          lockReason: result.lockReason || 'The lock network is busy. Try again in a minute',
        } : r));
      }
    } catch (err: any) {
      console.warn('[Attendance] Retry error:', err);
    } finally {
      setRetryingId(null);
    }
  };

  // ── Mount: check server, load records, try initial sync ──────────────────
  useEffect(() => {
    checkServer();
    loadServerRecords();
    syncOfflineQueue();
  }, [loadServerRecords]);

  useEffect(() => { saveRecords(records); }, [records]);

  // Auto-sync the moment internet returns
  useEffect(() => {
    const handleOnline = () => {
      console.log('[Attendance] Network restored — attempting offline sync...');
      syncOfflineQueue();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Backup: check every 30s in case the browser 'online' event doesn't fire
  useEffect(() => {
    const interval = setInterval(() => {
      if (navigator.onLine) syncOfflineQueue();
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  // ── Server health check ────────────────────────────────────────────────────
  const checkServer = useCallback(async () => {
    try {
      const res = await authFetch('/api/blockchain/status');
      const d   = await res.json();
      setServerOnline(d.connected);
    } catch { setServerOnline(false); }
  }, []);

  // ── Auto-sync offline queue via server keypair ─────────────────────────────
  const syncOfflineQueue = useCallback(async () => {
    try {
      const queueRes = await authFetch('/api/blockchain/attendance/queue');
      if (!queueRes.ok) return;
      const queueData = await queueRes.json();
      if (!queueData.success || queueData.count === 0) return;

      setSyncStatus('syncing');
      setSyncMessage(`Syncing ${queueData.count} offline record${queueData.count > 1 ? 's' : ''} securely…`);

      const syncRes = await syncAllAttendance();
      if (syncRes.success && syncRes.synced > 0) {
        setSyncMessage(`${syncRes.synced} record${syncRes.synced > 1 ? 's' : ''} secured ✓`);
        setSyncStatus('done');
        setTimeout(() => setSyncStatus('idle'), 5000);

        setRecords(prev => prev.map(r => ({ ...r, confirmedOnChain: true })));
      } else {
        setSyncStatus('idle');
      }
    } catch {
      setSyncStatus('idle');
    }
  }, []);

  // ── Save Attendance (online — server signs) ─────────────────────────────────
  const handleSave = async () => {
    setTxState('working');
    setTxError('');
    setLastRecord(null);

    try {
      const now          = new Date();
      const recordedDate = now.toISOString().slice(0, 10);
      const recordedTime = now.toTimeString().slice(0, 5);

      // Attempt non-blocking location capture (5s max timeout)
      const location = await getCurrentLocation();

      const data = await recordAttendanceOnline({
        staffId:        user.id,
        staffName:      user.name,
        date:           recordedDate,
        time:           recordedTime,
        className,
        status,
        schoolId:       'ZMB-KAPASA-001',
        localTimestamp: now.toISOString(),
        latitude:       location?.latitude ?? null,
        longitude:      location?.longitude ?? null,
      });

      const isLocked = Boolean(data.confirmedOnChain) && isValidSolanaSig(data.signature);
      const rec: AttendanceRecord = {
        id:                data.id || (isLocked && data.signature ? data.signature : `att-${Date.now()}`),
        staffId:           user.id,
        staffName:         user.name,
        date:              recordedDate,
        time:              recordedTime,
        className,
        status,
        offlineHash:       data.offlineHash || '',
        signature:         isLocked ? data.signature : undefined,
        slot:              isLocked ? data.slot : undefined,
        syncedFromOffline: false,
        confirmedOnChain:  isLocked,
        lockError:         data.lockError || null,
        lockReason:        isLocked ? null : (data.lockReason || 'The school lock wallet is not set'),
        timestamp:         now.toISOString(),
        explorerUrl:       isLocked && data.signature ? data.explorerUrl : undefined,
        latitude:          data.latitude ?? location?.latitude ?? null,
        longitude:         data.longitude ?? location?.longitude ?? null,
        locationFlagged:   data.locationFlagged ?? false,
        distanceMeters:    data.distanceMeters ?? null,
      };

      setRecords(prev => [rec, ...prev]);
      setLastRecord(rec);
      setTxState('done');

    } catch (err: any) {
      setTxError(friendlyError(err));
      setTxState('error');
    }
  };

  // ── Save to device only (offline queue — auto-syncs when online) ───────────
  const handleSaveOffline = async () => {
    setTxState('working');
    try {
      const now          = new Date();
      const recordedDate = now.toISOString().slice(0, 10);
      const recordedTime = now.toTimeString().slice(0, 5);

      // Attempt non-blocking location capture (5s max timeout)
      const location = await getCurrentLocation();

      const res = await authFetch('/api/blockchain/attendance/queue', {
        method: 'POST',
        body: JSON.stringify({
          staffId:        user.id,
          staffName:      user.name,
          date:           recordedDate,
          time:           recordedTime,
          className,
          status,
          schoolId:       'ZMB-KAPASA-001',
          localTimestamp: now.toISOString(),
          latitude:       location?.latitude ?? null,
          longitude:      location?.longitude ?? null,
        }),
      });
      const data = await res.json();

      const rec: AttendanceRecord = {
        id:                data.queueId || `offline-${Date.now()}`,
        staffId:           user.id,
        staffName:         user.name,
        date:              recordedDate,
        time:              recordedTime,
        className,
        status,
        offlineHash:       data.offlineHash || '',
        syncedFromOffline: true,
        confirmedOnChain:  false,
        timestamp:         now.toISOString(),
        latitude:          location?.latitude ?? null,
        longitude:         location?.longitude ?? null,
        locationFlagged:   data.locationFlagged ?? false,
        distanceMeters:    data.distanceMeters ?? null,
      };

      setRecords(prev => [rec, ...prev]);
      setLastRecord(rec);
      setTxState('done');

      // Immediately attempt to sync
      syncOfflineQueue();

    } catch (err: any) {
      setTxError('Could not save to your device. Please check storage permissions and try again.');
      setTxState('error');
    }
  };

  const busy = txState === 'working';

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-2xl mx-auto">

      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-primary-600 dark:text-primary-400" />
            Mark Attendance
          </h1>
          <p className="text-slate-600 dark:text-slate-400 text-sm mt-1">
            Record and manage student attendance.
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs mt-1">
          {serverOnline === null ? (
            <span className="text-slate-500 flex items-center gap-1.5">
              <Loader2 className="w-3 h-3 animate-spin" /> Checking…
            </span>
          ) : serverOnline ? (
            <span className="text-emerald-400 flex items-center gap-1.5">
              <Wifi className="w-3.5 h-3.5" /> Online
            </span>
          ) : (
            <span className="text-amber-400 flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5" /> Working locally
            </span>
          )}
          <button
            onClick={checkServer}
            className="ml-1 p-1 rounded-lg text-slate-600 hover:text-slate-400 transition-colors"
            title="Refresh connection"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Offline sync banner */}
      {syncStatus !== 'idle' && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-medium border animate-in fade-in ${
          syncStatus === 'syncing'
            ? 'bg-amber-950/20 border-amber-500/20 text-amber-400'
            : 'bg-emerald-950/20 border-emerald-500/20 text-emerald-400'
        }`}>
          {syncStatus === 'syncing'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <CheckCircle className="w-3.5 h-3.5" />
          }
          {syncMessage}
        </div>
      )}

      {/* Recorded by teacher info card */}
      <div className="glass-card px-5 py-3 rounded-2xl flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/20 flex items-center justify-center">
            <UserCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-slate-600 dark:text-slate-400">Recorded by</p>
            <p className="text-sm font-bold text-slate-900 dark:text-white">{user.name}</p>
          </div>
        </div>
        <span className="px-2.5 py-1 bg-emerald-100 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-500/20 text-emerald-800 dark:text-emerald-400 text-[11px] font-bold rounded-full">
          Secure &amp; Ready
        </span>
      </div>

      {/* Attendance form */}
      <div className="glass-card p-6 rounded-2xl space-y-5">

        {/* Class dropdown — populated from teacher's assigned classes */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-700 dark:text-slate-300 ml-0.5">Class</label>
          {teachingClasses.length > 0 ? (
            <select
              value={className}
              onChange={e => setClassName(e.target.value)}
              className="w-full px-4 py-3 bg-white dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-xl text-sm text-slate-900 dark:text-white outline-none focus:border-primary-500 transition-colors cursor-pointer"
            >
              <option value="" className="bg-white text-slate-900 dark:bg-[#0d0f1a] dark:text-white">Select your class…</option>
              {teachingClasses.map(c => (
                <option key={c} value={c} className="bg-white text-slate-900 dark:bg-[#0d0f1a] dark:text-white">{c}</option>
              ))}
            </select>
          ) : (
            <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-300 dark:border-amber-500/20 rounded-xl text-xs text-amber-800 dark:text-amber-400">
              No classes assigned to your profile yet. Ask an admin to add your teaching classes.
            </div>
          )}
        </div>

        {/* Date/Time (read-only) + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 ml-0.5">Date &amp; Time</label>
            <div className="w-full px-4 py-3 bg-slate-100 dark:bg-white/5 border border-slate-300 dark:border-white/10 rounded-xl text-sm text-slate-800 dark:text-slate-200 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {friendlyDate(new Date().toISOString())} · {new Date().toTimeString().slice(0, 5)}
            </div>
            <p className="text-[10px] text-slate-600 dark:text-slate-400 ml-0.5">
              Captured automatically when you save — cannot be edited
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 dark:text-slate-300 ml-0.5">Today's Status</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => {
                const cfg      = STATUS_CONFIG[s];
                const selected = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-bold border transition-all active:scale-95 flex items-center justify-center gap-1.5 cursor-pointer ${
                      selected
                        ? `${cfg.bg} ${cfg.color} ${cfg.border} shadow-lg`
                        : 'bg-slate-100 dark:bg-white/5 border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-400 hover:border-slate-400 dark:hover:border-white/20 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                  >
                    <span>{cfg.emoji}</span> {cfg.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Primary action */}
        <button
          onClick={handleSave}
          disabled={busy}
          className="w-full py-4 bg-primary-600 text-white rounded-xl font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-700 transition-all active:scale-95 shadow-lg shadow-primary-900/40 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
        >
          {busy ? (
            <><Loader2 className="w-5 h-5 animate-spin" /> Saving…</>
          ) : (
            <><BookOpen className="w-5 h-5" /> Save Attendance</>
          )}
        </button>

        {/* Secondary action */}
        <button
          onClick={handleSaveOffline}
          disabled={busy}
          className="w-full py-3 bg-slate-100 dark:bg-white/5 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-slate-200 dark:hover:bg-white/10 hover:text-slate-900 dark:hover:text-white transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
        >
          <Clock className="w-4 h-4 text-slate-600 dark:text-slate-400" /> Save to device only (auto-syncs when online)
        </button>

        <p className="text-[11px] text-slate-600 dark:text-slate-400 text-center font-medium">
          "Save Attendance" creates a permanent record · "Save to device only" stores it locally and secures it automatically when you reconnect
        </p>
      </div>

      {/* Result banner */}
      {txState === 'done' && lastRecord && (
        <div className="p-5 rounded-2xl border animate-in slide-in-from-top-2 bg-emerald-950/20 border-emerald-500/30">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-base text-emerald-400">
                Attendance saved.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {`${user.name}${lastRecord.className ? ' · ' + lastRecord.className : ''} · ${lastRecord.date} ${lastRecord.time} · ${STATUS_CONFIG[lastRecord.status].label}`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setTxState('idle')}
                  className="px-4 py-2 bg-primary-600 text-white text-xs font-bold rounded-xl hover:bg-primary-700 transition-all active:scale-95"
                >
                  Mark another day
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {txState === 'error' && (
        <div className="p-5 rounded-2xl bg-rose-950/20 border border-rose-500/30 animate-in slide-in-from-top-2">
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-bold text-rose-400 text-sm">Could not save attendance</p>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">{txError}</p>
              <button
                onClick={() => setTxState('idle')}
                className="mt-3 px-4 py-2 bg-white/5 border border-white/10 text-slate-300 text-xs font-bold rounded-xl hover:bg-white/10 transition-colors"
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Attendance history */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <button
          onClick={() => setShowHistory(v => !v)}
          className="w-full p-5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-3">
            <CalendarCheck className="w-5 h-5 text-primary-600 dark:text-primary-400" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white text-sm">Attendance History</p>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {records.length} record{records.length !== 1 ? 's' : ''} saved
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>

        {showHistory && (
          <div className="border-t border-slate-200 dark:border-white/5">
            {records.length === 0 ? (
              <div className="p-10 text-center text-slate-600 dark:text-slate-400 text-sm italic">
                No records yet. Save your first attendance above.
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-white/5">
                {records.map(r => {
                  const cfg = STATUS_CONFIG[r.status];
                  const isLocked = Boolean(r.confirmedOnChain) && isValidSolanaSig(r.signature);
                  return (
                    <div
                      key={r.id}
                      className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl ${cfg.bg} ${cfg.border} border flex items-center justify-center ${cfg.color} font-bold text-base shrink-0`}>
                          {cfg.emoji}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-200">
                            {friendlyDate(r.date)}{r.time ? ` · ${r.time}` : ''}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {r.staffName}{r.className ? ` · ${r.className}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                          {cfg.label}
                        </span>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                          <CheckCircle className="w-3.5 h-3.5" /> Saved.
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
};
