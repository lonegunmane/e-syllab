import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  CheckSquare, Search, RefreshCw, Loader2, CheckCircle2,
  XCircle, Clock, ExternalLink, ShieldCheck, Lock, AlertCircle
} from 'lucide-react';
import { getAdminActivity, checkAdminActivity, lockWaitingActivity } from '../services/api';

export interface ActivityRecord {
  id: string;
  type: 'Attendance' | 'Grade' | 'Assessment' | 'Paper' | string;
  who: string;
  whoRole: 'Teacher' | 'Student' | string;
  className: string;
  date: string;
  summary: string;
  confirmedOnChain: boolean;
  signature: string | null;
  explorerUrl?: string;
  timestamp?: string;
}

interface CheckResult {
  checked: boolean;
  match: boolean;
  locked: boolean;
  message: string;
  explorerUrl?: string;
}

export const CheckRecordsView: React.FC = () => {
  const [records, setRecords] = useState<ActivityRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Locking state
  const [lockingWaiting, setLockingWaiting] = useState<boolean>(false);
  const [lockMessage, setLockMessage] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // Per-row check state
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkResults, setCheckResults] = useState<Record<string, CheckResult>>({});

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAdminActivity();
      if (res.success && Array.isArray(res.activity)) {
        setRecords(res.activity);
      } else {
        setRecords([]);
      }
    } catch (err: any) {
      console.error('[CheckRecords] Fetch error:', err);
      setError('Could not load school records. Please refresh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Check a single record
  const handleCheckRecord = async (record: ActivityRecord) => {
    if (!record.id) return;

    setCheckingId(record.id);
    try {
      const res = await checkAdminActivity(record.id);
      setCheckResults(prev => ({
        ...prev,
        [record.id]: {
          checked: true,
          match: Boolean(res.match),
          locked: Boolean(res.locked),
          message: res.message || (res.match ? (res.locked ? 'Matches record saved at school and locked on public ledger.' : 'Matches record saved at school. Waiting to lock.') : 'This record does not match school records.'),
          explorerUrl: res.explorerUrl,
        },
      }));
    } catch (err: any) {
      setCheckResults(prev => ({
        ...prev,
        [record.id]: {
          checked: true,
          match: false,
          locked: false,
          message: 'This record does not match school records.',
        },
      }));
    } finally {
      setCheckingId(null);
    }
  };

  // Lock waiting records
  const handleLockWaiting = async () => {
    setLockingWaiting(true);
    setLockMessage(null);
    try {
      const res = await lockWaitingActivity();
      if (res.locked > 0) {
        setLockMessage({
          type: 'success',
          text: res.message || `Successfully locked ${res.locked} record${res.locked > 1 ? 's' : ''} on the public ledger.`,
        });
      } else {
        setLockMessage({
          type: 'info',
          text: res.message || 'Cannot lock on public ledger right now. Saved at school.',
        });
      }
      await fetchRecords();
    } catch (err: any) {
      setLockMessage({
        type: 'info',
        text: 'Cannot lock on public ledger right now. Saved at school.',
      });
    } finally {
      setLockingWaiting(false);
    }
  };

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter(r => {
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch = !q ||
        (r.who && r.who.toLowerCase().includes(q)) ||
        (r.type && r.type.toLowerCase().includes(q)) ||
        (r.className && r.className.toLowerCase().includes(q)) ||
        (r.date && r.date.toLowerCase().includes(q)) ||
        (r.summary && r.summary.toLowerCase().includes(q));

      const matchesType = typeFilter === 'ALL' || r.type.toUpperCase() === typeFilter.toUpperCase();
      const statusStr = r.confirmedOnChain ? 'LOCKED' : 'WAITING';
      const matchesStatus = statusFilter === 'ALL' || statusStr === statusFilter.toUpperCase();

      return matchesSearch && matchesType && matchesStatus;
    });
  }, [records, searchQuery, typeFilter, statusFilter]);

  const lockedCount = records.filter(r => r.confirmedOnChain).length;
  const waitingCount = records.filter(r => !r.confirmedOnChain).length;

  return (
    <div className="space-y-6 max-w-7xl mx-auto animate-in fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-primary-400" />
            Check records
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Oversee school-wide attendance, grades, assessments, and vault documents.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={handleLockWaiting}
            disabled={lockingWaiting || waitingCount === 0}
            className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-40 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all active:scale-95 shadow-md shadow-primary-950/40 cursor-pointer"
          >
            {lockingWaiting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Lock className="w-3.5 h-3.5" />
            )}
            Lock waiting records ({waitingCount})
          </button>

          <button
            onClick={fetchRecords}
            disabled={loading}
            className="px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Lock Feedback Banner */}
      {lockMessage && (
        <div className={`p-4 rounded-2xl border flex items-center justify-between gap-3 text-xs font-semibold animate-in fade-in ${
          lockMessage.type === 'success'
            ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
            : 'bg-amber-950/40 text-amber-300 border-amber-500/30'
        }`}>
          <div className="flex items-center gap-2">
            {lockMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            )}
            <span>{lockMessage.text}</span>
          </div>
          <button
            onClick={() => setLockMessage(null)}
            className="text-slate-400 hover:text-white text-xs px-2 py-1"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass-card p-5 rounded-2xl border border-white/10">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total School Records</p>
          <p className="text-2xl font-bold text-white mt-1">{records.length}</p>
          <p className="text-xs text-slate-500 mt-0.5">Attendance, grades, assessments, and papers</p>
        </div>

        <div className="glass-card p-5 rounded-2xl border border-white/10">
          <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">Locked</p>
          <p className="text-2xl font-bold text-emerald-400 mt-1">{lockedCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Saved and permanently locked</p>
        </div>

        <div className="glass-card p-5 rounded-2xl border border-white/10">
          <p className="text-[11px] font-bold text-amber-400 uppercase tracking-wider">Waiting</p>
          <p className="text-2xl font-bold text-amber-400 mt-1">{waitingCount}</p>
          <p className="text-xs text-slate-500 mt-0.5">Saved at school, waiting to lock</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-card p-4 rounded-2xl border border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          {/* Type filters */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10 overflow-x-auto max-w-full">
            {['ALL', 'Attendance', 'Grade', 'Assessment', 'Paper'].map(t => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  typeFilter === t
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {t === 'ALL' ? 'All Types' : t}
              </button>
            ))}
          </div>

          {/* Status filters */}
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-xl border border-white/10">
            {['ALL', 'Locked', 'Waiting'].map(s => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors whitespace-nowrap cursor-pointer ${
                  statusFilter === s
                    ? 'bg-white/15 text-white'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {s === 'ALL' ? 'All Status' : s}
              </button>
            ))}
          </div>
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search person, class, or summary…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500 transition-colors"
          />
        </div>
      </div>

      {/* Main Records Table */}
      <div className="glass-card rounded-3xl overflow-hidden border border-white/10">
        {loading ? (
          <div className="p-12 flex flex-col items-center justify-center text-slate-400 gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
            <p className="text-sm">Loading school records…</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400 bg-rose-950/20 border border-rose-500/20 rounded-2xl text-xs font-bold">
            {error}
          </div>
        ) : filteredRecords.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm italic">
            No records found matching your filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  <th className="p-4">Date</th>
                  <th className="p-4">Person</th>
                  <th className="p-4">Type</th>
                  <th className="p-4">Summary</th>
                  <th className="p-4">Status</th>
                  <th className="p-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredRecords.map(rec => {
                  const isCheckingThis = checkingId === rec.id;
                  const rowResult = checkResults[rec.id];

                  return (
                    <tr key={rec.id} className="hover:bg-white/5 transition-colors group">
                      {/* Date */}
                      <td className="p-4 text-slate-300 font-medium whitespace-nowrap">
                        {rec.date}
                      </td>

                      {/* Person & Role */}
                      <td className="p-4 whitespace-nowrap">
                        <p className="font-bold text-white text-sm">{rec.who}</p>
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-slate-400 font-medium">
                          {rec.whoRole || 'Member'} • {rec.className || 'General'}
                        </span>
                      </td>

                      {/* Type */}
                      <td className="p-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold border ${
                          rec.type === 'Attendance'
                            ? 'bg-sky-950/40 text-sky-400 border-sky-500/20'
                            : rec.type === 'Grade'
                            ? 'bg-purple-950/40 text-purple-400 border-purple-500/20'
                            : rec.type === 'Assessment'
                            ? 'bg-amber-950/40 text-amber-400 border-amber-500/20'
                            : 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20'
                        }`}>
                          {rec.type}
                        </span>
                      </td>

                      {/* Summary */}
                      <td className="p-4 max-w-xs">
                        <p className="text-slate-300 font-medium truncate">{rec.summary}</p>
                      </td>

                      {/* Status */}
                      <td className="p-4 whitespace-nowrap">
                        {rec.confirmedOnChain ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-950/40 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold rounded-full">
                            <CheckCircle2 className="w-3 h-3" /> Locked
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-950/40 border border-amber-500/30 text-amber-400 text-[11px] font-bold rounded-full">
                            <Clock className="w-3 h-3" /> Waiting
                          </span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="p-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          {rowResult ? (
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex items-center gap-1 text-xs font-bold ${
                                rowResult.match ? 'text-emerald-400' : 'text-rose-400'
                              }`}>
                                {rowResult.match ? (
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5" />
                                )}
                                {rowResult.message}
                              </span>

                              {rowResult.locked && rowResult.explorerUrl && (
                                <a
                                  href={rowResult.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <span>Open public proof</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleCheckRecord(rec)}
                                disabled={isCheckingThis}
                                className="px-3 py-1.5 bg-primary-600/80 hover:bg-primary-600 disabled:opacity-50 text-white font-bold text-xs rounded-xl inline-flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                              >
                                {isCheckingThis ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <ShieldCheck className="w-3 h-3" />
                                )}
                                Check this record
                              </button>

                              {rec.confirmedOnChain && rec.explorerUrl && (
                                <a
                                  href={rec.explorerUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <span>Open public proof</span>
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
