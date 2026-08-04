import { LocalNotification, Assignment, User } from '../types';
import { db } from './database';

const NOTIFICATIONS_STORAGE_KEY = 'esylab_db_notifications';
const NOTIFIED_ALERT_KEYS = 'esylab_notified_alerts';

class NotificationService {
  /**
   * Get all local notifications for a user
   */
  getNotifications(userId?: string): LocalNotification[] {
    try {
      const data = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
      const all: LocalNotification[] = data ? JSON.parse(data) : [];
      if (!userId) return all;
      return all.filter(n => !n.userId || n.userId === userId)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    } catch {
      return [];
    }
  }

  /**
   * Save notifications array to storage
   */
  private saveNotifications(notifications: LocalNotification[]): void {
    try {
      localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
      window.dispatchEvent(new CustomEvent('esylab_notification_update'));
    } catch (e) {
      console.error('[NotificationService] Error saving notifications:', e);
    }
  }

  /**
   * Add a new notification
   */
  addNotification(notification: Omit<LocalNotification, 'id' | 'timestamp' | 'read'>): LocalNotification {
    const all = this.getNotifications();
    const newNotif: LocalNotification = {
      ...notification,
      id: db.generateId(),
      timestamp: new Date().toISOString(),
      read: false
    };

    all.unshift(newNotif);
    this.saveNotifications(all);

    // Trigger browser native push if granted
    this.sendNativePushNotification(newNotif.title, newNotif.body);

    return newNotif;
  }

  /**
   * Mark a notification as read
   */
  markAsRead(id: string): void {
    const all = this.getNotifications();
    const updated = all.map(n => n.id === id ? { ...n, read: true } : n);
    this.saveNotifications(updated);
  }

  /**
   * Mark all notifications as read for a user
   */
  markAllAsRead(userId?: string): void {
    const all = this.getNotifications();
    const updated = all.map(n => {
      if (!userId || !n.userId || n.userId === userId) {
        return { ...n, read: true };
      }
      return n;
    });
    this.saveNotifications(updated);
  }

  /**
   * Clear notifications for a user
   */
  clearAll(userId?: string): void {
    const all = this.getNotifications();
    if (!userId) {
      this.saveNotifications([]);
    } else {
      const remaining = all.filter(n => n.userId && n.userId !== userId);
      this.saveNotifications(remaining);
    }
  }

  /**
   * Request native browser notification permission
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      console.warn('[NotificationService] Web Notifications API is not supported by browser.');
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      return permission;
    } catch (e) {
      console.error('[NotificationService] Error requesting notification permission:', e);
      return 'denied';
    }
  }

  /**
   * Check current browser notification permission status
   */
  getPermissionStatus(): NotificationPermission | 'unsupported' {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      return 'unsupported';
    }
    return Notification.permission;
  }

  /**
   * Send a native Web Push Notification if granted
   */
  sendNativePushNotification(title: string, body: string, icon = '/favicon.ico') {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
      try {
        const notif = new Notification(title, {
          body,
          icon,
          tag: 'esylab-alert-' + Date.now()
        });
        notif.onclick = () => {
          window.focus();
        };
      } catch (err) {
        console.warn('[NotificationService] Browser push error:', err);
      }
    }
  }

  /**
   * Scan assignments and trigger deadline notifications for student or teacher
   */
  checkUpcomingDeadlines(user: User): void {
    if (!user) return;

    try {
      const assignments = db.getTable<Assignment>('esylab_db_assignments') || [];
      const notifiedSet = new Set<string>(JSON.parse(localStorage.getItem(NOTIFIED_ALERT_KEYS) || '[]'));

      const now = new Date();
      const userGrade = user.grade || 'Grade 10';

      assignments.forEach(assignment => {
        // Filter relevance: student grade or all grades
        if (assignment.gradeLevel && assignment.gradeLevel !== 'All Grades' && assignment.gradeLevel !== userGrade) {
          return;
        }

        const due = new Date(assignment.dueDate);
        const timeDiffMs = due.getTime() - now.getTime();
        const hoursDiff = timeDiffMs / (1000 * 60 * 60);

        // 1. OVERDUE ALERT (due date in past within 48h and not completed)
        if (hoursDiff < 0 && hoursDiff > -48) {
          const alertKey = `overdue-${assignment.id}-${user.id}`;
          if (!notifiedSet.has(alertKey)) {
            notifiedSet.add(alertKey);
            this.addNotification({
              userId: user.id,
              title: `⚠️ Overdue Assignment Alert: ${assignment.title}`,
              body: `The assignment for ${assignment.subject} was due on ${due.toLocaleDateString()} at ${due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Please submit as soon as possible.`,
              type: 'OVERDUE_ALERT',
              relatedId: assignment.id,
              dueDate: assignment.dueDate,
              priority: 'urgent'
            });
          }
        }
        // 2. URGENT DEADLINE (Due in less than 6 hours)
        else if (hoursDiff > 0 && hoursDiff <= 6) {
          const alertKey = `due6h-${assignment.id}-${user.id}`;
          if (!notifiedSet.has(alertKey)) {
            notifiedSet.add(alertKey);
            const formattedTime = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            this.addNotification({
              userId: user.id,
              title: `🔥 Urgent Deadline Alert: ${assignment.title}`,
              body: `Due in less than ${Math.ceil(hoursDiff)} hour(s) (${formattedTime}) for ${assignment.subject}. Don't miss the deadline!`,
              type: 'ASSIGNMENT_DUE',
              relatedId: assignment.id,
              dueDate: assignment.dueDate,
              priority: 'urgent'
            });
          }
        }
        // 3. UPCOMING DEADLINE (Due in less than 24 hours)
        else if (hoursDiff > 6 && hoursDiff <= 24) {
          const alertKey = `due24h-${assignment.id}-${user.id}`;
          if (!notifiedSet.has(alertKey)) {
            notifiedSet.add(alertKey);
            this.addNotification({
              userId: user.id,
              title: `⏰ Assignment Due Tomorrow: ${assignment.title}`,
              body: `${assignment.subject} assignment is due on ${due.toLocaleDateString()} at ${due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`,
              type: 'ASSIGNMENT_DUE',
              relatedId: assignment.id,
              dueDate: assignment.dueDate,
              priority: 'high'
            });
          }
        }
      });

      localStorage.setItem(NOTIFIED_ALERT_KEYS, JSON.stringify(Array.from(notifiedSet)));
    } catch (e) {
      console.error('[NotificationService] Error checking deadlines:', e);
    }
  }
}

export const notificationService = new NotificationService();
