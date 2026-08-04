import React, { useState } from 'react';
import { Bell, Calendar, ShieldAlert, Send, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { User, UserRole } from '../types';
import { db } from '../services/database';
import { createSystemNotification } from '../services/api';

interface NotificationSendFormProps {
  currentUser: User;
  onSuccess?: () => void;
}

export const NotificationSendForm: React.FC<NotificationSendFormProps> = ({ currentUser, onSuccess }) => {
  const [type, setType] = useState<'meeting' | 'misconduct'>('meeting');
  const [targetMode, setTargetMode] = useState<'class' | 'user'>('class');
  
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const teacherClass = currentUser.grade || currentUser.teachingClasses?.[0] || 'Grade 10';

  const [selectedClass, setSelectedClass] = useState<string>(isAdmin ? 'Grade 10' : teacherClass);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [title, setTitle] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Users filterable for targeting
  const allUsers = db.getTable<User>(db.tables.USERS) || [];
  const eligibleUsers = isAdmin
    ? allUsers.filter(u => u.id !== currentUser.id)
    : allUsers.filter(u => u.role === UserRole.STUDENT && (u.grade === teacherClass || u.gradeLevel === teacherClass));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      setStatusMsg({ type: 'error', text: 'Please fill in both title and message.' });
      return;
    }

    if (targetMode === 'user' && !selectedUserId) {
      setStatusMsg({ type: 'error', text: 'Please select a recipient.' });
      return;
    }

    setLoading(true);
    setStatusMsg(null);

    try {
      await createSystemNotification({
        type,
        title: title.trim(),
        message: message.trim(),
        className: targetMode === 'class' ? selectedClass : undefined,
        recipientId: targetMode === 'user' ? selectedUserId : undefined,
      });

      setStatusMsg({ type: 'success', text: `Notification alert dispatched successfully!` });
      setTitle('');
      setMessage('');
      
      // Dispatch update event for header bell icon
      window.dispatchEvent(new Event('esylab_notification_update'));
      
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to dispatch notification alert.' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass-card p-6 rounded-2xl border border-white/5 space-y-5 animate-in fade-in">
      <div className="flex items-center justify-between border-b border-white/5 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-primary-600/20 text-primary-400 rounded-xl border border-primary-500/30">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-white text-base leading-tight">Send System Notification Alert</h3>
            <p className="text-xs text-slate-400">
              {isAdmin ? 'Broadcast meeting & misconduct alerts to any class or specific user.' : `Dispatch alerts to your class (${teacherClass}) or individual students.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 bg-white/5 p-1 rounded-xl border border-white/5">
          <button
            type="button"
            onClick={() => setType('meeting')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              type === 'meeting' ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5" /> Meeting Alert
          </button>
          <button
            type="button"
            onClick={() => setType('misconduct')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              type === 'misconduct' ? 'bg-rose-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" /> Misconduct Alert
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
          statusMsg.type === 'success' ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300' : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
        }`}>
          {statusMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Recipient Scope Target */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
              Target Scope
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTargetMode('class')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  targetMode === 'class' ? 'bg-primary-600/30 border-primary-500 text-primary-200' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                Entire Class
              </button>
              <button
                type="button"
                onClick={() => setTargetMode('user')}
                className={`py-2 px-3 rounded-xl text-xs font-bold border transition-all cursor-pointer ${
                  targetMode === 'user' ? 'bg-primary-600/30 border-primary-500 text-primary-200' : 'bg-white/5 border-white/5 text-slate-400 hover:bg-white/10'
                }`}
              >
                Specific Recipient
              </button>
            </div>
          </div>

          <div>
            {targetMode === 'class' ? (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Target Class
                </label>
                {isAdmin ? (
                  <select
                    value={selectedClass}
                    onChange={e => setSelectedClass(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500 cursor-pointer"
                  >
                    <option value="Grade 9">Grade 9</option>
                    <option value="Grade 10">Grade 10</option>
                    <option value="Grade 11">Grade 11</option>
                    <option value="Grade 12">Grade 12</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    disabled
                    value={teacherClass}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-xs text-slate-400 cursor-not-allowed"
                  />
                )}
              </div>
            ) : (
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                  Select Recipient
                </label>
                <select
                  value={selectedUserId}
                  onChange={e => setSelectedUserId(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500 cursor-pointer"
                >
                  <option value="">-- Choose User --</option>
                  {eligibleUsers.map(u => (
                    <option key={u.id} value={u.id}>
                      {u.name} ({u.role}{u.grade ? ` - ${u.grade}` : ''})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            Alert Title
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={type === 'meeting' ? 'e.g. Parent-Teacher Progress Review' : 'e.g. Disciplinary Warning - Lab Safety Violation'}
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Message */}
        <div>
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
            Alert Details / Message
          </label>
          <textarea
            required
            rows={3}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Describe the details, time/location for meetings, or incident report for misconduct..."
            className="w-full bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-primary-500"
          />
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          className={`w-full py-2.5 rounded-xl font-bold text-xs text-white shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
            type === 'meeting' ? 'bg-blue-600 hover:bg-blue-500 shadow-blue-950/50' : 'bg-rose-600 hover:bg-rose-500 shadow-rose-950/50'
          }`}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          Dispatch {type === 'meeting' ? 'Meeting Alert' : 'Misconduct Warning'}
        </button>
      </form>
    </div>
  );
};
