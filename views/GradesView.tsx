import React, { useState, useEffect } from 'react';
import {
  TrendingUp, Search, Plus, Save, Award,
  BookOpen, CheckCircle, XCircle, Loader2,
  Star, ChevronDown, ExternalLink, Shield,
} from 'lucide-react';
import { User, UserRole, GradeRecord } from '../types';
import { db } from '../services/database';
import { recordGrade } from '../services/academicLedger';

interface GradesViewProps {
  currentUser: User;
}

// ─── Grade calculator ─────────────────────────────────────────────────────────

function calculateGrade(s: number): { grade: string; label: string; color: string; bg: string; border: string } {
  if (s >= 90) return { grade: 'A+', label: 'Outstanding',   color: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/30' };
  if (s >= 80) return { grade: 'A',  label: 'Excellent',     color: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/30' };
  if (s >= 75) return { grade: 'B+', label: 'Very Good',     color: 'text-blue-400',    bg: 'bg-blue-950/40',    border: 'border-blue-500/30'    };
  if (s >= 65) return { grade: 'B',  label: 'Good',          color: 'text-blue-400',    bg: 'bg-blue-950/40',    border: 'border-blue-500/30'    };
  if (s >= 60) return { grade: 'C+', label: 'Satisfactory',  color: 'text-amber-400',   bg: 'bg-amber-950/40',   border: 'border-amber-500/30'   };
  if (s >= 50) return { grade: 'C',  label: 'Average',       color: 'text-amber-400',   bg: 'bg-amber-950/40',   border: 'border-amber-500/30'   };
  if (s >= 45) return { grade: 'D+', label: 'Below Average', color: 'text-orange-400',  bg: 'bg-orange-950/40',  border: 'border-orange-500/30'  };
  if (s >= 40) return { grade: 'D',  label: 'Weak Pass',     color: 'text-orange-400',  bg: 'bg-orange-950/40',  border: 'border-orange-500/30'  };
  return       { grade: 'F',  label: 'Fail',          color: 'text-rose-400',    bg: 'bg-rose-950/40',    border: 'border-rose-500/30'    };
}

function friendlyDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Score bar ────────────────────────────────────────────────────────────────

const ScoreBar: React.FC<{ score: number }> = ({ score }) => {
  const info = calculateGrade(score);
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-1">
        <span className={`text-xs font-bold ${info.color}`}>{score}%</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${info.bg} ${info.color} ${info.border}`}>{info.grade}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${
            score >= 75 ? 'bg-emerald-400' : score >= 50 ? 'bg-amber-400' : 'bg-rose-400'
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
};

// ─── Component ────────────────────────────────────────────────────────────────

export const GradesView: React.FC<GradesViewProps> = ({ currentUser }) => {
  const [students, setStudents]       = useState<User[]>([]);
  const [grades, setGrades]           = useState<GradeRecord[]>([]);
  const [showForm, setShowForm]       = useState(false);
  const [search, setSearch]           = useState('');
  const [expandedId, setExpandedId]   = useState<string | null>(null);

  // Form
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [subject, setSubject]         = useState('');
  const [score, setScore]             = useState('');
  const [term, setTerm]               = useState('Term 1');
  const [academicYear, setAcademicYear] = useState(new Date().getFullYear().toString());

  // Save state
  const [saveState, setSaveState]     = useState<'idle' | 'saving' | 'done' | 'error'>('idle');
  const [saveMsg, setSaveMsg]         = useState('');
  const [lastExplorerUrl, setLastExplorerUrl] = useState<string | null>(null);

  const isStudent = currentUser.role === UserRole.STUDENT;
  const isTeacher = currentUser.role === UserRole.TEACHER;

  const refresh = () => {
    if (isStudent) {
      setGrades(db.getGradesByStudent(currentUser.id));
    } else if (currentUser.role === UserRole.ADMIN) {
      setGrades(db.getAllGrades());
      setStudents(db.getUsersByRole(UserRole.STUDENT));
    } else {
      setGrades(db.getGradesByTeacher(currentUser.id));
      setStudents(db.getUsersByRole(UserRole.STUDENT));
    }
  };

  useEffect(() => { refresh(); }, [currentUser.id]);

  const handleSave = async () => {
    if (!selectedStudentId || !subject || !score) return;

    const scoreNum = parseFloat(score);
    if (isNaN(scoreNum) || scoreNum < 0 || scoreNum > 100) {
      setSaveMsg('Please enter a score between 0 and 100.');
      setSaveState('error');
      return;
    }

    const { grade } = calculateGrade(scoreNum);
    const student   = students.find(s => s.id === selectedStudentId);
    if (!student) return;

    setSaveState('saving');
    setSaveMsg('');
    setLastExplorerUrl(null);

    try {
      // Step 1: Save to local database
      const gradeRecord = db.saveGrade({
        studentId:   selectedStudentId,
        studentName: student.name,
        teacherId:   currentUser.id,
        subject,
        score:       scoreNum,
        grade,
        comment:     calculateGrade(scoreNum).label,
      });

      refresh();

      // Step 2: Record on blockchain — Phantom popup appears here
      setSaveMsg('Approve the pop-up in Phantom to secure this grade permanently...');
      const result = await recordGrade(gradeRecord, currentUser.name, 'ZMB-KAPASA-001', academicYear, term);

      if (result.success) {
        setSaveState('done');
        setSaveMsg(`Grade saved and permanently secured. ✓`);
        setLastExplorerUrl(result.explorerUrl || null);
        // Reset form
        setShowForm(false);
        setSelectedStudentId('');
        setSubject('');
        setScore('');
      } else {
        // Blockchain failed but local save succeeded — still a success for the teacher
        setSaveState('done');
        setSaveMsg(`Grade saved locally. Blockchain recording failed: ${result.error}. Connect Phantom to secure it.`);
      }
    } catch (err: any) {
      setSaveState('error');
      setSaveMsg(err.message || 'Could not save grade. Please try again.');
    }
  };

  const filtered = grades
    .filter(g =>
      g.studentName.toLowerCase().includes(search.toLowerCase()) ||
      g.subject.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const avg    = grades.length ? (grades.reduce((a, c) => a + c.score, 0) / grades.length) : 0;
  const topG   = grades.length ? grades.reduce((p, c) => p.score > c.score ? p : c) : null;
  const scoreNum = parseFloat(score);
  const preview  = !isNaN(scoreNum) && scoreNum >= 0 && scoreNum <= 100 ? calculateGrade(scoreNum) : null;

  // ── Student view ─────────────────────────────────────────────────────────────
  if (isStudent) {
    return (
      <div className="space-y-5 max-w-2xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Star className="w-6 h-6 text-amber-400" /> My Results
          </h1>
          <p className="text-slate-400 text-sm mt-1">Your academic results recorded by your teachers.</p>
        </div>

        {/* Summary */}
        {grades.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-xs text-slate-500 mb-1">Average Score</p>
              <p className="text-2xl font-bold text-white">{avg.toFixed(1)}%</p>
              <p className={`text-xs font-bold mt-1 ${calculateGrade(avg).color}`}>{calculateGrade(avg).label}</p>
            </div>
            <div className="glass-card p-4 rounded-2xl">
              <p className="text-xs text-slate-500 mb-1">Subjects Recorded</p>
              <p className="text-2xl font-bold text-white">{grades.length}</p>
              <p className="text-xs text-slate-500 mt-1">entries total</p>
            </div>
          </div>
        )}

        {/* Results list */}
        <div className="glass-card rounded-2xl overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-sm italic">
              <Star className="w-10 h-10 mx-auto mb-3 opacity-10" />
              No results yet. Check back after your teacher records your grades.
            </div>
          ) : (
            <div className="divide-y divide-white/5">
              {filtered.map(g => {
                const info = calculateGrade(g.score);
                return (
                  <div key={g.id} className="p-5">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div>
                        <p className="font-bold text-white">{g.subject}</p>
                        <p className="text-xs text-slate-500">{friendlyDate(g.timestamp)}</p>
                      </div>
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border ${info.bg} ${info.color} ${info.border} shrink-0`}>
                        {info.grade}
                      </div>
                    </div>
                    <ScoreBar score={g.score} />
                    <p className={`text-xs mt-2 font-medium ${info.color}`}>{info.label}</p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Teacher / Admin view ──────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <TrendingUp className="w-6 h-6 text-primary-400" />
            {currentUser.role === UserRole.ADMIN ? 'Academic Records' : 'Grade Hub'}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            {currentUser.role === UserRole.ADMIN
              ? 'All student grades across the school.'
              : 'Record and manage your students\' academic results.'}
          </p>
        </div>
        {!isStudent && (
          <button
            onClick={() => { setShowForm(true); setSaveState('idle'); setSaveMsg(''); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-primary-600 text-white text-sm font-bold rounded-xl hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-900/40 shrink-0"
          >
            <Plus className="w-4 h-4" /> Record Grade
          </button>
        )}
      </div>

      {/* Summary stats */}
      {grades.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Total Entries',   value: grades.length,         sub: 'grades recorded'      },
            { label: 'Class Average',   value: avg.toFixed(1) + '%',  sub: calculateGrade(avg).label },
            { label: 'Top Student',     value: topG?.studentName.split(' ')[0] ?? '—', sub: topG ? topG.score + '% · ' + topG.subject : '' },
          ].map((s, i) => (
            <div key={i} className="glass-card p-4 rounded-2xl">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{s.label}</p>
              <p className="text-xl font-bold text-white truncate">{s.value}</p>
              <p className="text-[11px] text-slate-500 truncate">{s.sub}</p>
            </div>
          ))}
        </div>
      )}

      {/* Result banner */}
      {(saveState === 'done' || saveState === 'error') && (
        <div className={`p-4 rounded-2xl border flex items-start gap-3 ${
          saveState === 'done'
            ? 'bg-emerald-950/20 border-emerald-500/30'
            : 'bg-rose-950/20 border-rose-500/30'
        }`}>
          {saveState === 'done'
            ? <CheckCircle className="w-5 h-5 text-emerald-400 mt-0.5 shrink-0" />
            : <XCircle    className="w-5 h-5 text-rose-400 mt-0.5 shrink-0" />
          }
          <div className="flex-1">
            <p className={`text-sm font-bold ${saveState === 'done' ? 'text-emerald-400' : 'text-rose-400'}`}>
              {saveState === 'done' ? 'Grade recorded' : 'Could not save'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">{saveMsg}</p>
            {lastExplorerUrl && (
              <a href={lastExplorerUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 mt-2 text-xs text-primary-400 hover:underline">
                <ExternalLink className="w-3 h-3" /> View permanent record
              </a>
            )}
          </div>
          <button onClick={() => setSaveState('idle')} className="text-slate-500 hover:text-white text-xs">✕</button>
        </div>
      )}

      {/* Add grade form (inline — no modal) */}
      {showForm && (
        <div className="glass-card p-6 rounded-2xl border border-primary-500/20">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-white flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-primary-400" /> Record a Grade
            </h3>
            <button onClick={() => setShowForm(false)} className="text-slate-500 hover:text-white text-sm">✕ Cancel</button>
          </div>

          <div className="space-y-4">
            {/* Student */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400">Student</label>
              <select
                value={selectedStudentId}
                onChange={e => setSelectedStudentId(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
              >
                <option value="" className="bg-[#0d0f1a]">Choose a student...</option>
                {students.map(s => (
                  <option key={s.id} value={s.id} className="bg-[#0d0f1a]">{s.name} {s.grade ? `· Grade ${s.grade}` : ''}</option>
                ))}
              </select>
            </div>

            {/* Subject + Score */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400">Subject</label>
                <input
                  type="text"
                  placeholder="e.g. Mathematics"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400">Score (0–100)</label>
                <input
                  type="number"
                  min="0" max="100" step="1"
                  placeholder="e.g. 78"
                  value={score}
                  onChange={e => setScore(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>

            {/* Term + Year */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400">Term</label>
                <select
                  value={term}
                  onChange={e => setTerm(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
                >
                  <option className="bg-[#0d0f1a]">Term 1</option>
                  <option className="bg-[#0d0f1a]">Term 2</option>
                  <option className="bg-[#0d0f1a]">Term 3</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-400">Academic Year</label>
                <input
                  type="text"
                  value={academicYear}
                  onChange={e => setAcademicYear(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
                />
              </div>
            </div>

            {/* Grade preview */}
            {preview && (
              <div className={`p-4 rounded-xl border flex items-center gap-4 ${preview.bg} ${preview.border}`}>
                <div className={`text-3xl font-bold ${preview.color}`}>{preview.grade}</div>
                <div>
                  <p className={`text-sm font-bold ${preview.color}`}>{preview.label}</p>
                  <p className="text-xs text-slate-400">Score: {score}%</p>
                </div>
              </div>
            )}

            {/* Saving progress */}
            {saveState === 'saving' && (
              <div className="flex items-center gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
                <Loader2 className="w-4 h-4 animate-spin text-primary-400 shrink-0" />
                <p className="text-xs text-slate-400">{saveMsg || 'Saving...'}</p>
              </div>
            )}

            {/* Save button */}
            <button
              onClick={handleSave}
              disabled={!selectedStudentId || !subject || !score || saveState === 'saving'}
              className="w-full py-3.5 bg-primary-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saveState === 'saving'
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                : <><Save className="w-4 h-4" /> Save Grade</>
              }
            </button>

            <p className="text-[11px] text-slate-600 text-center flex items-center justify-center gap-1.5">
              <Shield className="w-3 h-3" />
              Grades are permanently secured after your Phantom approval
            </p>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          type="text"
          placeholder="Search by student name or subject..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-11 pr-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:border-primary-500 transition-colors"
        />
      </div>

      {/* Grades list */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
          <h3 className="font-bold text-white text-sm">
            {currentUser.role === UserRole.ADMIN ? 'All Student Grades' : 'Your Students\' Grades'}
          </h3>
          <span className="px-3 py-1 bg-primary-950/40 text-primary-400 text-[11px] font-bold rounded-full border border-primary-500/20">
            {filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-sm italic">
            <Award className="w-10 h-10 mx-auto mb-3 opacity-10" />
            {search ? 'No grades match your search.' : 'No grades recorded yet. Click "Record Grade" to add one.'}
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {filtered.map(g => {
              const info      = calculateGrade(g.score);
              const isExpanded = expandedId === g.id;
              return (
                <div key={g.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : g.id)}
                    className="w-full px-5 py-4 flex items-center gap-4 hover:bg-white/5 transition-colors text-left"
                  >
                    {/* Grade badge */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold border shrink-0 ${info.bg} ${info.color} ${info.border}`}>
                      {info.grade}
                    </div>

                    {/* Name + subject */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-200 truncate">{g.studentName}</p>
                      <p className="text-xs text-slate-500 truncate">{g.subject} · {friendlyDate(g.timestamp)}</p>
                    </div>

                    {/* Score bar */}
                    <div className="w-28 hidden sm:block">
                      <ScoreBar score={g.score} />
                    </div>

                    <ChevronDown className={`w-4 h-4 text-slate-600 shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>

                  {isExpanded && (
                    <div className="px-5 pb-5 pt-1 bg-white/5 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'Score',   value: g.score + '%'          },
                          { label: 'Grade',   value: info.grade + ' · ' + info.label },
                          { label: 'Subject', value: g.subject               },
                          { label: 'Recorded', value: friendlyDate(g.timestamp) },
                        ].map(item => (
                          <div key={item.label} className="bg-black/20 rounded-xl p-3">
                            <p className="text-[10px] text-slate-600 uppercase tracking-wider mb-0.5">{item.label}</p>
                            <p className="text-xs font-bold text-slate-300">{item.value}</p>
                          </div>
                        ))}
                      </div>
                      <div className="sm:hidden">
                        <ScoreBar score={g.score} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
