import React, { useState, useEffect } from 'react';
import {
  Users, Calendar, Award, FileText, CheckCircle, RefreshCw,
  Loader2, Search, BarChart2, TrendingUp, Briefcase, BookOpen,
  MapPin, AlertTriangle, ShieldCheck, Filter, Clock, Hash,
  Navigation, Crosshair, ChevronRight, AlertCircle, ExternalLink,
  Copy, Check
} from 'lucide-react';
import { getStaffPerformance, getAdminAttendanceRecords, verifyAttendanceHash } from '../services/api';
import { AttendanceRecordItem } from '../types';

interface TeacherPerformanceData {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  attendanceCount30Days: number;
  gradesCount30Days: number;
  vaultDocsSubmitted: number;
  vaultDocsApproved: number;
  weeklyWorkload: number;
}

export const StaffPerformanceDashboard: React.FC = () => {
  const [activeSubTab, setActiveSubTab] = useState<'roster' | 'attendance_audit'>('roster');
  const [teachers, setTeachers] = useState<TeacherPerformanceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Attendance Records State
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordItem[]>([]);
  const [loadingAttendance, setLoadingAttendance] = useState(false);
  const [attendanceError, setAttendanceError] = useState<string | null>(null);
  const [flaggedFilter, setFlaggedFilter] = useState<'all' | 'flagged'>('all');
  const [attendanceSearch, setAttendanceSearch] = useState('');

  // Copy and Verify state for on-chain attendance audit
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [verifyingRows, setVerifyingRows] = useState<Record<string, boolean>>({});
  const [verificationStatus, setVerificationStatus] = useState<Record<string, { status: 'verified' | 'mismatch'; message?: string }>>({});

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  const handleVerifyRow = async (rec: AttendanceRecordItem) => {
    setVerifyingRows(prev => ({ ...prev, [rec.id]: true }));
    try {
      const hashToVerify = rec.offlineHash || rec.signature || rec.txSignature || '';
      const res = await verifyAttendanceHash({
        staffId: rec.staffId,
        date: rec.date,
        status: rec.status,
        hashToVerify,
        signature: rec.signature || rec.txSignature,
        latitude: rec.latitude,
        longitude: rec.longitude,
      });

      if (res && res.isValid) {
        setVerificationStatus(prev => ({
          ...prev,
          [rec.id]: {
            status: 'verified',
            message: res.message || 'Record verified — this attendance record matches.'
          }
        }));
      } else {
        setVerificationStatus(prev => ({
          ...prev,
          [rec.id]: {
            status: 'mismatch',
            message: res?.message || 'Record mismatch — details do not match.'
          }
        }));
      }
    } catch (err: any) {
      setVerificationStatus(prev => ({
        ...prev,
        [rec.id]: {
          status: 'mismatch',
          message: err.message || 'Verification error'
        }
      }));
    } finally {
      setVerifyingRows(prev => ({ ...prev, [rec.id]: false }));
    }
  };

  const fetchPerformance = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaffPerformance();
      if (res.success && Array.isArray(res.teachers)) {
        setTeachers(res.teachers);
      } else {
        setError(res.error || 'Failed to load faculty performance metrics');
      }
    } catch (err: any) {
      setError(err.message || 'Error connecting to server');
    } finally {
      setLoading(false);
    }
  };

  const fetchAttendanceRecords = async () => {
    setLoadingAttendance(true);
    setAttendanceError(null);
    try {
      const res = await getAdminAttendanceRecords(false);
      if (res.success && Array.isArray(res.records)) {
        setAttendanceRecords(res.records);
      } else {
        setAttendanceError('Failed to load attendance records');
      }
    } catch (err: any) {
      setAttendanceError(err.message || 'Error loading attendance records');
    } finally {
      setLoadingAttendance(false);
    }
  };

  useEffect(() => {
    fetchPerformance();
    fetchAttendanceRecords();
  }, []);

  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAttendance = attendanceRecords.filter(rec => {
    if (flaggedFilter === 'flagged' && !rec.locationFlagged) return false;
    if (attendanceSearch.trim()) {
      const q = attendanceSearch.toLowerCase();
      const matchStaff = rec.staffName?.toLowerCase().includes(q);
      const matchClass = rec.className?.toLowerCase().includes(q);
      const matchDate = rec.date?.toLowerCase().includes(q);
      if (!matchStaff && !matchClass && !matchDate) return false;
    }
    return true;
  });

  const flaggedCount = attendanceRecords.filter(r => r.locationFlagged).length;

  const totalWorkload = teachers.reduce((acc, t) => acc + t.weeklyWorkload, 0);
  const totalGrades = teachers.reduce((acc, t) => acc + t.gradesCount30Days, 0);
  const totalAttendance = teachers.reduce((acc, t) => acc + t.attendanceCount30Days, 0);
  const totalApprovedVault = teachers.reduce((acc, t) => acc + t.vaultDocsApproved, 0);

  return (
    <div className="space-y-6 animate-in fade-in">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6 rounded-3xl border border-white/10">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-emerald-950/60 rounded-xl border border-emerald-500/30 text-emerald-400">
              <BarChart2 className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                Staff Performance & Workload Analytics
              </h2>
              <p className="text-xs text-slate-400">
                Real-time tracking of faculty class schedules, attendance marking, grading activity, and vault documents.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchPerformance}
          disabled={loading}
          className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all active:scale-95 self-start md:self-auto"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Metrics
        </button>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-white/10 pb-3">
        <button
          onClick={() => setActiveSubTab('roster')}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'roster'
              ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/40'
              : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>Faculty Roster &amp; Workload</span>
        </button>

        <button
          onClick={() => {
            setActiveSubTab('attendance_audit');
            fetchAttendanceRecords();
          }}
          className={`px-4 py-2.5 rounded-2xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeSubTab === 'attendance_audit'
              ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/40'
              : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
          }`}
        >
          <MapPin className="w-4 h-4" />
          <span>Attendance &amp; Geofence Audit</span>
          {flaggedCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/30 border border-amber-500/40 text-amber-300">
              {flaggedCount} Flagged
            </span>
          )}
        </button>
      </div>

      {activeSubTab === 'roster' && (
        <>
          {/* Summary KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-purple-950/60 border border-purple-500/30 text-purple-400 rounded-xl">
                <Briefcase className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Workload</p>
                <p className="text-xl font-bold text-white">{totalWorkload} Periods/Wk</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Across {teachers.length} Faculty Members</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 rounded-xl">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Attendance Marked (30d)</p>
                <p className="text-xl font-bold text-white">{totalAttendance} Records</p>
                <p className="text-[10px] text-emerald-400 mt-0.5">On-chain &amp; Sync Verified</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-blue-950/60 border border-blue-500/30 text-blue-400 rounded-xl">
                <Award className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grades Submitted (30d)</p>
                <p className="text-xl font-bold text-white">{totalGrades} Assessments</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Logged in Gradebook</p>
              </div>
            </div>

            <div className="glass-card p-5 rounded-2xl flex items-center gap-4">
              <div className="p-3 bg-amber-950/60 border border-amber-500/30 text-amber-400 rounded-xl">
                <FileText className="w-6 h-6" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Approved Vault Materials</p>
                <p className="text-xl font-bold text-white">{totalApprovedVault} Approved</p>
                <p className="text-[10px] text-slate-500 mt-0.5">Repository Resources</p>
              </div>
            </div>
          </div>

          {/* Main Table View */}
          <div className="glass-card rounded-3xl overflow-hidden border border-white/10 space-y-4 p-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-2 border-b border-white/5">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-primary-400" />
                <h3 className="font-bold text-white text-base">Faculty Roster &amp; Performance Summary</h3>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search teacher by name or email..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500 transition-all"
                />
              </div>
            </div>

            {loading ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
                <p className="text-sm">Fetching faculty performance data...</p>
              </div>
            ) : error ? (
              <div className="p-8 text-center text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-xs font-bold">
                {error}
              </div>
            ) : filteredTeachers.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm italic">
                No faculty records match your query.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="p-4">Faculty Member</th>
                      <th className="p-4">Weekly Workload</th>
                      <th className="p-4">Attendance Marked (30d)</th>
                      <th className="p-4">Grades Posted (30d)</th>
                      <th className="p-4">Vault Submissions</th>
                      <th className="p-4 text-right">Engagement</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs">
                    {filteredTeachers.map(teacher => {
                      const hasHighActivity = teacher.weeklyWorkload > 0 || teacher.gradesCount30Days > 0 || teacher.attendanceCount30Days > 0;

                      return (
                        <tr key={teacher.id} className="hover:bg-white/[0.02] transition-colors">
                          <td className="p-4">
                            <div className="flex items-center gap-3">
                              <img
                                src={teacher.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(teacher.name)}`}
                                alt={teacher.name}
                                className="w-10 h-10 rounded-full border border-white/10 object-cover bg-white/5"
                              />
                              <div>
                                <p className="font-bold text-white text-sm">{teacher.name}</p>
                                <p className="text-[11px] text-slate-400">{teacher.email}</p>
                              </div>
                            </div>
                          </td>

                          <td className="p-4">
                            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-300 font-bold">
                              <Calendar className="w-3.5 h-3.5 text-purple-400" />
                              <span>{teacher.weeklyWorkload} Periods/Wk</span>
                            </div>
                          </td>

                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{teacher.attendanceCount30Days}</span>
                              <span className="text-[10px] text-slate-400">sessions</span>
                            </div>
                          </td>

                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{teacher.gradesCount30Days}</span>
                              <span className="text-[10px] text-slate-400 font-mono">grades</span>
                            </div>
                          </td>

                          <td className="p-4">
                            <div className="space-y-0.5">
                              <p className="font-bold text-white text-xs">
                                {teacher.vaultDocsApproved} / {teacher.vaultDocsSubmitted} <span className="text-[10px] font-normal text-slate-400">Approved</span>
                              </p>
                              <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full transition-all"
                                  style={{
                                    width: teacher.vaultDocsSubmitted > 0
                                      ? `${Math.round((teacher.vaultDocsApproved / teacher.vaultDocsSubmitted) * 100)}%`
                                      : '0%'
                                  }}
                                />
                              </div>
                            </div>
                          </td>

                          <td className="p-4 text-right">
                            {hasHighActivity ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                                <CheckCircle className="w-3 h-3 text-emerald-400" /> Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase bg-amber-950/60 text-amber-300 border border-amber-500/30">
                                Pending Tasks
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Attendance & Geofence Audit Sub-Tab */}
      {activeSubTab === 'attendance_audit' && (
        <div className="space-y-6 animate-in fade-in">
          {/* Policy Information Header Card */}
          <div className="glass-card p-6 rounded-3xl border border-white/10 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary-950/60 rounded-xl border border-primary-500/30 text-primary-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Teacher Attendance &amp; Location Review
                  </h3>
                  <p className="text-xs text-slate-400">
                    Review teacher attendance records and location checks.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={fetchAttendanceRecords}
                  disabled={loadingAttendance}
                  className="px-3.5 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 transition-all active:scale-95 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingAttendance ? 'animate-spin' : ''}`} />
                  Refresh
                </button>
              </div>
            </div>

            <div className="p-3.5 bg-white/5 border border-white/10 rounded-2xl text-xs text-slate-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                <strong>Evidentiary Review Only:</strong> Flagged records indicate attendance recorded outside the configured campus boundary or without device GPS. Marking is never blocked in real-time to prevent disruption in low-signal rural environments.
              </span>
            </div>
          </div>

          {/* Filters & Search Controls */}
          <div className="glass-card p-4 rounded-2xl border border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={() => setFlaggedFilter('all')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                  flaggedFilter === 'all'
                    ? 'bg-white/15 text-white border border-white/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                All Records ({attendanceRecords.length})
              </button>

              <button
                onClick={() => setFlaggedFilter('flagged')}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                  flaggedFilter === 'flagged'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-amber-300 hover:bg-white/5'
                }`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Flagged Only ({flaggedCount})</span>
              </button>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search staff, class, or date..."
                value={attendanceSearch}
                onChange={e => setAttendanceSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500 transition-all"
              />
            </div>
          </div>

          {/* Records Table */}
          <div className="glass-card rounded-3xl overflow-hidden border border-white/10">
            {loadingAttendance ? (
              <div className="p-12 flex flex-col items-center justify-center text-slate-400 gap-3">
                <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
                <p className="text-sm">Loading attendance audit log...</p>
              </div>
            ) : attendanceError ? (
              <div className="p-8 text-center text-rose-400 bg-rose-950/30 border border-rose-500/30 rounded-2xl text-xs font-bold">
                {attendanceError}
              </div>
            ) : filteredAttendance.length === 0 ? (
              <div className="p-12 text-center text-slate-500 text-sm italic">
                {flaggedFilter === 'flagged'
                  ? 'No flagged location anomalies found in recorded attendance.'
                  : 'No attendance records recorded yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 bg-white/5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                      <th className="p-4">Date &amp; Time</th>
                      <th className="p-4">Staff Member</th>
                      <th className="p-4">Class</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Geofence &amp; Location</th>
                      <th className="p-4">Coordinates</th>
                      <th className="p-4 text-right">Record code</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredAttendance.map(rec => {
                      const hasCoords = rec.latitude !== null && rec.latitude !== undefined && rec.longitude !== null && rec.longitude !== undefined;
                      const isFlagged = Boolean(rec.locationFlagged);
                      const distance = rec.distanceMeters !== null && rec.distanceMeters !== undefined ? Math.round(rec.distanceMeters) : null;
                      const rawSig = (rec.signature || rec.txSignature || '').trim();
                      const isConfirmedSig = Boolean(
                        rawSig.length >= 44 &&
                        !rawSig.startsWith('queue-') &&
                        !rawSig.startsWith('recorded-') &&
                        !rawSig.startsWith('pending-') &&
                        !rawSig.startsWith('dummy-') &&
                        !rawSig.startsWith('att-') &&
                        !rawSig.startsWith('ledger-') &&
                        /^[1-9A-HJ-NP-Za-km-z]+$/.test(rawSig)
                      );
                      const signature = isConfirmedSig ? rawSig : null;
                      const solanaExplorerUrl = rec.explorerUrl || (isConfirmedSig ? `https://explorer.solana.com/tx/${encodeURIComponent(rawSig)}?cluster=devnet` : null);
                      const isVerifying = Boolean(verifyingRows[rec.id]);
                      const vStatus = verificationStatus[rec.id];

                      return (
                        <tr key={rec.id} className="hover:bg-white/[0.02] transition-colors">
                          {/* Date & Time */}
                          <td className="p-4 whitespace-nowrap">
                            <div className="flex items-center gap-2 text-slate-200 font-semibold">
                              <Clock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span>{rec.date}</span>
                              {rec.time && <span className="text-slate-400 font-normal">· {rec.time}</span>}
                            </div>
                          </td>

                          {/* Staff Name */}
                          <td className="p-4 whitespace-nowrap">
                            <p className="font-bold text-white">{rec.staffName || 'Staff Member'}</p>
                            <p className="text-[10px] text-slate-500 font-mono">{rec.staffId}</p>
                          </td>

                          {/* Class */}
                          <td className="p-4 whitespace-nowrap">
                            <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 font-bold text-[11px]">
                              {rec.className || 'General'}
                            </span>
                          </td>

                          {/* Status */}
                          <td className="p-4 whitespace-nowrap">
                            <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              rec.status === 'PRESENT'
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                                : rec.status === 'LATE'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-500/30'
                                : rec.status === 'EXCUSED'
                                ? 'bg-blue-950/60 text-blue-300 border border-blue-500/30'
                                : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                            }`}>
                              {rec.status}
                            </span>
                          </td>

                          {/* Geofence & Location */}
                          <td className="p-4 whitespace-nowrap">
                            {hasCoords ? (
                              isFlagged ? (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-300 font-bold text-[11px]">
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                  <span>Outside Campus {distance !== null ? `(${distance}m)` : ''}</span>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 font-bold text-[11px]">
                                  <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span>Within Bounds {distance !== null ? `(${distance}m)` : ''}</span>
                                </div>
                              )
                            ) : (
                              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-amber-950/50 border border-amber-500/30 text-amber-300 font-bold text-[11px]">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                <span>No GPS Captured</span>
                              </div>
                            )}
                          </td>

                          {/* Coordinates */}
                          <td className="p-4 whitespace-nowrap font-mono text-[11px] text-slate-400">
                            {hasCoords ? (
                              <span>{Number(rec.latitude).toFixed(4)}, {Number(rec.longitude).toFixed(4)}</span>
                            ) : (
                              <span className="text-slate-600 italic">Not Captured</span>
                            )}
                          </td>

                          {/* Signature / Explorer Link / Copy / Inline Verification */}
                          <td className="p-4 whitespace-nowrap text-right">
                            <div className="flex items-center justify-end gap-2">
                              {signature ? (
                                <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
                                  {solanaExplorerUrl ? (
                                    <a
                                      href={solanaExplorerUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Open public proof`}
                                      className="text-emerald-400 hover:text-emerald-300 hover:underline font-mono text-[11px] inline-flex items-center gap-1 transition-colors group/link"
                                    >
                                      <span>
                                        {signature.length > 18
                                          ? `${signature.slice(0, 8)}...${signature.slice(-8)}`
                                          : signature}
                                      </span>
                                      <ExternalLink className="w-3 h-3 opacity-60 group-hover/link:opacity-100 shrink-0" />
                                    </a>
                                  ) : (
                                    <span className="text-slate-300 font-mono text-[11px]" title={signature}>
                                      {signature.length > 18
                                        ? `${signature.slice(0, 8)}...${signature.slice(-8)}`
                                        : signature}
                                    </span>
                                  )}

                                  <button
                                    type="button"
                                    onClick={() => handleCopy(rec.id, signature)}
                                    title="Copy record code"
                                    className="p-0.5 text-slate-500 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer ml-0.5"
                                  >
                                    {copiedId === rec.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : rec.offlineHash ? (
                                <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 px-2.5 py-1 rounded-lg">
                                  <span className="text-slate-400 font-mono text-[11px]" title={rec.offlineHash}>
                                    {rec.offlineHash.startsWith('queue-')
                                      ? 'Pending Sync'
                                      : rec.offlineHash.length > 18
                                      ? `${rec.offlineHash.slice(0, 8)}...${rec.offlineHash.slice(-8)}`
                                      : rec.offlineHash}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleCopy(rec.id, rec.offlineHash!)}
                                    title="Copy record code"
                                    className="p-0.5 text-slate-500 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer ml-0.5"
                                  >
                                    {copiedId === rec.id ? (
                                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                                    ) : (
                                      <Copy className="w-3.5 h-3.5" />
                                    )}
                                  </button>
                                </div>
                              ) : (
                                <span className="text-slate-500 italic text-[11px]">Pending Sync</span>
                              )}

                              {/* Inline Verification Action & Indicator */}
                              {isVerifying ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-500/10 text-primary-300 border border-primary-500/20 text-[10px] font-bold">
                                  <Loader2 className="w-3 h-3 animate-spin text-primary-400" />
                                  <span>Checking...</span>
                                </span>
                              ) : vStatus?.status === 'verified' ? (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyRow(rec)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold hover:bg-emerald-900/60 transition-colors cursor-pointer"
                                  title="Record matches"
                                >
                                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                                  <span>Matches</span>
                                </button>
                              ) : vStatus?.status === 'mismatch' ? (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyRow(rec)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-950/60 text-rose-300 border border-rose-500/30 text-[10px] font-bold hover:bg-rose-900/60 transition-colors cursor-pointer"
                                  title="Record mismatch"
                                >
                                  <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                                  <span>Mismatch</span>
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleVerifyRow(rec)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-500/10 hover:bg-primary-500/20 text-primary-400 hover:text-primary-300 border border-primary-500/30 text-[10px] font-bold transition-all active:scale-95 cursor-pointer"
                                  title="Check this record"
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                  <span>Check</span>
                                </button>
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
      )}
    </div>
  );
};
