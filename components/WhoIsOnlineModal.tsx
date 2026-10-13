import React, { useEffect, useState, useCallback } from 'react';
import { X, Users, Shield, GraduationCap, School, Clock, RefreshCw } from 'lucide-react';
import { User, UserRole } from '../types';
import { getUsersPresence } from '../services/api';
import { db } from '../services/database';

interface WhoIsOnlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser?: User;
}

/**
 * Computes human-friendly real relative time from an activity timestamp.
 * Examples: "Online now", "5 minutes ago", "2 hours ago", "2 days ago"
 */
export function formatRelativeActiveTime(isoDate?: string | null): string {
  if (!isoDate) return 'Offline';
  const time = new Date(isoDate).getTime();
  if (isNaN(time)) return 'Offline';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - time) / 1000));

  // Active within 2 minutes is considered online right now
  if (diffSeconds < 120) {
    return 'Online now';
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes} ${diffMinutes === 1 ? 'minute' : 'minutes'} ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return `${diffMonths} ${diffMonths === 1 ? 'month' : 'months'} ago`;
  }

  const diffYears = Math.floor(diffDays / 365);
  return `${diffYears} ${diffYears === 1 ? 'year' : 'years'} ago`;
}

/**
 * Maps system user roles to plain English: Admin / Teacher / Pupil
 */
export function getPlainEnglishRole(role?: string | UserRole): string {
  if (!role) return 'Pupil';
  const r = String(role).toUpperCase();
  if (r === 'ADMIN') return 'Admin';
  if (r === 'TEACHER') return 'Teacher';
  if (r === 'STUDENT' || r === 'PUPIL') return 'Pupil';
  return role;
}

export const WhoIsOnlineModal: React.FC<WhoIsOnlineModalProps> = ({
  isOpen,
  onClose,
  currentUser,
}) => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getUsersPresence();
      if (res && res.success && Array.isArray(res.users)) {
        setUsers(res.users);
        return;
      }
    } catch {
      // Fallback to local database presence
    }

    try {
      const fallback = db.getUsersWithPresence(currentUser?.id);
      setUsers(fallback);
    } catch {
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (isOpen) {
      fetchUsers();
    }
  }, [isOpen, fetchUsers]);

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Filter to active accounts that have activity timestamps
  const activeList = users.filter((u) => u.active !== false && Boolean(u.lastActiveAt));

  const onlineNowCount = activeList.filter(
    (u) => formatRelativeActiveTime(u.lastActiveAt) === 'Online now'
  ).length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="who-is-online-title"
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#1a1635] border border-slate-200 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[85vh] animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 bg-slate-50/80 dark:bg-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-700/40 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2
                  id="who-is-online-title"
                  className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate"
                >
                  Who is online
                </h2>
                {onlineNowCount > 0 && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700/50">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    {onlineNowCount} online
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 truncate">
                People active now or recently on the system
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={fetchUsers}
              disabled={loading}
              title="Refresh list"
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50"
              aria-label="Refresh list"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-white/10 transition-colors cursor-pointer"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content list */}
        <div className="p-4 overflow-y-auto max-h-[60vh] space-y-2">
          {activeList.length === 0 ? (
            <div className="py-12 px-4 flex flex-col items-center justify-center text-center">
              <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 flex items-center justify-center text-slate-400 mb-3">
                <Users className="w-6 h-6 text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                No one is online right now.
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-xs">
                Teachers, pupils, and school administrators will show here when they sign in.
              </p>
            </div>
          ) : (
            activeList.map((u) => {
              const friendlyRole = getPlainEnglishRole(u.role);
              const relativeTime = formatRelativeActiveTime(u.lastActiveAt);
              const isOnlineNow = relativeTime === 'Online now';
              const isSelf = currentUser && currentUser.id === u.id;

              return (
                <div
                  key={u.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50/70 hover:bg-slate-100 dark:bg-white/[0.03] dark:hover:bg-white/[0.07] border border-slate-200/70 dark:border-white/5 transition-all"
                >
                  {/* User info & avatar */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative shrink-0">
                      <img
                        src={u.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`}
                        alt={u.name}
                        className="w-10 h-10 rounded-full object-cover ring-1 ring-slate-200 dark:ring-white/10 bg-slate-100 dark:bg-slate-800"
                        onError={(e) => {
                          // Fallback avatar image
                          (e.currentTarget as HTMLImageElement).src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(u.name)}`;
                        }}
                      />
                      {isOnlineNow ? (
                        <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500 border-2 border-white dark:border-[#1a1635]"></span>
                        </span>
                      ) : (
                        <span className="absolute -bottom-0.5 -right-0.5 inline-block w-3 h-3 rounded-full bg-slate-400 dark:bg-slate-500 border-2 border-white dark:border-[#1a1635]"></span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                          {u.name}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-md bg-primary-100 dark:bg-primary-950/60 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800/40">
                            You
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-0.5">
                        {friendlyRole === 'Admin' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                            <Shield className="w-3 h-3 shrink-0" />
                            Admin
                          </span>
                        ) : friendlyRole === 'Teacher' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                            <GraduationCap className="w-3 h-3 shrink-0" />
                            Teacher
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <School className="w-3 h-3 shrink-0" />
                            Pupil
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Relative time */}
                  <div className="text-right shrink-0">
                    {isOnlineNow ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        Online now
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
                        <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                        {relativeTime}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-3.5 px-5 bg-slate-50 dark:bg-white/5 border-t border-slate-200 dark:border-white/10 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <span>{activeList.length} total active users</span>
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 bg-white hover:bg-slate-100 dark:bg-white/10 dark:hover:bg-white/15 border border-slate-200 dark:border-white/10 transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
