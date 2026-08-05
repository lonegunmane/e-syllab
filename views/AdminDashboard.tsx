import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion } from 'motion/react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Cell 
} from 'recharts';
import { 
  Users, UserPlus, Database, Settings, Search, 
  ShieldCheck, CheckCircle, XCircle, Loader2, Mail, Lock,
  User as UserIcon, Phone, School, Home, Save, Pencil, GraduationCap, Briefcase, Calendar, Plus, FileText, BookOpen, X, Trash2, Bell
} from 'lucide-react';
import { User, UserRole, CurriculumResource, ResourceCategory, VaultDocument, DocumentStatus, AuthCredential } from '../types';
import { db } from '../services/database';
import { 
  createUserByAdmin, getAllLedgerRecords,
  getCurriculum, addCurriculum as apiAddCurriculum, deleteCurriculum as apiDeleteCurriculum,
  getVaultDocuments, updateVaultDocumentStatus as apiUpdateVaultStatus
} from '../services/api';
import { SettingsView } from '../components/SettingsView';
import { ProfileSection } from '../components/ProfileSection';
import { TimetableView } from '../components/TimetableView';
import { StaffPerformanceDashboard } from '../components/StaffPerformanceDashboard';
import { AssessmentView } from '../components/AssessmentView';
import { NotificationSendForm } from '../components/NotificationSendForm';

const staffActivity = [
  { name: 'Jan', activity: 400 },
  { name: 'Feb', activity: 300 },
  { name: 'Mar', activity: 600 },
  { name: 'Apr', activity: 800 },
  { name: 'May', activity: 500 },
  { name: 'Jun', activity: 900 },
];

const COLORS = ['#7c3aed', '#a78bfa', '#c4b5fd', '#8b5cf6'];

interface AdminDashboardProps {
  user: User;
  onUpdateUser: (user: User) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
  onLogout?: () => void;
}

const AnimatedCounter: React.FC<{ value: number }> = ({ value }) => {
  const [displayValue, setDisplayValue] = useState(0);
  const countRef = useRef<number>(0);

  useEffect(() => {
    let start = countRef.current;
    const end = value;
    if (start === end) {
      setDisplayValue(end);
      return;
    }
    const duration = 1000;
    const startTime = performance.now();
    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const current = Math.floor(start + (end - start) * easedProgress);
      setDisplayValue(current);
      if (progress < 1) requestAnimationFrame(animate);
      else countRef.current = end;
    };
    requestAnimationFrame(animate);
  }, [value]);

  return <span>{displayValue.toLocaleString()}</span>;
};

const LiveNetworkActivity: React.FC = () => {
    const allUsers = [...db.getUsersByRole(UserRole.STUDENT), ...db.getUsersByRole(UserRole.TEACHER)];
    
    // Create random-looking but deterministic session info based on ID length or characters
    const getSessionInfo = (user: User, index: number) => {
        const statuses = ['Active', 'Idle', 'Validating'];
        const times = ['1h 15m', '45m', '2h 10m', '30m', '10m', '55m'];
        const grades = ['A-', 'B+', 'A', 'B', 'B-', 'A+'];
        
        return {
            status: statuses[index % statuses.length],
            timeLoggedIn: times[index % times.length],
            avgGrade: grades[index % grades.length]
        };
    };

    const onlineUsers = allUsers.slice(0, 6).map((u, i) => ({
        ...u,
        ...getSessionInfo(u, i)
    }));
  
    return (
      <div className="lg:col-span-2 glass-card p-6 rounded-2xl flex flex-col h-[400px]">
          <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-white">Live Network Activity</h2>
              <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]"></span>
                  <span className="text-xs text-emerald-400 font-bold tracking-wider uppercase">Live</span>
              </div>
          </div>
          <div className="overflow-y-auto flex-1 pr-2 -mr-2 space-y-3">
            {onlineUsers.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-500 text-sm italic">
                    No active sessions found.
                </div>
            ) : (
                onlineUsers.map((user) => (
                    <div key={user.id} className="p-3 rounded-xl border border-white/5 bg-white/5 flex items-center justify-between hover:bg-white/10 transition-all group">
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <img src={user.avatar} alt="" className="w-10 h-10 rounded-full border border-white/10" />
                                <div className={`absolute bottom-0 right-0 w-3 h-3 border-2 border-[#1a1635] rounded-full ${user.status === 'Active' ? 'bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.5)]' : user.status === 'Idle' ? 'bg-amber-400 shadow-[0_0_5px_rgba(251,191,36,0.5)]' : 'bg-primary-400 shadow-[0_0_5px_rgba(167,139,250,0.5)]'}`}></div>
                            </div>
                            <div>
                                <p className="text-sm font-bold text-white group-hover:text-primary-300 transition-colors">{user.name}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{user.role}</p>
                            </div>
                        </div>
                        <div className="text-right">
                            <p className="text-xs font-mono text-slate-400">{user.timeLoggedIn} session</p>
                            {user.role === UserRole.STUDENT && (
                                <p className="text-[10px] font-bold text-primary-400 mt-0.5">Avg Grade: {user.avgGrade}</p>
                            )}
                        </div>
                    </div>
                ))
            )}
          </div>
      </div>
    );
  };

const DocumentTracker: React.FC = () => {
  const [docs, setDocs] = useState<VaultDocument[]>([]);
  const [curriculum, setCurriculum] = useState<CurriculumResource[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  useEffect(() => {
    const loadData = async () => {
      try {
        const [vaultRes, currRes] = await Promise.all([
          getVaultDocuments().catch(() => null),
          getCurriculum().catch(() => null),
        ]);
        if (vaultRes && vaultRes.success && Array.isArray(vaultRes.documents)) {
          setDocs(vaultRes.documents);
        } else {
          setDocs(db.getVaultDocuments());
        }
        if (currRes && currRes.success && Array.isArray(currRes.curriculum)) {
          setCurriculum(currRes.curriculum);
        } else {
          setCurriculum(db.getAllCurriculum());
        }
      } catch {
        setDocs(db.getVaultDocuments());
        setCurriculum(db.getAllCurriculum());
      }
    };
    loadData();
  }, []);

  const combinedDocs = useMemo(() => {
    const list1 = docs.map(d => ({
      id: d.id,
      title: d.title,
      author: d.teacherName,
      type: 'VAULT_DOCUMENT',
      status: d.status,
      date: d.createdAt,
      fileName: d.fileName
    }));

    const list2 = curriculum.map(c => ({
      id: c.id,
      title: c.title,
      author: c.uploadedByName,
      type: c.category === ResourceCategory.ANNOUNCEMENT ? 'ANNOUNCEMENT' : 'ASSIGNMENT',
      status: DocumentStatus.APPROVED,
      date: c.createdAt,
      fileName: c.fileName
    }));

    return [...list1, ...list2];
  }, [docs, curriculum]);

  const filteredDocs = useMemo(() => {
    return combinedDocs.filter(d => {
      const q = searchTerm.toLowerCase().trim();
      const matchesQuery = 
        !q ||
        d.title.toLowerCase().includes(q) ||
        d.author.toLowerCase().includes(q) ||
        (d.fileName && d.fileName.toLowerCase().includes(q));

      if (!matchesQuery) return false;
      if (typeFilter !== 'ALL' && d.type !== typeFilter) return false;
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;

      return true;
    });
  }, [combinedDocs, searchTerm, typeFilter, statusFilter]);

  return (
    <div className="space-y-4">
      {/* Searchbar & Search Filter */}
      <div className="p-4 bg-white/5 border border-white/5 rounded-2xl flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search documents by title, author, filename..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500 transition-all"
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="px-3 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="ALL" className="bg-[#1a1635]">All Resource Types</option>
            <option value="VAULT_DOCUMENT" className="bg-[#1a1635]">Vault Documents</option>
            <option value="ASSIGNMENT" className="bg-[#1a1635]">Assignments</option>
            <option value="ANNOUNCEMENT" className="bg-[#1a1635]">Announcements</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="ALL" className="bg-[#1a1635]">All Statuses</option>
            <option value={DocumentStatus.APPROVED} className="bg-[#1a1635]">Approved</option>
            <option value={DocumentStatus.PENDING} className="bg-[#1a1635]">Pending</option>
            <option value={DocumentStatus.REJECTED} className="bg-[#1a1635]">Rejected</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="glass-card rounded-2xl overflow-hidden border border-white/5">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-slate-400 font-bold uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3.5">Document Title</th>
                <th className="px-6 py-3.5">Author</th>
                <th className="px-6 py-3.5">Type</th>
                <th className="px-6 py-3.5">Date</th>
                <th className="px-6 py-3.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredDocs.map((doc) => (
                <tr key={doc.id} className="hover:bg-white/5 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <FileText className="w-4 h-4 text-primary-400 shrink-0" />
                      <div>
                        <p className="font-bold text-slate-200">{doc.title}</p>
                        {doc.fileName && <p className="text-[10px] text-slate-400 font-mono">{doc.fileName}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-300 font-medium">{doc.author}</td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-0.5 rounded bg-primary-950/40 text-primary-400 border border-primary-500/20 text-[9px] font-bold uppercase">
                      {doc.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-slate-500 font-mono text-[10px]">{new Date(doc.date).toLocaleDateString()}</td>
                  <td className="px-6 py-4 text-right">
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase border ${
                      doc.status === DocumentStatus.APPROVED ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30' :
                      doc.status === DocumentStatus.PENDING ? 'bg-amber-950/40 text-amber-400 border-amber-500/30' :
                      'bg-rose-950/40 text-rose-400 border-rose-500/30'
                    }`}>
                      {doc.status}
                    </span>
                  </td>
                </tr>
              ))}
              {filteredDocs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-500 italic">
                    No documents match search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const UserManager: React.FC<{ role: UserRole; title: string; onDelete: () => void }> = ({ role, title, onDelete }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'date_newest' | 'date_oldest'>('name_asc');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'success' | 'error', text: string } | null>(null);
  const [viewingUser, setViewingUser] = useState<User | null>(null);

  useEffect(() => {
    setUsers(db.getUsersByRole(role));
  }, [role]);

  const handleDelete = async (userId: string) => {
    // Prevent admin from deleting themselves (primary admin is id '3')
    if (userId === '3') {
      alert("System Protection: Primary Administrator account cannot be deleted.");
      return;
    }

    if (window.confirm(`Are you sure you want to permanently delete this ${role.toLowerCase()} account? This action cannot be reversed.`)) {
      setDeletingId(userId);
      setMsg(null);
      
      try {
        // Simulate network/blockchain verification delay
        await new Promise(resolve => setTimeout(resolve, 800));
        
        db.deleteUser(userId);
        setUsers(prev => prev.filter(u => u.id !== userId));
        onDelete(); // Update parent dashboard counts
        
        setMsg({ type: 'success', text: 'Account successfully removed from the ecosystem.' });
        setTimeout(() => setMsg(null), 3000);
      } catch (err) {
        setMsg({ type: 'error', text: 'Failed to delete account. Please try again.' });
      } finally {
        setDeletingId(null);
      }
    }
  };

  const formatDate = (isoString?: string) => {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const q = searchTerm.toLowerCase().trim();
      const matchesQuery = 
        !q ||
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.id.toLowerCase().includes(q) ||
        (u.teachingSubjects && u.teachingSubjects.some(s => s.toLowerCase().includes(q))) ||
        (u.teachingGrades && u.teachingGrades.some(g => g.toLowerCase().includes(q)));

      if (!matchesQuery) return false;

      if (statusFilter === 'COMPLETE' && !u.isProfileComplete) return false;
      if (statusFilter === 'PENDING' && u.isProfileComplete) return false;
      if (statusFilter.startsWith('GRADE_')) {
        const gradeStr = statusFilter.replace('GRADE_', 'Grade ');
        const studentGrade = u.gradeLevel || u.grade;
        if (role === UserRole.STUDENT && studentGrade !== gradeStr) return false;
        if (role === UserRole.TEACHER && (!u.teachingGrades || !u.teachingGrades.includes(gradeStr))) return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'name_asc') return a.name.localeCompare(b.name);
      if (sortBy === 'name_desc') return b.name.localeCompare(a.name);
      const dateA = db.getCredentialByUserId(a.id)?.createdAt || '';
      const dateB = db.getCredentialByUserId(b.id)?.createdAt || '';
      if (sortBy === 'date_newest') return dateB.localeCompare(dateA);
      if (sortBy === 'date_oldest') return dateA.localeCompare(dateB);
      return 0;
    });
  }, [users, searchTerm, statusFilter, sortBy, role]);

  return (
    <div className="glass-card rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2">
      <div className="p-6 border-b border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
            <h2 className="font-bold text-white flex items-center gap-2">
                {role === UserRole.STUDENT ? <GraduationCap className="w-5 h-5 text-primary-400" /> : role === UserRole.ADMIN ? <ShieldCheck className="w-5 h-5 text-rose-400" /> : <Briefcase className="w-5 h-5 text-emerald-400" />}
                {title}
            </h2>
            <p className="text-xs text-slate-400 mt-1">Direct management of registered {role.toLowerCase()} accounts with live search and filtering.</p>
        </div>
        <div className="flex items-center gap-3">
            {msg && (
              <span className={`text-[10px] font-bold px-2 py-1 rounded-md animate-in fade-in zoom-in-95 ${
                msg.type === 'success' ? 'bg-emerald-950/40 text-emerald-400 border border-emerald-500/20' : 'bg-rose-950/40 text-rose-400 border border-rose-500/20'
              }`}>
                {msg.text}
              </span>
            )}
            <span className="px-3 py-1 bg-primary-950/40 text-primary-400 text-xs font-bold rounded-full border border-primary-500/20">
                {filteredUsers.length} of {users.length} Total
            </span>
        </div>
      </div>

      {/* Searchbar & Search Filter Controls */}
      <div className="p-4 bg-white/5 border-b border-white/5 flex flex-col sm:flex-row gap-3 items-center justify-between">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder={`Search ${role.toLowerCase()}s by name, email, ID, subject...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-500 transition-all"
          />
          {searchTerm && (
            <button 
              onClick={() => setSearchTerm('')} 
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="ALL" className="bg-[#1a1635]">All Statuses</option>
            <option value="COMPLETE" className="bg-[#1a1635]">Profile Completed</option>
            <option value="PENDING" className="bg-[#1a1635]">Pending Setup</option>
            {role === UserRole.STUDENT && (
              <>
                <option value="GRADE_9" className="bg-[#1a1635]">Grade 9</option>
                <option value="GRADE_10" className="bg-[#1a1635]">Grade 10</option>
                <option value="GRADE_11" className="bg-[#1a1635]">Grade 11</option>
                <option value="GRADE_12" className="bg-[#1a1635]">Grade 12</option>
              </>
            )}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="px-3 py-2 bg-black/20 border border-white/10 rounded-xl text-xs text-slate-200 outline-none focus:border-primary-500 cursor-pointer"
          >
            <option value="name_asc" className="bg-[#1a1635]">Sort: Name (A-Z)</option>
            <option value="name_desc" className="bg-[#1a1635]">Sort: Name (Z-A)</option>
            <option value="date_newest" className="bg-[#1a1635]">Sort: Newest First</option>
            <option value="date_oldest" className="bg-[#1a1635]">Sort: Oldest First</option>
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead className="bg-white/5 text-slate-400 text-xs uppercase tracking-wider">
            <tr>
              <th className="px-6 py-4 font-bold">Identity</th>
              <th className="px-6 py-4 font-bold">Contact Email</th>
              <th className="px-6 py-4 font-bold">Enrollment Date</th>
              <th className="px-6 py-4 font-bold text-right">Control</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-slate-500 text-sm">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Search className="w-8 h-8 opacity-20 text-slate-400" />
                      <p className="font-semibold text-slate-400">No {role.toLowerCase()} records match your search criteria.</p>
                      {searchTerm && (
                        <button 
                          onClick={() => setSearchTerm('')} 
                          className="mt-1 px-3 py-1 bg-white/10 text-primary-300 text-xs rounded-lg hover:bg-white/20 transition-all font-bold"
                        >
                          Clear search query
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
            ) : (
                filteredUsers.map((u) => {
                    const creds = db.getCredentialByUserId(u.id);
                    const isDeleting = deletingId === u.id;
                    return (
                        <tr key={u.id} className="hover:bg-white/5 transition-colors">
                            <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                    <div className="relative">
                                      <img src={u.avatar} className="w-8 h-8 rounded-full border border-white/10" />
                                      <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-[#1a1635] rounded-full"></div>
                                    </div>
                                    <div>
                                      <span className="text-sm font-semibold text-slate-200 block">{u.name}</span>
                                      {(u.gradeLevel || u.grade) && <span className="text-[10px] text-primary-400 font-bold">{u.gradeLevel || u.grade}</span>}
                                    </div>
                                </div>
                            </td>
                            <td className="px-6 py-4 text-sm text-slate-400 font-medium">{u.email}</td>
                            <td className="px-6 py-4 text-sm text-slate-500 font-mono">{formatDate(creds?.createdAt)}</td>
                            <td className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-2">
                                  {role === UserRole.TEACHER && (
                                    <button
                                      onClick={() => setViewingUser(u)}
                                      className="p-2 rounded-lg transition-all text-primary-400 hover:text-primary-300 hover:bg-white/5"
                                      title="View Details"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>
                                    </button>
                                  )}
                                  <button 
                                    onClick={() => handleDelete(u.id)} 
                                    disabled={isDeleting || deletingId !== null}
                                    className={`p-2 rounded-lg transition-all ${
                                      isDeleting 
                                        ? 'bg-rose-950/40 text-rose-500 animate-pulse' 
                                        : 'text-rose-400 hover:text-rose-500 hover:bg-white/5'
                                    }`}
                                    title="Delete Account"
                                  >
                                      {isDeleting ? (
                                          <Loader2 className="w-4 h-4 animate-spin" />
                                      ) : (
                                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-trash2 lucide-trash-2 w-4 h-4" aria-hidden="true">
                                              <path d="M10 11v6"></path>
                                              <path d="M14 11v6"></path>
                                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path>
                                              <path d="M3 6h18"></path>
                                              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                                          </svg>
                                      )}
                                  </button>
                                </div>
                            </td>
                        </tr>
                    );
                })
            )}
          </tbody>
        </table>
      </div>
      
      {viewingUser && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
            <div className="glass-card rounded-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95">
                <div className="p-6 border-b border-white/5 flex justify-between items-start">
                    <div className="flex items-center gap-3">
                        <img src={viewingUser.avatar} className="w-12 h-12 rounded-full border border-white/10" />
                        <div>
                            <h2 className="font-bold text-white">{viewingUser.name}</h2>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary-950/40 text-primary-400 uppercase border border-primary-500/20">
                                {viewingUser.role}
                            </span>
                        </div>
                    </div>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase mb-1">Email Address</p>
                        <p className="text-sm text-slate-200">{viewingUser.email}</p>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase mb-1">Account ID</p>
                        <p className="text-xs font-mono text-slate-400">{viewingUser.id}</p>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-slate-500 uppercase mb-1">Joined Date</p>
                        <p className="text-sm text-slate-200">{formatDate(db.getCredentialByUserId(viewingUser.id)?.createdAt)}</p>
                    </div>
                    {viewingUser.role === UserRole.TEACHER && viewingUser.isProfileComplete && (
                      <div className="pt-4 border-t border-white/5 space-y-3">
                        <div>
                          <p className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Teaching Grades</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {viewingUser.teachingGrades?.map(g => (
                              <span key={g} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300">{g}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Assigned Classes</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {viewingUser.teachingClasses?.map(c => (
                              <span key={c} className="px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-[10px] text-slate-300">Class {c}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-primary-400 uppercase tracking-widest">Subject Specialization</p>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {viewingUser.teachingSubjects?.map(s => (
                              <span key={s} className="px-2 py-0.5 rounded-md bg-primary-600/20 border border-primary-500/20 text-[10px] text-primary-300">{s}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                </div>
                <div className="p-4 bg-white/5 flex justify-end">
                    <button onClick={() => setViewingUser(null)} className="px-6 py-2 bg-white/5 border border-white/10 text-slate-200 rounded-xl text-sm font-bold shadow-sm hover:bg-white/10 transition-colors">
                        Close
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};

const VaultApprovals: React.FC = () => {
    const [pendingDocs, setPendingDocs] = useState<VaultDocument[]>([]);
    
    const loadPending = async () => {
        try {
            const res = await getVaultDocuments();
            if (res && res.success && Array.isArray(res.documents)) {
                setPendingDocs(res.documents.filter(d => d.status === DocumentStatus.PENDING));
                return;
            }
            setPendingDocs(db.getPendingVaultDocuments());
        } catch {
            setPendingDocs(db.getPendingVaultDocuments());
        }
    };

    useEffect(() => {
        loadPending();
    }, []);

    const handleAction = async (docId: string, status: DocumentStatus) => {
        try {
            await apiUpdateVaultStatus(docId, status);
        } catch (err) {
            console.error('Failed to update vault status via API:', err);
        }
        db.updateVaultDocumentStatus(docId, status);
        setPendingDocs(prev => prev.filter(d => d.id !== docId));
    };

    const handleDownload = (doc: VaultDocument) => {
        if (doc.fileData) {
            const link = document.createElement('a');
            link.href = doc.fileData;
            link.download = doc.fileName || 'document';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    return (
        <div className="glass-card rounded-3xl overflow-hidden animate-in fade-in">
            <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <div>
                    <h2 className="font-bold text-white uppercase tracking-tight">Vault Approvals Queue</h2>
                    <p className="text-xs text-slate-400">Secure verification of faculty submissions.</p>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></span>
                    <span className="px-3 py-1 bg-amber-950/40 text-amber-500 text-[10px] font-bold rounded-full border border-amber-500/20 uppercase tracking-widest">
                        {pendingDocs.length} Pending Verification
                    </span>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-white/5 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                        <tr>
                            <th className="px-6 py-4">Document / Identity</th>
                            <th className="px-6 py-4">Faculty Member</th>
                            <th className="px-6 py-4">Classification</th>
                            <th className="px-6 py-4">Evidence Hash</th>
                            <th className="px-6 py-4 text-right">Approval</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                        {pendingDocs.map((doc) => (
                            <tr key={doc.id} className="hover:bg-white/5 group transition-colors">
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                        <div className="p-2 bg-white/5 rounded-lg border border-white/10 group-hover:border-primary-500/30 transition-all cursor-pointer" onClick={() => handleDownload(doc)}>
                                            <FileText className="w-4 h-4 text-primary-400" />
                                        </div>
                                        <div>
                                            <p className="font-bold text-slate-200 group-hover:text-primary-300 transition-colors">{doc.title}</p>
                                            <p className="text-[10px] text-slate-500 font-mono">{new Date(doc.createdAt).toLocaleString()}</p>
                                        </div>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <div className="flex items-center gap-2">
                                        <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${doc.teacherName}`} className="w-5 h-5 rounded-full border border-white/10" alt="" />
                                        <span className="text-slate-400 font-medium">{doc.teacherName}</span>
                                    </div>
                                </td>
                                <td className="px-6 py-4">
                                    <span className="text-[9px] font-bold px-2 py-0.5 rounded bg-primary-950/40 text-primary-400 border border-primary-500/20 uppercase">
                                        {doc.type}
                                    </span>
                                </td>
                                <td className="px-6 py-4">
                                    <code className="text-[10px] text-slate-600 bg-black/20 px-1.5 py-0.5 rounded border border-white/5 font-mono">
                                        {doc.hash?.substring(0, 8)}...
                                    </code>
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                        <button 
                                            onClick={() => handleDownload(doc)}
                                            className="px-3 py-1.5 bg-primary-500/10 text-primary-400 hover:bg-primary-500 text-[10px] font-bold rounded-lg transition-all border border-primary-500/20 hover:text-white uppercase tracking-widest flex items-center gap-1.5"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
                                            Review
                                        </button>
                                        <button 
                                            onClick={() => handleAction(doc.id, DocumentStatus.APPROVED)}
                                            className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 text-[10px] font-bold rounded-lg transition-all border border-emerald-500/20 hover:text-white uppercase tracking-widest"
                                        >
                                            Approve
                                        </button>
                                        <button 
                                            onClick={() => handleAction(doc.id, DocumentStatus.REJECTED)}
                                            className="px-3 py-1.5 bg-rose-500/10 text-rose-500 hover:bg-rose-500 text-[10px] font-bold rounded-lg transition-all border border-rose-500/20 hover:text-white uppercase tracking-widest"
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {pendingDocs.length === 0 && (
                            <tr>
                                <td colSpan={5} className="px-6 py-16 text-center text-slate-500 italic">
                                    <div className="flex flex-col items-center gap-2">
                                        <ShieldCheck className="w-12 h-12 opacity-10 mb-2" />
                                        <p>Approval queue is currently clear.</p>
                                        <p className="text-[10px] uppercase tracking-widest not-italic">All faculty submissions verified on-chain.</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const CurriculumManager: React.FC<{ user: User; filterCategory?: ResourceCategory; onUpdate?: () => void }> = ({ user, filterCategory, onUpdate }) => {
    const [materials, setMaterials] = useState<CurriculumResource[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [viewingMaterial, setViewingMaterial] = useState<CurriculumResource | null>(null);
    
    // Form state
    const [title, setTitle] = useState('');
    const [subject, setSubject] = useState('Mathematics');
    const [gradeLevel, setGradeLevel] = useState('Grade 10');
    const [category, setCategory] = useState<ResourceCategory>(filterCategory || ResourceCategory.DOCUMENT);
    const [description, setDescription] = useState('');
    const [fileName, setFileName] = useState('');
    const [fileType, setFileType] = useState('');
    const [fileData, setFileData] = useState('');

    const loadMaterials = async () => {
        try {
            const res = await getCurriculum();
            if (res && res.success && Array.isArray(res.curriculum)) {
                if (filterCategory) {
                    setMaterials(res.curriculum.filter(m => m.category === filterCategory));
                } else {
                    setMaterials(res.curriculum);
                }
                return;
            }
            const all = db.getAllCurriculum();
            setMaterials(filterCategory ? all.filter(m => m.category === filterCategory) : all);
        } catch {
            const all = db.getAllCurriculum();
            setMaterials(filterCategory ? all.filter(m => m.category === filterCategory) : all);
        }
    };

    useEffect(() => {
        loadMaterials();
    }, [filterCategory]);

    useEffect(() => {
        if (filterCategory) {
            setCategory(filterCategory);
        }
    }, [filterCategory]);

    useEffect(() => {
        if (category === ResourceCategory.ANNOUNCEMENT) {
            setFileName('');
            setFileType('');
            setFileData('');
        }
    }, [category]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            const file = e.target.files[0];
            setFileName(file.name);
            setFileType(file.type || file.name.split('.').pop() || 'unknown');
            
            const reader = new FileReader();
            reader.onload = (event) => {
                setFileData(event.target?.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

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

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const displayTitle = title || (category === ResourceCategory.ANNOUNCEMENT ? 'Official Announcement' : 'Academic Assignment');
            const displaySubject = category === ResourceCategory.ANNOUNCEMENT ? 'Campus Wide' : subject;

            let createdItem: CurriculumResource | null = null;
            try {
                const apiRes = await apiAddCurriculum({
                    title: displayTitle,
                    subject: displaySubject,
                    gradeLevel,
                    description,
                    category,
                    fileName: fileName || undefined,
                    fileType: fileType || undefined,
                    fileData: fileData || undefined
                });
                if (apiRes && apiRes.resource) {
                    createdItem = apiRes.resource;
                }
            } catch (apiErr) {
                console.error('Failed to add curriculum via API:', apiErr);
            }

            const newItem = db.addCurriculum({ 
                id: createdItem?.id,
                title: displayTitle, 
                subject: displaySubject, 
                gradeLevel, 
                description,
                category,
                authorRole: UserRole.ADMIN,
                uploadedById: user.id,
                uploadedByName: user.name,
                fileName: fileName || undefined,
                fileType: fileType || undefined,
                fileData: fileData || undefined
            });
            setMaterials([createdItem || newItem, ...materials]);
            setIsAdding(false);
            setTitle(''); setDescription(''); setFileName(''); setFileType(''); setFileData('');
            if (onUpdate) onUpdate();
        } catch (err) {
            console.error('Failed to add curriculum:', err);
        }
    };

    const handleDelete = async (id: string) => {
        if (window.confirm('Are you sure you want to delete this official curriculum material?')) {
            try {
                await apiDeleteCurriculum(id);
            } catch (err) {
                console.error('Failed to delete curriculum via API:', err);
            }
            db.deleteCurriculum(id);
            setMaterials(materials.filter(m => m.id !== id));
            if (onUpdate) onUpdate();
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center text-white">
                <div>
                    <h2 className="text-xl font-bold">{filterCategory === ResourceCategory.ANNOUNCEMENT ? 'Official Announcements' : 'Campus Assignments'}</h2>
                    <p className="text-slate-400 text-sm">
                        {filterCategory === ResourceCategory.ANNOUNCEMENT 
                            ? 'Standardized notices published by the school administration.' 
                            : 'Official academic tasks and document resources.'}
                    </p>
                </div>
                <button 
                    onClick={() => setIsAdding(!isAdding)}
                    className={`px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 transition-all active:scale-95 border ${
                        isAdding ? 'bg-white/5 border-white/10 text-slate-300' : 'bg-primary-600 border-primary-600 text-white shadow-lg shadow-primary-900/40 hover:bg-primary-700'
                    }`}
                >
                    {isAdding ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                    {isAdding ? 'Cancel' : (filterCategory === ResourceCategory.ANNOUNCEMENT ? 'New Announcement' : 'New Assignment')}
                </button>
            </div>

            {isAdding && (
                <div className="glass-card p-6 rounded-2xl animate-in slide-in-from-top-2 border border-primary-500/10">
                    <form onSubmit={handleAdd} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {!filterCategory && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Type</label>
                                    <select value={category} onChange={e=>setCategory(e.target.value as ResourceCategory)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-white">
                                        <option value={ResourceCategory.DOCUMENT} className="bg-[#1a1635]">Document (Assignment)</option>
                                        <option value={ResourceCategory.ANNOUNCEMENT} className="bg-[#1a1635]">Announcement</option>
                                    </select>
                                </div>
                            )}
                            <div className={filterCategory ? "col-span-full space-y-1" : "space-y-1"}>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Grade Level</label>
                                <select value={gradeLevel} onChange={e=>setGradeLevel(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-white">
                                    <option className="bg-[#1a1635]">Grade 9</option><option className="bg-[#1a1635]">Grade 10</option><option className="bg-[#1a1635]">Grade 11</option><option className="bg-[#1a1635]">Grade 12</option><option className="bg-[#1a1635]">All Grades</option>
                                </select>
                            </div>
                            {category !== ResourceCategory.ANNOUNCEMENT && (
                                <div className="col-span-full space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Subject</label>
                                    <select value={subject} onChange={e=>setSubject(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-white">
                                        <option className="bg-[#1a1635]">Mathematics</option>
                                        <option className="bg-[#1a1635]">Science Physics</option>
                                        <option className="bg-[#1a1635]">Biology</option>
                                        <option className="bg-[#1a1635]">Chemistry</option>
                                        <option className="bg-[#1a1635]">Physical Education</option>
                                        <option className="bg-[#1a1635]">Art</option>
                                        <option className="bg-[#1a1635]">Food and Nutrition</option>
                                        <option className="bg-[#1a1635]">Additional Mathematics</option>
                                        <option className="bg-[#1a1635]">Computer Studies</option>
                                    </select>
                                </div>
                            )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className={category === ResourceCategory.ANNOUNCEMENT ? "col-span-full space-y-1" : "space-y-1"}>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                                    {category === ResourceCategory.ANNOUNCEMENT ? "Announcement Content (Typed Sentences)" : "Description & Objectives"}
                                </label>
                                <textarea required value={description} onChange={e=>setDescription(e.target.value)} rows={category === ResourceCategory.ANNOUNCEMENT ? 5 : 3} placeholder={category === ResourceCategory.ANNOUNCEMENT ? "Type your announcement posts here..." : "Provide details for students and staff..."} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 resize-none text-white placeholder:text-slate-600" />
                            </div>
                            {category !== ResourceCategory.ANNOUNCEMENT && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Attachment (Syllabus/Guides)</label>
                                    <input 
                                        type="file" 
                                        onChange={handleFileChange}
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-slate-400 file:mr-4 file:py-1.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-primary-950/40 file:text-primary-400 file:border file:border-primary-500/20 hover:file:bg-primary-950/60 cursor-pointer"
                                    />
                                    <p className="text-[10px] text-slate-500 mt-1 pl-1 italic">Authorized formats: PDF, Word, Excel, Media</p>
                                </div>
                            )}
                        </div>
                        <button className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-900/40">
                           <ShieldCheck className="w-4 h-4" /> Publish Official Content
                        </button>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {materials.map(item => (
                    <div key={item.id} className={`glass-card p-6 rounded-2xl transition-all group relative hover:border-primary-500/30 ${item.authorRole === UserRole.ADMIN ? 'border-primary-500/20' : ''}`}>
                        <button 
                            onClick={() => handleDelete(item.id)} 
                            className="absolute top-4 right-4 p-1.5 text-slate-600 hover:text-rose-500 transition-colors opacity-0 group-hover:opacity-100" 
                            title="Remove Material"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="w-10 h-10 bg-primary-950/40 border border-primary-500/20 rounded-xl flex items-center justify-center text-primary-400 mb-4 shadow-lg shadow-primary-950/20">
                            {item.category === ResourceCategory.ANNOUNCEMENT ? <Bell className="w-5 h-5" /> : (item.authorRole === UserRole.ADMIN ? <ShieldCheck className="w-5 h-5" /> : <FileText className="w-5 h-5" />)}
                        </div>
                        <div className="flex flex-col gap-1 mb-1">
                            {item.category === ResourceCategory.ANNOUNCEMENT && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[8px] font-bold uppercase w-fit border border-amber-500/30">Announcement</span>}
                            <div className="flex items-center gap-2">
                                <h3 className="font-bold text-white group-hover:text-primary-300 transition-colors uppercase text-xs tracking-tight">{item.title}</h3>
                                {item.authorRole === UserRole.ADMIN && <span className="text-[8px] bg-primary-600/20 text-primary-400 border border-primary-500/30 px-1 rounded uppercase font-bold">Admin</span>}
                            </div>
                        </div>
                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">{item.subject} • {item.gradeLevel}</p>
                        <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed mb-3">{item.description}</p>
                        {item.fileName && (
                          <div className="flex items-center gap-2 text-[10px] font-bold bg-white/5 text-slate-300 px-3 py-1.5 rounded-lg border border-white/10 max-w-fit">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-paperclip text-primary-400"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
                            <span className="truncate max-w-[120px]">{item.fileName}</span>
                          </div>
                        )}
                        <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-[10px] font-medium text-slate-500 font-mono">
                            <div className="flex items-center gap-2">
                                <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${item.uploadedByName}`} className="w-4 h-4 rounded-full border border-white/10" alt="" />
                                <span className="text-primary-400 font-bold">{item.uploadedByName || 'System Admin'}</span>
                            </div>
                            <span onClick={() => setViewingMaterial(item)} className="flex items-center gap-1 text-primary-400 cursor-pointer hover:text-primary-300 hover:underline font-bold"><BookOpen className="w-3 h-3" /> View Details</span>
                        </div>
                    </div>
                ))}
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
                                    <p className="text-sm font-bold text-white">{viewingMaterial.uploadedByName || 'System Administrator'}</p>
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
                                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-paperclip text-slate-500 w-5 h-5"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
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


type MetricType = 'STUDENTS' | 'TEACHERS' | 'ADMINS' | 'DOCUMENTS';

interface MetricTrackerModalProps {
  metric: MetricType | null;
  onClose: () => void;
  onNavigateTab: (tab: string) => void;
  onDeleteUser: () => void;
}

const MetricTrackerModal: React.FC<MetricTrackerModalProps> = ({ metric, onClose, onNavigateTab, onDeleteUser }) => {
  if (!metric) return null;

  const getMetricConfig = () => {
    switch (metric) {
      case 'STUDENTS':
        return {
          title: 'Student Directory & Tracking',
          subtitle: 'Real-time searchable student records with grade and profile filters.',
          icon: GraduationCap,
          color: 'text-primary-400',
          tabName: 'students',
        };
      case 'TEACHERS':
        return {
          title: 'Faculty & Teacher Management',
          subtitle: 'Search faculty staff, class assignments, and subject specializations.',
          icon: Briefcase,
          color: 'text-emerald-400',
          tabName: 'staff',
        };
      case 'ADMINS':
        return {
          title: 'Administrator Directory & Privileges',
          subtitle: 'Manage administrative users and verify system level controls.',
          icon: ShieldCheck,
          color: 'text-rose-400',
          tabName: 'overview',
        };
      case 'DOCUMENTS':
        return {
          title: 'Documents & Vault Repository',
          subtitle: 'Search and filter all curriculum, assignments, and vault submissions.',
          icon: FileText,
          color: 'text-primary-400',
          tabName: 'vault',
        };
    }
  };

  const config = getMetricConfig();
  const Icon = config.icon;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="glass-card rounded-3xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 border border-white/10 shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-white/10 flex items-center justify-between bg-black/20">
          <div className="flex items-center gap-3">
            <div className={`p-3 rounded-2xl bg-white/5 border border-white/10 ${config.color}`}>
              <Icon className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                {config.title}
              </h2>
              <p className="text-xs text-slate-400">{config.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onClose();
                onNavigateTab(config.tabName);
              }}
              className="px-3 py-1.5 bg-primary-600/20 hover:bg-primary-600 border border-primary-500/30 text-primary-300 hover:text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
            >
              Open Tab <BookOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {metric === 'STUDENTS' && <UserManager role={UserRole.STUDENT} title="Student Directory" onDelete={onDeleteUser} />}
          {metric === 'TEACHERS' && <UserManager role={UserRole.TEACHER} title="Faculty Members" onDelete={onDeleteUser} />}
          {metric === 'ADMINS' && <UserManager role={UserRole.ADMIN} title="System Administrators" onDelete={onDeleteUser} />}
          {metric === 'DOCUMENTS' && <DocumentTracker />}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-black/20 flex justify-between items-center text-xs text-slate-400">
          <span className="flex items-center gap-2 font-mono text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            E-SYLAB Live Tracking Engine • Database & Solana Ledger Synchronized
          </span>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl transition-colors"
          >
            Close Tracker
          </button>
        </div>
      </div>
    </div>
  );
};


export const AdminDashboard: React.FC<AdminDashboardProps> = ({ user, onUpdateUser, activeTab, setActiveTab, onLogout }) => {
  const [totalStudents, setTotalStudents] = useState(0);
  const [totalTeachers, setTotalTeachers] = useState(0);
  const [totalAdmins, setTotalAdmins] = useState(0);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [totalVaultDocs, setTotalVaultDocs] = useState(0);
  const [selectedMetricTracker, setSelectedMetricTracker] = useState<MetricType | null>(null);
  const [isCreatingStaff, setIsCreatingStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffEmail, setStaffEmail] = useState('');
  const [staffPassword, setStaffPassword] = useState('');
  const [staffRole, setStaffRole] = useState<UserRole>(UserRole.TEACHER);
  const [staffMsg, setStaffMsg] = useState<{type: 'success'|'error', text: string} | null>(null);

  const refreshCounts = async () => {
    setTotalStudents(db.getTotalUsersByRole(UserRole.STUDENT));
    setTotalTeachers(db.getTotalUsersByRole(UserRole.TEACHER));
    setTotalAdmins(db.getTotalUsersByRole(UserRole.ADMIN));
    try {
      const [currRes, vaultRes] = await Promise.all([
        getCurriculum().catch(() => null),
        getVaultDocuments().catch(() => null),
      ]);
      if (currRes && currRes.success && Array.isArray(currRes.curriculum)) {
        setTotalDocuments(currRes.curriculum.length);
      } else {
        setTotalDocuments(db.getAllCurriculum().length);
      }
      if (vaultRes && vaultRes.success && Array.isArray(vaultRes.documents)) {
        setTotalVaultDocs(vaultRes.documents.length);
      } else {
        setTotalVaultDocs(db.getVaultDocuments().length);
      }
    } catch {
      setTotalDocuments(db.getAllCurriculum().length);
      setTotalVaultDocs(db.getVaultDocuments().length);
    }
  };

  useEffect(() => {
    // Refresh to ensure counts are current when switching tabs
    refreshCounts();
  }, [activeTab]);

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreatingStaff(true);
    setStaffMsg(null);
    try {
        await createUserByAdmin({
            name: staffName, email: staffEmail, role: staffRole,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staffName)}`
        }, staffPassword);

        // Sync with local db if available for fallback/counts
        try {
          await db.registerUser({
              name: staffName, email: staffEmail, role: staffRole,
              avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(staffName)}`
          }, staffPassword);
        } catch {
          // Ignore if local registration fails or already exists
        }

        setStaffMsg({type: 'success', text: `${staffRole === UserRole.ADMIN ? 'Administrator' : 'Faculty'} account created successfully.`});
        setStaffName(''); setStaffEmail(''); setStaffPassword('');
        refreshCounts();
    } catch (err: any) { 
        setStaffMsg({type: 'error', text: err.message}); 
    } finally { 
        setIsCreatingStaff(false); 
    }
  };

   const activeUsers = useMemo(() => {
     const students = db.getUsersByRole(UserRole.STUDENT);
     const teachers = db.getUsersByRole(UserRole.TEACHER);
     const admins = db.getUsersByRole(UserRole.ADMIN);
     return [...admins, ...teachers, ...students].slice(0, 10);
   }, [totalStudents, totalTeachers, totalAdmins]);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Control Panel</h1>
          <p className="text-slate-400">Secure real-time monitoring of the E-SYLAB ecosystem.</p>
        </div>
        <div className="flex items-center gap-4">
           <div className="bg-white/5 backdrop-blur-md rounded-full px-4 py-2 border border-white/10 flex items-center gap-3">
              <div className="flex items-center gap-2 mr-2">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Active Now</span>
              </div>
              <div className="flex items-center gap-2 overflow-hidden max-w-[120px] relative">
                <motion.div 
                  className="flex -space-x-2"
                  animate={{ x: activeUsers.length > 3 ? [0, -100] : 0 }}
                  transition={{ 
                    duration: 15,
                    repeat: Infinity,
                    ease: "linear"
                  }}
                >
                  {[...activeUsers, ...(activeUsers.length > 3 ? activeUsers : [])].map((u, idx) => (
                    <div 
                      key={`${u.id}-${idx}`} 
                      className="w-8 h-8 rounded-full border-2 border-[#0a0a1a] bg-white/5 overflow-hidden shrink-0"
                    >
                      <img src={u.avatar} className="w-full h-full object-cover" alt={u.name} title={u.name} />
                    </div>
                  ))}
                </motion.div>
                {activeUsers.length > 3 && (
                  <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-[#0a0a1a] to-transparent z-10 pointer-events-none"></div>
                )}
              </div>
              
              <div className="w-[1px] h-4 bg-white/10 mx-1"></div>
              
              <div className="flex items-center">
                <div className="overflow-hidden w-32 relative h-8">
                  <motion.div 
                    className="flex gap-3 whitespace-nowrap items-center"
                    animate={{ x: [0, -200] }}
                    transition={{ 
                      duration: 20,
                      repeat: Infinity,
                      ease: "linear"
                    }}
                  >
                    {activeUsers.map((u) => (
                      <span key={u.id} className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                        <span className="w-1 h-1 bg-primary-500 rounded-full"></span>
                        {u.name}
                      </span>
                    ))}
                    {/* Duplicate for seamless scroll */}
                    {activeUsers.map((u) => (
                      <span key={`${u.id}-dup`} className="text-[10px] font-medium text-slate-400 flex items-center gap-1">
                        <span className="w-1 h-1 bg-primary-500 rounded-full"></span>
                        {u.name}
                      </span>
                    ))}
                  </motion.div>
                </div>
              </div>
           </div>
        </div>
      </div>
      
      {activeTab === 'overview' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { id: 'STUDENTS', label: 'Students', value: totalStudents, change: 'Live Growth', icon: GraduationCap, color: 'text-primary-400', bg: 'bg-primary-950/40' },
              { id: 'TEACHERS', label: 'Teachers', value: totalTeachers, change: 'Staffing', icon: Briefcase, color: 'text-emerald-400', bg: 'bg-emerald-950/40' }, 
              { id: 'ADMINS', label: 'Admins', value: `${totalAdmins}/2`, change: 'Limit Control', icon: ShieldCheck, color: 'text-rose-400', bg: 'bg-rose-950/40' },
              { id: 'DOCUMENTS', label: 'Documents', value: totalVaultDocs, change: 'Live Repo', icon: FileText, color: 'text-primary-400', bg: 'bg-primary-950/40' },
            ].map((kpi, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setSelectedMetricTracker(kpi.id as MetricType)}
                className={`glass-card p-6 rounded-2xl transition-all duration-200 text-left relative overflow-hidden group cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary-500/50 hover:border-primary-500/50 hover:bg-white/[0.08] hover:scale-[1.02] active:scale-[0.98] ${
                  selectedMetricTracker === kpi.id ? 'border-primary-500 ring-2 ring-primary-500/30 bg-primary-950/30' : ''
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div className={`p-2 rounded-lg ${kpi.bg} ${kpi.color} group-hover:scale-110 transition-transform border border-white/5`}><kpi.icon className="w-5 h-5" /></div>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${kpi.change === 'Optimal' || kpi.change === 'Stable' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20' : 'bg-primary-950/40 text-primary-400 border-primary-500/20'}`}>
                    {kpi.change}
                  </span>
                </div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{kpi.label}</p>
                <div className="flex items-baseline justify-between mt-1">
                  <p className="text-2xl font-bold text-white">
                      {typeof kpi.value === 'number' ? <AnimatedCounter value={kpi.value} /> : kpi.value}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <LiveNetworkActivity />
            <div className="glass-card p-6 rounded-2xl relative overflow-hidden">
              <h2 className="font-bold text-white mb-2 flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary-400" /> Onboard Personnel</h2>
              <p className="text-xs text-slate-400 mb-6 leading-relaxed">System-provisioned accounts for Faculty and Administrators. Account limits are strictly enforced.</p>
              
              {staffMsg && (
                <div className={`text-xs p-3 rounded-xl mb-4 animate-in slide-in-from-top-2 border ${
                    staffMsg.type === 'success' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20' : 'bg-rose-950/40 text-rose-400 border-rose-500/20'
                }`}>
                    {staffMsg.text}
                </div>
              )}
              
              <form onSubmit={handleCreateStaff} className="space-y-4 relative z-10">
                <div className="grid grid-cols-2 gap-3 mb-2">
                  <button
                    type="button"
                    onClick={() => setStaffRole(UserRole.TEACHER)}
                    className={`py-2 px-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${
                      staffRole === UserRole.TEACHER 
                        ? 'bg-primary-600 border-primary-600 text-white shadow-md shadow-primary-900/40' 
                        : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                    }`}
                  >
                    Faculty
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffRole(UserRole.ADMIN)}
                    disabled={totalAdmins >= 2}
                    className={`py-2 px-3 rounded-xl text-[10px] font-bold uppercase tracking-wider border transition-all ${
                      staffRole === UserRole.ADMIN 
                        ? 'bg-rose-600 border-rose-600 text-white shadow-md shadow-rose-900/40' 
                        : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10 disabled:opacity-40'
                    }`}
                  >
                    Admin {totalAdmins >= 2 && '(Full)'}
                  </button>
                </div>

                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Full Name</label>
                    <input required type="text" placeholder="Dr. John Smith" value={staffName} onChange={e=>setStaffName(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 transition-all text-white placeholder:text-slate-600" />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Email Address</label>
                    <input required type="email" placeholder="john.smith@esylab.edu" value={staffEmail} onChange={e=>setStaffEmail(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 transition-all text-white placeholder:text-slate-600" />
                </div>
                <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Temporary Password</label>
                    <input required type="password" placeholder="••••••••" value={staffPassword} onChange={e=>setStaffPassword(e.target.value)} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 transition-all text-white placeholder:text-slate-600" />
                </div>
                <button 
                  disabled={isCreatingStaff || (staffRole === UserRole.ADMIN && totalAdmins >= 2)} 
                  className={`w-full py-3 text-white rounded-xl font-bold disabled:opacity-50 transition-all active:scale-95 flex items-center justify-center gap-2 shadow-lg ${
                    staffRole === UserRole.ADMIN ? 'bg-rose-600 shadow-rose-950/40 hover:bg-rose-700' : 'bg-primary-600 shadow-primary-950/40 hover:bg-primary-700'
                  }`}
                >
                   {isCreatingStaff ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                   Provision Account
                </button>
              </form>
              <Users className="absolute -bottom-10 -right-10 w-32 h-32 text-white/5 pointer-events-none" />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'announcements' && (
        <div className="space-y-8">
          <NotificationSendForm currentUser={user} />
          <CurriculumManager user={user} filterCategory={ResourceCategory.ANNOUNCEMENT} onUpdate={refreshCounts} />
        </div>
      )}
      {activeTab === 'timetable' && <TimetableView currentUser={user} />}
      {activeTab === 'assignments' && <CurriculumManager user={user} filterCategory={ResourceCategory.DOCUMENT} onUpdate={refreshCounts} />}
      {activeTab === 'assessments' && <AssessmentView currentUser={user} />}
      {activeTab === 'staff' && (
        <div className="space-y-8">
          <StaffPerformanceDashboard />
          <UserManager role={UserRole.TEACHER} title="Faculty Account Management" onDelete={refreshCounts} />
        </div>
      )}
      {activeTab === 'students' && <UserManager role={UserRole.STUDENT} title="Student Directory" onDelete={refreshCounts} />}
      {(activeTab === 'profile' || activeTab === 'settings') && <SettingsView user={user} onUpdateUser={onUpdateUser} onLogout={onLogout} />}
      {activeTab === 'vault' && <VaultApprovals />}

      <MetricTrackerModal 
        metric={selectedMetricTracker} 
        onClose={() => setSelectedMetricTracker(null)} 
        onNavigateTab={setActiveTab} 
        onDeleteUser={refreshCounts} 
      />
    </div>
  );
};