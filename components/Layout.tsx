import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard, BookOpen, FileText, Settings,
  LogOut, Bell, Menu, X, Users, CheckSquare,
  TrendingUp, Loader2, CheckCircle,
  XCircle, MessageSquare, ShieldCheck, Save, Calendar, Database,
  BarChart2,
} from 'lucide-react';
import { UserRole, User } from '../types';
import { db } from '../services/database';
import { notificationService } from '../services/notificationService';
import { NotificationCenter } from './NotificationCenter';
import { Logo, LogoIcon } from './Logo';
import { getSystemNotifications } from '../services/api';
import { getNotificationPreferences } from '../services/settingsService';

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
  // Menu visibility (persisted in localStorage, default true)
  const [menuOpen, setMenuOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('esyllab_sidebar_open');
      return saved !== null ? saved === 'true' : true;
    } catch {
      return true;
    }
  });

  const toggleMenu = () => {
    setMenuOpen(prev => {
      const next = !prev;
      try {
        localStorage.setItem('esyllab_sidebar_open', String(next));
      } catch {}
      return next;
    });
  };

  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [unreadNotifsCount, setUnreadNotifsCount] = useState(0);
  const [unreadServerNotifsCount, setUnreadServerNotifsCount] = useState(0);

  const unreadCurriculumCount = db.getUnreadCurriculumCount(user);

  const updateNotifCount = () => {
    const prefs = getNotificationPreferences(user.id);
    notificationService.checkUpcomingDeadlines(user);
    const notifs = notificationService.getNotifications(user.id);
    const filteredLocal = notifs.filter(n => {
      if (!n.read) {
        if (n.type === 'ASSIGNMENT_DUE' || n.type === 'ASSIGNMENT_NEW' || n.type === 'OVERDUE_ALERT') {
          return prefs.deadlines;
        }
        if (n.type === 'SYSTEM_ALERT') {
          return prefs.general;
        }
        return true;
      }
      return false;
    });
    setUnreadNotifsCount(filteredLocal.length);

    getSystemNotifications()
      .then(res => {
        if (res.success && Array.isArray(res.notifications)) {
          const filteredServer = res.notifications.filter((n: any) => {
            if (!n.read) {
              if (n.type === 'deadline') return prefs.deadlines;
              if (n.type === 'meeting') return prefs.meetings;
              if (n.type === 'misconduct') return prefs.misconduct;
              if (n.type === 'general') return prefs.general;
              return true;
            }
            return false;
          });
          setUnreadServerNotifsCount(filteredServer.length);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    updateNotifCount();
    const timer = setInterval(() => {
      updateNotifCount();
    }, 15000); // Check deadlines every 15s

    const handleUpdate = () => updateNotifCount();
    window.addEventListener('esylab_notification_update', handleUpdate);
    window.addEventListener('esyllab_preferences_update', handleUpdate);

    return () => {
      clearInterval(timer);
      window.removeEventListener('esylab_notification_update', handleUpdate);
      window.removeEventListener('esyllab_preferences_update', handleUpdate);
    };
  }, [user]);

  const totalUnreadCount = unreadCurriculumCount + unreadNotifsCount + unreadServerNotifsCount;

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
          { id: 'timetable',      icon: Calendar,        label: 'Timetable'    },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'      },
          { id: 'assignments',    icon: CheckSquare,     label: 'Work'         },
          { id: 'assessments',    icon: BarChart2,       label: 'Assessments'  },
          { id: 'grades',         icon: TrendingUp,      label: 'Results'      },
          { id: 'profile',        icon: Settings,        label: 'Settings'     },
        ];
      case UserRole.TEACHER:
        return [
          { id: 'overview',       icon: LayoutDashboard, label: 'Home'         },
          { id: 'timetable',      icon: Calendar,        label: 'Timetable'    },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'      },
          { id: 'assignments',    icon: CheckSquare,     label: 'Assignments'  },
          { id: 'assessments',    icon: BarChart2,       label: 'Assessments'  },
          { id: 'attendance',     icon: ShieldCheck,     label: 'Attendance'   },
          { id: 'communicate',    icon: MessageSquare,   label: 'Messages'     },
          { id: 'students',       icon: Users,           label: 'Students'     },
          { id: 'grades',         icon: TrendingUp,      label: 'Grades'       },
          { id: 'profile',        icon: Settings,        label: 'Settings'     },
        ];
      case UserRole.ADMIN:
        return [
          { id: 'overview',       icon: LayoutDashboard, label: 'Home'                                                       },
          { id: 'timetable',      icon: Calendar,        label: 'Timetable'                                                  },
          { id: 'announcements',  icon: BookOpen,        label: 'Notices'                                                    },
          { id: 'vault',          icon: ShieldCheck,     label: 'Approvals',  badge: pendingVaultCount > 0 ? pendingVaultCount : undefined },
          { id: 'check-records',  icon: Database,        label: 'Check records'                                              },
          { id: 'communicate',    icon: MessageSquare,   label: 'Messages'                                                   },
          { id: 'assessments',    icon: BarChart2,       label: 'Assessments'                                                },
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

  return (
    <div className="min-h-screen flex">

      {/* ── Sidebar backdrop (mobile) ────────────────────────────────────────── */}
      <div
        className={`fixed inset-0 bg-slate-950/70 backdrop-blur-md z-40 lg:hidden transition-opacity duration-200 ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={toggleMenu}
      />

      {/* ── Sidebar (desktop & mobile toggle via logo, duration-200) ─────────── */}
      <aside
        className={`fixed inset-y-0 left-0 w-64 glass-card bg-[#1a1635]/95 backdrop-blur-xl border-r border-white/5 z-50 transform transition-transform duration-200 ease-in-out ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">

          {/* Logo toggle button */}
          <div className="p-6 flex items-center justify-between">
            <button
              type="button"
              onClick={toggleMenu}
              className="flex items-center gap-2.5 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-xl p-1 -m-1 transition-opacity hover:opacity-80 cursor-pointer"
              aria-label={menuOpen ? 'Hide menu' : 'Show menu'}
              title={menuOpen ? 'Hide menu' : 'Show menu'}
            >
              <Logo size="sm" />
            </button>
            <button
              type="button"
              className="lg:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              onClick={toggleMenu}
              aria-label="Hide menu"
              title="Hide menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-4 py-2 space-y-1 overflow-y-auto">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => { onTabChange(item.id); }}
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
              className="w-full flex items-center gap-3 px-3 py-2 text-slate-400 hover:bg-rose-950/40 hover:text-rose-400 rounded-xl transition-all group border border-transparent hover:border-rose-500/20"
            >
              <LogOut className="w-5 h-5 group-hover:text-rose-500" />
              <span className="font-medium text-sm">Sign Out</span>
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────────────────── */}
      {/* pb-20 on mobile leaves space for the bottom nav bar; lg:ml-64 when menuOpen else lg:ml-0 */}
      <main
        className={`flex-1 flex flex-col min-h-screen pb-20 lg:pb-0 transition-[margin] duration-200 ease-in-out ${
          menuOpen ? 'lg:ml-64' : 'lg:ml-0'
        }`}
      >

        {/* Top header */}
        <header className="sticky top-0 z-30 h-16 bg-[#1a1635]/60 backdrop-blur-md border-b border-white/5 px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* When menu is closed, show leftover pinned E logo control */}
            {!menuOpen && (
              <button
                type="button"
                onClick={toggleMenu}
                className="flex items-center justify-center p-1.5 rounded-xl bg-primary-600/20 border border-primary-500/30 text-white hover:bg-primary-600/30 hover:border-primary-500/50 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 cursor-pointer shadow-lg shadow-primary-950/40"
                aria-label="Show menu"
                title="Show menu"
              >
                <LogoIcon size={26} />
              </button>
            )}

            {/* Mobile hamburger toggle */}
            <button
              type="button"
              className="lg:hidden p-2 text-slate-400 hover:bg-white/5 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              onClick={toggleMenu}
              aria-label={menuOpen ? 'Hide menu' : 'Show menu'}
              title={menuOpen ? 'Hide menu' : 'Show menu'}
            >
              <Menu className="w-5 h-5" />
            </button>

            {/* Page title on mobile */}
            <span className="lg:hidden font-bold text-white text-sm">
              {navItems.find(i => i.id === activeTab)?.label ?? 'E-SYLLAB'}
            </span>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3 ml-auto">
            {/* Notifications */}
            <button
              onClick={() => setIsNotificationCenterOpen(true)}
              className="p-2 text-slate-400 hover:text-primary-400 relative transition-colors cursor-pointer rounded-lg hover:bg-white/5"
              title="Open Push Notifications & Deadline Center"
            >
              <Bell className="w-5 h-5" />
              {totalUnreadCount > 0 && (
                <>
                  <span className="absolute -top-1 -right-1 min-w-4 h-4 px-1 bg-rose-600 rounded-full border-2 border-[#1a1635] flex items-center justify-center text-[10px] font-bold text-white z-10">
                    {totalUnreadCount}
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
                <p className="text-[10px] uppercase tracking-widest font-bold text-slate-400 mt-0.5 capitalize">{user.role}</p>
              </div>
              <button 
                onClick={() => onTabChange('profile')} 
                className="relative block rounded-full bg-slate-950/90 border border-white/10 p-0.5 focus:outline-none group cursor-pointer hover:border-primary-500 transition-all"
                title="Go to Profile & Settings"
              >
                <img
                  src={user.avatar}
                  className="w-9 h-9 rounded-full object-cover border-2 border-white/10 group-hover:border-primary-500 transition-all shadow-lg"
                  alt={user.name}
                />
              </button>
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
                  active ? 'text-primary-400 font-semibold' : 'text-slate-300 hover:text-white'
                }`}
              >
                {/* Active indicator dot */}
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-0.5 bg-primary-500 rounded-full" />
                )}
                <item.icon className={`w-5 h-5 ${active ? 'text-primary-400' : 'text-slate-300'}`} />
                <span className={`text-[10px] font-medium truncate max-w-[56px] ${active ? 'text-primary-400' : 'text-slate-300'}`}>
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
              onClick={() => setMenuOpen(true)}
              className="flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl text-slate-300 hover:text-white transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
              aria-label="Show menu"
            >
              <Menu className="w-5 h-5 text-slate-300" />
              <span className="text-[10px] font-medium text-slate-300">More</span>
            </button>
          )}
        </div>
      </nav>

      {/* Local Push Notification & Deadline Alert Drawer */}
      <NotificationCenter
        user={user}
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        onNavigateTab={onTabChange}
      />

    </div>
  );
};
