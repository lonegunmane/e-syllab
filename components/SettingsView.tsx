import React, { useState, useEffect } from 'react';
import { 
  User as UserIcon, Mail, Phone, School, Home, Save, 
  Loader2, Lock, Sun, Moon, Bell, Info, ShieldCheck, CheckCircle2,
  Calendar, AlertTriangle, MessageSquare, Check, Sparkles, Smartphone,
  Layers, ChevronDown, ChevronUp, Code2, WifiOff, FileCheck, Shield,
  FileText, Trash2, LogOut, Upload, Laptop, Globe, Key, AlertCircle,
  GraduationCap, BookOpen, Hash, Download, MapPin, Crosshair, Navigation,
  Pencil
} from 'lucide-react';
import { User, UserRole, UserSession, SchoolLocationConfig } from '../types';
import { db } from '../services/database';
import { 
  getSavedTheme, applyTheme, ThemeMode,
  getNotificationPreferences, saveNotificationPreferences, NotificationPreferences
} from '../services/settingsService';
import { getSessions, revokeSession, deleteAccount, clearToken, exportPersonalData, getSchoolLocation, updateSchoolLocation } from '../services/api';
import { downloadTermsPdf } from '../services/termsPdfHelper';
import { normalizeGradeToForm } from '../services/formLabels';

interface SettingsViewProps {
  user: User;
  onUpdateUser: (user: User) => void;
  onLogout?: () => void;
}

type SettingsSection = 
  | 'profile' 
  | 'display' 
  | 'notifications' 
  | 'devices' 
  | 'location'
  | 'terms' 
  | 'privacy' 
  | 'about';

// Preloaded illustrated portrait avatars (friendly drawn Bitmoji/Snapchat style portraits)
const PRELOADED_AVATARS = [
  { id: 'av-1', name: 'Kondwani', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Kondwani' },
  { id: 'av-2', name: 'Chipo',    url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Chipo' },
  { id: 'av-3', name: 'Mutale',   url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Mutale' },
  { id: 'av-4', name: 'Bwalya',   url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Bwalya' },
  { id: 'av-5', name: 'Thandiwe', url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Thandiwe' },
  { id: 'av-6', name: 'Mapalo',   url: 'https://api.dicebear.com/7.x/adventurer/svg?seed=Mapalo' },
];

export const SettingsView: React.FC<SettingsViewProps> = ({ user, onUpdateUser, onLogout }) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('profile');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // ── Profile Form State ──────────────────────────────────────────────────────
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [formData, setFormData] = useState({
    name: user.name || '',
    contact: user.contact || '',
    gender: (user.gender === 'Female' ? 'Female' : 'Male') as 'Male' | 'Female',
    residentialAddress: user.residentialAddress || '',
  });

  // Avatar editing state inside Profile section
  const [selectedAvatar, setSelectedAvatar] = useState<string>(user.avatar || PRELOADED_AVATARS[0].url);
  const [customAvatarPreview, setCustomAvatarPreview] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Display / Theme State ───────────────────────────────────────────────────
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(getSavedTheme());

  // ── Notifications State ────────────────────────────────────────────────────
  const [notifPrefs, setNotifPrefs] = useState<NotificationPreferences>(() => getNotificationPreferences(user.id));
  const [notifSavedBanner, setNotifSavedBanner] = useState(false);

  // ── Connected Devices / Sessions State ─────────────────────────────────────
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(false);
  const [revokingSessionId, setRevokingSessionId] = useState<string | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  // ── Delete Account State ───────────────────────────────────────────────────
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── Data Export State (Data Protection Act 2021) ──────────────────────────
  const [isExportingData, setIsExportingData] = useState(false);
  const [exportSuccessMessage, setExportSuccessMessage] = useState<string | null>(null);
  const [exportErrorMessage, setExportErrorMessage] = useState<string | null>(null);

  // ── Terms PDF Download State ───────────────────────────────────────────────
  const [isDownloadingTerms, setIsDownloadingTerms] = useState(false);
  const [termsDownloadSuccess, setTermsDownloadSuccess] = useState(false);

  // ── School Location & Geofence State (Admin Only) ─────────────────────────
  const [schoolLocation, setSchoolLocation] = useState<SchoolLocationConfig>({
    latitude: -15.3875,
    longitude: 28.3228,
    radiusMeters: 150,
  });
  const [isLoadingLocation, setIsLoadingLocation] = useState(false);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [isDetectingGPS, setIsDetectingGPS] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Keep form data synchronized if user prop changes
  useEffect(() => {
    setFormData({
      name: user.name || '',
      contact: user.contact || '',
      gender: (user.gender === 'Female' ? 'Female' : 'Male'),
      residentialAddress: user.residentialAddress || '',
    });
    setSelectedAvatar(user.avatar || PRELOADED_AVATARS[0].url);
  }, [user]);

  // Sync notification preferences when user changes
  useEffect(() => {
    setNotifPrefs(getNotificationPreferences(user.id));
  }, [user.id]);

  // Load Sessions when navigating to 'devices' section
  useEffect(() => {
    if (activeSection === 'devices') {
      loadSessions();
    }
  }, [activeSection]);

  // Load School Location when navigating to 'location' section or on mount for Admin
  useEffect(() => {
    if (activeSection === 'location' && user.role === UserRole.ADMIN) {
      loadSchoolLocation();
    }
  }, [activeSection, user.role]);

  const loadSchoolLocation = async () => {
    setIsLoadingLocation(true);
    setLocationFeedback(null);
    try {
      const res = await getSchoolLocation();
      if (res.success && res.location) {
        setSchoolLocation({
          latitude: Number(res.location.latitude) || -15.3875,
          longitude: Number(res.location.longitude) || 28.3228,
          radiusMeters: Number(res.location.radiusMeters) || 150,
        });
      }
    } catch (err: any) {
      console.warn('[SettingsView] Unable to fetch school location:', err);
    } finally {
      setIsLoadingLocation(false);
    }
  };

  const handleSaveSchoolLocation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingLocation(true);
    setLocationFeedback(null);
    try {
      const res = await updateSchoolLocation(schoolLocation);
      if (res.success) {
        setLocationFeedback({
          type: 'success',
          text: 'School location and geofence radius saved successfully.',
        });
      } else {
        setLocationFeedback({
          type: 'error',
          text: 'Failed to update school location.',
        });
      }
    } catch (err: any) {
      setLocationFeedback({
        type: 'error',
        text: err.message || 'Error saving school location.',
      });
    } finally {
      setIsSavingLocation(false);
    }
  };

  const handleDetectCampusGPS = () => {
    if (!navigator.geolocation) {
      setLocationFeedback({
        type: 'error',
        text: 'Geolocation is not supported by your browser.',
      });
      return;
    }
    setIsDetectingGPS(true);
    setLocationFeedback(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setSchoolLocation(prev => ({
          ...prev,
          latitude: Math.round(pos.coords.latitude * 1000000) / 1000000,
          longitude: Math.round(pos.coords.longitude * 1000000) / 1000000,
        }));
        setLocationFeedback({
          type: 'success',
          text: `Acquired device GPS coordinates (Accuracy: ±${Math.round(pos.coords.accuracy)}m). Click "Save Location" to apply.`,
        });
        setIsDetectingGPS(false);
      },
      (err) => {
        setIsDetectingGPS(false);
        setLocationFeedback({
          type: 'error',
          text: `Could not retrieve GPS coordinates: ${err.message}`,
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  const loadSessions = async () => {
    setIsLoadingSessions(true);
    setSessionsError(null);
    try {
      const res = await getSessions();
      if (res.success && Array.isArray(res.sessions)) {
        setSessions(res.sessions);
      } else {
        fallbackLocalSession();
      }
    } catch (err: any) {
      console.warn('[SettingsView] Unable to fetch online sessions, using local session:', err);
      fallbackLocalSession();
    } finally {
      setIsLoadingSessions(false);
    }
  };

  const fallbackLocalSession = () => {
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : 'Current Browser';
    let deviceName = 'Desktop Web Browser';
    if (/mobile|android|iphone|ipad/i.test(userAgent)) {
      deviceName = /iphone/i.test(userAgent) ? 'iPhone (Mobile Safari)' : 'Mobile Browser';
    } else if (/mac/i.test(userAgent)) {
      deviceName = 'Mac (Desktop)';
    } else if (/win/i.test(userAgent)) {
      deviceName = 'Windows PC (Desktop)';
    }

    setSessions([
      {
        id: 'local-current-session',
        userId: user.id,
        deviceInfo: deviceName,
        ipAddress: '127.0.0.1 (Local)',
        loginAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        isCurrent: true
      }
    ]);
  };

  const handleRevokeSession = async (sessionId: string, isCurrent: boolean) => {
    if (sessionId === 'local-current-session') {
      if (window.confirm('Are you sure you want to log out of this device?')) {
        handleTriggerLogout();
      }
      return;
    }

    const confirmMsg = isCurrent 
      ? 'Logging out this device will end your current session and require you to sign in again. Continue?'
      : 'Are you sure you want to log out this connected device?';

    if (!window.confirm(confirmMsg)) return;

    setRevokingSessionId(sessionId);
    try {
      await revokeSession(sessionId);
      if (isCurrent) {
        handleTriggerLogout();
      } else {
        setSessions(prev => prev.filter(s => s.id !== sessionId));
      }
    } catch (err: any) {
      alert(err.message || 'Could not log out device.');
    } finally {
      setRevokingSessionId(null);
    }
  };

  // Handle Profile Input Change
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  // Handle Custom Avatar File Upload
  const handleCustomAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isEditingProfile) return;
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      setProfileMessage({ type: 'error', text: 'Image file size must be under 5MB.' });
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      setCustomAvatarPreview(dataUrl);
      setSelectedAvatar(dataUrl);
      setProfileMessage({ type: 'success', text: 'Custom picture selected! Click "Save Changes" below to apply.' });
    };
    reader.readAsDataURL(file);
  };

  // Handle Avatar Selection from Preloaded Grid
  const handleSelectPreloadedAvatar = (avatarUrl: string) => {
    if (!isEditingProfile) return;
    setCustomAvatarPreview(null);
    setSelectedAvatar(avatarUrl);
  };

  // Cancel Profile Editing and restore original values
  const handleCancelEdit = () => {
    setFormData({
      name: user.name || '',
      contact: user.contact || '',
      gender: (user.gender === 'Female' ? 'Female' : 'Male'),
      residentialAddress: user.residentialAddress || '',
    });
    setSelectedAvatar(user.avatar || PRELOADED_AVATARS[0].url);
    setCustomAvatarPreview(null);
    setIsEditingProfile(false);
    setProfileMessage(null);
  };

  // Handle Profile Form Submit
  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isEditingProfile) return;
    setIsSavingProfile(true);
    setProfileMessage(null);

    try {
      await new Promise(resolve => setTimeout(resolve, 400));
      
      const updatedUser = db.updateUserProfile(user.id, {
        name: formData.name.trim(),
        contact: formData.contact.trim(),
        gender: formData.gender,
        residentialAddress: formData.residentialAddress.trim(),
        avatar: selectedAvatar,
      });

      if (updatedUser) {
        onUpdateUser(updatedUser);
        setIsEditingProfile(false);
        setCustomAvatarPreview(null);
        setProfileMessage({ 
          type: 'success', 
          text: 'Profile and avatar updated successfully!' 
        });
        setTimeout(() => {
          setProfileMessage(null);
        }, 4000);
      } else {
        throw new Error('Could not find user profile to update.');
      }
    } catch (err: any) {
      setProfileMessage({ 
        type: 'error', 
        text: err?.message || 'Failed to save changes. Please try again.' 
      });
    } finally {
      setIsSavingProfile(false);
    }
  };

  // Handle Theme Change
  const handleThemeChange = (newTheme: ThemeMode) => {
    setCurrentTheme(newTheme);
    applyTheme(newTheme);
  };

  // Handle Personal Data Export (Zambia Data Protection Act No. 3 of 2021)
  const handleExportData = async () => {
    setIsExportingData(true);
    setExportSuccessMessage(null);
    setExportErrorMessage(null);
    try {
      const { blob, filename } = await exportPersonalData();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      setExportSuccessMessage("Personal data archive downloaded successfully! This file contains your profile, grades, attendance logs, messages, and assessment scores.");
      setTimeout(() => setExportSuccessMessage(null), 8000);
    } catch (err: any) {
      setExportErrorMessage(err.message || "Failed to export personal data. Please try again.");
    } finally {
      setIsExportingData(false);
    }
  };

  // Handle Terms of Use PDF Download (Chinsali Girls Secondary School)
  const handleDownloadTermsPdf = async () => {
    setIsDownloadingTerms(true);
    try {
      await downloadTermsPdf();
      setTermsDownloadSuccess(true);
      setTimeout(() => setTermsDownloadSuccess(false), 5000);
    } catch (err: any) {
      console.error('Failed to download terms PDF:', err);
      alert('Could not download terms PDF. Please try again.');
    } finally {
      setIsDownloadingTerms(false);
    }
  };

  // Handle Notification Toggle
  const handleToggleNotif = (key: keyof NotificationPreferences) => {
    const updated = {
      ...notifPrefs,
      [key]: !notifPrefs[key],
    };
    setNotifPrefs(updated);
    saveNotificationPreferences(user.id, updated);
    setNotifSavedBanner(true);
    setTimeout(() => setNotifSavedBanner(false), 2200);
  };

  // Handle Account Deletion
  const handleDeleteAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!deletePassword) {
      setDeleteError('Please enter your account password to confirm deletion.');
      return;
    }

    setIsDeletingAccount(true);
    setDeleteError(null);

    try {
      const res = await deleteAccount(deletePassword);
      if (res.success) {
        setIsDeleteModalOpen(false);
        alert('Your account has been deleted successfully. You will now be redirected to the sign-in page.');
        handleTriggerLogout();
      } else {
        throw new Error(res.error || 'Failed to delete account.');
      }
    } catch (err: any) {
      setDeleteError(err?.message || 'Failed to delete account. Please verify your password.');
    } finally {
      setIsDeletingAccount(false);
    }
  };

  // Logout Trigger Helper
  const handleTriggerLogout = () => {
    if (onLogout) {
      onLogout();
    } else {
      clearToken();
      localStorage.removeItem('esylab_session');
      localStorage.removeItem('user');
      window.location.reload();
    }
  };

  // Navigation Items
  const navItems: { id: SettingsSection; label: string; icon: React.ElementType; description: string }[] = [
    { id: 'profile', label: 'Profile', icon: UserIcon, description: 'Personal info & avatar' },
    { id: 'display', label: 'Display', icon: currentTheme === 'dark' ? Moon : Sun, description: 'Light & Dark theme' },
    { id: 'notifications', label: 'Notifications', icon: Bell, description: 'Alerts & reminders' },
    { id: 'devices', label: 'Connected Devices', icon: Smartphone, description: 'Places you are signed in' },
    ...(user.role === UserRole.ADMIN ? [
      { id: 'location' as SettingsSection, label: 'School Location', icon: MapPin, description: 'Campus geofence & GPS' },
    ] : []),
    { id: 'terms', label: 'Terms of Use', icon: FileText, description: 'Platform guidelines' },
    { id: 'privacy', label: 'Privacy Policy', icon: Shield, description: 'Data Protection Act 2021' },
    { id: 'about', label: 'About', icon: Info, description: 'App & system details' },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-3 animate-in fade-in pb-4">
      
      {/* Header Banner - Compact layout */}
      <div className="glass-card px-4 py-2.5 md:px-5 md:py-3 rounded-2xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="px-2 py-0.5 bg-primary-600/20 text-primary-300 border border-primary-500/30 rounded-full text-[10px] font-bold uppercase tracking-wider">
                Settings
              </span>
              <span className="text-xs text-slate-400">
                Signed in as <strong className="text-white capitalize">{user.name}</strong> ({user.role})
              </span>
            </div>
            <h1 className="text-lg md:text-xl font-extrabold text-white tracking-tight">
              Settings &amp; Preferences
            </h1>
          </div>

          <div className="flex items-center gap-2.5 text-xs">
            <div className="px-3 py-1 bg-white/5 rounded-xl border border-white/10 flex items-center gap-2 text-slate-300">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="font-semibold text-white">Chinsali Girls Secondary School</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Settings Layout: Left Navigation + Right Content */}
      <div className="flex flex-col md:flex-row gap-3 md:gap-4 items-start">
        
        {/* Left-Side Navigation Sidebar */}
        <aside className="w-full md:w-52 lg:w-56 md:shrink-0 space-y-2">
          <div className="glass-card p-1.5 md:p-2 rounded-2xl space-y-0.5">
            <div className="px-2.5 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden md:block">
              Navigation
            </div>
            <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0">
              {navItems.map(item => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveSection(item.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-bold text-xs md:text-sm text-left transition-all whitespace-nowrap md:whitespace-normal cursor-pointer ${
                      isActive
                        ? 'bg-primary-600 text-white shadow-md shadow-primary-900/40'
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-primary-400'}`} />
                    <div className="min-w-0">
                      <p className="leading-tight text-xs font-semibold">{item.label}</p>
                    </div>
                  </button>
                );
              })}

              {/* Log Out Button in Settings Sidebar */}
              <div className="pt-1.5 border-t border-white/5 mt-0.5">
                <button
                  onClick={() => {
                    if (window.confirm('Are you sure you want to sign out of your account?')) {
                      handleTriggerLogout();
                    }
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl font-bold text-xs md:text-sm text-left text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-all cursor-pointer group"
                >
                  <LogOut className="w-4 h-4 shrink-0 text-slate-500 group-hover:text-rose-400" />
                  <div className="min-w-0">
                    <p className="leading-tight text-xs font-semibold">Log Out</p>
                  </div>
                </button>
              </div>

            </div>
          </div>
        </aside>

        {/* Right-Side Section Content */}
        <main className="flex-1 min-w-0 w-full space-y-3">

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 1: PROFILE
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'profile' && (
            <div className="space-y-3 animate-in fade-in">
              
              {/* Unified Profile & Institutional Account Details Card */}
              <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 rounded-xl bg-primary-600/20 text-primary-400 border border-primary-500/30">
                      <UserIcon className="w-4 h-4" />
                    </div>
                    <div>
                      <h2 className="text-base font-bold text-white flex items-center gap-2">
                        Personal Profile &amp; Account Details
                      </h2>
                      <p className="text-xs text-slate-400">
                        Manage your profile and view your school details.
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-full text-[11px] font-bold flex items-center gap-1.5 self-start sm:self-auto">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Account
                  </span>
                </div>

                {/* Status Message Alert */}
                {profileMessage && (
                  <div className={`p-2.5 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-1 border ${
                    profileMessage.type === 'success'
                      ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30'
                      : 'bg-rose-950/40 text-rose-300 border-rose-500/30'
                  }`}>
                    {profileMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    )}
                    <span>{profileMessage.text}</span>
                  </div>
                )}

                {/* Avatar Selection Section */}
                <div className="p-3 bg-white/[0.03] border border-white/5 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-bold text-primary-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5" /> Avatar Selection
                      {!isEditingProfile && <span className="text-[9px] font-normal text-slate-500 normal-case">(Locked — click Edit to change)</span>}
                    </label>
                    <label className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold transition-all duration-200 ${
                      !isEditingProfile
                        ? 'bg-white/5 text-slate-500 border border-white/5 cursor-not-allowed opacity-50 pointer-events-none'
                        : 'bg-primary-600/20 hover:bg-primary-600/30 text-primary-300 border border-primary-500/40 cursor-pointer hover:scale-105 active:scale-95'
                    }`}>
                      <Upload className="w-3 h-3" />
                      <span>Upload Photo</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={!isEditingProfile}
                        onChange={handleCustomAvatarUpload}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Preloaded Avatars 6-item Grid */}
                  <div className="grid grid-cols-6 gap-2">
                    {PRELOADED_AVATARS.map((av) => {
                      const isSelected = selectedAvatar === av.url;
                      return (
                        <button
                          key={av.id}
                          type="button"
                          disabled={!isEditingProfile}
                          onClick={() => handleSelectPreloadedAvatar(av.url)}
                          className={`p-1.5 rounded-xl border transition-all duration-200 flex flex-col items-center gap-1 relative group ${
                            isSelected
                              ? 'border-primary-500 bg-primary-950/60 ring-2 ring-primary-500/40 scale-105'
                              : !isEditingProfile
                                ? 'border-white/5 bg-white/[0.02] opacity-50 cursor-not-allowed'
                                : 'border-white/10 bg-white/5 hover:border-primary-500/40 hover:bg-white/10 cursor-pointer'
                          } ${!isEditingProfile && isSelected ? 'opacity-100 cursor-default' : ''}`}
                        >
                          <img
                            src={av.url}
                            alt={av.name}
                            className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg object-cover bg-slate-900/60"
                          />
                          <span className={`text-[9px] font-medium truncate max-w-full ${isSelected ? 'text-primary-300 font-bold' : 'text-slate-400'}`}>
                            {av.name}
                          </span>
                          {isSelected && (
                            <div className="absolute -top-1 -right-1 w-4 h-4 bg-primary-600 text-white rounded-full flex items-center justify-center shadow-md ring-1 ring-slate-900">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>

                  {customAvatarPreview && (
                    <div className="flex items-center gap-2 p-2 bg-primary-950/30 border border-primary-500/30 rounded-lg text-xs text-primary-300 animate-in fade-in">
                      <img src={customAvatarPreview} alt="Custom Preview" className="w-6 h-6 rounded-md object-cover border border-primary-500" />
                      <span>Custom picture selected. Click &quot;Save Changes&quot; to apply.</span>
                    </div>
                  )}
                </div>

                {/* Form: 2-column layout (Editable Info on Left, Read-only Institutional Credentials on Right) */}
                <form onSubmit={handleProfileSubmit} className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    
                    {/* Left Column: Personal Fields (Locked until Edit is clicked) */}
                    <div className="space-y-2.5">
                      <div>
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                            <UserIcon className="w-3 h-3 text-primary-400" /> Full Name
                          </label>
                          {!isEditingProfile && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                        </div>
                        <input
                          type="text"
                          name="name"
                          required
                          disabled={!isEditingProfile}
                          value={formData.name}
                          onChange={handleInputChange}
                          placeholder="e.g. Kondwani Phiri"
                          className={`w-full px-3 py-1.5 rounded-xl text-xs outline-none transition-all placeholder:text-slate-600 ${
                            !isEditingProfile
                              ? 'bg-white/[0.02] border border-white/5 text-slate-300 cursor-not-allowed opacity-90'
                              : 'bg-white/5 border border-white/10 focus:border-primary-500 text-white'
                          }`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                            <Phone className="w-3 h-3 text-primary-400" /> Contact Number
                          </label>
                          {!isEditingProfile && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                        </div>
                        <input
                          type="tel"
                          name="contact"
                          disabled={!isEditingProfile}
                          value={formData.contact}
                          onChange={handleInputChange}
                          placeholder="e.g. +260 97 1234567"
                          className={`w-full px-3 py-1.5 rounded-xl text-xs outline-none transition-all placeholder:text-slate-600 ${
                            !isEditingProfile
                              ? 'bg-white/[0.02] border border-white/5 text-slate-300 cursor-not-allowed opacity-90'
                              : 'bg-white/5 border border-white/10 focus:border-primary-500 text-white'
                          }`}
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                            <UserIcon className="w-3 h-3 text-primary-400" /> Gender Preference
                          </label>
                          {!isEditingProfile && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                        </div>
                        <select
                          name="gender"
                          disabled={!isEditingProfile}
                          value={formData.gender}
                          onChange={handleInputChange}
                          className={`w-full px-3 py-1.5 rounded-xl text-xs outline-none transition-all ${
                            !isEditingProfile
                              ? 'bg-white/[0.02] border border-white/5 text-slate-300 cursor-not-allowed opacity-90'
                              : 'bg-white/5 border border-white/10 focus:border-primary-500 text-white'
                          }`}
                        >
                          <option value="Male" className="bg-[#1a1635] text-white">Male</option>
                          <option value="Female" className="bg-[#1a1635] text-white">Female</option>
                        </select>
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1 ml-1">
                          <label className="text-[10px] font-bold text-slate-400 flex items-center gap-1 uppercase tracking-wider">
                            <Home className="w-3 h-3 text-primary-400" /> Residential Address
                          </label>
                          {!isEditingProfile && <Lock className="w-2.5 h-2.5 text-slate-500" />}
                        </div>
                        <input
                          type="text"
                          name="residentialAddress"
                          disabled={!isEditingProfile}
                          value={formData.residentialAddress}
                          onChange={handleInputChange}
                          placeholder="e.g. Plot 412, Woodlands, Lusaka"
                          className={`w-full px-3 py-1.5 rounded-xl text-xs outline-none transition-all placeholder:text-slate-600 ${
                            !isEditingProfile
                              ? 'bg-white/[0.02] border border-white/5 text-slate-300 cursor-not-allowed opacity-90'
                              : 'bg-white/5 border border-white/10 focus:border-primary-500 text-white'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Right Column: Protected Institutional Fields (Read-Only) */}
                    <div className="space-y-2.5">
                      
                      {/* School / Institution - SCREENSHOT 3 FIX */}
                      <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5 relative">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <School className="w-3 h-3 text-emerald-400" /> Institution
                          </span>
                          <Lock className="w-3 h-3 text-slate-500" />
                        </div>
                        <p className="text-xs font-bold text-white truncate">Chinsali Girls Secondary School</p>
                        <p className="text-[10px] text-slate-400">Chinsali, Zambia</p>
                      </div>

                      {/* Email Address */}
                      <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5 relative">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <Mail className="w-3 h-3 text-primary-400" /> Email Address
                          </span>
                          <Lock className="w-3 h-3 text-slate-500" />
                        </div>
                        <p className="text-xs font-semibold text-white truncate">{user.email || 'N/A'}</p>
                        <p className="text-[10px] text-slate-500">Used to sign in</p>
                      </div>

                      {/* Account Role */}
                      <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5 relative">
                        <div className="flex items-center justify-between text-slate-400">
                          <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                            <Shield className="w-3 h-3 text-amber-400" /> Account Role
                          </span>
                          <Lock className="w-3 h-3 text-slate-500" />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-extrabold uppercase">
                            {user.role}
                          </span>
                          <span className="text-[10px] text-slate-500">Your role</span>
                        </div>
                      </div>

                      {/* Role Specific Read-Only */}
                      {user.role === UserRole.STUDENT && (
                        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5 relative">
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                              <GraduationCap className="w-3 h-3 text-cyan-400" /> Class
                            </span>
                            <Lock className="w-3 h-3 text-slate-500" />
                          </div>
                          <p className="text-xs font-semibold text-cyan-300">
                            {normalizeGradeToForm(user.grade || user.gradeLevel) || 'Form 3'} • {user.className || 'Class A'}
                          </p>
                          <p className="text-[10px] text-slate-500">Class</p>
                        </div>
                      )}

                      {user.role === UserRole.TEACHER && (
                        <div className="p-2.5 rounded-xl bg-white/[0.03] border border-white/5 space-y-0.5 relative">
                          <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                              <BookOpen className="w-3 h-3 text-cyan-400" /> Teaching Assignment
                            </span>
                            <Lock className="w-3 h-3 text-slate-500" />
                          </div>
                          <p className="text-xs font-semibold text-cyan-300 truncate">
                            {user.teachingSubjects && user.teachingSubjects.length > 0 ? user.teachingSubjects.join(', ') : 'All STEM & Humanities'}
                          </p>
                          <p className="text-[10px] text-slate-500">Instruction levels: {user.teachingGrades && user.teachingGrades.length > 0 ? user.teachingGrades.map(g => normalizeGradeToForm(g)).join(', ') : 'Forms 1 - 5'}</p>
                        </div>
                      )}

                    </div>

                  </div>

                  {/* Profile Edit / Save Actions */}
                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/10">
                    {!isEditingProfile ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setIsEditingProfile(true);
                            setProfileMessage(null);
                          }}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-primary-600 hover:bg-primary-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-primary-900/40 active:scale-95 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          <span>Edit</span>
                        </button>

                        <button
                          type="button"
                          disabled
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-white/5 border border-white/10 text-slate-500 text-xs font-bold rounded-xl cursor-not-allowed opacity-50"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Changes</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          disabled={isSavingProfile}
                          className="px-3.5 py-1.5 bg-white/10 hover:bg-white/15 text-slate-300 hover:text-white text-xs font-semibold rounded-xl transition-all cursor-pointer disabled:opacity-50"
                        >
                          Cancel
                        </button>

                        <button
                          type="submit"
                          disabled={isSavingProfile}
                          className="flex items-center gap-1.5 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-900/40 active:scale-95 cursor-pointer disabled:opacity-50"
                        >
                          {isSavingProfile ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Saving Changes...</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-3.5 h-3.5" />
                              <span>Save Changes</span>
                            </>
                          )}
                        </button>
                      </>
                    )}
                  </div>
                </form>
              </div>

              {/* ─────────────────────────────────────────────────────────────────
                  2-COLUMN GRID: DATA PORTABILITY & DANGER ZONE
                  SCREENSHOT 1 & SCREENSHOT 11 OPTIMIZATION
                 ───────────────────────────────────────────────────────────────── */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                
                {/* Card 1: Data Portability (Download My Data) */}
                <div className="p-3.5 rounded-2xl border border-primary-500/30 bg-primary-950/20 backdrop-blur-md flex flex-col justify-between gap-2.5">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Download className="w-4 h-4 text-primary-400 shrink-0" />
                        <h3 className="text-sm font-bold text-white">
                          Download My Data
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 bg-primary-500/20 text-primary-300 border border-primary-500/30 rounded-md text-[9px] font-extrabold uppercase tracking-wider">
                        Your information
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      In line with Zambia's <strong>Data Protection Act No. 3 of 2021</strong>, download a file of your school records held in the school system — including profile, grades, attendance logs, messages, and assessment scores.
                    </p>
                    {exportSuccessMessage && (
                      <div className="text-xs text-emerald-400 font-medium flex items-center gap-1 animate-in fade-in">
                        <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{exportSuccessMessage}</span>
                      </div>
                    )}
                    {exportErrorMessage && (
                      <div className="text-xs text-rose-400 font-medium flex items-center gap-1 animate-in fade-in">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{exportErrorMessage}</span>
                      </div>
                    )}
                  </div>

                  <button
                    id="download-my-data-btn"
                    type="button"
                    disabled={isExportingData}
                    onClick={handleExportData}
                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-primary-950/60 hover:shadow-primary-900/80 flex items-center gap-1.5 cursor-pointer self-start active:scale-95 shrink-0 disabled:opacity-50"
                  >
                    {isExportingData ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Exporting...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Download My Data</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Card 2: Danger Zone (Delete Account) */}
                <div className="p-3.5 rounded-2xl border border-rose-500/30 bg-rose-950/20 backdrop-blur-md flex flex-col justify-between gap-2.5">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                        <h3 className="text-sm font-bold text-rose-400">
                          Delete Account
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/30 rounded-md text-[9px] font-extrabold uppercase tracking-wider">
                        Permanent
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Permanently erase your account profile, login details, school activity, and places you are signed in from the school system. This action cannot be reversed.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setDeletePassword('');
                      setDeleteError(null);
                      setIsDeleteModalOpen(true);
                    }}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-rose-950/60 hover:shadow-rose-900/80 flex items-center gap-1.5 cursor-pointer self-start active:scale-95 shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Account</span>
                  </button>
                </div>

              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 2: DISPLAY (THEME SWITCHER)
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'display' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                    {currentTheme === 'dark' ? <Moon className="w-4 h-4 text-primary-400" /> : <Sun className="w-4 h-4 text-primary-400" />}
                    Display &amp; Theme
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Choose your preferred appearance mode. Your selection applies immediately across all pages.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => handleThemeChange(currentTheme === 'dark' ? 'light' : 'dark')}
                  className="flex items-center gap-2.5 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-bold text-slate-300 transition-all self-start sm:self-auto cursor-pointer"
                >
                  {currentTheme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-400" />
                      <span>Switch to Light Mode</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-primary-400" />
                      <span>Switch to Dark Mode</span>
                    </>
                  )}
                </button>
              </div>

              {/* Theme Selection Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                
                {/* Dark Theme */}
                <div
                  onClick={() => handleThemeChange('dark')}
                  className={`p-6 rounded-3xl border-2 transition-all cursor-pointer relative ${
                    currentTheme === 'dark'
                      ? 'border-primary-500 bg-primary-950/30 shadow-xl shadow-primary-950/50 ring-2 ring-primary-500/20'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                  }`}
                >
                  {currentTheme === 'dark' && (
                    <div className="absolute top-4 right-4 p-1.5 rounded-full bg-primary-600 text-white shadow-md">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-2xl bg-[#120f26] border border-white/10 text-primary-400 shadow-inner">
                      <Moon className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">Dark Theme</h3>
                      <span className="text-[10px] font-bold text-primary-300 bg-primary-950/60 px-2 py-0.5 rounded-full border border-primary-500/30">
                        Default
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed mb-5">
                    Midnight canvas with rich indigo and violet highlights. Ideal for low-light environments and eye comfort.
                  </p>
                  <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                    <div className="w-5 h-5 rounded-full bg-[#0c0a1f] border border-white/20" title="Background #0c0a1f" />
                    <div className="w-5 h-5 rounded-full bg-[#1a1635] border border-white/20" title="Surface #1a1635" />
                    <div className="w-5 h-5 rounded-full bg-[#7c3aed]" title="Accent #7c3aed" />
                    <div className="w-5 h-5 rounded-full bg-[#a78bfa]" title="Accent #a78bfa" />
                    <span className="text-[11px] text-slate-500 font-medium ml-2">Night Palette</span>
                  </div>
                </div>

                {/* Light Theme */}
                <div
                  onClick={() => handleThemeChange('light')}
                  className={`p-6 rounded-3xl border-2 transition-all cursor-pointer relative ${
                    currentTheme === 'light'
                      ? 'border-primary-500 bg-primary-950/30 shadow-xl shadow-primary-950/50 ring-2 ring-primary-500/20'
                      : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'
                  }`}
                >
                  {currentTheme === 'light' && (
                    <div className="absolute top-4 right-4 p-1.5 rounded-full bg-primary-600 text-white shadow-md">
                      <Check className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex items-center gap-3 mb-4">
                    <div className="p-3 rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-300 shadow-inner">
                      <Sun className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base">Light Theme</h3>
                      <span className="text-[10px] font-bold text-slate-400 bg-white/10 px-2 py-0.5 rounded-full">
                        High Contrast
                      </span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed mb-5">
                    Clean daylight layout with crisp surfaces and high-contrast dark typography for daytime readability.
                  </p>
                  <div className="flex items-center gap-2 pt-3 border-t border-white/5">
                    <div className="w-5 h-5 rounded-full bg-[#f8fafc] border border-slate-300" title="Background #f8fafc" />
                    <div className="w-5 h-5 rounded-full bg-[#ffffff] border border-slate-300" title="Surface #ffffff" />
                    <div className="w-5 h-5 rounded-full bg-[#7c3aed]" title="Accent #7c3aed" />
                    <div className="w-5 h-5 rounded-full bg-[#6d28d9]" title="Accent #6d28d9" />
                    <span className="text-[11px] text-slate-500 font-medium ml-2">Day Palette</span>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 3: NOTIFICATIONS
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'notifications' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                    <Bell className="w-4 h-4 text-primary-400" />
                    Notification Preferences
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Choose which school notices and reminders trigger alerts and badge counters.
                  </p>
                </div>

                {notifSavedBanner && (
                  <span className="px-3.5 py-1.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1.5 animate-in fade-in self-start sm:self-auto">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Saved instantly
                  </span>
                )}
              </div>

              <div className="space-y-4">
                
                {/* 1. Deadlines Toggle */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4 transition-all hover:bg-white/[0.07]">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-amber-950/40 text-amber-400 border border-amber-500/30 shrink-0">
                      <Calendar className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Course Deadlines &amp; Assignments</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Upcoming homework due dates, test schedules, and reminder alerts.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleNotif('deadlines')}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none ${
                      notifPrefs.deadlines ? 'bg-primary-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        notifPrefs.deadlines ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 2. Meetings Toggle */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4 transition-all hover:bg-white/[0.07]">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-blue-950/40 text-blue-400 border border-blue-500/30 shrink-0">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Meetings &amp; School Assemblies</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Staff meetings, parent briefings, and official school assemblies.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleNotif('meetings')}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none ${
                      notifPrefs.meetings ? 'bg-primary-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        notifPrefs.meetings ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 3. Misconduct / Absence Toggle */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4 transition-all hover:bg-white/[0.07]">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-rose-950/40 text-rose-400 border border-rose-500/30 shrink-0">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">Attendance &amp; Conduct Notices</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Absence notifications, misconduct notes, and urgent alerts.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleNotif('misconduct')}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none ${
                      notifPrefs.misconduct ? 'bg-primary-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        notifPrefs.misconduct ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 4. General Announcements */}
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-between gap-4 transition-all hover:bg-white/[0.07]">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-primary-950/40 text-primary-400 border border-primary-500/30 shrink-0">
                      <Bell className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white">General School Announcements</h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Term calendar shifts, curriculum updates, and institutional news.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleNotif('general')}
                    className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 focus:outline-none ${
                      notifPrefs.general ? 'bg-primary-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`w-4 h-4 rounded-full bg-white absolute top-1 transition-transform ${
                        notifPrefs.general ? 'left-7' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 4: CONNECTED DEVICES (SESSIONS)
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'devices' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-primary-400" />
                    Connected Devices &amp; Signed-in Places
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    See and manage places you are signed in across your phones, tablets, and computers.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={loadSessions}
                  disabled={isLoadingSessions}
                  className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl text-xs font-bold text-slate-300 transition-all cursor-pointer self-start sm:self-auto disabled:opacity-50"
                >
                  <Loader2 className={`w-3.5 h-3.5 ${isLoadingSessions ? 'animate-spin' : ''}`} />
                  <span>Refresh</span>
                </button>
              </div>

              {sessionsError && (
                <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                  <span>{sessionsError}</span>
                </div>
              )}

              {isLoadingSessions && sessions.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-400 text-xs gap-3">
                  <Loader2 className="w-6 h-6 animate-spin text-primary-400" />
                  <span>Loading connected devices...</span>
                </div>
              ) : (
                <div className="space-y-4">
                  {sessions.map((session) => {
                    const isCurrent = Boolean(session.isCurrent);
                    const isRevoking = revokingSessionId === session.id;
                    const isMobile = /mobile|iphone|android|ipad/i.test(session.deviceInfo);

                    return (
                      <div
                        key={session.id}
                        className={`p-5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                          isCurrent
                            ? 'bg-primary-950/20 border-primary-500/40 shadow-md'
                            : 'bg-white/5 border-white/10 hover:bg-white/[0.07]'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`p-3 rounded-2xl shrink-0 border ${
                            isCurrent
                              ? 'bg-primary-600 text-white border-primary-400/40 shadow-lg shadow-primary-950/50'
                              : 'bg-white/5 text-slate-400 border-white/10'
                          }`}>
                            {isMobile ? <Smartphone className="w-6 h-6" /> : <Laptop className="w-6 h-6" />}
                          </div>

                          <div className="space-y-1">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <h3 className="text-sm font-bold text-white">{session.deviceInfo || 'Web Browser'}</h3>
                              {isCurrent && (
                                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-extrabold flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                  This Device
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 text-xs text-slate-400 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Globe className="w-3.5 h-3.5 text-slate-500" />
                                {session.ipAddress || 'IP: Active'}
                              </span>
                              <span>•</span>
                              <span>Signed in: {new Date(session.loginAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRevokeSession(session.id, isCurrent)}
                          disabled={isRevoking}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer self-start sm:self-auto disabled:opacity-50 ${
                            isCurrent
                              ? 'bg-rose-600/20 text-rose-300 border border-rose-500/30 hover:bg-rose-600/30'
                              : 'bg-white/5 text-slate-300 border border-white/10 hover:bg-rose-950/40 hover:text-rose-300 hover:border-rose-500/30'
                          }`}
                        >
                          {isRevoking ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Logging out...</span>
                            </>
                          ) : (
                            <>
                              <LogOut className="w-3.5 h-3.5" />
                              <span>{isCurrent ? 'Log out this device' : 'Log out device'}</span>
                            </>
                          )}
                        </button>
                      </div>
                    );
                  })}

                  {sessions.length === 0 && (
                    <div className="py-8 text-center text-slate-500 text-xs italic">
                      No signed-in devices found.
                    </div>
                  )}
                </div>
              )}

              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl text-xs text-slate-400">
                <span>Logging out a device immediately signs it out and requires signing in again.</span>
              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION: SCHOOL LOCATION & GEOFENCING (ADMIN ONLY)
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'location' && user.role === UserRole.ADMIN && (
            <div className="space-y-3 animate-in fade-in">
              
              <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
                  <div>
                    <div className="flex items-center gap-1.5 text-primary-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                      <MapPin className="w-3.5 h-3.5" /> Campus Geofence Configuration
                    </div>
                    <h2 className="text-base md:text-lg font-extrabold text-white">
                      School Location &amp; Attendance Geofencing
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5 max-w-xl">
                      Configure the school's geographical coordinates and verification perimeter. Attendance submitted outside this radius will be flagged for administrative audit.
                    </p>
                  </div>

                  <span className="px-3 py-1 bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-full text-xs font-bold uppercase tracking-wider self-start sm:self-auto">
                    Admin Exclusive
                  </span>
                </div>

                {/* Explanatory Policy Card */}
                <div className="p-4 bg-primary-950/30 border border-primary-500/20 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-primary-300">
                    <ShieldCheck className="w-4 h-4 text-primary-400" />
                    <span>Non-Blocking Evidence Layer</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    Under standard school policy, location capture serves as an evidentiary verification layer. Teachers are <strong>never blocked</strong> from recording attendance if GPS is weak or outside bounds; instead, any record falling outside the specified radius is tagged with a geofence warning for review in the Admin Dashboard.
                  </p>
                </div>

                {isLoadingLocation ? (
                  <div className="py-12 flex flex-col items-center justify-center gap-3">
                    <Loader2 className="w-8 h-8 text-primary-400 animate-spin" />
                    <p className="text-xs text-slate-400">Loading campus coordinates...</p>
                  </div>
                ) : (
                  <form onSubmit={handleSaveSchoolLocation} className="space-y-6">
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                      {/* Latitude */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Navigation className="w-3.5 h-3.5 text-primary-400" />
                          School Latitude (Decimal Degrees)
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          required
                          value={schoolLocation.latitude}
                          onChange={(e) => setSchoolLocation({ ...schoolLocation, latitude: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. -15.3875"
                          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white text-sm focus:outline-none focus:border-primary-500 transition-all font-mono"
                        />
                        <p className="text-[11px] text-slate-500">e.g. -15.3875 (South is negative)</p>
                      </div>

                      {/* Longitude */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                          <Navigation className="w-3.5 h-3.5 text-primary-400" />
                          School Longitude (Decimal Degrees)
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          required
                          value={schoolLocation.longitude}
                          onChange={(e) => setSchoolLocation({ ...schoolLocation, longitude: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 28.3228"
                          className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-2xl text-white text-sm focus:outline-none focus:border-primary-500 transition-all font-mono"
                        />
                        <p className="text-[11px] text-slate-500">e.g. 28.3228 (East is positive)</p>
                      </div>
                    </div>

                    {/* Radius Slider & Number Input */}
                    <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                            <Crosshair className="w-4 h-4 text-emerald-400" />
                            Allowed Geofence Radius
                          </label>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Permissible distance from campus center for standard attendance
                          </p>
                        </div>
                        <div className="px-3 py-1.5 bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-emerald-300 font-mono font-bold text-sm">
                          {schoolLocation.radiusMeters} meters
                        </div>
                      </div>

                      <input
                        type="range"
                        min="25"
                        max="2000"
                        step="25"
                        value={schoolLocation.radiusMeters}
                        onChange={(e) => setSchoolLocation({ ...schoolLocation, radiusMeters: parseInt(e.target.value, 10) || 150 })}
                        className="w-full accent-primary-500 cursor-pointer"
                      />

                      <div className="flex flex-wrap gap-2 pt-1">
                        <span className="text-[11px] text-slate-400 mr-2 self-center">Quick presets:</span>
                        {[50, 100, 150, 250, 500, 1000].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setSchoolLocation({ ...schoolLocation, radiusMeters: preset })}
                            className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                              schoolLocation.radiusMeters === preset
                                ? 'bg-primary-600 text-white font-bold'
                                : 'bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                            }`}
                          >
                            {preset}m
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Geolocation Capture Button & Save Controls */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-white/10">
                      <button
                        type="button"
                        onClick={handleDetectCampusGPS}
                        disabled={isDetectingGPS}
                        className="w-full sm:w-auto px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-200 rounded-2xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {isDetectingGPS ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin text-primary-400" />
                            <span>Acquiring Device GPS...</span>
                          </>
                        ) : (
                          <>
                            <Crosshair className="w-4 h-4 text-primary-400" />
                            <span>Use My Current GPS Position</span>
                          </>
                        )}
                      </button>

                      <div className="flex items-center gap-3 w-full sm:w-auto">
                        <button
                          type="submit"
                          disabled={isSavingLocation}
                          className="w-full sm:w-auto px-6 py-3 bg-primary-600 hover:bg-primary-500 text-white rounded-2xl text-xs font-bold transition-all shadow-lg shadow-primary-900/50 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                          {isSavingLocation ? (
                            <>
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Saving Location...</span>
                            </>
                          ) : (
                            <>
                              <Save className="w-4 h-4" />
                              <span>Save School Location</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Feedback Alert */}
                    {locationFeedback && (
                      <div className={`p-4 rounded-2xl border text-xs flex items-center gap-3 animate-in fade-in ${
                        locationFeedback.type === 'success'
                          ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                          : 'bg-rose-950/40 border-rose-500/30 text-rose-300'
                      }`}>
                        {locationFeedback.type === 'success' ? (
                          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="w-5 h-5 shrink-0 text-rose-400" />
                        )}
                        <span>{locationFeedback.text}</span>
                      </div>
                    )}

                  </form>
                )}

              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 5: TERMS OF USE
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'terms' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-3.5 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-primary-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                    <FileText className="w-3.5 h-3.5" /> Legal &amp; Institutional Governance
                  </div>
                  <h2 className="text-base md:text-lg font-extrabold text-white">
                    Terms of Use &amp; Platform Guidelines
                  </h2>
                  <p className="text-xs text-slate-400">
                    Chinsali Girls Secondary School • Chinsali, Zambia
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadTermsPdf}
                    disabled={isDownloadingTerms}
                    className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-sm font-bold transition-all shadow-md shadow-primary-950/60 hover:shadow-primary-900/80 flex items-center gap-1.5 cursor-pointer disabled:opacity-50 active:scale-95"
                  >
                    {isDownloadingTerms ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Generating PDF...</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-3.5 h-3.5" />
                        <span>Download terms (PDF)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {termsDownloadSuccess && (
                <div className="p-2 rounded-xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs font-medium flex items-center gap-1.5 animate-in fade-in">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Terms of Use PDF downloaded successfully!</span>
                </div>
              )}

              {/* 2-Column layout for compact viewing without vertical scroll */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 text-xs text-slate-300 leading-relaxed">
                
                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">1.</span> Acceptance of Educational Terms
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    By signing in to and accessing E-SYLLAB at Chinsali Girls Secondary School, students, teachers, and administrators agree to comply with school administrative regulations and these terms of use. The system is provided exclusively for educational administration, curriculum tracking, attendance verification, and academic learning.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">2.</span> Permitted Use &amp; Account Responsibility
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    Each user is issued personalized credentials. You are strictly prohibited from sharing your login credentials, impersonating another student or faculty member, or attempting to bypass role-based permissions. Teachers and administrators are responsible for the accuracy of records submitted under their accounts.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">3.</span> Academic Integrity &amp; Record Authenticity
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    All attendance entries, grade submissions, and vault documents are cryptographically tracked to preserve institutional integrity. Any unauthorized attempt to tamper with academic scores, attendance histories, or cryptographic proofs constitutes gross misconduct under school disciplinary codes.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">4.</span> Compliance with Zambia Data Protection Act 2021
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    E-SYLLAB operates in full compliance with the <strong>Data Protection Act No. 3 of 2021</strong> of the Republic of Zambia. The platform processes educational records, attendance logs, and contact details solely for lawful educational purposes with appropriate security safeguards.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">5.</span> Curriculum Standards &amp; Intellectual Property
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    Curriculum materials and assessment frameworks align with Examinations Council of Zambia (ECZ) national standards. Course materials uploaded by teachers remain the institutional property of Chinsali Girls Secondary School.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">6.</span> Service Availability &amp; Offline Continuity
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    Local offline storage guarantees that attendance marking and timetable access function even when school internet connectivity is interrupted. Saved school records synchronize automatically when connectivity is restored.
                  </p>
                </div>

                <div className="p-3 bg-white/[0.02] border border-white/5 rounded-xl space-y-1 md:col-span-2">
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span className="text-primary-400">7.</span> Amendments &amp; School Inquiries
                  </h3>
                  <p className="text-[11px] text-slate-300 leading-normal">
                    These terms may be updated periodically in consultation with school management boards and the Ministry of Education. Inquiries regarding platform policies should be directed to the Administration Office at Chinsali Girls Secondary School, Chinsali, Zambia.
                  </p>
                </div>

              </div>

              <div className="pt-2 border-t border-white/10 text-slate-500 text-[10px] flex items-center justify-between">
                <span>Last updated: Term 1, 2026</span>
                <span>Chinsali Girls Secondary School • Ministry of Education, Zambia</span>
              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 6: PRIVACY POLICY
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'privacy' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10">
                <div className="flex items-center gap-1.5 text-primary-400 text-[10px] font-bold uppercase tracking-wider mb-0.5">
                  <Shield className="w-3.5 h-3.5" /> Data Protection &amp; Confidentiality
                </div>
                <h2 className="text-base md:text-lg font-extrabold text-white">
                  Privacy Policy
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Compliance statement under the Data Protection Act No. 3 of 2021 (Republic of Zambia).
                </p>
              </div>

              <div className="space-y-6 text-xs text-slate-300 leading-relaxed">
                
                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white">1. Statement of Compliance</h3>
                  <p>
                    E-SYLLAB is committed to protecting the privacy and personal data of students, guardians, teachers, and school administrators. We process all personal information in accordance with the principles set forth in the <strong>Data Protection Act No. 3 of 2021</strong> of the Republic of Zambia.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white">2. Information We Collect</h3>
                  <ul className="list-disc pl-5 space-y-1 text-slate-400">
                    <li><strong className="text-white">Account Identification:</strong> Full name, institutional email address, school role, contact phone numbers, and profile avatars.</li>
                    <li><strong className="text-white">Academic &amp; Attendance Records:</strong> Daily class attendance timestamps, subject assessment scores, syllabus progression, and optional device GPS coordinates captured at the moment attendance is marked (with user permission) for geofence verification.</li>
                    <li><strong className="text-white">Device &amp; Session Logs:</strong> Browser User-Agent, approximate IP address, and sign-in timestamps recorded for session security and unauthorized access prevention.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white">3. Lawful Basis &amp; Purpose of Processing</h3>
                  <p>
                    Data is processed strictly for:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-slate-400">
                    <li>Delivering educational curriculum in accordance with ECZ national guidelines.</li>
                    <li>Maintaining immutable school attendance registers.</li>
                    <li>Generating verified student academic report cards.</li>
                    <li>Preventing security breaches and account takeovers.</li>
                  </ul>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white">4. Protection of Student Minors</h3>
                  <p>
                    We recognize the special sensitivity of student records. Student educational data is accessible only by authorized classroom teachers, school administrators, and verified parent/guardian contacts. No student personal data is ever sold, leased, or shared with third-party advertisers.
                  </p>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-bold text-white">5. Security Safeguards &amp; Cryptographic Ledger</h3>
                  <p>
                    We employ industry-standard encryption, password hashing via bcrypt, secure JSON Web Tokens (JWT) with blacklisting on logout, and cryptographic verification hashes for permanent attendance records.
                  </p>
                </section>

                <section className="space-y-3">
                  <h3 className="text-sm font-bold text-white">6. Your Rights as a Data Subject</h3>
                  <p>
                    Under the <strong>Data Protection Act No. 3 of 2021 (Republic of Zambia)</strong>, you have full control over your personal data. E-SYLLAB provides accessible, direct controls for every user:
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                    <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2 text-primary-400 font-bold text-xs">
                        <Download className="w-4 h-4" /> Right of Access &amp; Your Information
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        <strong>See &amp; Export Your Data:</strong> You have the right to obtain a full copy of all data held about you. Click <em>"Download My Data"</em> in your Profile settings to download a single structured JSON archive containing your profile, grades, attendance logs, messages, and assessment scores.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                        <Save className="w-4 h-4" /> Right to Rectification
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        <strong>Correct Inaccurate Information:</strong> You can edit and update your name, contact phone number, residential address, gender, and avatar picture at any time in the Profile section of Settings.
                      </p>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-white/5 border border-white/10 space-y-1.5">
                      <div className="flex items-center gap-2 text-rose-400 font-bold text-xs">
                        <Trash2 className="w-4 h-4" /> Right to Erasure &amp; Deactivation
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">
                        <strong>Delete Your Account:</strong> You can request permanent erasure and deactivation of your account, login details, and places you are signed in from the Danger Zone in your Profile settings.
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 pt-1">
                    Informed Consent: Data processing begins with your explicit, informed consent recorded during registration with an immutable timestamp in our secure database.
                  </p>
                </section>

              </div>

              <div className="pt-4 border-t border-white/10 text-slate-500 text-[11px] flex items-center justify-between">
                <span>Data Protection Officer • E-SYLLAB Platform</span>
                <span>Zambia Information &amp; Communications Technology Authority (ZICTA) Standards</span>
              </div>

            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════════
              SECTION 7: ABOUT
             ══════════════════════════════════════════════════════════════════════ */}
          {activeSection === 'about' && (
            <div className="glass-card p-4 md:p-5 rounded-2xl space-y-4 animate-in fade-in">
              
              <div className="pb-3 border-b border-white/10">
                <h2 className="text-base md:text-lg font-bold text-white flex items-center gap-2">
                  <Info className="w-4 h-4 text-primary-400" />
                  About E-SYLLAB
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Your school's secure digital learning, attendance, and syllabus tracking system.
                </p>
              </div>

              {/* Identity Card */}
              <div className="p-6 bg-gradient-to-br from-primary-950/40 via-purple-950/20 to-slate-900/40 border border-primary-500/30 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-primary-600 text-white rounded-2xl shadow-lg shadow-primary-900/50">
                    <ShieldCheck className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-white">E-SYLLAB — Easy &amp; Secure Learning</h3>
                    <p className="text-xs text-primary-300">Zambian Secondary Schools Digital Platform</p>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  E-SYLLAB is a reliable, easy-to-use digital platform designed for Zambian secondary schools. It allows teachers to mark attendance even without internet, keeps school records secure and permanent, and helps students and teachers stay organized throughout the term.
                </p>
              </div>

              {/* Data Protection & User Rights Card */}
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-emerald-600/30 border border-emerald-500/40 text-emerald-300 rounded-2xl">
                    <Shield className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Data Protection &amp; User Privacy Rights</h3>
                    <p className="text-[11px] text-emerald-300">Zambia Data Protection Act No. 3 of 2021</p>
                  </div>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  E-SYLLAB is built with user privacy and data sovereignty by design. As a registered user, you have full control over your personal records:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300 pt-1">
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <strong className="text-white block text-xs">1. Download My Data</strong>
                    <p className="text-[11px] text-slate-400">Export a complete copy of all personal records, grades, attendance logs, and messages held about you.</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <strong className="text-white block text-xs">2. Edit Profile</strong>
                    <p className="text-[11px] text-slate-400">Correct and update your personal details, contact number, avatar, and residential address at any time.</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                    <strong className="text-white block text-xs">3. Delete Account</strong>
                    <p className="text-[11px] text-slate-400">Permanently erase and deactivate your login details, profile, and places you are signed in from the school database.</p>
                  </div>
                </div>
              </div>

              {/* System Overview Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                
                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <Layers className="w-4 h-4" /> App Version
                  </div>
                  <p className="text-base font-extrabold text-white">E-SYLLAB v2.4</p>
                  <p className="text-[11px] text-slate-400">Up to date &amp; ready to use</p>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <FileCheck className="w-4 h-4" /> Attendance Records
                  </div>
                  <p className="text-base font-extrabold text-white">Verified Records</p>
                  <p className="text-[11px] text-slate-400">Protected against changes &amp; loss</p>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <WifiOff className="w-4 h-4" /> Offline Support
                  </div>
                  <p className="text-base font-extrabold text-white">Works Without Internet</p>
                  <p className="text-[11px] text-slate-400">Saves on device &amp; syncs when online</p>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <School className="w-4 h-4" /> Curriculum Standard
                  </div>
                  <p className="text-base font-extrabold text-white">Zambian ECZ Framework</p>
                  <p className="text-[11px] text-slate-400">Grades 8 – 12 Core Subjects</p>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <Smartphone className="w-4 h-4" /> Device Compatibility
                  </div>
                  <p className="text-base font-extrabold text-white">Phones, Tablets &amp; PCs</p>
                  <p className="text-[11px] text-slate-400">Runs in browser or as an installed app</p>
                </div>

                <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-1">
                  <div className="flex items-center gap-2 text-primary-400 text-xs font-bold uppercase tracking-wider">
                    <ShieldCheck className="w-4 h-4" /> Account Protection
                  </div>
                  <p className="text-base font-extrabold text-white">Secure Student &amp; Staff Login</p>
                  <p className="text-[11px] text-slate-400">Protected accounts and private data</p>
                </div>

              </div>

              {/* Collapsible Technical Details Section */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="w-full flex items-center justify-between p-4 bg-white/5 hover:bg-white/[0.08] border border-white/10 rounded-2xl text-left transition-all cursor-pointer group"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-xl bg-primary-950/40 border border-primary-500/30 text-primary-400 group-hover:text-primary-300">
                      <Code2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-white group-hover:text-primary-300 transition-colors">
                        Technical &amp; System Architecture Details
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        Click to {showTechnicalDetails ? 'hide' : 'view'} detailed technical specifications for system administrators
                      </p>
                    </div>
                  </div>
                  <div className="text-slate-400 group-hover:text-white transition-colors">
                    {showTechnicalDetails ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                  </div>
                </button>

                {showTechnicalDetails && (
                  <div className="mt-3 p-5 rounded-2xl bg-black/40 border border-white/10 space-y-4 animate-in slide-in-from-top-2">
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Under the hood, E-SYLLAB uses cryptographic verification and distributed ledger technology to guarantee record authenticity:
                    </p>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">Runtime Version</span>
                        <span className="font-mono text-emerald-400 font-bold text-xs">v2.4.0-prod</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">PWA ServiceWorker v7</p>
                      </div>

                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">Verification Ledger</span>
                        <span className="font-mono text-purple-400 font-bold text-xs">Solana Devnet</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">Ed25519 signatures &amp; SHA-256 state hashes</p>
                      </div>

                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">Client-Side Persistence</span>
                        <span className="font-mono text-blue-400 font-bold text-xs">IndexedDB Storage</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">Dual-mode background sync queue</p>
                      </div>

                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">Curriculum Engine</span>
                        <span className="font-mono text-amber-400 font-bold text-xs">ECZ Syllabus Spec</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">Grades 8–12 Zambian National Framework</p>
                      </div>

                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">App Distribution</span>
                        <span className="font-mono text-cyan-400 font-bold text-xs">PWA Manifest v2</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">Standalone cross-platform cache</p>
                      </div>

                      <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                        <span className="text-slate-500 font-mono text-[10px] block uppercase">Security &amp; Auth</span>
                        <span className="font-mono text-emerald-400 font-bold text-xs">JWT + Protected Vault</span>
                        <p className="text-[10px] text-slate-400 mt-0.5">Role-Based Access Control (RBAC)</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-2">
                <span>© 2026 E-SYLLAB Learning Systems. All rights reserved.</span>
                <span>Ministry of Education Secondary Digital Initiative</span>
              </div>

            </div>
          )}

        </main>
      </div>

      {/* ─── Confirmation Modal: Delete Account ─────────────────────────────── */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="glass-card max-w-md w-full p-6 md:p-8 rounded-3xl border border-rose-500/40 shadow-2xl space-y-6 animate-in slide-in-from-bottom-2 bg-[#1a1635]">
            
            <div className="flex items-center gap-3.5">
              <div className="p-3 bg-rose-950/60 border border-rose-500/40 text-rose-400 rounded-2xl">
                <AlertTriangle className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete Your Account</h3>
                <p className="text-xs text-rose-300">Permanent and irreversible action</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Are you sure you want to permanently delete your account (<strong className="text-white">{user.email}</strong>)? All your personal data and places you are signed in will be removed immediately.
            </p>

            {deleteError && (
              <div className="p-3.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-xs text-rose-300 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{deleteError}</span>
              </div>
            )}

            <form onSubmit={handleDeleteAccountSubmit} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5 ml-1">
                  Type your password to confirm deletion:
                </label>
                <div className="relative">
                  <Key className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
                  <input
                    type="password"
                    required
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    placeholder="Enter account password"
                    className="w-full pl-10 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-rose-500 text-white placeholder:text-slate-600"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  disabled={isDeletingAccount}
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeletingAccount || !deletePassword}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-rose-950/50 disabled:opacity-50 flex items-center gap-2 cursor-pointer active:scale-95"
                >
                  {isDeletingAccount ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deleting Account...</span>
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm &amp; Delete</span>
                    </>
                  )}
                </button>
              </div>
            </form>

          </div>
        </div>
      )}

    </div>
  );
};
