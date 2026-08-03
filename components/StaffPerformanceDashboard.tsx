import React, { useState, useEffect } from 'react';
import {
  Users, Calendar, Award, FileText, CheckCircle, RefreshCw,
  Loader2, Search, BarChart2, TrendingUp, Briefcase, BookOpen
} from 'lucide-react';
import { getStaffPerformance } from '../services/api';

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
  const [teachers, setTeachers] = useState<TeacherPerformanceData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  useEffect(() => {
    fetchPerformance();
  }, []);

  const filteredTeachers = teachers.filter(t =>
    t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

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
            <p className="text-[10px] text-emerald-400 mt-0.5">On-chain & Sync Verified</p>
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
            <h3 className="font-bold text-white text-base">Faculty Roster & Performance Summary</h3>
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
                      {/* Teacher Profile */}
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

                      {/* Timetable Workload */}
                      <td className="p-4">
                        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-950/60 border border-purple-500/30 text-purple-300 font-bold">
                          <Calendar className="w-3.5 h-3.5 text-purple-400" />
                          <span>{teacher.weeklyWorkload} Periods/Wk</span>
                        </div>
                      </td>

                      {/* Attendance Marked */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{teacher.attendanceCount30Days}</span>
                          <span className="text-[10px] text-slate-400">sessions</span>
                        </div>
                      </td>

                      {/* Grades Submitted */}
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-white text-sm">{teacher.gradesCount30Days}</span>
                          <span className="text-[10px] text-slate-400 font-mono">grades</span>
                        </div>
                      </td>

                      {/* Vault Docs */}
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

                      {/* Engagement Status */}
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
    </div>
  );
};
