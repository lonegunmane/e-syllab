import React, { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, Clock, Loader2,
  ExternalLink, RefreshCw,
  UserCheck, BookOpen, CalendarCheck, Wifi, WifiOff,
  ChevronDown,
} from 'lucide-react';
import { User } from '../types';
import { authFetch, recordAttendanceOnline, syncAllAttendance } from '../services/api';

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
  timestamp: string;
  explorerUrl?: string;
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

function loadRecords(): AttendanceRecord[] {
  try { return JSON.parse(localStorage.getItem(RECORDS_KEY) || '[]'); } catch { return []; }
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
    return 'The school signing account needs to be funded. Please contact your IT administrator.';
  if (msg.toLowerCase().includes('fetch') || msg.toLowerCase().includes('network') || msg.includes('ECONNREFUSED'))
    return 'Cannot reach the server. Check your internet connection and try again.';
  return msg || 'Something went wrong. Please try again or contact your IT support if it keeps failing.';
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props { user: User; }

export const BlockchainAttendance: React.FC<Props> = ({ user }) => {
  // Pull the teacher's assigned classes directly from their profile
  const teachingClasses: string[] = user.teachingClasses && user.teachingClasses.length > 0
    ? user.teachingClasses
    : [];

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

  // ── Mount: check server, try initial sync ────────────────────────────────
  useEffect(() => {
    checkServer();
    syncOfflineQueue();
  }, []);

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
      setSyncMessage(`Syncing ${queueData.count} offline record${queueData.count > 1 ? 's' : ''} to blockchain…`);

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

      const data = await recordAttendanceOnline({
        staffId:        user.id,
        staffName:      user.name,
        date:           recordedDate,
        time:           recordedTime,
        className,
        status,
        schoolId:       'ZMB-KAPASA-001',
        localTimestamp: now.toISOString(),
      });

      const rec: AttendanceRecord = {
        id:                data.signature || `rec-${Date.now()}`,
        staffId:           user.id,
        staffName:         user.name,
        date:              recordedDate,
        time:              recordedTime,
        className,
        status,
        offlineHash:       data.offlineHash || '',
        signature:         data.signature,
        slot:              data.slot,
        syncedFromOffline: false,
        confirmedOnChain:  data.confirmedOnChain ?? true,
        timestamp:         now.toISOString(),
        explorerUrl:       data.explorerUrl,
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
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-primary-400" />
            Mark Attendance
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Your attendance is saved securely and cannot be altered.
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
            <span className="text-rose-400 flex items-center gap-1.5">
              <WifiOff className="w-3.5 h-3.5" /> Offline
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
          <div className="w-8 h-8 rounded-full bg-emerald-950/40 border border-emerald-500/20 flex items-center justify-center">
            <UserCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Recorded by</p>
            <p className="text-sm font-bold text-white">{user.name}</p>
          </div>
        </div>
        <span className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded-full">
          School Keypair Active
        </span>
      </div>

      {/* Attendance form */}
      <div className="glass-card p-6 rounded-2xl space-y-5">

        {/* Class dropdown — populated from teacher's assigned classes */}
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-slate-400 ml-0.5">Class</label>
          {teachingClasses.length > 0 ? (
            <select
              value={className}
              onChange={e => setClassName(e.target.value)}
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
            >
              <option value="" className="bg-[#0d0f1a]">Select your class…</option>
              {teachingClasses.map(c => (
                <option key={c} value={c} className="bg-[#0d0f1a]">{c}</option>
              ))}
            </select>
          ) : (
            <div className="px-4 py-3 bg-amber-950/20 border border-amber-500/20 rounded-xl text-xs text-amber-400">
              No classes assigned to your profile yet. Ask an admin to add your teaching classes.
            </div>
          )}
        </div>

        {/* Date/Time (read-only) + Status */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 ml-0.5">Date &amp; Time</label>
            <div className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-slate-300 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              {friendlyDate(new Date().toISOString())} · {new Date().toTimeString().slice(0, 5)}
            </div>
            <p className="text-[10px] text-slate-600 ml-0.5">
              Captured automatically when you save — cannot be edited
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-400 ml-0.5">Today's Status</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(STATUS_CONFIG) as AttendanceStatus[]).map(s => {
                const cfg      = STATUS_CONFIG[s];
                const selected = status === s;
                return (
                  <button
                    key={s}
                    onClick={() => setStatus(s)}
                    className={`py-2.5 px-3 rounded-xl text-sm font-bold border transition-all active:scale-95 flex items-center justify-center gap-1.5 ${
                      selected
                        ? `${cfg.bg} ${cfg.color} ${cfg.border} shadow-lg`
                        : 'bg-white/5 border-white/10 text-slate-500 hover:border-white/20 hover:text-slate-300'
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
          className="w-full py-4 bg-primary-600 text-white rounded-xl font-bold text-base flex items-center justify-center gap-2 hover:bg-primary-700 transition-all active:scale-95 shadow-lg shadow-primary-900/40 disabled:opacity-60 disabled:cursor-not-allowed"
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
          className="w-full py-3 bg-white/5 border border-white/10 text-slate-400 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:border-primary-500/30 hover:text-white transition-all active:scale-95 disabled:opacity-50"
        >
          <Clock className="w-4 h-4" /> Save to device only (auto-syncs when online)
        </button>

        <p className="text-[11px] text-slate-600 text-center">
          "Save Attendance" creates a permanent record · "Save to device only" stores it locally and secures it automatically when you reconnect
        </p>
      </div>

      {/* Result banner */}
      {txState === 'done' && lastRecord && (
        <div className={`p-5 rounded-2xl border animate-in slide-in-from-top-2 ${
          lastRecord.confirmedOnChain
            ? 'bg-emerald-950/20 border-emerald-500/30'
            : 'bg-amber-950/20 border-amber-500/30'
        }`}>
          <div className="flex items-start gap-3">
            {lastRecord.confirmedOnChain
              ? <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
              : <Clock        className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            }
            <div className="flex-1">
              <p className={`font-bold text-base ${lastRecord.confirmedOnChain ? 'text-emerald-400' : 'text-amber-400'}`}>
                {lastRecord.confirmedOnChain ? 'Attendance saved & verified ✓' : 'Saved to your device'}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                {lastRecord.confirmedOnChain
                  ? `${user.name}${lastRecord.className ? ' · ' + lastRecord.className : ''} · ${lastRecord.date} ${lastRecord.time} · ${STATUS_CONFIG[lastRecord.status].label} · Permanently recorded`
                  : 'This will be automatically secured the next time you have internet.'}
              </p>
              {lastRecord.confirmedOnChain && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => setTxState('idle')}
                    className="px-4 py-2 bg-primary-600 text-white text-xs font-bold rounded-xl hover:bg-primary-700 transition-all active:scale-95"
                  >
                    Mark another day
                  </button>
                  {lastRecord.explorerUrl && (
                    <a
                      href={lastRecord.explorerUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-primary-400 transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5" /> View verification record
                    </a>
                  )}
                </div>
              )}
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
            <CalendarCheck className="w-5 h-5 text-primary-400" />
            <div>
              <p className="font-bold text-white text-sm">Attendance History</p>
              <p className="text-xs text-slate-500">
                {records.length} record{records.length !== 1 ? 's' : ''} saved
              </p>
            </div>
          </div>
          <ChevronDown className={`w-4 h-4 text-slate-500 transition-transform ${showHistory ? 'rotate-180' : ''}`} />
        </button>

        {showHistory && (
          <div className="border-t border-white/5">
            {records.length === 0 ? (
              <div className="p-10 text-center text-slate-500 text-sm italic">
                No records yet. Save your first attendance above.
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {records.map(r => {
                  const cfg = STATUS_CONFIG[r.status];
                  return (
                    <div
                      key={r.id}
                      className="px-5 py-4 flex items-center justify-between gap-4 hover:bg-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl ${cfg.bg} ${cfg.border} border flex items-center justify-center ${cfg.color} font-bold text-base shrink-0`}>
                          {cfg.emoji}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200">
                            {friendlyDate(r.date)}{r.time ? ` · ${r.time}` : ''}
                          </p>
                          <p className="text-xs text-slate-500">
                            {r.staffName}{r.className ? ` · ${r.className}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                          {cfg.label}
                        </span>
                        {r.confirmedOnChain ? (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-400">
                            <CheckCircle className="w-3.5 h-3.5" /> Verified
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[11px] font-bold text-amber-400">
                            <Clock className="w-3.5 h-3.5" /> Pending
                          </span>
                        )}
                        {r.explorerUrl && (
                          <a
                            href={r.explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-600 hover:text-primary-400 transition-colors"
                            title="View verification record"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
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
