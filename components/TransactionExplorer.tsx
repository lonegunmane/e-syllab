import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Database, Search, RefreshCw, Loader2, CheckCircle2,
  XCircle, ExternalLink, ShieldCheck, Zap, ArrowUpRight,
  Filter, Layers, GraduationCap, Award, CheckSquare, FileCode,
  Copy, Check, AlertTriangle, Eye, ChevronRight, Activity, Cpu
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, PieChart, Pie
} from 'recharts';
import { getAllLedgerRecords, verifyLedgerRecord } from '../services/api';

export interface LedgerEvent {
  offlineHash: string;
  signature: string;
  slot: number;
  type: 'GRADE' | 'CREDENTIAL' | 'ATTENDANCE' | 'SYSTEM_ANCHOR' | string;
  timestamp: string;
  status: 'CONFIRMED' | 'PENDING_SYNC' | string;
  explorerUrl?: string;
  details?: string;
  // Grade fields
  studentId?: string;
  studentName?: string;
  teacherId?: string;
  teacherName?: string;
  subject?: string;
  score?: number;
  grade?: string;
  academicYear?: string;
  term?: string;
  // Credential fields
  credentialId?: string;
  credentialType?: string;
  issuedBy?: string;
  issuedById?: string;
  subjects?: Array<{ subject: string; grade: string; score?: number }>;
  // Attendance fields
  staffId?: string;
  staffName?: string;
  date?: string;
  time?: string;
  className?: string;
  attendanceStatus?: string;
  // Vault/System
  vaultId?: string;
  title?: string;
  approvedBy?: string;
  schoolId?: string;
}

const TYPE_COLORS: Record<string, { bg: string; text: string; border: string; label: string }> = {
  GRADE: { bg: 'bg-purple-950/50', text: 'text-purple-400', border: 'border-purple-500/30', label: 'Grade Entry' },
  CREDENTIAL: { bg: 'bg-emerald-950/50', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'Academic Certificate' },
  ATTENDANCE: { bg: 'bg-blue-950/50', text: 'text-blue-400', border: 'border-blue-500/30', label: 'Attendance Record' },
  SYSTEM_ANCHOR: { bg: 'bg-amber-950/50', text: 'text-amber-400', border: 'border-amber-500/30', label: 'System Update' },
};

export const TransactionExplorer: React.FC = () => {
  const [events, setEvents] = useState<LedgerEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState('');
  
  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Selected event for modal inspector
  const [selectedEvent, setSelectedEvent] = useState<LedgerEvent | null>(null);

  // Verification state
  const [verifyInputHash, setVerifyInputHash] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ isValid: boolean; message: string; record?: any; signature?: string; slot?: number } | null>(null);

  // Copy feedback
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const fetchRecords = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshing(true);
    else setIsLoading(true);
    setError('');

    try {
      const res = await getAllLedgerRecords();
      if (res.success && Array.isArray(res.records)) {
        setEvents(res.records);
      } else {
        setError('Failed to load ledger records from backend.');
      }
    } catch (err: any) {
      setError(err.message || 'Error fetching blockchain ledger records.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  // Copy helper
  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHash(text);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Filtered Events
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      const q = searchTerm.toLowerCase().trim();
      const matchesSearch =
        !q ||
        e.offlineHash?.toLowerCase().includes(q) ||
        e.signature?.toLowerCase().includes(q) ||
        e.studentName?.toLowerCase().includes(q) ||
        e.teacherName?.toLowerCase().includes(q) ||
        e.staffName?.toLowerCase().includes(q) ||
        e.subject?.toLowerCase().includes(q) ||
        e.details?.toLowerCase().includes(q) ||
        e.credentialType?.toLowerCase().includes(q) ||
        e.title?.toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (typeFilter !== 'ALL' && e.type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && e.status !== statusFilter) return false;

      return true;
    });
  }, [events, searchTerm, typeFilter, statusFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const total = events.length;
    const grades = events.filter((e) => e.type === 'GRADE').length;
    const credentials = events.filter((e) => e.type === 'CREDENTIAL').length;
    const attendance = events.filter((e) => e.type === 'ATTENDANCE').length;
    const system = events.filter((e) => e.type === 'SYSTEM_ANCHOR').length;
    const maxSlot = events.reduce((max, e) => Math.max(max, e.slot || 0), 0);

    return { total, grades, credentials, attendance, system, maxSlot };
  }, [events]);

  // Chart Data
  const chartData = useMemo(() => {
    return [
      { name: 'Grade Entries', count: metrics.grades, color: '#a855f7' },
      { name: 'Academic Records', count: metrics.credentials, color: '#10b981' },
      { name: 'Attendance Records', count: metrics.attendance, color: '#3b82f6' },
      { name: 'System Updates', count: metrics.system, color: '#f59e0b' },
    ];
  }, [metrics]);

  // Verify hash click handler
  const handleVerifyHash = async (hashToVerify?: string) => {
    const targetHash = (hashToVerify || verifyInputHash).trim();
    if (!targetHash) return;

    setVerifying(true);
    setVerifyResult(null);

    try {
      const res = await verifyLedgerRecord(targetHash);
      setVerifyResult(res);
    } catch (err: any) {
      setVerifyResult({
        isValid: false,
        message: err.message || 'Could not verify record.',
      });
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
      {/* Top Banner & Header */}
      <div className="glass-card p-6 rounded-2xl relative overflow-hidden border border-white/10 bg-gradient-to-r from-[#1e1035]/80 via-[#13112c]/80 to-[#0e172a]/80">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2.5 py-0.5 rounded-full bg-primary-500/20 text-primary-300 border border-primary-500/30 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5">
                <Cpu className="w-3 h-3 text-primary-400 animate-pulse" />
                Verified School Records
              </span>
              <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[10px] font-bold uppercase">
                Protected &amp; Permanent
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Database className="w-6 h-6 text-primary-400" />
              Verified Record History
            </h1>
            <p className="text-slate-300 text-xs mt-1 max-w-2xl leading-relaxed">
              View and audit all tamper-proof school records, including grade submissions, certificates, attendance logs, and system updates.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => fetchRecords(true)}
              disabled={isRefreshing}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 border border-white/15 text-xs text-white hover:bg-primary-600 hover:border-primary-500 transition-all shadow-md active:scale-95 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-primary-300' : ''}`} />
              Refresh Records
            </button>
          </div>
        </div>

        {/* Floating background icon */}
        <Activity className="absolute -bottom-8 -right-8 w-40 h-40 text-white/5 pointer-events-none" />
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Records</p>
          <p className="text-2xl font-bold text-white mt-1">{metrics.total}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Securely logged</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 text-purple-400">
            <GraduationCap className="w-3 h-3" /> Grades
          </p>
          <p className="text-2xl font-bold text-purple-300 mt-1">{metrics.grades}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Recorded grades</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 text-emerald-400">
            <Award className="w-3 h-3" /> Certificates
          </p>
          <p className="text-2xl font-bold text-emerald-300 mt-1">{metrics.credentials}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Issued credentials</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 text-blue-400">
            <CheckSquare className="w-3 h-3" /> Attendance
          </p>
          <p className="text-2xl font-bold text-blue-300 mt-1">{metrics.attendance}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">Verified entries</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest flex items-center gap-1 text-amber-400">
            <ShieldCheck className="w-3 h-3" /> Updates
          </p>
          <p className="text-2xl font-bold text-amber-300 mt-1">{metrics.system}</p>
          <p className="text-[10px] text-slate-500 mt-0.5">System updates</p>
        </div>

        <div className="glass-card p-4 rounded-2xl border border-white/5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest text-primary-400">Latest Record #</p>
          <p className="text-lg font-mono font-bold text-white mt-1 truncate">
            {metrics.maxSlot > 0 ? `#${metrics.maxSlot.toLocaleString()}` : '—'}
          </p>
          <p className="text-[10px] text-slate-500 mt-0.5">Verified network</p>
        </div>
      </div>

      {/* Visual Analytics Bar Chart & Verification Tool */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ledger Event Distribution Chart */}
        <div className="lg:col-span-2 glass-card p-6 rounded-2xl border border-white/5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-white text-sm flex items-center gap-2">
                <BarChart className="w-4 h-4 text-primary-400" />
                Record Distribution
              </h3>
              <p className="text-slate-400 text-xs">Breakdown of all saved record types</p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white/5 text-slate-300 border border-white/10">
              Live Overview
            </span>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} tickLine={false} />
                <YAxis stroke="#94a3b8" fontSize={11} allowDecimals={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#13112c', borderColor: '#ffffff20', borderRadius: '12px', fontSize: '12px' }}
                  itemStyle={{ color: '#ffffff' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Hash Verification Tool Console */}
        <div className="glass-card p-6 rounded-2xl border border-white/5 flex flex-col justify-between">
          <div>
            <h3 className="font-bold text-white text-sm flex items-center gap-2 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Security Code Checker
            </h3>
            <p className="text-slate-400 text-xs mb-4">
              Enter any record's digital fingerprint security code to confirm it is genuine and untouched.
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 block">
                  Security Code
                </label>
                <div className="relative">
                  <input
                    type="text"
                    placeholder="e.g., a9f82c0192e84d3b6e82a..."
                    value={verifyInputHash}
                    onChange={(e) => setVerifyInputHash(e.target.value)}
                    className="w-full px-3 py-2 bg-black/40 border border-white/10 rounded-xl text-xs text-white font-mono placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-all pr-8"
                  />
                  {verifyInputHash && (
                    <button
                      onClick={() => setVerifyInputHash('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              <button
                onClick={() => handleVerifyHash()}
                disabled={verifying || !verifyInputHash.trim()}
                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl font-bold text-xs transition-all shadow-lg shadow-emerald-950/40 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                Check Record Authenticity
              </button>
            </div>
          </div>

          {verifyResult && (
            <div
              className={`mt-4 p-3 rounded-xl border text-xs animate-in fade-in ${
                verifyResult.isValid
                  ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/50 border-rose-500/40 text-rose-300'
              }`}
            >
              <div className="flex items-start gap-2">
                {verifyResult.isValid ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <p className="font-bold">{verifyResult.isValid ? 'Record Confirmed Authentic' : 'Verification Failed'}</p>
                  <p className="text-[11px] mt-0.5 opacity-90">{verifyResult.message}</p>
                  {verifyResult.isValid && verifyResult.slot ? (
                    <p className="text-[10px] font-mono mt-1 opacity-75">
                      Record: #{verifyResult.slot} | Ref: {verifyResult.signature?.slice(0, 16)}…
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main Ledger Table Controls & Search */}
      <div className="p-4 glass-card border border-white/5 rounded-2xl flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by security code, student, teacher, or subject..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-black/30 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500 transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              ×
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-black/30 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="ALL" className="bg-[#1a1635]">All Types</option>
            <option value="GRADE" className="bg-[#1a1635]">Grade Entries</option>
            <option value="CREDENTIAL" className="bg-[#1a1635]">Certificates &amp; Diplomas</option>
            <option value="ATTENDANCE" className="bg-[#1a1635]">Attendance Records</option>
            <option value="SYSTEM_ANCHOR" className="bg-[#1a1635]">System Updates</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-black/30 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="ALL" className="bg-[#1a1635]">All Statuses</option>
            <option value="CONFIRMED" className="bg-[#1a1635]">Verified &amp; Saved</option>
            <option value="PENDING_SYNC" className="bg-[#1a1635]">Pending Connection</option>
          </select>
        </div>
      </div>

      {/* Ledger Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-white/5">
        <div className="p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="font-bold text-white text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-primary-400" />
            Recent Saved Records
          </h3>
          <span className="px-2.5 py-0.5 bg-primary-950/40 text-primary-300 text-[10px] font-bold rounded-full border border-primary-500/20">
            {filteredEvents.length} Saved Records
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-3" />
            <p className="text-slate-400 text-sm">Loading verified school records…</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400 text-sm">{error}</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-12 text-center text-slate-500 italic text-sm">
            <Database className="w-10 h-10 mx-auto mb-3 opacity-20" />
            No records found matching your search.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-white/5 text-slate-400 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-4 py-3.5">Record Type</th>
                  <th className="px-4 py-3.5">Security Code &amp; Reference ID</th>
                  <th className="px-4 py-3.5">Details &amp; Author</th>
                  <th className="px-4 py-3.5">Record # / Date</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Public Record</th>
                  <th className="px-4 py-3.5 text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredEvents.map((evt, idx) => {
                  const style = TYPE_COLORS[evt.type] || {
                    bg: 'bg-slate-800',
                    text: 'text-slate-300',
                    border: 'border-slate-700',
                    label: evt.type,
                  };

                  const solanaExplorerUrl = evt.explorerUrl || (evt.signature && evt.signature.length > 20 && !evt.signature.startsWith('queue-') ? `https://explorer.solana.com/tx/${evt.signature}?cluster=devnet` : null);

                  return (
                    <tr key={`${evt.offlineHash}-${idx}`} className="hover:bg-white/5 transition-colors group">
                      {/* Type Badge */}
                      <td className="px-4 py-3.5">
                        <span className={`px-2 py-0.5 rounded ${style.bg} ${style.text} border ${style.border} font-bold text-[9px] uppercase`}>
                          {style.label}
                        </span>
                      </td>

                      {/* Hash & Signature */}
                      <td className="px-4 py-3.5">
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-200">
                            <span>{evt.offlineHash.slice(0, 16)}…{evt.offlineHash.slice(-6)}</span>
                            <button
                              onClick={() => handleCopy(evt.offlineHash)}
                              className="text-slate-500 hover:text-white transition-colors"
                              title="Copy Security Code"
                            >
                              {copiedHash === evt.offlineHash ? (
                                <Check className="w-3 h-3 text-emerald-400" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                          <span className="font-mono text-[9px] text-slate-500">
                            Ref: {evt.signature ? `${evt.signature.slice(0, 12)}…` : 'N/A'}
                          </span>
                        </div>
                      </td>

                      {/* Payload / Actor */}
                      <td className="px-4 py-3.5">
                        {evt.type === 'GRADE' && (
                          <div>
                            <p className="font-bold text-slate-200">{evt.studentName || evt.studentId} — <span className="text-purple-300">{evt.subject}</span></p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Score: <strong className="text-white">{evt.score}</strong> ({evt.grade}) | By {evt.teacherName || 'Teacher'}
                            </p>
                          </div>
                        )}
                        {evt.type === 'CREDENTIAL' && (
                          <div>
                            <p className="font-bold text-emerald-300">{evt.credentialType || 'Academic Certificate'}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Recipient: <strong className="text-slate-200">{evt.studentName}</strong> | Issued by {evt.issuedBy || 'School Admin'}
                            </p>
                          </div>
                        )}
                        {evt.type === 'ATTENDANCE' && (
                          <div>
                            <p className="font-bold text-blue-300">Staff: {evt.staffName || evt.staffId}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">
                              Status: <strong className="text-emerald-400">{evt.attendanceStatus || 'PRESENT'}</strong> | Class: {evt.className || 'General'}
                            </p>
                          </div>
                        )}
                        {evt.type === 'SYSTEM_ANCHOR' && (
                          <div>
                            <p className="font-bold text-amber-300">{evt.title || 'System Record'}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{evt.details || 'Document Approval'}</p>
                          </div>
                        )}
                      </td>

                      {/* Slot & Date */}
                      <td className="px-4 py-3.5 font-mono text-[10px]">
                        <p className="text-slate-300">
                          {evt.slot > 0 ? `#${evt.slot.toLocaleString()}` : 'Queued'}
                        </p>
                        <p className="text-[9px] text-slate-500 mt-0.5">
                          {new Date(evt.timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        {evt.status === 'PENDING_SYNC' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-950/40 border border-amber-500/20 px-2 py-0.5 rounded">
                            <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Pending Sync
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2 py-0.5 rounded">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Verified
                          </span>
                        )}
                      </td>

                      {/* Verifiable Link Column */}
                      <td className="px-4 py-3.5">
                        {solanaExplorerUrl ? (
                          <a
                            href={solanaExplorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/60 hover:bg-emerald-800 border border-emerald-500/30 text-emerald-300 hover:text-white text-[10px] font-bold transition-all shadow-sm"
                            title="View public verification record"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Proof
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">Saved on device</span>
                        )}
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3.5 text-right">
                        <button
                          onClick={() => setSelectedEvent(evt)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/5 hover:bg-primary-600 hover:text-white text-slate-300 text-[10px] font-bold transition-all border border-white/10"
                        >
                          <Eye className="w-3 h-3" />
                          View
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transaction Detail Inspector Modal */}
      <AnimatePresence>
        {selectedEvent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="glass-card max-w-2xl w-full p-6 rounded-2xl border border-white/10 space-y-6 relative max-h-[90vh] overflow-y-auto"
            >
              {/* Modal Header */}
              <div className="flex items-start justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded bg-primary-950 text-primary-400 border border-primary-500/30 text-[10px] font-bold uppercase">
                      {selectedEvent.type}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      Record #{selectedEvent.slot || 'N/A'}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <FileCode className="w-5 h-5 text-primary-400" />
                    Record Details &amp; Verification
                  </h2>
                </div>

                <button
                  onClick={() => setSelectedEvent(null)}
                  className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Cryptographic Hashes Card */}
              <div className="bg-black/40 p-4 rounded-xl border border-white/10 space-y-3 font-mono text-xs">
                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Record Security Code (Digital Fingerprint)</p>
                  <div className="flex items-center justify-between mt-1 p-2 bg-white/5 rounded border border-white/5">
                    <span className="text-emerald-400 break-all">{selectedEvent.offlineHash}</span>
                    <button
                      onClick={() => handleCopy(selectedEvent.offlineHash)}
                      className="text-slate-400 hover:text-white ml-2 shrink-0"
                      title="Copy Security Code"
                    >
                      {copiedHash === selectedEvent.offlineHash ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Network Record Reference ID</p>
                  <div className="flex items-center justify-between mt-1 p-2 bg-white/5 rounded border border-white/5">
                    <span className="text-primary-300 break-all">{selectedEvent.signature || 'Queued on device'}</span>
                    {selectedEvent.signature && (
                      <button
                        onClick={() => handleCopy(selectedEvent.signature)}
                        className="text-slate-400 hover:text-white ml-2 shrink-0"
                        title="Copy Reference ID"
                      >
                        {copiedHash === selectedEvent.signature ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Payload Breakdown */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold text-white uppercase tracking-wider">Record Information</h4>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Student / Recipient</p>
                    <p className="text-white font-medium mt-0.5">{selectedEvent.studentName || selectedEvent.staffName || 'N/A'}</p>
                    {selectedEvent.studentId && <p className="text-[10px] text-slate-500 font-mono">ID: {selectedEvent.studentId}</p>}
                  </div>

                  <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Teacher / Recorded By</p>
                    <p className="text-white font-medium mt-0.5">{selectedEvent.teacherName || selectedEvent.issuedBy || 'School Admin'}</p>
                  </div>

                  {selectedEvent.subject && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Subject &amp; Score</p>
                      <p className="text-purple-300 font-bold mt-0.5">
                        {selectedEvent.subject}: {selectedEvent.score} ({selectedEvent.grade})
                      </p>
                    </div>
                  )}

                  {selectedEvent.academicYear && (
                    <div className="p-3 bg-white/5 rounded-xl border border-white/5">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Term &amp; Year</p>
                      <p className="text-white font-medium mt-0.5">{selectedEvent.term || 'Term 1'} ({selectedEvent.academicYear})</p>
                    </div>
                  )}

                  <div className="col-span-2 p-3 bg-white/5 rounded-xl border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold">Notes</p>
                    <p className="text-slate-300 mt-0.5">{selectedEvent.details || 'Permanent school record.'}</p>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between pt-4 border-t border-white/10">
                <button
                  onClick={() => {
                    handleVerifyHash(selectedEvent.offlineHash);
                    setSelectedEvent(null);
                  }}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md"
                >
                  <ShieldCheck className="w-4 h-4" />
                  Check Record Authenticity
                </button>

                {selectedEvent.explorerUrl && (
                  <a
                    href={selectedEvent.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-4 py-2 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-xl transition-all shadow-md"
                  >
                    <ExternalLink className="w-4 h-4" />
                    View Public Record
                  </a>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
