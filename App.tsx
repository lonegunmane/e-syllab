import React, { useState, useEffect } from 'react';
import { User, UserRole } from './types';
import { Layout } from './components/Layout';
import { StudentDashboard } from './views/StudentDashboard';
import { TeacherDashboard } from './views/TeacherDashboard';
import { AdminDashboard } from './views/AdminDashboard';
import { MessagingView } from './views/MessagingView';
import { GradesView } from './views/GradesView';
import { AssessmentView } from './components/AssessmentView';
import { TimetableView } from './components/TimetableView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { AuthPage } from './components/AuthPage';
import { db } from './services/database';
import { PasswordResetModal } from './components/PasswordResetModal';
import { TeacherSetupModal } from './components/TeacherSetupModal';
import { StudentSetupModal } from './components/StudentSetupModal';
import { getToken, clearToken, getProfile } from './services/api';

const App: React.FC = () => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    db.init();
    
    // Check if we have a valid session strictly verified by the server
    const initAuth = async () => {
      const token = getToken();

      if (!token) {
        clearToken();
        setCurrentUser(null);
        setInitializing(false);
        return;
      }

      try {
        const result = await getProfile();
        if (result && result.success && result.user) {
          setCurrentUser(result.user);
          localStorage.setItem('esylab_session', JSON.stringify(result.user));
          const creds = db.getCredentialByUserId(result.user.id);
          if (creds?.passwordResetRequired) {
            setShowPasswordReset(true);
          }
        } else {
          // Token expired, invalid, blacklisted, deactivated or profile failed
          clearToken();
          setCurrentUser(null);
        }
      } catch (err: any) {
        console.warn("[App] Session verification failed:", err?.message || err);
        clearToken();
        setCurrentUser(null);
      } finally {
        setInitializing(false);
      }
    };

    initAuth();
  }, []);

  const handleLoginSuccess = (loginData: { user: User; needsPasswordReset: boolean }) => {
    setCurrentUser(loginData.user);
    localStorage.setItem('esylab_session', JSON.stringify(loginData.user));
    if (loginData.needsPasswordReset) {
      setShowPasswordReset(true);
    }
  };

  const handlePasswordResetSuccess = () => {
    if (currentUser) {
        const freshUser = db.findUserByEmail(currentUser.email);
        if(freshUser){
            setCurrentUser(freshUser);
            localStorage.setItem('esylab_session', JSON.stringify(freshUser));
        }
    }
    setShowPasswordReset(false);
  }

  const handleLogout = async () => {
    try {
      const token = getToken();
      if (token) {
        await fetch('/api/logout', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });
      }
    } catch (err) {
      console.warn("[App] Server logout unreachable:", err);
    } finally {
      // Clear tokens and session
      clearToken();
      localStorage.removeItem('esylab_session');
      setCurrentUser(null);
      setShowPasswordReset(false);
      setActiveTab('overview');
    }
  };
  
  const handleUserUpdate = (updatedUser: User) => {
    setCurrentUser(updatedUser);
    localStorage.setItem('esylab_session', JSON.stringify(updatedUser));
  };


  if (initializing) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-white/5 border-t-primary-500 rounded-full animate-spin shadow-[0_0_15px_rgba(124,58,237,0.3)]" />
      </div>
    );
  }

  if (!currentUser) {
    return <AuthPage onLoginSuccess={handleLoginSuccess} />;
  }
  
  if (showPasswordReset) {
      return <PasswordResetModal user={currentUser} onResetSuccess={handlePasswordResetSuccess} onLogout={handleLogout} />
  }

  const showTeacherOnboarding = currentUser.role === UserRole.TEACHER && !currentUser.isProfileComplete;
  const showStudentOnboarding = currentUser.role === UserRole.STUDENT && !currentUser.isProfileComplete;

  const renderContent = () => {
    if (!currentUser) return null;
    
    if (activeTab === 'communicate') {
      return <MessagingView currentUser={currentUser} />;
    }

    if (activeTab === 'grades') {
      return <GradesView currentUser={currentUser} />;
    }

    if (activeTab === 'assessments') {
      return <AssessmentView currentUser={currentUser} />;
    }

    if (activeTab === 'timetable') {
      return <TimetableView currentUser={currentUser} />;
    }

    switch (currentUser.role) {
      case UserRole.STUDENT: return <StudentDashboard user={currentUser} onUpdateUser={handleUserUpdate} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />;
      case UserRole.TEACHER: return <TeacherDashboard user={currentUser} onUpdateUser={handleUserUpdate} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />;
      case UserRole.ADMIN: return <AdminDashboard user={currentUser} onUpdateUser={handleUserUpdate} activeTab={activeTab} setActiveTab={setActiveTab} onLogout={handleLogout} />;
      default: return null;
    }
  };

  return (
    <Layout 
      user={currentUser} 
      onLogout={handleLogout} 
      onUpdateUser={handleUserUpdate}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {showTeacherOnboarding && (
        <TeacherSetupModal 
          user={currentUser} 
          onComplete={handleUserUpdate} 
        />
      )}
      {showStudentOnboarding && (
        <StudentSetupModal 
          user={currentUser} 
          onComplete={handleUserUpdate} 
        />
      )}
      {renderContent()}
      <OfflineIndicator />
    </Layout>
  );
};

export default App;