import React, { useState, useEffect } from 'react';
import { 
  Plus, FileCheck,
  Users, Calendar,
  Shield, Save, Pencil,
  CheckCircle, XCircle, Loader2, GraduationCap, FileText, BookOpen, X, Trash2, Bell
} from 'lucide-react';
import { blockchainService } from '../services/blockchain';
import { User, UserRole, CurriculumResource, ResourceCategory, VaultDocument, DocumentStatus } from '../types';
import { db } from '../services/database';
import { ProfileSection } from '../components/ProfileSection';
import { BlockchainAttendance } from '../components/BlockchainAttendance';
import { TimetableView } from '../components/TimetableView';
import { AssessmentView } from '../components/AssessmentView';
import { NotificationSendForm } from '../components/NotificationSendForm';

interface TeacherDashboardProps {
  user: User;
  onUpdateUser: (user: User) => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const DetailedStudentList: React.FC = () => {
  const [students, setStudents] = useState<User[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { setStudents(db.getUsersByRole(UserRole.STUDENT)); }, []);

  const handleDeleteStudent = async (studentId: string) => {
      if (window.confirm("Are you sure you want to permanently delete this student's account? This action cannot be undone.")) {
          setDeletingId(studentId);
          try {
              // Simulate verification delay
              await new Promise(resolve => setTimeout(resolve, 600));
              db.deleteUser(studentId);
              setStudents(prev => prev.filter(s => s.id !== studentId));
          } finally {
              setDeletingId(null);
          }
      }
  };

  return (
    <div className="glass-card rounded-3xl overflow-hidden animate-in fade-in">
      <div className="p-6 border-b border-white/5 flex justify-between items-center">
        <div><h2 className="font-bold text-white">Assigned Students</h2><p className="text-xs text-slate-400">Student profiles for classroom management.</p></div>
        <span className="px-3 py-1 bg-primary-950/40 text-primary-400 text-xs font-bold rounded-full border border-primary-500/20">{students.length} Records</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
            <tr><th className="px-6 py-4">Student</th><th className="px-6 py-4">Academic</th><th className="px-6 py-4">Location</th><th className="px-6 py-4 text-right">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {students.map((s) => (
                <tr key={s.id} className="hover:bg-white/5 group transition-colors">
                    <td className="px-6 py-4"><div className="flex items-center gap-3"><img src={s.avatar} className="w-8 h-8 rounded-full border border-white/10" /><div><p className="font-bold text-slate-200">{s.name}</p><p className="text-[10px] text-slate-500">{s.email}</p></div></div></td>
                    <td className="px-6 py-4 font-medium text-slate-400">{s.grade || 'N/A'}</td>
                    <td className="px-6 py-4 text-slate-500 truncate max-w-[150px]">{s.residentialAddress || 'Unset'}</td>
                    <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                            <button className="text-primary-400 font-bold hover:text-primary-300 transition-colors text-xs">View Profile</button>
                            <button 
                                onClick={() => handleDeleteStudent(s.id)}
                                disabled={deletingId !== null}
                                className={`p-2 rounded-lg transition-all ${deletingId === s.id ? 'bg-rose-950/40 text-rose-500 animate-pulse' : 'text-rose-400 hover:text-rose-500 hover:bg-white/5 opacity-0 group-hover:opacity-100'}`}
                                title="Delete Student Account"
                            >
                                {deletingId === s.id ? (
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
            ))}
             {students.length === 0 && (
                <tr><td colSpan={4} className="px-6 py-12 text-center text-slate-500 italic">No students registered in the directory.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const CurriculumManager: React.FC<{ user: User; filterCategory?: ResourceCategory }> = ({ user, filterCategory }) => {
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

    useEffect(() => {
        const all = db.getAllCurriculum();
        if (filterCategory) {
            setMaterials(all.filter(m => m.category === filterCategory));
        } else {
            setMaterials(all);
        }
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

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const displayTitle = title || (category === ResourceCategory.ANNOUNCEMENT ? 'Faculty Announcement' : 'Academic Task');
            const displaySubject = category === ResourceCategory.ANNOUNCEMENT ? 'General' : subject;

            const newItem = db.addCurriculum({ 
                title: displayTitle, 
                subject: displaySubject, 
                gradeLevel, 
                description,
                category,
                authorRole: UserRole.TEACHER,
                uploadedById: user.id,
                uploadedByName: user.name,
                fileName: fileName || undefined,
                fileType: fileType || undefined,
                fileData: fileData || undefined
            });
            setMaterials([newItem, ...materials]);
            setIsAdding(false);
            setTitle(''); setDescription(''); setFileName(''); setFileType(''); setFileData('');
        } catch (err) {
            console.error('Failed to add curriculum:', err);
        }
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Are you sure you want to delete this educational material? This will remove it for all students and teachers.')) {
            db.deleteCurriculum(id);
            setMaterials(materials.filter(m => m.id !== id));
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-white">{filterCategory === ResourceCategory.ANNOUNCEMENT ? 'Announcements' : 'Assignments'}</h2>
                    <p className="text-slate-400 text-sm">
                        {filterCategory === ResourceCategory.ANNOUNCEMENT 
                            ? 'Share important updates with your students.' 
                            : 'Upload and manage educational documents and tasks.'}
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
                <div className="glass-card p-6 rounded-2xl animate-in slide-in-from-top-2">
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
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Target Grade</label>
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
                                    {category === ResourceCategory.ANNOUNCEMENT ? "Announcement Content (Typed Sentences)" : "Material Details"}
                                </label>
                                <textarea required value={description} onChange={e=>setDescription(e.target.value)} rows={category === ResourceCategory.ANNOUNCEMENT ? 5 : 3} placeholder={category === ResourceCategory.ANNOUNCEMENT ? "Type your announcement posts here..." : "Provide a summary or resource links..."} className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 resize-none text-white placeholder:text-slate-600" />
                            </div>
                            {category !== ResourceCategory.ANNOUNCEMENT && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">Upload File (Optional)</label>
                                    <input 
                                        type="file" 
                                        onChange={handleFileChange}
                                        accept=".pdf,.doc,.docx,.xls,.xlsx,.mdb,.accdb,.mp3,.mp4,.jpg,.jpeg"
                                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-slate-400 file:mr-4 file:py-1.5 file:px-4 file:rounded-xl file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-primary-950/40 file:text-primary-400 file:border file:border-primary-500/20 hover:file:bg-primary-950/60 cursor-pointer"
                                    />
                                    <div className="text-[10px] text-slate-500 mt-1 pl-1 italic">
                                      Optimal: PDF, Word, Excel, Access, Media, Images
                                    </div>
                                </div>
                            )}
                        </div>
                        <button className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary-900/40">
                           <Save className="w-4 h-4" /> Publish to Repository
                        </button>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {materials.map(item => (
                    <div key={item.id} className="glass-card p-6 rounded-2xl transition-all group relative hover:border-primary-500/30">
                        <button 
                            onClick={() => handleDelete(item.id)} 
                            className="absolute top-4 right-4 p-1.5 text-slate-600 hover:text-rose-500 transition-colors" 
                            title="Delete Material"
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                        <div className="w-10 h-10 bg-primary-950/40 border border-primary-500/20 rounded-xl flex items-center justify-center text-primary-400 mb-4 shadow-lg shadow-primary-950/20">
                            {item.category === ResourceCategory.ANNOUNCEMENT ? <Bell className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                        </div>
                        <h3 className="font-bold text-white mb-1 group-hover:text-primary-300 transition-colors">
                            {item.category === ResourceCategory.ANNOUNCEMENT && <span className="inline-block px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 text-[8px] font-bold uppercase mr-2 relative -top-0.5 border border-amber-500/30">Announcement</span>}
                            {item.title}
                        </h3>
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
                                <span className="text-primary-400 font-bold">{item.uploadedByName || 'Educator'}</span>
                            </div>
                            <span onClick={() => setViewingMaterial(item)} className="flex items-center gap-1 text-primary-400 cursor-pointer hover:text-primary-300 hover:underline"><BookOpen className="w-3 h-3" /> View</span>
                        </div>
                    </div>
                ))}
                {materials.length === 0 && !isAdding && (
                    <div className="col-span-full py-16 text-center text-slate-500 bg-white/5 rounded-3xl border-2 border-dashed border-white/10 italic">
                        <FileText className="w-12 h-12 mx-auto mb-4 opacity-10" />
                        <p className="font-medium text-slate-500">Repository is empty.</p>
                        <button onClick={() => setIsAdding(true)} className="mt-4 text-primary-400 text-sm font-bold hover:underline">Add first material</button>
                    </div>
                )}
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
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Uploaded By Educator</p>
                                    <p className="text-sm font-bold text-white">{viewingMaterial.uploadedByName || 'Platform Educator'}</p>
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



export const TeacherDashboard: React.FC<TeacherDashboardProps> = ({ user, onUpdateUser, activeTab, setActiveTab }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<VaultDocument[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (activeTab === 'overview') {
      setVaultDocs(db.getVaultDocuments(user.id));
    }
  }, [activeTab, user.id]);

  const handleUploadClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      
      // Limit file size to 2MB to prevent localStorage hits
      if (file.size > 2 * 1024 * 1024) {
        window.alert("File size exceeds the secure processing limit (2MB). Please compress or select a smaller document.");
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      const type = window.prompt("Select document classification (e.g., Scheme of Work, Record of Work):", "Scheme of Work");
      if (!type) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      setIsUploading(true);
      
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const fileData = event.target?.result as string;
          const newDoc = await db.addVaultDocument({
            title: file.name,
            type: type,
            teacherId: user.id,
            teacherName: user.name,
            fileName: file.name,
            fileType: file.type || file.name.split('.').pop() || 'unknown',
            fileData
          });
          setVaultDocs(prev => [newDoc, ...prev]);
          window.alert("Document securely uploaded and pending administrative verification.");
        } catch (err) {
          console.error("Upload failed in processing:", err);
          window.alert("The campus security system could not process this upload. This usually happens when the local storage is full.");
        } finally {
          setIsUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      };

      reader.onerror = () => {
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
        window.alert("Failed to read the selected file. Please ensure the file is not corrupted.");
      };

      reader.readAsDataURL(file);
    }
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
    <div className="max-w-7xl mx-auto space-y-8">
      <input 
        type="file" 
        ref={fileInputRef} 
        onChange={onFileChange} 
        className="hidden" 
        accept=".pdf,.doc,.docx,.xls,.xlsx,.mdb,.accdb,.mp3,.mp4,.jpg,.jpeg"
      />
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
        <div><h1 className="text-2xl font-bold text-white">Hi, {user.name}! 👋</h1><p className="text-slate-400">Manage classroom materials and student performance records.</p></div>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-8 animate-in fade-in">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 space-y-8">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                {[
                  { label: 'Active Classes', value: '04', icon: Users, color: 'text-primary-400', bg: 'bg-primary-950/40' },
                  { label: 'Attendance', value: '94%', icon: Calendar, color: 'text-emerald-400', bg: 'bg-emerald-950/40' },
                  { label: 'Assignments', value: '12', icon: FileCheck, color: 'text-amber-400', bg: 'bg-amber-950/40' },
                ].map((stat, i) => (
                  <div key={i} className="glass-card p-6 rounded-2xl group hover:border-primary-500/30 transition-all">
                    <div className={`w-10 h-10 rounded-xl ${stat.bg} ${stat.color} flex items-center justify-center mb-4 border border-white/5 shadow-lg shadow-black/20 group-hover:scale-110 transition-transform`}><stat.icon className="w-5 h-5" /></div>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">{stat.label}</p>
                    <p className="text-2xl font-bold text-white mt-1">{stat.value}</p>
                  </div>
                ))}
                
                {/* Documents Count Card */}
                <div className="glass-card p-6 rounded-2xl transition-all hover:border-primary-500/30 group">
                  <div className="flex justify-between items-start mb-4">
                    <div className="p-2 rounded-lg bg-primary-950/40 text-primary-400 group-hover:scale-110 transition-transform border border-white/5">
                      <FileText className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md border bg-primary-950/40 text-primary-400 border-primary-500/20">Live Repo</span>
                  </div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Documents</p>
                  <p className="text-2xl font-bold text-white mt-1"><span>{vaultDocs.length}</span></p>
                </div>
              </div>
              <div className="glass-card rounded-3xl overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between">
                  <h2 className="font-bold text-white">Teacher Vault</h2>
                  <button onClick={handleUploadClick} className="px-4 py-2 bg-primary-600 text-white text-xs font-bold rounded-xl flex items-center gap-2 hover:bg-primary-700 transition-all active:scale-95 shadow-lg shadow-primary-900/40">{isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}New Material</button>
                </div>
                <div className="divide-y divide-white/5">
                  {vaultDocs.map((doc) => (
                    <div key={doc.id} onClick={() => handleDownload(doc)} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors group cursor-pointer">
                      <div className="flex items-center gap-4">
                        <div className="p-2 bg-white/5 rounded-lg border border-white/5 group-hover:border-primary-500/30 transition-colors">
                          <Shield className={`w-5 h-5 ${doc.hash ? 'text-primary-400' : 'text-slate-600'}`} />
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200 group-hover:text-primary-300 transition-colors">{doc.title}</p>
                          <p className="text-[10px] text-slate-500 uppercase font-mono">{doc.type} • {new Date(doc.createdAt).toISOString().split('T')[0]}</p>
                        </div>
                      </div>
                      <span className={`text-[10px] font-bold px-2 py-1 rounded-full border ${
                        doc.status === DocumentStatus.APPROVED ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20' : 
                        doc.status === DocumentStatus.REJECTED ? 'bg-rose-950/40 text-rose-400 border-rose-500/20' :
                        'bg-amber-950/40 text-amber-400 border-amber-500/20'
                      }`}>
                        {doc.status}
                      </span>
                    </div>
                  ))}
                  {vaultDocs.length === 0 && (
                    <div className="p-12 text-center text-slate-500 italic text-sm">No documents uploaded to your vault yet.</div>
                  )}
                </div>
              </div>
            </div>
            <div className="bg-gradient-to-br from-primary-600 to-primary-900 rounded-3xl p-8 text-white relative overflow-hidden shadow-xl shadow-primary-950/40 group">
                <h3 className="font-bold text-xl mb-4 relative z-10 transition-transform group-hover:translate-x-1">Student Records</h3>
                <p className="text-primary-100 text-sm mb-8 relative z-10 leading-relaxed font-medium">Access and grade student submissions verified on the Solana blockchain infrastructure.</p>
                <button onClick={() => setActiveTab('students')} className="w-full py-3 bg-white text-primary-600 rounded-2xl text-sm font-bold hover:bg-primary-50 transition-all relative z-10 shadow-lg active:scale-95">Access Directory</button>
                <GraduationCap className="w-40 h-40 absolute -right-8 -bottom-8 text-white/10 group-hover:rotate-12 transition-transform duration-700" />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'announcements' && (
        <div className="space-y-8">
          <NotificationSendForm currentUser={user} />
          <CurriculumManager user={user} filterCategory={ResourceCategory.ANNOUNCEMENT} />
        </div>
      )}
      {activeTab === 'timetable' && <TimetableView currentUser={user} />}
      {activeTab === 'assignments' && <CurriculumManager user={user} filterCategory={ResourceCategory.DOCUMENT} />}
      {activeTab === 'assessments' && <AssessmentView currentUser={user} />}
      {activeTab === 'students' && <DetailedStudentList />}
      {activeTab === 'attendance' && <BlockchainAttendance user={user} />}
      {activeTab === 'profile' && <ProfileSection user={user} onUpdateUser={onUpdateUser} />}
    </div>
  );
};