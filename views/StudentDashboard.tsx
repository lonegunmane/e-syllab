import React, { useState, useEffect, useMemo } from 'react';
import { 
  Book, Clock, CheckCircle, Download, ExternalLink, MessageSquare,
  User as UserIcon, Mail, Phone, School, Home, Save, Pencil,
  CheckCircle as CheckCircleIcon, XCircle, Loader2, Users, FileText, X, BookOpen, TrendingUp, Bell, Calendar as CalendarIcon, ClipboardList
} from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, AreaChart, Area 
} from 'recharts';
import { User, CurriculumResource, ResourceCategory, UserRole, GradeRecord, Assignment } from '../types';
import { db } from '../services/database';
import { getCurriculum, getGrades } from '../services/api';
import { notificationService } from '../services/notificationService';
import { ProfileSection } from '../components/ProfileSection';
import { TimetableView } from '../components/TimetableView';
import { AssessmentView } from '../components/AssessmentView';

interface StudentDashboardProps {
  user: User;
  onUpdateUser: (user: User) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const CurriculumViewer: React.FC<{ userGrade?: string }> = ({ userGrade }) => {
    const [materials, setMaterials] = useState<CurriculumResource[]>([]);
    const [viewingMaterial, setViewingMaterial] = useState<CurriculumResource | null>(null);

    useEffect(() => {
        const loadCurriculum = async () => {
            try {
                const res = await getCurriculum();
                if (res && res.success && Array.isArray(res.curriculum)) {
                    setMaterials(res.curriculum.filter(m => 
                        (m.category === ResourceCategory.ANNOUNCEMENT) && 
                        (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                    ));
                    return;
                }
                const all = db.getAllCurriculum();
                setMaterials(all.filter(m => 
                    (m.category === ResourceCategory.ANNOUNCEMENT) && 
                    (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                ));
            } catch {
                const all = db.getAllCurriculum();
                setMaterials(all.filter(m => 
                    (m.category === ResourceCategory.ANNOUNCEMENT) && 
                    (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                ));
            }
        };
        loadCurriculum();
    }, [userGrade]);

    const handleDownload = (material: CurriculumResource) => {
        const { fileData, fileName, title, description } = material;
        
        if (fileData) {
            const link = document.createElement('a');
            link.href = fileData;
            link.download = fileName || 'download';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            return;
        }

        // Fallback for items without real data
        const content = `Title: ${title}\nDescription: ${description}\n\nThis is a simulated download from the Secure Digital Campus Platform.`;
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = (fileName || 'document').includes('.') ? (fileName || 'document') : `${fileName || 'document'}.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div><h2 className="text-xl font-bold text-white uppercase tracking-tight">Campus Announcements</h2><p className="text-slate-400 text-sm">Official notices and updates from the school administration.</p></div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {materials.map(item => (
                    <div key={item.id} className="glass-card p-6 rounded-2xl transition-all group hover:border-primary-500/30">
                        <div className="w-10 h-10 bg-primary-950/40 border border-primary-500/20 rounded-xl flex items-center justify-center text-primary-400 mb-4 shadow-lg shadow-primary-950/20">
                            {item.category === ResourceCategory.ANNOUNCEMENT ? <Bell className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <h3 className="font-bold text-white mb-1 group-hover:text-primary-300 transition-colors">
                            {item.category === ResourceCategory.ANNOUNCEMENT && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[8px] font-bold uppercase mr-2 relative -top-0.5 border border-amber-500/30">Announcement</span>}
                            {item.title}
                        </h3>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{item.subject} • {item.gradeLevel}</p>
                        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed">{item.description}</p>
                        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] font-medium text-slate-500 font-mono">
                            <div className="flex items-center gap-2">
                                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${item.uploadedByName}`} className="w-4 h-4 rounded-full border border-white/10" alt="" />
                                <span className="text-primary-400 font-bold">{item.uploadedByName || 'Admin'}</span>
                            </div>
                            <span onClick={() => setViewingMaterial(item)} className="flex items-center gap-1 text-primary-400 cursor-pointer hover:text-primary-300 hover:underline"><BookOpen className="w-3 h-3" /> View</span>
                        </div>
                    </div>
                ))}
                {materials.length === 0 && <div className="col-span-full py-16 text-center text-slate-500 bg-white/5 rounded-3xl border-2 border-dashed border-white/10 italic">No curriculum materials shared yet.</div>}
            </div>

            {viewingMaterial && (
                <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
                    <div className="glass-card rounded-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95">
                        <div className="p-6 border-b border-white/5 flex justify-between items-start">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-primary-950/40 border border-primary-500/20 rounded-xl flex items-center justify-center text-primary-400 shadow-lg shadow-primary-950/20">
                                    <FileText className="w-5 h-5" />
                                </div>
                                <div>
                                    <h2 className="font-bold text-white">{viewingMaterial.title}</h2>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{viewingMaterial.subject} • {viewingMaterial.gradeLevel}</p>
                                </div>
                            </div>
                            <button onClick={() => setViewingMaterial(null)} className="p-2 text-slate-500 hover:bg-white/5 hover:text-white rounded-lg transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-6">
                            <div className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl mb-4">
                                <img src={db.getTable<User>(db.tables.USERS).find(u => u.id === viewingMaterial.uploadedById)?.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${viewingMaterial.uploadedByName}`} className="w-10 h-10 rounded-full border border-white/10 bg-black/20" alt="" />
                                <div>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Published By</p>
                                    <p className="text-sm font-bold text-white">{viewingMaterial.uploadedByName || 'Platform Administrator'}</p>
                                </div>
                            </div>
                            <div>
                                <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Description</h3>
                                <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{viewingMaterial.description}</p>
                            </div>
                            
                            {viewingMaterial.fileName && (
                                <div>
                                    <h3 className="text-xs font-bold text-slate-500 uppercase mb-2">Attached File</h3>
                                    <div className="flex items-center justify-between p-4 bg-white/5 border border-white/10 rounded-xl group hover:bg-white/10 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-paperclip text-primary-400 w-5 h-5 transition-transform group-hover:rotate-12"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                                            <div>
                                                <p className="text-sm font-semibold text-slate-200">{viewingMaterial.fileName}</p>
                                                <p className="text-[10px] text-slate-600 uppercase font-mono">{viewingMaterial.fileType || 'Unknown Type'}</p>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={() => handleDownload(viewingMaterial)}
                                            className="px-4 py-2 bg-primary-600 text-white text-xs font-bold rounded-lg hover:bg-primary-700 transition-colors shadow-lg shadow-primary-900/40"
                                        >
                                            Download
                                        </button>
                                    </div>
                                </div>
                            )}
                            
                            <div className="pt-4 border-t border-white/5 flex justify-between items-center text-xs text-slate-500 font-mono">
                                <span>Uploaded on {new Date(viewingMaterial.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div className="p-4 bg-white/5 flex justify-end">
                            <button onClick={() => setViewingMaterial(null)} className="px-6 py-2 bg-white/5 border border-white/10 text-slate-200 rounded-xl text-sm font-bold shadow-sm hover:bg-white/10 transition-colors">
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const AssignmentsView: React.FC<{ userGrade?: string }> = ({ userGrade }) => {
    const [timedAssignments, setTimedAssignments] = useState<Assignment[]>([]);
    const [curriculumDocs, setCurriculumDocs] = useState<CurriculumResource[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

    useEffect(() => {
        const grade = userGrade || 'Grade 10';
        setTimedAssignments(db.getAssignments(grade));

        const loadDocs = async () => {
            try {
                const res = await getCurriculum();
                if (res && res.success && Array.isArray(res.curriculum)) {
                    setCurriculumDocs(res.curriculum.filter(m => 
                        (m.category === ResourceCategory.DOCUMENT) && 
                        (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                    ));
                    return;
                }
                const all = db.getAllCurriculum();
                setCurriculumDocs(all.filter(m => 
                    (m.category === ResourceCategory.DOCUMENT) && 
                    (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                ));
            } catch {
                const all = db.getAllCurriculum();
                setCurriculumDocs(all.filter(m => 
                    (m.category === ResourceCategory.DOCUMENT) && 
                    (m.gradeLevel === 'All Grades' || m.gradeLevel === userGrade || !userGrade)
                ));
            }
        };
        loadDocs();
    }, [userGrade]);

    const handleReminderTrigger = (asg: Assignment) => {
        notificationService.addNotification({
          userId: '',
          title: `⏰ Custom Reminder Set: ${asg.title}`,
          body: `Reminder added for ${asg.subject} assignment due on ${new Date(asg.dueDate).toLocaleString()}.`,
          type: 'ASSIGNMENT_DUE',
          relatedId: asg.id,
          dueDate: asg.dueDate,
          priority: 'high'
        });
        alert(`Push alert reminder set for "${asg.title}"!`);
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-bold text-white uppercase tracking-tight">Active Assignments & Deadline Alerts</h2>
                    <p className="text-slate-400 text-sm">Review your pending academic submissions and local push notifications.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-xs text-emerald-400 font-bold uppercase tracking-widest bg-emerald-950/40 px-3 py-1 rounded-full border border-emerald-500/20">
                        {timedAssignments.length} Timed Tasks
                    </span>
                </div>
            </div>

            {/* Timed Assignments with Push Notification Alerts */}
            {timedAssignments.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {timedAssignments.map(asg => {
                        const due = new Date(asg.dueDate);
                        const isOverdue = due.getTime() < Date.now();
                        const hoursLeft = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60));

                        return (
                            <div key={asg.id} className={`glass-card p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                                isOverdue 
                                  ? 'border-rose-500/40 bg-rose-950/10' 
                                  : hoursLeft <= 6 
                                  ? 'border-amber-500/40 bg-amber-950/10' 
                                  : 'border-white/10 hover:border-primary-500/40'
                            }`}>
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase border ${
                                            isOverdue ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                                            hoursLeft <= 6 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                                            'bg-primary-500/20 text-primary-300 border-primary-500/30'
                                        }`}>
                                            {isOverdue ? 'OVERDUE' : hoursLeft <= 24 ? `Due in ${hoursLeft}h` : due.toLocaleDateString()}
                                        </span>
                                        <span className="text-xs text-slate-400 font-semibold">{asg.subject}</span>
                                    </div>

                                    <div>
                                        <h3 className="font-bold text-white text-base leading-snug">{asg.title}</h3>
                                        <p className="text-xs text-slate-400 mt-1 line-clamp-2">{asg.description}</p>
                                    </div>
                                </div>

                                <div className="pt-4 mt-4 border-t border-white/5 flex items-center justify-between text-xs">
                                    <span className="text-slate-500 font-medium">By {asg.createdByName || 'Instructor'}</span>
                                    <button
                                        onClick={() => handleReminderTrigger(asg)}
                                        className="px-3 py-1 bg-primary-600/20 hover:bg-primary-600 text-primary-300 hover:text-white rounded-lg border border-primary-500/30 font-bold transition-all text-[11px] flex items-center gap-1 cursor-pointer"
                                    >
                                        <Bell className="w-3 h-3" /> Set Alert
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Curriculum Documents & Reference Materials */}
            <div className="glass-card rounded-2xl overflow-hidden">
                <div className="p-4 border-b border-white/5 bg-white/5 flex items-center justify-between">
                    <h3 className="font-bold text-slate-200 text-sm uppercase tracking-wider">Curriculum Reference Documents</h3>
                    <span className="text-xs text-slate-500">{curriculumDocs.length} Documents</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-white/5 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                            <tr>
                                <th className="px-6 py-4">Task / Document</th>
                                <th className="px-6 py-4">Category</th>
                                <th className="px-6 py-4">Subject</th>
                                <th className="px-6 py-4">Status</th>
                                <th className="px-6 py-4 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            {curriculumDocs.map((item) => (
                                <tr key={item.id} className="hover:bg-white/5 group transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-2 bg-white/5 rounded-lg border border-white/10 group-hover:border-primary-500/30 transition-colors">
                                                {item.category === ResourceCategory.ANNOUNCEMENT ? <Bell className="w-4 h-4 text-amber-400" /> : <ClipboardList className="w-4 h-4 text-primary-400" />}
                                            </div>
                                            <span className="font-semibold text-slate-200 group-hover:text-primary-300 transition-colors">{item.title}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase ${
                                            item.category === ResourceCategory.ANNOUNCEMENT ? 'bg-amber-900/40 text-amber-400 border border-amber-500/20' : 'bg-primary-950/40 text-primary-400 border border-primary-500/20'
                                        }`}>
                                            {item.category || 'Assignment'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-500 font-medium">{item.subject}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex items-center gap-2">
                                            <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Available</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <button className="text-[10px] font-bold text-primary-400 hover:text-primary-300 transition-all uppercase tracking-widest group-hover:mr-1">Open Portal</button>
                                    </td>
                                </tr>
                            ))}
                            {curriculumDocs.length === 0 && timedAssignments.length === 0 && (
                                <tr>
                                    <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">No active assignments found for your grade.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export const StudentDashboard: React.FC<StudentDashboardProps> = ({ user, onUpdateUser, activeTab, setActiveTab }) => {
  const subjectsList = [
    'Mathematics', 
    'Science Physics', 
    'Biology', 
    'Chemistry', 
    'Physical Education', 
    'Art', 
    'Food and Nutrition', 
    'Additional Mathematics', 
    'Computer Studies'
  ];

  const [assignmentCount, setAssignmentCount] = useState(0);
  const [selectedRankSubject, setSelectedRankSubject] = useState<string>('Overall');
  const [rankInfo, setRankInfo] = useState<{ pos: number; total: number } | null>(null);
  const [studentGrades, setStudentGrades] = useState<GradeRecord[]>([]);
  const [recentCurriculum, setRecentCurriculum] = useState<CurriculumResource[]>([]);

  useEffect(() => {
    const loadOverviewData = async () => {
      try {
        const [gradesRes, currRes] = await Promise.all([
          getGrades().catch(() => null),
          getCurriculum().catch(() => null)
        ]);

        if (gradesRes && gradesRes.success && Array.isArray(gradesRes.grades)) {
          setStudentGrades(gradesRes.grades);
        } else {
          setStudentGrades(db.getGradesByStudent(user.id));
        }

        let studentCurr: CurriculumResource[] = [];
        if (currRes && currRes.success && Array.isArray(currRes.curriculum)) {
          studentCurr = currRes.curriculum.filter(c => c.gradeLevel === 'All Grades' || c.gradeLevel === user.grade || !user.grade);
          setRecentCurriculum(studentCurr);
        } else {
          const allCurr = db.getAllCurriculum();
          studentCurr = allCurr.filter(c => c.gradeLevel === 'All Grades' || c.gradeLevel === user.grade || !user.grade);
          setRecentCurriculum(studentCurr);
        }

        const count = studentCurr.filter(m => m.category === ResourceCategory.DOCUMENT).length;
        setAssignmentCount(count);
      } catch {
        const grades = db.getGradesByStudent(user.id);
        setStudentGrades(grades);

        const allCurr = db.getAllCurriculum();
        const studentCurr = allCurr.filter(c => c.gradeLevel === 'All Grades' || c.gradeLevel === user.grade || !user.grade);
        setRecentCurriculum(studentCurr);

        const count = studentCurr.filter(m => m.category === ResourceCategory.DOCUMENT).length;
        setAssignmentCount(count);
      }
    };

    loadOverviewData();

    // Calculate Academic Rank
    const calculateRank = () => {
      const allStudents = db.getUsersByRole(UserRole.STUDENT);
      // Filter by Grade AND Class
      const peerStudents = allStudents.filter(s => s.grade === user.grade && s.className === user.className);
      
      if (peerStudents.length === 0) return;

      const studentsWithAverages = peerStudents.map(student => {
        const grades = db.getGradesByStudent(student.id);
        
        let relevantGrades = grades;
        if (selectedRankSubject !== 'Overall') {
          relevantGrades = grades.filter(g => g.subject === selectedRankSubject);
        }

        if (relevantGrades.length === 0) return { studentId: student.id, avg: 0 };
        const totalScore = relevantGrades.reduce((sum, g) => sum + g.score, 0);
        return { studentId: student.id, avg: totalScore / relevantGrades.length };
      });

      // Sort by average descending
      studentsWithAverages.sort((a, b) => b.avg - a.avg);

      const findPos = studentsWithAverages.findIndex(s => s.studentId === user.id) + 1;
      
      setRankInfo({
        pos: findPos || 0,
        total: peerStudents.length
      });
    };

    calculateRank();
  }, [user.id, user.grade, user.className, selectedRankSubject]);

  const avgGradeLetter = useMemo(() => {
    if (studentGrades.length === 0) return '--';
    const avg = studentGrades.reduce((sum, g) => sum + g.score, 0) / studentGrades.length;
    if (avg >= 90) return 'A+';
    if (avg >= 80) return 'A';
    if (avg >= 70) return 'B';
    if (avg >= 60) return 'C';
    if (avg >= 50) return 'D';
    return 'F';
  }, [studentGrades]);

  const performanceChartData = useMemo(() => {
    return studentGrades.map(g => ({
      name: g.subject.slice(0, 10),
      score: g.score
    }));
  }, [studentGrades]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Hi, {user.name}! 👋</h1><p className="text-slate-400">Welcome to your secure digital campus.</p></div>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="glass-card p-6 rounded-2xl group hover:border-primary-500/30 transition-all cursor-default">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-emerald-950/40 text-emerald-400 border border-white/5 shadow-inner transition-transform group-hover:scale-110">
                  <CheckCircle className="w-6 h-6" />
                </div>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">
                  {user.grade} {user.className || 'Class'} Position
                </p>
                <p className="text-xl font-bold text-white transition-colors group-hover:text-primary-400">
                  {rankInfo && rankInfo.pos > 0 ? `${rankInfo.pos} / ${rankInfo.total}` : '--'}
                </p>
              </div>
            </div>

            <div className="glass-card p-6 rounded-2xl group hover:border-primary-500/30 transition-all cursor-default">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 rounded-xl bg-primary-950/40 text-primary-400 border border-white/5 shadow-inner transition-transform group-hover:scale-110">
                  <Clock className="w-6 h-6" />
                </div>
                <select 
                  value={selectedRankSubject}
                  onChange={(e) => setSelectedRankSubject(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-lg text-[10px] font-bold text-slate-400 px-2 py-1 outline-none focus:border-primary-500 cursor-pointer"
                >
                  <option value="Overall">Overall Rank</option>
                  {subjectsList.map(s => <option key={s} value={s}>{s} Rank</option>)}
                </select>
              </div>
              <div>
                <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Grades Recorded</p>
                <p className="text-xl font-bold text-white transition-colors group-hover:text-primary-400">{studentGrades.length}</p>
              </div>
            </div>

            {[
              { label: 'Avg Grade', value: avgGradeLetter, icon: Book, color: 'text-amber-400', bg: 'bg-amber-950/40' },
            ].map((stat, i) => (
              <div key={i} className="glass-card p-6 rounded-2xl flex items-center gap-4 group hover:border-primary-500/30 transition-all cursor-default">
                <div className={`p-3 rounded-xl ${stat.bg} ${stat.color} border border-white/5 shadow-inner transition-transform group-hover:scale-110`}><stat.icon className="w-6 h-6" /></div>
                <div><p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{stat.label}</p><p className="text-xl font-bold text-white transition-colors group-hover:text-primary-400">{stat.value}</p></div>
              </div>
            ))}
            
            {/* Live Assignments KPI Card */}
            <div 
              onClick={() => setActiveTab('assignments')}
              className="glass-card p-6 rounded-2xl group hover:border-primary-500/30 transition-all cursor-pointer"
            >
              <div className="w-10 h-10 rounded-xl bg-amber-950/40 text-amber-400 flex items-center justify-center mb-4 border border-white/5 shadow-lg shadow-black/20 group-hover:scale-110 transition-transform">
                <ClipboardList className="w-5 h-5" />
              </div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Assignments</p>
              <p className="text-2xl font-bold text-white mt-1">{assignmentCount}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 glass-card p-6 rounded-2xl h-[400px]">
                <h2 className="font-bold text-white mb-6 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-primary-400" /> Academic Progress</h2>
                {performanceChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="80%">
                    <AreaChart data={performanceChartData}>
                      <defs><linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3}/><stop offset="95%" stopColor="#7c3aed" stopOpacity={0}/></linearGradient></defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#ffffff05" />
                      <XAxis dataKey="name" stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="#64748b" fontSize={11} tickLine={false} axisLine={false} domain={[0, 100]} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#1a1635', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.05)', color: '#fff' }}
                        itemStyle={{ color: '#a78bfa' }}
                      />
                      <Area type="monotone" dataKey="score" stroke="#7c3aed" strokeWidth={3} fillOpacity={1} fill="url(#colorScore)" dot={{ fill: '#7c3aed', strokeWidth: 2, r: 4, stroke: '#1a1635' }} activeDot={{ r: 6, strokeWidth: 0 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-[280px] flex flex-col items-center justify-center text-slate-500 text-xs italic gap-2">
                    <TrendingUp className="w-8 h-8 opacity-20" />
                    <p>No academic scores recorded yet.</p>
                  </div>
                )}
            </div>
            <div className="glass-card p-6 rounded-2xl">
              <h2 className="font-bold text-white mb-6 flex items-center gap-2"><BookOpen className="w-4 h-4 text-primary-400" /> Recent Courses</h2>
              <div className="space-y-4">
                {recentCurriculum.length > 0 ? (
                  recentCurriculum.slice(0, 5).map((curr) => (
                    <div key={curr.id} className="p-3 bg-white/5 border border-white/5 rounded-xl hover:bg-white/10 transition-colors">
                      <p className="text-xs font-bold text-white truncate">{curr.title}</p>
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                        <span>{curr.subject}</span>
                        <span className="text-primary-400 font-bold uppercase">{curr.category}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-12 flex flex-col items-center justify-center text-slate-500 text-xs italic gap-2">
                    <BookOpen className="w-8 h-8 opacity-20" />
                    <p>No course modules assigned yet.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'announcements' && <CurriculumViewer userGrade={user.grade} />}
      {activeTab === 'timetable' && <TimetableView currentUser={user} />}
      {activeTab === 'assignments' && <AssignmentsView userGrade={user.grade} />}
      {activeTab === 'assessments' && <AssessmentView currentUser={user} />}
      {activeTab === 'profile' && <ProfileSection user={user} onUpdateUser={onUpdateUser} />}
    </div>
  );
};
