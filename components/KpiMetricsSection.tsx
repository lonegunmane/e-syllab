import React, { useState, useEffect, useMemo } from 'react';
import {
  Briefcase,
  TrendingUp,
  Award,
  FileText,
  X,
  Calendar,
  Clock,
  User,
  BookOpen,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { TimetableEntry, GradeRecord, VaultDocument, AttendanceRecordItem, DocumentStatus } from '../types';
import { getTimetables, getGrades, getVaultDocuments, getAdminAttendanceRecords } from '../services/api';
import { db } from '../services/database';

export type KpiModalType = 'workload' | 'attendance' | 'grades' | 'vault' | null;

interface KpiMetricsSectionProps {
  // Optional pre-fetched data props; if omitted, component fetches them cleanly
  timetables?: TimetableEntry[];
  attendanceRecords?: AttendanceRecordItem[];
  grades?: GradeRecord[];
  vaultDocuments?: VaultDocument[];
  onDataRefresh?: () => void;
}

export const KpiMetricsSection: React.FC<KpiMetricsSectionProps> = ({
  timetables: propTimetables,
  attendanceRecords: propAttendance,
  grades: propGrades,
  vaultDocuments: propVault,
}) => {
  const [internalTimetables, setInternalTimetables] = useState<TimetableEntry[]>([]);
  const [internalAttendance, setInternalAttendance] = useState<AttendanceRecordItem[]>([]);
  const [internalGrades, setInternalGrades] = useState<GradeRecord[]>([]);
  const [internalVault, setInternalVault] = useState<VaultDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [openModalType, setOpenModalType] = useState<KpiModalType>(null);

  // Fetch real records if not passed via props
  useEffect(() => {
    let isMounted = true;
    const loadAll = async () => {
      setIsLoading(true);
      try {
        const [ttRes, attRes, grRes, vtRes] = await Promise.all([
          propTimetables ? Promise.resolve(null) : getTimetables().catch(() => null),
          propAttendance ? Promise.resolve(null) : getAdminAttendanceRecords().catch(() => null),
          propGrades ? Promise.resolve(null) : getGrades().catch(() => null),
          propVault ? Promise.resolve(null) : getVaultDocuments().catch(() => null),
        ]);

        if (!isMounted) return;

        if (!propTimetables) {
          if (ttRes && ttRes.success && Array.isArray(ttRes.timetables)) {
            setInternalTimetables(ttRes.timetables);
          } else {
            setInternalTimetables([]);
          }
        }

        if (!propAttendance) {
          if (attRes && attRes.success && Array.isArray(attRes.records)) {
            setInternalAttendance(attRes.records);
          } else {
            setInternalAttendance([]);
          }
        }

        if (!propGrades) {
          if (grRes && grRes.success && Array.isArray(grRes.grades)) {
            setInternalGrades(grRes.grades);
          } else {
            setInternalGrades(db.getAllGrades() || []);
          }
        }

        if (!propVault) {
          if (vtRes && vtRes.success && Array.isArray(vtRes.documents)) {
            setInternalVault(vtRes.documents);
          } else {
            setInternalVault(db.getVaultDocuments() || []);
          }
        }
      } catch {
        // Fallback to safe defaults if API fails
        if (isMounted) {
          if (!propTimetables) setInternalTimetables([]);
          if (!propAttendance) setInternalAttendance([]);
          if (!propGrades) setInternalGrades(db.getAllGrades() || []);
          if (!propVault) setInternalVault(db.getVaultDocuments() || []);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAll();
    return () => {
      isMounted = false;
    };
  }, [propTimetables, propAttendance, propGrades, propVault]);

  // Handle escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModalType) {
        setOpenModalType(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [openModalType]);

  const timetables = propTimetables ?? internalTimetables;
  const attendanceRecords = propAttendance ?? internalAttendance;
  const grades = propGrades ?? internalGrades;
  const vaultDocuments = propVault ?? internalVault;

  // 30 days window for attendance and grades
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  }, []);

  const attendanceLast30Days = useMemo(() => {
    return attendanceRecords.filter(r => {
      if (!r.date) return false;
      const d = new Date(r.date);
      return !isNaN(d.getTime()) && d >= thirtyDaysAgo;
    });
  }, [attendanceRecords, thirtyDaysAgo]);

  const gradesLast30Days = useMemo(() => {
    return grades.filter(g => {
      const dateStr = g.recordedAt || (g as any).date || g.createdAt || g.timestamp;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return !isNaN(d.getTime()) && d >= thirtyDaysAgo;
    });
  }, [grades, thirtyDaysAgo]);

  const approvedVaultDocs = useMemo(() => {
    return vaultDocuments.filter(d => 
      d.status === DocumentStatus.APPROVED || 
      String(d.status).toUpperCase() === 'APPROVED'
    );
  }, [vaultDocuments]);

  // Honest numbers: 0 until real data exists. Do not invent demo rows.
  const workloadCount = timetables.length;
  const attendanceCount = attendanceLast30Days.length;
  const gradesCount = gradesLast30Days.length;
  const vaultCount = approvedVaultDocs.length;

  return (
    <>
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card 1: TOTAL WORKLOAD */}
        <button
          type="button"
          onClick={() => setOpenModalType('workload')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpenModalType('workload');
            }
          }}
          className="glass-card p-5 rounded-2xl flex items-center gap-4 text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.08] hover:border-purple-500/40 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-purple-500/50 group"
          aria-label="View lessons on the timetable this week"
        >
          <div className="p-3 bg-purple-950/60 border border-purple-500/30 text-purple-400 rounded-xl group-hover:scale-110 transition-transform">
            <Briefcase className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Workload</p>
            <p className="text-xl font-bold text-white">{workloadCount} {workloadCount === 1 ? 'Period/Wk' : 'Periods/Wk'}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Click to view timetable</p>
          </div>
        </button>

        {/* Card 2: ATTENDANCE MARKED */}
        <button
          type="button"
          onClick={() => setOpenModalType('attendance')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpenModalType('attendance');
            }
          }}
          className="glass-card p-5 rounded-2xl flex items-center gap-4 text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.08] hover:border-emerald-500/40 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-emerald-500/50 group"
          aria-label="View attendance marked in the last 30 days"
        >
          <div className="p-3 bg-emerald-950/60 border border-emerald-500/30 text-emerald-400 rounded-xl group-hover:scale-110 transition-transform">
            <TrendingUp className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Attendance Marked (30d)</p>
            <p className="text-xl font-bold text-white">{attendanceCount} {attendanceCount === 1 ? 'Record' : 'Records'}</p>
            <p className="text-[10px] text-emerald-400 mt-0.5">Click to view records</p>
          </div>
        </button>

        {/* Card 3: GRADES SUBMITTED */}
        <button
          type="button"
          onClick={() => setOpenModalType('grades')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpenModalType('grades');
            }
          }}
          className="glass-card p-5 rounded-2xl flex items-center gap-4 text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.08] hover:border-blue-500/40 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-blue-500/50 group"
          aria-label="View grades entered in the last 30 days"
        >
          <div className="p-3 bg-blue-950/60 border border-blue-500/30 text-blue-400 rounded-xl group-hover:scale-110 transition-transform">
            <Award className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grades Submitted (30d)</p>
            <p className="text-xl font-bold text-white">{gradesCount} {gradesCount === 1 ? 'Assessment' : 'Assessments'}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Click to view gradebook</p>
          </div>
        </button>

        {/* Card 4: APPROVED VAULT MATERIALS */}
        <button
          type="button"
          onClick={() => setOpenModalType('vault')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setOpenModalType('vault');
            }
          }}
          className="glass-card p-5 rounded-2xl flex items-center gap-4 text-left transition-all duration-200 cursor-pointer hover:bg-white/[0.08] hover:border-amber-500/40 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-amber-500/50 group"
          aria-label="View approved school files"
        >
          <div className="p-3 bg-amber-950/60 border border-amber-500/30 text-amber-400 rounded-xl group-hover:scale-110 transition-transform">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Approved School Files</p>
            <p className="text-xl font-bold text-white">{vaultCount} {vaultCount === 1 ? 'File' : 'Approved'}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Click to view files</p>
          </div>
        </button>
      </div>

      {/* Simple English Modal / Drawer */}
      {openModalType && (
        <div
          className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in"
          onClick={() => setOpenModalType(null)}
        >
          <div
            className="glass-card rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden animate-in zoom-in-95 border border-white/10 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="p-5 md:p-6 border-b border-white/10 flex items-center justify-between bg-black/20">
              <div className="flex items-center gap-3">
                <div className={`p-2.5 rounded-xl border ${
                  openModalType === 'workload'
                    ? 'bg-purple-950/60 border-purple-500/30 text-purple-400'
                    : openModalType === 'attendance'
                    ? 'bg-emerald-950/60 border-emerald-500/30 text-emerald-400'
                    : openModalType === 'grades'
                    ? 'bg-blue-950/60 border-blue-500/30 text-blue-400'
                    : 'bg-amber-950/60 border-amber-500/30 text-amber-400'
                }`}>
                  {openModalType === 'workload' && <Briefcase className="w-5 h-5" />}
                  {openModalType === 'attendance' && <TrendingUp className="w-5 h-5" />}
                  {openModalType === 'grades' && <Award className="w-5 h-5" />}
                  {openModalType === 'vault' && <FileText className="w-5 h-5" />}
                </div>

                <div>
                  <h3 className="text-base md:text-lg font-bold text-white">
                    {openModalType === 'workload' && 'Lessons on the timetable this week'}
                    {openModalType === 'attendance' && 'Attendance marked in the last 30 days'}
                    {openModalType === 'grades' && 'Grades entered in the last 30 days'}
                    {openModalType === 'vault' && 'Approved school files'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {openModalType === 'workload' && `${workloadCount} scheduled lessons`}
                    {openModalType === 'attendance' && `${attendanceCount} attendance logs`}
                    {openModalType === 'grades' && `${gradesCount} grade submissions`}
                    {openModalType === 'vault' && `${vaultCount} approved materials`}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setOpenModalType(null)}
                className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body / List */}
            <div className="p-5 md:p-6 overflow-y-auto flex-1 space-y-3">
              
              {/* 1. Workload Modal Content */}
              {openModalType === 'workload' && (
                <>
                  {timetables.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                        <Briefcase className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">No lessons on the timetable yet.</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Timetable entries scheduled for classes and teachers will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {timetables.map((entry, idx) => (
                        <div
                          key={entry.id || idx}
                          className="p-3.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{entry.subject}</span>
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-purple-950/60 border border-purple-500/30 text-purple-300 font-semibold">
                                {entry.className}
                              </span>
                            </div>
                            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                {entry.dayOfWeek}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-slate-500" />
                                {entry.period}
                              </span>
                              {entry.room && (
                                <span className="text-slate-500">
                                  Room: {entry.room}
                                </span>
                              )}
                            </div>
                          </div>
                          {entry.teacherName && (
                            <div className="text-right shrink-0">
                              <span className="text-xs text-slate-300 font-medium block">{entry.teacherName}</span>
                              <span className="text-[10px] text-slate-500">Assigned Teacher</span>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* 2. Attendance Modal Content */}
              {openModalType === 'attendance' && (
                <>
                  {attendanceLast30Days.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                        <TrendingUp className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">No attendance marked yet.</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Attendance marked by teachers within the last 30 days will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {attendanceLast30Days.map((rec, idx) => (
                        <div
                          key={rec.id || idx}
                          className="p-3.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                {rec.staffName || 'Faculty Teacher'}
                              </span>
                              {rec.className && (
                                <span className="text-[11px] px-2 py-0.5 rounded-md bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 font-semibold">
                                  {rec.className}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                {rec.date}
                              </span>
                              {rec.time && (
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                                  {rec.time}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              {rec.status || 'Marked'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* 3. Grades Modal Content */}
              {openModalType === 'grades' && (
                <>
                  {gradesLast30Days.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                        <Award className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">No grades yet.</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Student grades entered in the last 30 days will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {gradesLast30Days.map((grade, idx) => (
                        <div
                          key={grade.id || idx}
                          className="p-3.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">
                                {grade.studentName || 'Student Record'}
                              </span>
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-blue-950/60 border border-blue-500/30 text-blue-300 font-semibold">
                                {grade.subject}
                              </span>
                            </div>
                            <div className="text-xs text-slate-400 flex items-center gap-3">
                              {(grade.recordedAt || (grade as any).date || grade.createdAt) && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                  {new Date(grade.recordedAt || (grade as any).date || grade.createdAt).toLocaleDateString()}
                                </span>
                              )}
                              {grade.comment && (
                                <span className="text-slate-400 italic">
                                  "{grade.comment}"
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-blue-950/60 border border-blue-500/30 text-blue-300 block">
                              Grade: {grade.grade} {grade.score !== undefined ? `(${grade.score}%)` : ''}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* 4. Vault Modal Content */}
              {openModalType === 'vault' && (
                <>
                  {approvedVaultDocs.length === 0 ? (
                    <div className="py-12 text-center space-y-2">
                      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto text-slate-400">
                        <FileText className="w-6 h-6" />
                      </div>
                      <p className="text-sm font-semibold text-white">No approved files yet.</p>
                      <p className="text-xs text-slate-400 max-w-sm mx-auto">
                        Curriculum files and schemes of work approved by administrators will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {approvedVaultDocs.map((doc, idx) => (
                        <div
                          key={doc.id || idx}
                          className="p-3.5 bg-white/[0.03] hover:bg-white/[0.06] border border-white/5 rounded-xl flex items-center justify-between gap-3 transition-colors"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-white text-sm">{doc.title}</span>
                              <span className="text-[11px] px-2 py-0.5 rounded-md bg-amber-950/60 border border-amber-500/30 text-amber-300 font-semibold">
                                {doc.type}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-xs text-slate-400">
                              <span className="flex items-center gap-1">
                                <User className="w-3.5 h-3.5 text-slate-500" />
                                {doc.teacherName}
                              </span>
                              {doc.createdAt && (
                                <span className="flex items-center gap-1">
                                  <Calendar className="w-3.5 h-3.5 text-slate-500" />
                                  {new Date(doc.createdAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="shrink-0">
                            <span className="px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                              Approved
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-white/10 bg-black/20 flex justify-between items-center text-xs text-slate-400">
              <span className="text-slate-500">
                School records system • Chinsali Girls Secondary School
              </span>
              <button
                type="button"
                onClick={() => setOpenModalType(null)}
                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
