import React, { useState } from 'react';
import {
  LayoutDashboard, BookOpen, FileText, Settings,
  LogOut, Bell, Menu, X, Users, CheckSquare,
  TrendingUp, Camera, Pencil, Loader2, CheckCircle,
  XCircle, MessageSquare, ShieldCheck, Save,
} from 'lucide-react';
import { UserRole, User } from '../types';
import { db } from '../services/database';

interface LayoutProps {
  children: React.ReactNode;
  user: User;
  onLogout: () => void;
  onUpdateUser: (user: User) => void;
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

const GraduationCap = (props: any) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
    <path d="M6 12v5c3 3 9 3 12 0v-5"/>
  </svg>
);

export const Layout: React.FC<LayoutProps> = ({
  children, user, onLogout, onUpdateUser, activeTab, onTabChange,
}) => {
  const [sidebarOpen, setSidebarOpen]           = useState(false);
  const [isAvatarEditing, setIsAvatarEditing]   = useState(false);
  const [avatarPreview, setAvatarPreview]       = useState<string | null>(user.avatar);
  const [avatarFile, setAvatarFile]             = useState<File | null>(null);
  const [avatarUploadLoading, setAvatarUploadLoading] = useState(false);
  const [avatarUploadMessage, setAvatarUploadMessage] = useState<{type:'success'|'error';text:string}|null>(null);

  const unreadCount = db.getUnreadCurriculumCount(user);

  React.useEffect(() => {
    if (activeTab === 'announcements') {
      const updated = db.updateUserProfile(user.id, { lastViewedCurriculumAt: new Date().toISOString() });
      if (updated) onUpdateUser(updated);
    }
  }, [activeTab, user.id]);

  const getNavItems = () => {
    const pendingVaultCount = db.getPendingVaultDocuments().length;
    switch (user.role) {
      case UserRole.STUDENT:
        return [
          { id: 'overview',       icon: LayoutDashboard, label: 'Home'         },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'      },
          { id: 'assignments',    icon: CheckSquare,     label: 'Work'         },
          { id: 'grades',         icon: TrendingUp,      label: 'Results'      },
          { id: 'profile',        icon: Settings,        label: 'Settings'     },
        ];
      case UserRole.TEACHER:
        return [
          { id: 'overview',       icon: LayoutDashboard, label: 'Home'         },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'      },
          { id: 'assignments',    icon: CheckSquare,     label: 'Assignments'  },
          { id: 'attendance',     icon: ShieldCheck,     label: 'Attendance'   },
          { id: 'communicate',    icon: MessageSquare,   label: 'Messages'     },
          { id: 'students',       icon: Users,           label: 'Students'     },
          { id: 'grades',         icon: TrendingUp,      label: 'Grades'       },
          { id: 'profile',        icon: Settings,        label: 'Settings'     },
        ];
      case UserRole.ADMIN:
        return [
          { id: 'overview',       icon: LayoutDashboard, label: 'Home'                                                       },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'                                                    },
          { id: 'vault',          icon: ShieldCheck,     label: 'Approvals',  badge: pendingVaultCount > 0 ? pendingVaultCount : undefined },
          { id: 'communicate',    icon: MessageSquare,   label: 'Messages'                                                   },
          { id: 'grades',         icon: TrendingUp,      label: 'Grades'                                                     },
          { id: 'staff',          icon: Users,           label: 'Staff'                                                      },
          { id: 'profile',        icon: Settings,        label: 'Settings'                                                   },
        ];
      default:
        return [{ id: 'overview', icon: LayoutDashboard, label: 'Home' }];
    }
  };

  const navItems = getNavItems() as any[];

  // Bottom nav shows the first 5 most important items on mobile
  const bottomNavItems = navItems.slice(0, 5);

  const handleAvatarFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0];
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSaveAvatar = async () => {
    if (!avatarFile || !user) return;
    setAvatarUploadLoading(true);
    setAvatarUploadMessage(null);
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        const base64 = reader.result as string;
        await new Promise(r => setTimeout(r, 500));
        const updated = db.updateUserProfile(user.id, { avatar: base64 });
        if (updated) {
          onUpdateUser(updated);
          setAvatarUploadMessage({ type: 'success', text: 'Profile picture updated!' });
          setIsAvatarEditing(false);
          setAvatarFile(null);
        } else throw new Error('User not found.');
      } catch (err: any) {
        setAvatarUploadMessage({ type: 'error', text: err.message || 'Failed to update.' });
      } finally { setAvatarUploadLoading(false); }
    };
    reader.readAsDataURL(avatarFile);
  };

  return (
    <div className="min-h-screen flex">

      {/* ── Sidebar backdrop (mobile) ────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-slate-950/70 backdrop-blur-md z-40 lg:hidden transition-opacity ${
          sidebarOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setSidebarOpen(false)}
      />

      {/* ── Sidebar (desktop always visible, mobile slide-in) ───────────────── */}
      <aside className={`fixed inset-y-0 left-0 w-64 glass-card bg-[#1a1635]/80 backdrop-blur-xl border-r border-white/5 z-50 transform lg:translate-x-0 transition-transform ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        <div className="flex flex-col h-full">

          {/* Logo */}
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center gap-2 font-bold text-xl text-primary-400">
              <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-primary-900/40 text-sm">E</div>
              E-SYLLAB
            </div>
            <button className="lg:hidden p-1 text-slate-500 hover:text-white" onClick={() => setSidebarOpen(false)}>
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => { onTabChange(item.id); setSidebarOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl transition-all group ${
                  activeTab === item.id
                    ? 'bg-primary-600 text-white shadow-lg shadow-primary-900/40'
                    : 'text-slate-400 hover:bg-white/5 hover:text-primary-300'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon className={`w-5 h-5 ${activeTab === item.id ? 'text-white' : 'text-slate-500 group-hover:text-primary-400'}`} />
                  <span className="font-medium text-sm">{item.label}</span>
                </div>
                {item.badge && (
                  <span className="bg-rose-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow-lg">
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>

          {/* Sign out */}
          <div className="p-4 border-t border-white/5">
            <button
              onClick={onLogout}
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-500 hover:bg-rose-950/40 hover:text-rose-400 rounded-xl transition-all group border border-transparent hover:border-rose-500/20"
            >
              <LogOut className="w-5 h-5 group-hover:text-rose-500" />
              <span className="font-medium text-sm">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      {/* pb-20 on mobile leaves space for the bottom nav bar */}
      <main className="flex-1 lg:ml-64 flex flex-col min-h-screen pb-20 lg:pb-0">

        {/* Top header */}
        <header className="sticky top-0 z-30 h-16 bg-[#1a1635]/60 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 flex items-center justify-between">
          {/* Hamburger — mobile only */}
          <button className="lg:hidden p-2 text-slate-400 hover:bg-white/5 rounded-lg" onClick={() => setSidebarOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>

          {/* Page title on mobile */}
          <span className="lg:hidden font-bold text-white text-sm">
            {navItems.find(i => i.id === activeTab)?.label ?? 'E-SYLLAB'}
          </span>

          {/* Right side */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Notifications */}
            <button
              onClick={() => onTabChange('announcements')}
              className="p-2 text-slate-500 hover:text-primary-400 relative transition-colors"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <>
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 rounded-full border-2 border-[#1a1635] flex items-center justify-center text-[10px] font-bold text-white z-10">
                    {unreadCount}
                  </span>
                  <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-600 rounded-full animate-ping opacity-25" />
                </>
              )}
            </button>

            <div className="h-6 w-px bg-white/10" />

            {/* Avatar */}
            <div className="flex items-center gap-2 relative">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-semibold text-white leading-none">{user.name}</p>
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mt-0.5 capitalize">{user.role}</p>
              </div>
              <button onClick={() => setIsAvatarEditing(!isAvatarEditing)} className="relative block rounded-full focus:outline-none group">
                <img
                  src={user.avatar}
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/10 group-hover:border-primary-500 transition-all shadow-lg"
                  alt="Avatar"
                />
                <div className="absolute -bottom-1 -right-1 p-1 bg-primary-600 rounded-full text-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  <Pencil className="w-2.5 h-2.5" />
                </div>
              </button>

              {/* Avatar edit dropdown */}
              {isAvatarEditing && (
                <div className="absolute right-0 top-full mt-2 w-64 glass-card p-4 rounded-xl z-40 animate-in fade-in slide-in-from-top-1">
                  <h3 className="font-semibold text-white mb-3 flex items-center gap-2">
                    <Camera className="w-4 h-4 text-primary-400" /> Change Profile Picture
                  </h3>
                  {avatarUploadMessage && (
                    <div className={`text-xs p-2 rounded-lg mb-3 border ${
                      avatarUploadMessage.type === 'success'
                        ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20'
                        : 'bg-rose-950/40 text-rose-400 border-rose-500/20'
                    }`}>
                      {avatarUploadMessage.text}
                    </div>
                  )}
                  <div className="flex flex-col items-center gap-3 mb-4">
                    <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-white/10 shadow-xl">
                      <img src={avatarPreview || user.avatar} className="w-full h-full object-cover" alt="preview" />
                    </div>
                    <input
                      type="file" accept="image/*" onChange={handleAvatarFileChange}
                      className="text-[10px] w-full text-slate-400 file:bg-white/5 file:border-white/10 file:text-slate-300 file:rounded-lg file:px-2 file:py-1 file:mr-2 hover:file:bg-white/10 cursor-pointer"
                    />
                  </div>
                  <div className="flex gap-2 justify-end pt-3 border-t border-white/5">
                    <button onClick={() => setIsAvatarEditing(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:bg-white/5 rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveAvatar}
                      disabled={avatarUploadLoading || !avatarFile}
                      className="px-4 py-1.5 bg-primary-600 text-white text-xs font-bold rounded-lg hover:bg-primary-700 disabled:opacity-50 shadow-lg transition-all active:scale-95"
                    >
                      {avatarUploadLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="p-4 sm:p-6 md:p-8 flex-1 relative z-10">
          {children}
        </div>
      </main>

      {/* ── Mobile bottom nav bar ─────────────────────────────────────────────── */}
      {/* Visible on mobile only (lg:hidden). Shows the 5 most used tabs. */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1a1635]/95 backdrop-blur-xl border-t border-white/5 bottom-nav">
        <div className="flex items-center justify-around px-2 pt-2 pb-1">
          {bottomNavItems.map(item => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-all relative min-w-0 ${
                  active ? 'text-primary-400' : 'text-slate-600 hover:text-slate-400'
                }`}
              >
                {/* Active indicator dot */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary-500 rounded-full" />
                )}
                <item.icon className={`w-5 h-5 ${active ? 'text-primary-400' : 'text-slate-600'}`} />
                <span className={`text-[10px] font-medium truncate max-w-[56px] ${active ? 'text-primary-400' : 'text-slate-600'}`}>
                  {item.label}
                </span>
                {/* Badge */}
                {item.badge && (
                  <span className="absolute top-0.5 right-1.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
          {/* If there are more than 5 items, show "More" which opens the sidebar */}
          {navItems.length > 5 && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-slate-600 hover:text-slate-400 transition-all"
            >
              <Menu className="w-5 h-5" />
              <span className="text-[10px] font-medium">More</span>
            </button>
          )}
        </div>
      </nav>

    </div>
  );
};
