import React, { useState, useEffect } from 'react';
import {
  Calendar, Clock, Plus, Edit3, Trash2, Search,
  Building2, UserCheck, Loader2, CheckCircle, XCircle,
  X, Save, Filter, BookOpen, GraduationCap, ShieldCheck
} from 'lucide-react';
import { User, UserRole, TimetableEntry } from '../types';
import { getTimetables, createTimetable, updateTimetable, deleteTimetable } from '../services/api';
import { db } from '../services/database';

interface TimetableViewProps {
  currentUser: User;
}

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const DEFAULT_PERIODS = [
  'Period 1 (08:00 - 08:45)',
  'Period 2 (08:50 - 09:35)',
  'Period 3 (09:40 - 10:00)',
  'Break (10:00 - 10:30)',
  'Period 4 (10:30 - 11:15)',
  'Period 5 (11:20 - 12:05)',
  'Period 6 (12:10 - 12:55)',
  'Lunch (13:00 - 14:00)',
  'Period 7 (14:00 - 14:45)',
  'Period 8 (14:50 - 15:35)',
];

// Color mapping helper for subjects
function getSubjectBadgeStyle(subject: string) {
  const subLower = (subject || '').toLowerCase();
  if (subLower.includes('math') || subLower.includes('calculus') || subLower.includes('algebra')) {
    return { bg: 'bg-purple-950/60', text: 'text-purple-300', border: 'border-purple-500/30', accent: 'bg-purple-500' };
  }
  if (subLower.includes('physic') || subLower.includes('chemist') || subLower.includes('biolog') || subLower.includes('sci')) {
    return { bg: 'bg-emerald-950/60', text: 'text-emerald-300', border: 'border-emerald-500/30', accent: 'bg-emerald-500' };
  }
  if (subLower.includes('eng') || subLower.includes('literat') || subLower.includes('lang')) {
    return { bg: 'bg-blue-950/60', text: 'text-blue-300', border: 'border-blue-500/30', accent: 'bg-blue-500' };
  }
  if (subLower.includes('comput') || subLower.includes('program') || subLower.includes('tech') || subLower.includes('it')) {
    return { bg: 'bg-cyan-950/60', text: 'text-cyan-300', border: 'border-cyan-500/30', accent: 'bg-cyan-500' };
  }
  if (subLower.includes('histor') || subLower.includes('geograph') || subLower.includes('social')) {
    return { bg: 'bg-amber-950/60', text: 'text-amber-300', border: 'border-amber-500/30', accent: 'bg-amber-500' };
  }
  return { bg: 'bg-primary-950/60', text: 'text-primary-300', border: 'border-primary-500/30', accent: 'bg-primary-500' };
}

export const TimetableView: React.FC<TimetableViewProps> = ({ currentUser }) => {
  const [timetables, setTimetables] = useState<TimetableEntry[]>([]);
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedClass, setSelectedClass] = useState<string>(
    currentUser.role === UserRole.STUDENT && currentUser.grade ? currentUser.grade : 'ALL'
  );
  const [searchQuery, setSearchQuery] = useState('');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<TimetableEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Form Fields
  const [formClassName, setFormClassName] = useState('');
  const [formDayOfWeek, setFormDayOfWeek] = useState('Monday');
  const [formPeriod, setFormPeriod] = useState(DEFAULT_PERIODS[0]);
  const [formSubject, setFormSubject] = useState('');
  const [formTeacherId, setFormTeacherId] = useState('');
  const [formRoom, setFormRoom] = useState('');

  const isAdmin = currentUser.role === UserRole.ADMIN;

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getTimetables();
      if (data.success && Array.isArray(data.timetables)) {
        setTimetables(data.timetables);
      }
    } catch (err: any) {
      console.error('[Timetable] Error fetching timetables:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // Fetch faculty list for selection
    try {
      const teacherList = db.getUsersByRole(UserRole.TEACHER);
      setTeachers(teacherList);
    } catch {}
  }, []);

  const handleOpenAddModal = (day?: string, period?: string) => {
    setEditingEntry(null);
    const existingClasses = Array.from(new Set(timetables.map(t => t.className).filter(Boolean))).sort();
    setFormClassName(selectedClass === 'ALL' ? (existingClasses[0] || '') : selectedClass);
    setFormDayOfWeek(day || 'Monday');
    setFormPeriod(period || DEFAULT_PERIODS[0]);
    setFormSubject('');
    setFormTeacherId(teachers.length > 0 ? teachers[0].id : '');
    setFormRoom('');
    setStatusMsg(null);
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (entry: TimetableEntry) => {
    setEditingEntry(entry);
    setFormClassName(entry.className);
    setFormDayOfWeek(entry.dayOfWeek);
    setFormPeriod(entry.period);
    setFormSubject(entry.subject);
    setFormTeacherId(entry.teacherId || '');
    setFormRoom(entry.room || '');
    setStatusMsg(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formClassName || !formDayOfWeek || !formPeriod || !formSubject) {
      setStatusMsg({ type: 'error', text: 'Please fill in all required fields.' });
      return;
    }

    setSaving(true);
    setStatusMsg(null);

    try {
      if (editingEntry) {
        // Update existing entry
        const res = await updateTimetable(editingEntry.id, {
          className: formClassName,
          dayOfWeek: formDayOfWeek,
          period: formPeriod,
          subject: formSubject,
          teacherId: formTeacherId,
          room: formRoom,
        });
        if (res.success) {
          setStatusMsg({ type: 'success', text: 'Timetable entry successfully updated!' });
          setTimeout(() => {
            setIsModalOpen(false);
            loadData();
          }, 800);
        } else {
          throw new Error(res.error || 'Failed to update entry');
        }
      } else {
        // Create new entry
        const res = await createTimetable({
          className: formClassName,
          dayOfWeek: formDayOfWeek,
          period: formPeriod,
          subject: formSubject,
          teacherId: formTeacherId,
          room: formRoom,
        });
        if (res.success) {
          setStatusMsg({ type: 'success', text: 'Timetable entry successfully created!' });
          setTimeout(() => {
            setIsModalOpen(false);
            loadData();
          }, 800);
        } else {
          throw new Error(res.error || 'Failed to create entry');
        }
      }
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Operation failed.' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to remove this period from the timetable?')) {
      return;
    }

    setDeletingId(id);
    try {
      const res = await deleteTimetable(id);
      if (res.success) {
        setTimetables(prev => prev.filter(t => t.id !== id));
      } else {
        alert(res.error || 'Failed to delete timetable entry');
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete entry');
    } finally {
      setDeletingId(null);
    }
  };

  // Filter timetables
  const filteredTimetables = timetables.filter(item => {
    const matchesClass = selectedClass === 'ALL' || item.className.toLowerCase() === selectedClass.toLowerCase();
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch = !query ||
      item.subject.toLowerCase().includes(query) ||
      item.className.toLowerCase().includes(query) ||
      (item.room && item.room.toLowerCase().includes(query)) ||
      (item.teacherName && item.teacherName.toLowerCase().includes(query));
    return matchesClass && matchesSearch;
  });

  // Extract all unique class names present in data
  const availableClasses = Array.from(new Set(
    timetables.map(t => t.className).filter(Boolean)
  )).sort();

  return (
    <div className="max-w-7xl mx-auto space-y-8 animate-in fade-in">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-card p-6 rounded-3xl border border-white/10">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2.5 bg-primary-950/60 rounded-xl border border-primary-500/30 text-primary-400">
              <Calendar className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white flex items-center gap-2">
                School Timetable
                {isAdmin && (
                  <span className="px-2.5 py-0.5 text-[10px] font-bold uppercase rounded-full bg-rose-950/60 text-rose-400 border border-rose-500/30">
                    Admin Manager
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-400">
                Weekly master schedule distribution for classes, faculty, and lecture halls.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && (
            <button
              onClick={() => handleOpenAddModal()}
              className="px-4 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 transition-all active:scale-95 shadow-lg shadow-primary-900/40"
            >
              <Plus className="w-4 h-4" />
              Create Period Entry
            </button>
          )}
        </div>
      </div>

      {/* Filter and Search Controls */}
      <div className="glass-card p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Class Filter Selector */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <span className="text-xs font-bold uppercase text-slate-400 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5 text-primary-400" /> Class:
          </span>
          <button
            onClick={() => setSelectedClass('ALL')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              selectedClass === 'ALL'
                ? 'bg-primary-600 text-white shadow-md shadow-primary-900/40'
                : 'bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
          >
            All Classes
          </button>
          {availableClasses.map(cls => (
            <button
              key={cls}
              onClick={() => setSelectedClass(cls)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
                selectedClass === cls
                  ? 'bg-primary-600 text-white shadow-md shadow-primary-900/40'
                  : 'bg-white/5 text-slate-400 hover:bg-white/10'
              }`}
            >
              {cls}
            </button>
          ))}
        </div>

        {/* Search Bar */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search subject, room, or teacher..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 outline-none focus:border-primary-500 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Timetable Weekly Grid */}
      {loading ? (
        <div className="glass-card p-12 rounded-3xl flex flex-col items-center justify-center text-slate-400 gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-primary-400" />
          <p className="text-sm">Loading timetable schedule...</p>
        </div>
      ) : (
        <div className="glass-card rounded-3xl overflow-hidden border border-white/10">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[900px]">
              {/* Grid Header: Days of Week */}
              <thead className="bg-white/5 border-b border-white/10">
                <tr>
                  <th className="p-4 w-44 text-xs font-bold uppercase tracking-wider text-slate-400 border-r border-white/5 bg-slate-950/40">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-primary-400" />
                      Time & Period
                    </div>
                  </th>
                  {DAYS_OF_WEEK.map(day => (
                    <th key={day} className="p-4 text-xs font-bold uppercase tracking-wider text-slate-200 border-r border-white/5 last:border-r-0">
                      <div className="flex items-center justify-between">
                        <span>{day}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-slate-400 font-normal">
                          {filteredTimetables.filter(t => t.dayOfWeek.toLowerCase() === day.toLowerCase()).length} Periods
                        </span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              {/* Grid Body: Periods as Rows */}
              <tbody className="divide-y divide-white/5 text-xs">
                {DEFAULT_PERIODS.map(periodStr => {
                  const isBreakOrLunch = periodStr.toLowerCase().includes('break') || periodStr.toLowerCase().includes('lunch');

                  if (isBreakOrLunch) {
                    return (
                      <tr key={periodStr} className="bg-slate-900/80 border-y border-slate-700/60 select-none">
                        <td className="p-3 font-bold text-slate-400 bg-slate-950/80 border-r border-slate-700/60">
                          <div className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5 text-slate-500" />
                            {periodStr}
                          </div>
                        </td>
                        <td colSpan={5} className="p-3.5 text-center text-slate-400 font-bold tracking-widest uppercase text-xs bg-slate-900/50">
                          <div className="flex items-center justify-center gap-2">
                            <ShieldCheck className="w-4 h-4 text-slate-500" />
                            <span>{periodStr.toUpperCase()} — FIXED NON-SCHEDULABLE SLOT (LOCKED)</span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={periodStr} className="hover:bg-white/[0.02] transition-colors">
                      {/* Period Header Column */}
                      <td className="p-4 font-semibold text-slate-300 border-r border-white/5 bg-slate-950/20 align-top">
                        <div className="space-y-1">
                          <span className="font-bold text-white block">{periodStr.split(' ')[0]} {periodStr.split(' ')[1]}</span>
                          <span className="text-[10px] text-slate-400 font-mono block">
                            {periodStr.includes('(') ? periodStr.substring(periodStr.indexOf('(')) : ''}
                          </span>
                        </div>
                      </td>

                      {/* Day Columns */}
                      {DAYS_OF_WEEK.map(day => {
                        const cellEntries = filteredTimetables.filter(
                          t => t.dayOfWeek.toLowerCase() === day.toLowerCase() &&
                               t.period.toLowerCase().startsWith(periodStr.split(' ')[0].toLowerCase())
                        );

                        return (
                          <td
                            key={day}
                            className="p-2 border-r border-white/5 last:border-r-0 align-top min-w-[150px] relative group"
                          >
                            {cellEntries.length > 0 ? (
                              <div className="space-y-2">
                                {cellEntries.map(entry => {
                                  const style = getSubjectBadgeStyle(entry.subject);
                                  return (
                                    <div
                                      key={entry.id}
                                      className={`p-3 rounded-2xl border ${style.bg} ${style.border} transition-all hover:scale-[1.02] relative group/card shadow-md`}
                                    >
                                      {/* Accent bar */}
                                      <div className={`w-1 h-full absolute left-0 top-0 rounded-l-2xl ${style.accent}`} />

                                      <div className="pl-1.5 pr-1 space-y-1">
                                        <div className="flex items-start justify-between gap-1">
                                          <span className={`font-bold text-sm ${style.text} leading-tight block`}>
                                            {entry.subject}
                                          </span>
                                          {isAdmin && (
                                            <div className="flex items-center gap-1 opacity-0 group-hover/card:opacity-100 transition-opacity">
                                              <button
                                                onClick={() => handleOpenEditModal(entry)}
                                                className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-colors"
                                                title="Edit Entry"
                                              >
                                                <Edit3 className="w-3 h-3" />
                                              </button>
                                              <button
                                                onClick={e => handleDelete(entry.id, e)}
                                                disabled={deletingId === entry.id}
                                                className="p-1 text-rose-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg transition-colors"
                                                title="Delete Entry"
                                              >
                                                {deletingId === entry.id ? (
                                                  <Loader2 className="w-3 h-3 animate-spin" />
                                                ) : (
                                                  <Trash2 className="w-3 h-3" />
                                                )}
                                              </button>
                                            </div>
                                          )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px]">
                                          <span className="px-1.5 py-0.5 rounded-md bg-white/10 font-bold text-slate-200">
                                            {entry.className}
                                          </span>

                                          {entry.room && (
                                            <span className="flex items-center gap-1 text-slate-300 font-mono">
                                              <Building2 className="w-3 h-3 text-slate-400" />
                                              {entry.room}
                                            </span>
                                          )}
                                        </div>

                                        {entry.teacherName && (
                                          <div className="flex items-center gap-1 text-[10px] text-slate-400 pt-1 border-t border-white/5 mt-1">
                                            <UserCheck className="w-3 h-3 text-primary-400" />
                                            <span className="truncate">{entry.teacherName}</span>
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <div className="h-full min-h-[64px] flex flex-col items-center justify-center rounded-xl border border-dashed border-white/5 hover:border-white/20 transition-all group/empty">
                                {isAdmin ? (
                                  <button
                                    onClick={() => handleOpenAddModal(day, periodStr)}
                                    className="opacity-0 group-hover/empty:opacity-100 flex items-center gap-1 text-[10px] font-bold text-primary-400 hover:text-primary-300 px-2 py-1 bg-primary-950/40 rounded-lg border border-primary-500/20 transition-all"
                                  >
                                    <Plus className="w-3 h-3" /> Add lesson
                                  </button>
                                ) : (
                                  <span className="text-[10px] text-slate-500 italic">No lesson yet</span>
                                )}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Admin Create / Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in">
          <div className="glass-card max-w-lg w-full p-6 rounded-3xl border border-white/15 shadow-2xl relative space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-primary-950/60 rounded-xl border border-primary-500/30 text-primary-400">
                  <Calendar className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-lg">
                    {editingEntry ? 'Edit Timetable Entry' : 'Create New Timetable Entry'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingEntry ? 'Modify timetable parameters' : 'Schedule a period for a class'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {statusMsg && (
              <div
                className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${
                  statusMsg.type === 'success'
                    ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-950/60 text-rose-300 border border-rose-500/30'
                }`}
              >
                {statusMsg.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                {statusMsg.text}
              </div>
            )}

            <form onSubmit={handleSave} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-4">
                {/* Class Name */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Target Class *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Grade 10A"
                    value={formClassName}
                    onChange={e => setFormClassName(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                {/* Day of Week */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Day of Week *
                  </label>
                  <select
                    value={formDayOfWeek}
                    onChange={e => setFormDayOfWeek(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  >
                    {DAYS_OF_WEEK.map(d => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Period */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Period Slot *
                  </label>
                  <select
                    value={formPeriod}
                    onChange={e => setFormPeriod(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  >
                    {DEFAULT_PERIODS.filter(p => !p.toLowerCase().includes('break') && !p.toLowerCase().includes('lunch')).map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Subject */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Subject *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Mathematics"
                    value={formSubject}
                    onChange={e => setFormSubject(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Room */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Room / Lab
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Room 101 or Lab 2"
                    value={formRoom}
                    onChange={e => setFormRoom(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  />
                </div>

                {/* Assigned Teacher */}
                <div className="space-y-1">
                  <label className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Assigned Faculty
                  </label>
                  <select
                    value={formTeacherId}
                    onChange={e => setFormTeacherId(e.target.value)}
                    className="w-full px-3 py-2.5 bg-slate-900 border border-white/10 rounded-xl text-white outline-none focus:border-primary-500 transition-all"
                  >
                    <option value="">Unassigned</option>
                    {teachers.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.email})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-white/10 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white font-bold rounded-xl flex items-center gap-2 transition-all active:scale-95 disabled:opacity-50 shadow-lg shadow-primary-900/40"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  {editingEntry ? 'Update Entry' : 'Save Entry'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
