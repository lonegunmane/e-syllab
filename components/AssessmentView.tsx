import React, { useState, useEffect } from 'react';
import {
  Award, Plus, Save, CheckCircle, XCircle, Loader2,
  ChevronRight, Shield, ExternalLink, BarChart2,
  FileText, Users, Search, RefreshCw, AlertCircle,
  TrendingUp, TrendingDown, Check, Percent
} from 'lucide-react';
import { User, UserRole, Assessment, AssessmentScore } from '../types';
import { authFetch } from '../services/api';
import { db } from '../services/database';

interface AssessmentViewProps {
  currentUser: User;
}

interface AssessmentReport {
  average: number;
  highest: number;
  lowest: number;
  passRate: number;
  totalStudents: number;
  maxScore: number;
}

function calculateGrade(score: number, maxScore: number = 100) {
  const pct = maxScore > 0 ? (score / maxScore) * 100 : 0;
  if (pct >= 90) return { grade: 'A+', label: 'Outstanding', color: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/30' };
  if (pct >= 80) return { grade: 'A', label: 'Excellent', color: 'text-emerald-400', bg: 'bg-emerald-950/40', border: 'border-emerald-500/30' };
  if (pct >= 75) return { grade: 'B+', label: 'Very Good', color: 'text-blue-400', bg: 'bg-blue-950/40', border: 'border-blue-500/30' };
  if (pct >= 65) return { grade: 'B', label: 'Good', color: 'text-blue-400', bg: 'bg-blue-950/40', border: 'border-blue-500/30' };
  if (pct >= 60) return { grade: 'C+', label: 'Satisfactory', color: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-500/30' };
  if (pct >= 50) return { grade: 'C', label: 'Average', color: 'text-amber-400', bg: 'bg-amber-950/40', border: 'border-amber-500/30' };
  if (pct >= 45) return { grade: 'D+', label: 'Below Average', color: 'text-orange-400', bg: 'bg-orange-950/40', border: 'border-orange-500/30' };
  if (pct >= 40) return { grade: 'D', label: 'Weak Pass', color: 'text-orange-400', bg: 'bg-orange-950/40', border: 'border-orange-500/30' };
  return { grade: 'F', label: 'Fail', color: 'text-rose-400', bg: 'bg-rose-950/40', border: 'border-rose-500/30' };
}

function friendlyDate(iso: string) {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const AssessmentView: React.FC<AssessmentViewProps> = ({ currentUser }) => {
  const isStudent = currentUser.role === UserRole.STUDENT;

  // Assessments list state
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loadingAssessments, setLoadingAssessments] = useState(true);
  const [selectedAssessment, setSelectedAssessment] = useState<Assessment | null>(null);

  // New Assessment Form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [className, setClassName] = useState('Grade 10');
  const [maxScore, setMaxScore] = useState('100');
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Teacher Scoring Form
  const [students, setStudents] = useState<User[]>([]);
  const [scoresInput, setScoresInput] = useState<{ [studentId: string]: { score: string; feedback: string } }>({});
  const [submittingScores, setSubmittingScores] = useState(false);
  const [scoreMsg, setScoreMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [existingScores, setExistingScores] = useState<AssessmentScore[]>([]);

  // Student State
  const [studentScores, setStudentScores] = useState<AssessmentScore[]>([]);
  const [loadingStudentScores, setLoadingStudentScores] = useState(true);

  // Search filter
  const [searchQuery, setSearchQuery] = useState('');

  // 1. Fetch Assessments
  const fetchAssessments = async () => {
    setLoadingAssessments(true);
    try {
      const res = await authFetch('/api/assessments');
      const data = await res.json();
      if (data.success && Array.isArray(data.assessments)) {
        setAssessments(data.assessments);
      }
    } catch (err) {
      console.warn('[AssessmentView] Error fetching assessments:', err);
    } finally {
      setLoadingAssessments(false);
    }
  };

  // 2. Fetch Student Scores (for Student Role)
  const fetchStudentScores = async () => {
    setLoadingStudentScores(true);
    try {
      const res = await authFetch('/api/assessments/student/my-scores');
      const data = await res.json();
      if (data.success && Array.isArray(data.scores)) {
        setStudentScores(data.scores);
      }
    } catch (err) {
      console.warn('[AssessmentView] Error fetching student scores:', err);
    } finally {
      setLoadingStudentScores(false);
    }
  };

  // 3. Fetch Students for Scoring Form
  const fetchStudents = async () => {
    try {
      const res = await authFetch('/api/users');
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        const studentList = data.users.filter((u: User) => u.role === UserRole.STUDENT);
        setStudents(studentList);
      } else {
        setStudents(db.getUsersByRole(UserRole.STUDENT));
      }
    } catch {
      setStudents(db.getUsersByRole(UserRole.STUDENT));
    }
  };

  // 4. Load Assessment Detail & Report
  const loadAssessmentDetail = async (assessment: Assessment) => {
    setSelectedAssessment(assessment);
    setScoreMsg(null);
    try {
      const res = await authFetch(`/api/assessments/${assessment.id}/report`);
      const data = await res.json();
      if (data.success) {
        setReport(data.report);
        if (Array.isArray(data.scores)) {
          setExistingScores(data.scores);
          // Populate scoring form inputs with existing scores
          const initScores: { [id: string]: { score: string; feedback: string } } = {};
          data.scores.forEach((s: AssessmentScore) => {
            initScores[s.studentId] = {
              score: s.score.toString(),
              feedback: s.feedback || '',
            };
          });
          setScoresInput(initScores);
        }
      }
    } catch (err) {
      console.warn('[AssessmentView] Error loading report:', err);
    }
  };

  useEffect(() => {
    if (isStudent) {
      fetchStudentScores();
    } else {
      fetchAssessments();
      fetchStudents();
    }
  }, [currentUser.id]);

  // Handle Create Assessment
  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !subject.trim() || !className.trim() || !maxScore) {
      setCreateMsg({ type: 'error', text: 'Please complete all required fields.' });
      return;
    }

    const maxScoreNum = parseFloat(maxScore);
    if (isNaN(maxScoreNum) || maxScoreNum <= 0) {
      setCreateMsg({ type: 'error', text: 'Maximum score must be greater than 0.' });
      return;
    }

    setCreating(true);
    setCreateMsg(null);

    try {
      const res = await authFetch('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({
          title: title.trim(),
          subject: subject.trim(),
          className: className.trim(),
          maxScore: maxScoreNum,
        }),
      });

      const data = await res.json();
      if (data.success && data.assessment) {
        setCreateMsg({ type: 'success', text: 'Assessment created successfully!' });
        setTitle('');
        setSubject('');
        setShowCreateForm(false);
        await fetchAssessments();
        loadAssessmentDetail(data.assessment);
      } else {
        setCreateMsg({ type: 'error', text: data.error || 'Failed to create assessment.' });
      }
    } catch (err: any) {
      setCreateMsg({ type: 'error', text: err.message || 'Server connection error.' });
    } finally {
      setCreating(false);
    }
  };

  // Handle Submit Scores
  const handleSubmitScores = async () => {
    if (!selectedAssessment) return;

    // Build payload array from student inputs
    const scorePayload: { studentId: string; score: number; feedback: string }[] = [];
    const classStudents = students.filter(
      s => !selectedAssessment.className || s.className === selectedAssessment.className || s.grade === selectedAssessment.className
    );
    const targetStudents = classStudents.length > 0 ? classStudents : students;

    for (const student of targetStudents) {
      const entry = scoresInput[student.id];
      if (entry && entry.score !== '') {
        const val = parseFloat(entry.score);
        if (!isNaN(val) && val >= 0 && val <= selectedAssessment.maxScore) {
          scorePayload.push({
            studentId: student.id,
            score: val,
            feedback: entry.feedback || '',
          });
        }
      }
    }

    if (scorePayload.length === 0) {
      setScoreMsg({ type: 'error', text: 'Please enter at least one valid score before submitting.' });
      return;
    }

    setSubmittingScores(true);
    setScoreMsg(null);

    try {
      const res = await authFetch(`/api/assessments/${selectedAssessment.id}/scores`, {
        method: 'POST',
        body: JSON.stringify({ scores: scorePayload }),
      });

      const data = await res.json();
      if (data.success) {
        setScoreMsg({ type: 'success', text: `Submitted ${scorePayload.length} score(s) successfully and secured on Solana blockchain! ✓` });
        if (data.report) setReport(data.report);
        if (Array.isArray(data.scores)) setExistingScores(data.scores);
      } else {
        setScoreMsg({ type: 'error', text: data.error || 'Failed to submit scores.' });
      }
    } catch (err: any) {
      setScoreMsg({ type: 'error', text: err.message || 'Connection error while submitting scores.' });
    } finally {
      setSubmittingScores(false);
    }
  };

  // Filtered assessments list
  const filteredAssessments = assessments.filter(
    a => a.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
         a.subject.toLowerCase().includes(searchQuery.toLowerCase()) ||
         a.className.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ─── STUDENT VIEW ──────────────────────────────────────────────────────────
  if (isStudent) {
    return (
      <div className="space-y-6 max-w-4xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Award className="w-6 h-6 text-primary-400" /> Assessment Reports & Scores
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Your test and examination scores verified and anchored on-chain.
            </p>
          </div>
          <button
            onClick={fetchStudentScores}
            className="p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 text-slate-300 transition-colors"
            title="Refresh scores"
          >
            <RefreshCw className={`w-4 h-4 ${loadingStudentScores ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {loadingStudentScores ? (
          <div className="glass-card p-12 text-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary-400 mb-3" />
            Loading your verified assessment records...
          </div>
        ) : studentScores.length === 0 ? (
          <div className="glass-card p-12 text-center text-slate-500 rounded-2xl">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="text-base font-semibold text-slate-300">No Assessment Scores Yet</p>
            <p className="text-xs text-slate-500 mt-1">
              When your teachers post test scores, they will appear here with cryptographic proof.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {studentScores.map(score => {
              const maxSc = score.assessment?.maxScore || 100;
              const info = calculateGrade(score.score, maxSc);
              const pct = ((score.score / maxSc) * 100).toFixed(1);

              return (
                <div key={score.id} className="glass-card p-5 rounded-2xl border border-white/10 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/5 pb-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-primary-400 px-2 py-0.5 bg-primary-950/60 rounded-full border border-primary-500/20">
                        {score.assessment?.subject || 'Subject'}
                      </span>
                      <h3 className="text-lg font-bold text-white mt-1">
                        {score.assessment?.title || 'Assessment Score'}
                      </h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Recorded on {friendlyDate(score.createdAt)} · Class: {score.assessment?.className || 'General'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-2xl font-bold text-white">
                          {score.score} <span className="text-xs text-slate-500">/ {maxSc}</span>
                        </div>
                        <div className={`text-xs font-bold ${info.color}`}>{pct}% · {info.label}</div>
                      </div>
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg border ${info.bg} ${info.color} ${info.border} shrink-0`}>
                        {info.grade}
                      </div>
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-700 ${
                          Number(pct) >= 75 ? 'bg-emerald-400' : Number(pct) >= 50 ? 'bg-amber-400' : 'bg-rose-400'
                        }`}
                        style={{ width: `${Math.min(100, Math.max(0, Number(pct)))}%` }}
                      />
                    </div>
                  </div>

                  {/* Feedback comment */}
                  {score.feedback && (
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-xs text-slate-300">
                      <span className="font-bold text-primary-400">Teacher Feedback: </span>
                      {score.feedback}
                    </div>
                  )}

                  {/* Blockchain Verification Badge */}
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 pt-1 text-xs">
                    <div className="flex items-center gap-1.5 text-emerald-400 font-medium">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Anchored on Solana Blockchain</span>
                    </div>
                    {score.explorerUrl ? (
                      <a
                        href={score.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-primary-400 hover:underline font-mono text-[11px]"
                      >
                        Hash: {score.offlineHash?.substring(0, 16)}... <ExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span className="text-slate-500 font-mono text-[11px]">
                        Hash: {score.offlineHash?.substring(0, 16)}...
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ─── TEACHER / ADMIN VIEW ────────────────────────────────────────────────────
  const classStudents = students.filter(
    s => !selectedAssessment || !selectedAssessment.className || s.className === selectedAssessment.className || s.grade === selectedAssessment.className
  );
  const targetStudents = classStudents.length > 0 ? classStudents : students;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <BarChart2 className="w-6 h-6 text-primary-400" /> Assessment & Performance Reporting
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Conduct assessments, log scores, and generate automated performance metrics.
          </p>
        </div>

        <button
          onClick={() => {
            setShowCreateForm(!showCreateForm);
            setCreateMsg(null);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2.5 bg-primary-600 text-white text-sm font-bold rounded-xl hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-900/40 shrink-0"
        >
          <Plus className="w-4 h-4" /> {showCreateForm ? 'Cancel' : 'New Assessment'}
        </button>
      </div>

      {/* Create New Assessment Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateAssessment} className="glass-card p-6 rounded-2xl border border-primary-500/30 space-y-4">
          <div className="flex items-center justify-between border-b border-white/5 pb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-primary-400" /> Create New Assessment / Test
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400">Assessment Title *</label>
              <input
                type="text"
                placeholder="e.g. Midterm Mathematics Exam"
                value={title}
                onChange={e => setTitle(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white placeholder:text-slate-600 outline-none focus:border-primary-500 transition-colors"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400">Subject *</label>
              <select
                value={subject}
                onChange={e => setSubject(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
              >
                <option value="" className="bg-[#0d0f1a]">Select Subject...</option>
                <option className="bg-[#0d0f1a]">Mathematics</option>
                <option className="bg-[#0d0f1a]">Physics</option>
                <option className="bg-[#0d0f1a]">Chemistry</option>
                <option className="bg-[#0d0f1a]">Biology</option>
                <option className="bg-[#0d0f1a]">English Language</option>
                <option className="bg-[#0d0f1a]">Computer Studies</option>
                <option className="bg-[#0d0f1a]">Geography</option>
                <option className="bg-[#0d0f1a]">History</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400">Class / Grade Level *</label>
              <select
                value={className}
                onChange={e => setClassName(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
              >
                <option className="bg-[#0d0f1a]">Grade 9</option>
                <option className="bg-[#0d0f1a]">Grade 10</option>
                <option className="bg-[#0d0f1a]">Grade 11</option>
                <option className="bg-[#0d0f1a]">Grade 12</option>
                <option className="bg-[#0d0f1a]">Form 4A</option>
                <option className="bg-[#0d0f1a]">All Classes</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-400">Max Score Marks *</label>
              <input
                type="number"
                min="1"
                max="1000"
                value={maxScore}
                onChange={e => setMaxScore(e.target.value)}
                required
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white outline-none focus:border-primary-500 transition-colors"
              />
            </div>
          </div>

          {createMsg && (
            <div className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-medium ${
              createMsg.type === 'success' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400' : 'bg-rose-950/30 border-rose-500/30 text-rose-400'
            }`}>
              {createMsg.type === 'success' ? <Check className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
              <span>{createMsg.text}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-900/40 disabled:opacity-50"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {creating ? 'Creating Assessment...' : 'Create Assessment'}
          </button>
        </form>
      )}

      {/* Main Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Assessment Selection List */}
        <div className="space-y-4 lg:col-span-1">
          <div className="glass-card p-4 rounded-2xl border border-white/10 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-primary-400" /> Assessments ({assessments.length})
              </h2>
              <button
                onClick={fetchAssessments}
                className="text-slate-400 hover:text-white transition-colors"
                title="Refresh list"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingAssessments ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {/* Search filter */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search assessments..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-600 outline-none focus:border-primary-500 transition-colors"
              />
            </div>

            {/* List */}
            {loadingAssessments ? (
              <div className="p-8 text-center text-xs text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary-400 mb-2" />
                Loading assessments...
              </div>
            ) : filteredAssessments.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No assessments found. Click "New Assessment" above to create one.
              </div>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {filteredAssessments.map(item => {
                  const isSelected = selectedAssessment?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => loadAssessmentDetail(item)}
                      className={`w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between ${
                        isSelected
                          ? 'bg-primary-600/20 border-primary-500/50 text-white shadow-lg shadow-primary-950/40'
                          : 'bg-white/5 border-white/5 text-slate-300 hover:bg-white/10 hover:border-white/10'
                      }`}
                    >
                      <div>
                        <p className="text-xs font-bold text-white line-clamp-1">{item.title}</p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {item.subject} · {item.className}
                        </p>
                        <p className="text-[10px] text-slate-500 mt-1">
                          Max: {item.maxScore} pts · {friendlyDate(item.createdAt)}
                        </p>
                      </div>
                      <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${isSelected ? 'text-primary-400 translate-x-0.5' : 'text-slate-600'}`} />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Scoring Form & Report Dashboard */}
        <div className="space-y-6 lg:col-span-2">
          {!selectedAssessment ? (
            <div className="glass-card p-12 text-center text-slate-500 rounded-2xl">
              <BarChart2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
              <p className="text-base font-semibold text-slate-300">Select an Assessment</p>
              <p className="text-xs text-slate-500 mt-1">
                Choose an assessment from the left column to enter scores or view performance reports.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Selected Assessment Banner */}
              <div className="glass-card p-5 rounded-2xl border border-primary-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary-400 px-2.5 py-1 bg-primary-950/60 rounded-full border border-primary-500/30">
                    {selectedAssessment.subject}
                  </span>
                  <h2 className="text-xl font-bold text-white mt-2">{selectedAssessment.title}</h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Target Class: <strong className="text-slate-200">{selectedAssessment.className}</strong> · Max Marks: <strong className="text-slate-200">{selectedAssessment.maxScore}</strong>
                  </p>
                </div>

                {report && (
                  <div className="flex items-center gap-3 bg-white/5 p-3 rounded-xl border border-white/10 shrink-0">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Class Avg</p>
                      <p className="text-lg font-bold text-emerald-400">{report.average} <span className="text-xs text-slate-400">/ {report.maxScore}</span></p>
                    </div>
                    <div className="h-8 w-px bg-white/10" />
                    <div className="text-center">
                      <p className="text-[10px] text-slate-500 uppercase font-bold">Pass Rate</p>
                      <p className="text-lg font-bold text-primary-400">{report.passRate}%</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Class Performance Metrics Report Card */}
              {report && (
                <div className="glass-card p-5 rounded-2xl border border-white/10 space-y-4">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2 border-b border-white/5 pb-2">
                    <TrendingUp className="w-4 h-4 text-emerald-400" /> Automated Class Performance Report
                  </h3>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Average Score</p>
                      <p className="text-xl font-bold text-white mt-1">{report.average}</p>
                      <p className="text-[10px] text-slate-400">
                        {((report.average / (report.maxScore || 1)) * 100).toFixed(1)}% of total
                      </p>
                    </div>

                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Highest Score</p>
                      <p className="text-xl font-bold text-emerald-400 mt-1">{report.highest}</p>
                      <p className="text-[10px] text-slate-400">Top performance</p>
                    </div>

                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Lowest Score</p>
                      <p className="text-xl font-bold text-rose-400 mt-1">{report.lowest}</p>
                      <p className="text-[10px] text-slate-400">Needs improvement</p>
                    </div>

                    <div className="bg-white/5 p-3 rounded-xl border border-white/5">
                      <p className="text-[10px] font-bold text-slate-500 uppercase">Pass Rate (≥50%)</p>
                      <p className="text-xl font-bold text-primary-400 mt-1">{report.passRate}%</p>
                      <p className="text-[10px] text-slate-400">{report.totalStudents} student(s)</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Feedback Alert Banner */}
              {scoreMsg && (
                <div className={`p-4 rounded-2xl border flex items-start gap-3 text-xs ${
                  scoreMsg.type === 'success' ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-400' : 'bg-rose-950/30 border-rose-500/30 text-rose-400'
                }`}>
                  {scoreMsg.type === 'success' ? <CheckCircle className="w-5 h-5 shrink-0" /> : <XCircle className="w-5 h-5 shrink-0" />}
                  <div className="flex-1">
                    <p className="font-bold text-sm">{scoreMsg.type === 'success' ? 'Scores Submitted' : 'Error'}</p>
                    <p className="mt-0.5 text-slate-300">{scoreMsg.text}</p>
                  </div>
                  <button onClick={() => setScoreMsg(null)} className="text-slate-500 hover:text-white">✕</button>
                </div>
              )}

              {/* Student Score Entry Form */}
              <div className="glass-card p-5 rounded-2xl border border-white/10 space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-primary-400" /> Class Roster & Score Entry
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Enter scores for students below. All submitted scores are automatically hashed & anchored on-chain.
                    </p>
                  </div>
                  <span className="text-xs font-bold text-slate-400 bg-white/5 px-3 py-1 rounded-full border border-white/10">
                    {targetStudents.length} Student(s)
                  </span>
                </div>

                <div className="divide-y divide-white/5">
                  {targetStudents.map(student => {
                    const currentEntry = scoresInput[student.id] || { score: '', feedback: '' };
                    const numericScore = parseFloat(currentEntry.score);
                    const gradeCalc = !isNaN(numericScore) ? calculateGrade(numericScore, selectedAssessment.maxScore) : null;

                    return (
                      <div key={student.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <img
                            src={student.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${student.id}`}
                            alt={student.name}
                            className="w-9 h-9 rounded-full bg-white/5 border border-white/10 shrink-0"
                          />
                          <div className="truncate">
                            <p className="text-sm font-bold text-white truncate">{student.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {student.email} · {student.className || student.grade || 'Student'}
                            </p>
                          </div>
                        </div>

                        {/* Score Input & Feedback */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                          <div className="relative w-full sm:w-28">
                            <input
                              type="number"
                              min="0"
                              max={selectedAssessment.maxScore}
                              step="0.5"
                              placeholder={`0 - ${selectedAssessment.maxScore}`}
                              value={currentEntry.score}
                              onChange={e => {
                                setScoresInput(prev => ({
                                  ...prev,
                                  [student.id]: {
                                    ...prev[student.id],
                                    score: e.target.value,
                                    feedback: prev[student.id]?.feedback || '',
                                  },
                                }));
                              }}
                              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-600 outline-none focus:border-primary-500 transition-colors"
                            />
                          </div>

                          <input
                            type="text"
                            placeholder="Feedback comment (optional)..."
                            value={currentEntry.feedback}
                            onChange={e => {
                              setScoresInput(prev => ({
                                ...prev,
                                [student.id]: {
                                  score: prev[student.id]?.score || '',
                                  feedback: e.target.value,
                                },
                              }));
                            }}
                            className="w-full sm:w-48 px-3 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-600 outline-none focus:border-primary-500 transition-colors"
                          />

                          {gradeCalc && (
                            <span className={`px-2.5 py-1 text-xs font-bold rounded-lg border ${gradeCalc.bg} ${gradeCalc.color} ${gradeCalc.border} shrink-0 text-center`}>
                              {gradeCalc.grade}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="pt-2 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-500 flex items-center gap-1.5">
                    <Shield className="w-3.5 h-3.5 text-emerald-400" /> Each score entry generates an immutable SHA-256 digest on Solana.
                  </p>

                  <button
                    onClick={handleSubmitScores}
                    disabled={submittingScores}
                    className="w-full sm:w-auto px-6 py-3 bg-primary-600 text-white text-xs font-bold rounded-xl hover:bg-primary-700 active:scale-95 transition-all shadow-lg shadow-primary-950/40 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {submittingScores ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {submittingScores ? 'Submitting & Anchoring...' : 'Submit Class Scores'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentView;
