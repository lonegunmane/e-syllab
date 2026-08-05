import React, { useState, useEffect } from 'react';
import { 
  Bell, Clock, AlertTriangle, CheckCircle2, Trash2, ShieldAlert, 
  Volume2, VolumeX, Check, ExternalLink, Calendar, Plus, X 
} from 'lucide-react';
import { User, LocalNotification, Assignment, UserRole, SystemNotification } from '../types';
import { notificationService } from '../services/notificationService';
import { db } from '../services/database';
import { getSystemNotifications, markSystemNotificationRead } from '../services/api';
import { getNotificationPreferences, NotificationPreferences } from '../services/settingsService';

interface NotificationCenterProps {
  user: User;
  isOpen: boolean;
  onClose: () => void;
  onNavigateTab?: (tab: string) => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  user,
  isOpen,
  onClose,
  onNavigateTab
}) => {
  const [notifications, setNotifications] = useState<LocalNotification[]>([]);
  const [systemNotifications, setSystemNotifications] = useState<SystemNotification[]>([]);
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default');
  const [filter, setFilter] = useState<'ALL' | 'UNREAD' | 'DEADLINES'>('ALL');
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [showCreateAssignment, setShowCreateAssignment] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(() => getNotificationPreferences(user.id));

  // New assignment form state (for teachers/admins)
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('Mathematics');
  const [gradeLevel, setGradeLevel] = useState(user.grade || 'Grade 10');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('high');
  const [creationStatus, setCreationStatus] = useState<string | null>(null);

  const loadData = () => {
    setNotifPrefs(getNotificationPreferences(user.id));
    // Check deadlines first
    notificationService.checkUpcomingDeadlines(user);
    const notifs = notificationService.getNotifications(user.id);
    setNotifications(notifs);
    setPermission(notificationService.getPermissionStatus());
    
    const userGrade = user.grade || 'Grade 10';
    setAssignments(db.getAssignments(userGrade));

    getSystemNotifications().then(res => {
      if (res.success && Array.isArray(res.notifications)) {
        setSystemNotifications(res.notifications);
      }
    }).catch(err => console.warn('[NotificationCenter] Failed to fetch system notifications:', err));
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, user]);

  useEffect(() => {
    const handleUpdate = () => {
      setNotifPrefs(getNotificationPreferences(user.id));
      const notifs = notificationService.getNotifications(user.id);
      setNotifications(notifs);
      getSystemNotifications().then(res => {
        if (res.success && Array.isArray(res.notifications)) {
          setSystemNotifications(res.notifications);
        }
      }).catch(() => {});
    };

    window.addEventListener('esylab_notification_update', handleUpdate);
    window.addEventListener('esyllab_preferences_update', handleUpdate);
    return () => {
      window.removeEventListener('esylab_notification_update', handleUpdate);
      window.removeEventListener('esyllab_preferences_update', handleUpdate);
    };
  }, [user.id]);

  const handleRequestPermission = async () => {
    const res = await notificationService.requestPermission();
    setPermission(res);
    if (res === 'granted') {
      notificationService.sendNativePushNotification(
        '🔔 Push Notifications Enabled',
        'You will now receive instant push alerts for upcoming assignment deadlines!'
      );
    }
  };

  const handleMarkAsRead = (id: string) => {
    notificationService.markAsRead(id);
  };

  const handleMarkSystemAsRead = async (id: string) => {
    try {
      await markSystemNotificationRead(id);
      setSystemNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
      window.dispatchEvent(new Event('esylab_notification_update'));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkAllRead = async () => {
    notificationService.markAllAsRead(user.id);
    for (const notif of systemNotifications.filter(n => !n.read)) {
      try {
        await markSystemNotificationRead(notif.id);
      } catch {}
    }
    setSystemNotifications(prev => prev.map(n => ({ ...n, read: true })));
    window.dispatchEvent(new Event('esylab_notification_update'));
  };

  const handleClearAll = () => {
    notificationService.clearAll(user.id);
  };

  const handleCreateAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !dueDate) {
      setCreationStatus('Please fill in assignment title and due date.');
      return;
    }

    try {
      const created = db.addAssignment({
        title,
        subject,
        gradeLevel,
        description,
        dueDate: new Date(dueDate).toISOString(),
        priority,
        createdById: user.id,
        createdByName: user.name,
        status: 'pending'
      });

      // Broadcast local push notification instantly
      notificationService.addNotification({
        userId: '', // Broadcast to relevant users
        title: `📌 New Assignment Posted: ${title}`,
        body: `${user.name} posted a new ${subject} assignment due on ${new Date(dueDate).toLocaleDateString()} at ${new Date(dueDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
        type: 'ASSIGNMENT_NEW',
        relatedId: created.id,
        dueDate: created.dueDate,
        priority: priority === 'urgent' ? 'urgent' : 'high'
      });

      setCreationStatus('Assignment posted & push notification broadcasted!');
      setTitle('');
      setDescription('');
      setDueDate('');
      setShowCreateAssignment(false);
      loadData();
    } catch {
      setCreationStatus('Error posting assignment.');
    }
  };

  if (!isOpen) return null;

  // Filter based on user preferences and view filter
  const allowedNotifications = notifications.filter(n => {
    if (n.type === 'ASSIGNMENT_DUE' || n.type === 'ASSIGNMENT_NEW' || n.type === 'OVERDUE_ALERT') {
      return notifPrefs.deadlines;
    }
    if (n.type === 'SYSTEM_ALERT') {
      return notifPrefs.general;
    }
    return true;
  });

  const allowedSystemNotifications = systemNotifications.filter(n => {
    if (n.type === 'deadline') return notifPrefs.deadlines;
    if (n.type === 'meeting') return notifPrefs.meetings;
    if (n.type === 'misconduct') return notifPrefs.misconduct;
    if (n.type === 'general') return notifPrefs.general;
    return true;
  });

  const filteredNotifications = allowedNotifications.filter(n => {
    if (filter === 'UNREAD') return !n.read;
    if (filter === 'DEADLINES') return n.type === 'ASSIGNMENT_DUE' || n.type === 'OVERDUE_ALERT';
    return true;
  });

  const filteredSystemNotifications = allowedSystemNotifications.filter(n => {
    if (filter === 'UNREAD') return !n.read;
    if (filter === 'DEADLINES') return n.type === 'deadline';
    return true;
  });

  const unreadCount = allowedNotifications.filter(n => !n.read).length;
  const unreadSystemCount = allowedSystemNotifications.filter(n => !n.read).length;
  const totalUnreadCount = unreadCount + unreadSystemCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in">
      <div className="w-full max-w-lg h-full bg-[#120f26] border-l border-white/10 flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-5 border-b border-white/10 bg-[#1a1635]/90 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-primary-600/20 text-primary-400 rounded-xl border border-primary-500/30">
              <Bell className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="font-bold text-white text-base leading-tight flex items-center gap-2">
                Notification Center
                {totalUnreadCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-xs font-bold border border-rose-500/30">
                    {totalUnreadCount} New
                  </span>
                )}
              </h2>
              <p className="text-xs text-slate-400">System Alerts & Deadline Notifications</p>
            </div>
          </div>

          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Browser Push Permission Banner */}
        <div className="px-5 py-3 bg-[#1e193d] border-b border-white/5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2.5 text-slate-300">
            {permission === 'granted' ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-4 h-4" /> Native Push Alerts Active
              </span>
            ) : permission === 'denied' ? (
              <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                <ShieldAlert className="w-4 h-4" /> Push Notifications Blocked
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <Bell className="w-4 h-4" /> Browser Push Notifications Disabled
              </span>
            )}
          </div>

          {permission !== 'granted' && permission !== 'unsupported' && (
            <button
              onClick={handleRequestPermission}
              className="px-3 py-1 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-lg transition-all shadow-md text-[11px] cursor-pointer"
            >
              Enable Push
            </button>
          )}
        </div>

        {/* Action Controls & Filters */}
        <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between bg-black/20 gap-2">
          <div className="flex items-center gap-1.5 bg-white/5 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setFilter('ALL')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${filter === 'ALL' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              All ({notifications.length + systemNotifications.length})
            </button>
            <button
              onClick={() => setFilter('UNREAD')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${filter === 'UNREAD' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              Unread ({totalUnreadCount})
            </button>
            <button
              onClick={() => setFilter('DEADLINES')}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${filter === 'DEADLINES' ? 'bg-primary-600 text-white shadow-sm' : 'text-slate-400 hover:text-white'}`}
            >
              Deadlines
            </button>
          </div>

          <div className="flex items-center gap-2">
            {totalUnreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-[11px] font-semibold text-primary-400 hover:text-primary-300 transition-colors"
              >
                Mark Read
              </button>
            )}
            {notifications.length > 0 && (
              <button
                onClick={handleClearAll}
                className="text-[11px] font-semibold text-slate-500 hover:text-rose-400 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Teacher / Admin Action: Create New Assignment */}
        {(user.role === UserRole.TEACHER || user.role === UserRole.ADMIN) && (
          <div className="px-5 py-3 border-b border-white/5 bg-primary-950/20">
            {!showCreateAssignment ? (
              <button
                onClick={() => setShowCreateAssignment(true)}
                className="w-full py-2 px-4 bg-primary-600/30 hover:bg-primary-600/50 border border-primary-500/40 text-primary-200 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Plus className="w-4 h-4" /> Post New Assignment & Push Deadline Alert
              </button>
            ) : (
              <form onSubmit={handleCreateAssignment} className="space-y-3 bg-slate-900/90 p-4 rounded-2xl border border-primary-500/30 animate-in fade-in">
                <div className="flex items-center justify-between border-b border-white/5 pb-2">
                  <h4 className="font-bold text-xs text-white uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-primary-400" /> New Assignment Alert
                  </h4>
                  <button type="button" onClick={() => setShowCreateAssignment(false)} className="text-slate-400 hover:text-white text-xs">Cancel</button>
                </div>

                {creationStatus && (
                  <p className="text-[11px] text-primary-300 bg-primary-950/60 p-2 rounded-lg border border-primary-500/20">{creationStatus}</p>
                )}

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Title</label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    placeholder="e.g. Physics Lab Report 2"
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Subject</label>
                    <select
                      value={subject}
                      onChange={e => setSubject(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                    >
                      <option value="Mathematics">Mathematics</option>
                      <option value="Science Physics">Science Physics</option>
                      <option value="Biology">Biology</option>
                      <option value="Chemistry">Chemistry</option>
                      <option value="Computer Studies">Computer Studies</option>
                      <option value="Additional Mathematics">Additional Math</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Target Grade</label>
                    <select
                      value={gradeLevel}
                      onChange={e => setGradeLevel(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                    >
                      <option value="All Grades">All Grades</option>
                      <option value="Grade 9">Grade 9</option>
                      <option value="Grade 10">Grade 10</option>
                      <option value="Grade 11">Grade 11</option>
                      <option value="Grade 12">Grade 12</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Due Date & Time</label>
                    <input
                      type="datetime-local"
                      required
                      value={dueDate}
                      onChange={e => setDueDate(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Priority Alert</label>
                    <select
                      value={priority}
                      onChange={e => setPriority(e.target.value as any)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl px-2 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                    >
                      <option value="low">Low Priority</option>
                      <option value="medium">Medium Priority</option>
                      <option value="high">High Priority</option>
                      <option value="urgent">Urgent Deadline</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">Instructions / Description</label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Provide details or submission instructions..."
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white focus:outline-none focus:border-primary-500"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs rounded-xl shadow-lg transition-all"
                >
                  Publish Assignment & Push Alert
                </button>
              </form>
            )}
          </div>
        )}

        {/* List Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">

          {/* Active Upcoming Assignments Widget */}
          {assignments.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>Upcoming Course Deadlines</span>
                <span className="text-primary-400">{assignments.length} Active</span>
              </h3>

              <div className="space-y-2">
                {assignments.slice(0, 4).map(asg => {
                  const due = new Date(asg.dueDate);
                  const isOverdue = due.getTime() < Date.now();
                  const hoursLeft = Math.ceil((due.getTime() - Date.now()) / (1000 * 60 * 60));

                  return (
                    <div 
                      key={asg.id}
                      className={`p-3 rounded-2xl border transition-all ${
                        isOverdue 
                          ? 'bg-rose-950/20 border-rose-500/30' 
                          : hoursLeft <= 6 
                          ? 'bg-amber-950/20 border-amber-500/30'
                          : 'bg-white/5 border-white/5'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                            isOverdue ? 'bg-rose-500/20 text-rose-300 border-rose-500/30' :
                            hoursLeft <= 6 ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                            'bg-primary-500/20 text-primary-300 border-primary-500/30'
                          }`}>
                            {isOverdue ? 'OVERDUE' : hoursLeft <= 24 ? `Due in ${hoursLeft}h` : due.toLocaleDateString()}
                          </span>
                          <h4 className="font-bold text-white text-xs mt-1.5">{asg.title}</h4>
                          <p className="text-[11px] text-slate-400 mt-0.5">{asg.subject} • {asg.gradeLevel}</p>
                        </div>
                        <Clock className={`w-4 h-4 shrink-0 mt-1 ${isOverdue ? 'text-rose-400' : hoursLeft <= 6 ? 'text-amber-400' : 'text-slate-500'}`} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* System Alerts Feed (Deadlines, Meetings, Misconduct, General) */}
          {filteredSystemNotifications.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
                <span>System Alerts ({filteredSystemNotifications.length})</span>
              </h3>

              <div className="space-y-3">
                {filteredSystemNotifications.map(notif => {
                  const isMisconduct = notif.type === 'misconduct';
                  const isMeeting = notif.type === 'meeting';
                  const isDeadline = notif.type === 'deadline';

                  return (
                    <div
                      key={notif.id}
                      onClick={() => !notif.read && handleMarkSystemAsRead(notif.id)}
                      className={`p-4 rounded-2xl border transition-all relative cursor-pointer group ${
                        !notif.read
                          ? isMisconduct
                            ? 'bg-rose-950/40 border-rose-500/50 shadow-lg shadow-rose-950/40'
                            : isMeeting
                            ? 'bg-blue-950/40 border-blue-500/50 shadow-lg shadow-blue-950/40'
                            : isDeadline
                            ? 'bg-amber-950/40 border-amber-500/50 shadow-lg shadow-amber-950/40'
                            : 'bg-[#1e193d] border-primary-500/40 shadow-lg shadow-primary-950/30'
                          : 'bg-white/5 border-white/5 opacity-80 hover:opacity-100'
                      }`}
                    >
                      {!notif.read && (
                        <span className="absolute top-3 right-3 w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
                      )}

                      <div className="flex items-start gap-3">
                        <div className={`p-2.5 rounded-xl border shrink-0 ${
                          isMisconduct
                            ? 'bg-rose-950/60 text-rose-400 border-rose-500/40'
                            : isMeeting
                            ? 'bg-blue-950/60 text-blue-400 border-blue-500/40'
                            : isDeadline
                            ? 'bg-amber-950/60 text-amber-400 border-amber-500/40'
                            : 'bg-primary-950/60 text-primary-400 border-primary-500/40'
                        }`}>
                          {isMisconduct ? (
                            <ShieldAlert className="w-4 h-4" />
                          ) : isMeeting ? (
                            <Calendar className="w-4 h-4" />
                          ) : isDeadline ? (
                            <Clock className="w-4 h-4" />
                          ) : (
                            <Bell className="w-4 h-4" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center gap-2 mb-1">
                            <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${
                              isMisconduct
                                ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                : isMeeting
                                ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                : isDeadline
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                                : 'bg-primary-500/20 text-primary-300 border-primary-500/40'
                            }`}>
                              {notif.type}
                            </span>
                            {!notif.read && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMarkSystemAsRead(notif.id);
                                }}
                                className="text-[10px] text-primary-400 hover:text-white font-semibold ml-auto"
                              >
                                Mark Read
                              </button>
                            )}
                          </div>
                          <h4 className="font-bold text-white text-xs leading-tight">{notif.title}</h4>
                          <p className="text-xs text-slate-300 mt-1 leading-relaxed">{notif.message}</p>
                          <div className="mt-2 text-[10px] text-slate-500 font-medium">
                            {new Date(notif.createdAt).toLocaleDateString()} {new Date(notif.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Local Push Notifications List */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center justify-between">
              <span>Push Notification Feed</span>
              <span>{filteredNotifications.length} Items</span>
            </h3>

            {filteredNotifications.length > 0 ? (
              <div className="space-y-3">
                {filteredNotifications.map(notif => (
                  <div
                    key={notif.id}
                    onClick={() => handleMarkAsRead(notif.id)}
                    className={`p-4 rounded-2xl border transition-all relative cursor-pointer group ${
                      !notif.read 
                        ? 'bg-[#1e193d] border-primary-500/40 shadow-lg shadow-primary-950/30' 
                        : 'bg-white/5 border-white/5 opacity-80 hover:opacity-100'
                    }`}
                  >
                    {!notif.read && (
                      <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                    )}

                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-xl border shrink-0 ${
                        notif.type === 'OVERDUE_ALERT' 
                          ? 'bg-rose-950/40 text-rose-400 border-rose-500/30'
                          : notif.type === 'ASSIGNMENT_DUE'
                          ? 'bg-amber-950/40 text-amber-400 border-amber-500/30'
                          : 'bg-primary-950/40 text-primary-400 border-primary-500/30'
                      }`}>
                        {notif.type === 'OVERDUE_ALERT' ? (
                          <AlertTriangle className="w-4 h-4" />
                        ) : notif.type === 'ASSIGNMENT_DUE' ? (
                          <Clock className="w-4 h-4" />
                        ) : (
                          <Bell className="w-4 h-4" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0 pr-4">
                        <h4 className="font-bold text-white text-xs leading-tight">{notif.title}</h4>
                        <p className="text-xs text-slate-300 mt-1 leading-relaxed">{notif.body}</p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-500 font-medium">
                          <span>{new Date(notif.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          {notif.dueDate && (
                            <span className="text-primary-300">Target Due: {new Date(notif.dueDate).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 flex flex-col items-center justify-center text-slate-500 italic text-xs gap-2 border border-dashed border-white/5 rounded-2xl">
                <Bell className="w-8 h-8 opacity-20" />
                <p>No notifications match your current filter.</p>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-[#1a1635]/90 flex items-center justify-between text-xs text-slate-400">
          <span>ESYLAB Local Push Service</span>
          {onNavigateTab && (
            <button
              onClick={() => {
                onClose();
                onNavigateTab('announcements');
              }}
              className="text-primary-400 hover:text-primary-300 font-bold flex items-center gap-1"
            >
              View Curriculum Feed <ExternalLink className="w-3 h-3" />
            </button>
          )}
        </div>

      </div>
    </div>
  );
};
