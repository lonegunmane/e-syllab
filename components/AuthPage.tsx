import React, { useState } from 'react';
import {
  Shield,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Info,
  KeyRound,
  RefreshCw,
  ArrowLeft,
  Sparkles,
  X,
  FileText,
  Check
} from 'lucide-react';
import { User, UserRole } from '../types';
import { db } from '../services/database';
import { login, register, sendTwoFactorOtp, verifyLoginTwoFactor } from '../services/api';
import { LogoIcon } from './Logo';

interface AuthPageProps {
  onLoginSuccess: (data: {
    user: User;
    needsPasswordReset: boolean;
  }) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onLoginSuccess }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // 2FA States
  const [authStep, setAuthStep] = useState<'credentials' | 'login_2fa' | 'register_2fa'>('credentials');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [pendingRole, setPendingRole] = useState<UserRole | null>(null);
  const [devCodeNotice, setDevCodeNotice] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);

  // Forgot Password States
  const [forgotPasswordStep, setForgotPasswordStep] = useState<'none' | 'email' | 'otp'>('none');
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [generatedOtp, setGeneratedOtp] = useState('');

  // Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [consentAgreed, setConsentAgreed] = useState(false);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);

  const handleSendOtp = async () => {
    if (!resetEmail) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = db.findUserByEmail(resetEmail);
      if (!user) {
        throw new Error("No account found with this email");
      }

      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      setGeneratedOtp(otp);
      
      const response = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, otp })
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 503) {
          console.warn("[AUTH] Server email service not configured. Falling back to alert.");
          alert(`Email sending isn't set up yet. Your code is: ${otp}`);
        } else {
          throw new Error(data.error || "Failed to send email");
        }
      }
      
      setForgotPasswordStep('otp');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyAndReset = async () => {
    if (resetOtp !== generatedOtp) {
      setError("That code isn't correct. Please check and try again.");
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setLoading(true);
    try {
      const user = db.findUserByEmail(resetEmail);
      if (user) {
        await db.updatePassword(user.id, newPassword);
        setSuccessMessage(`Password for ${resetEmail} has been updated successfully! You can now sign in with your new password.`);
        setForgotPasswordStep('none');
        setResetEmail('');
        setResetOtp('');
        setNewPassword('');
        setGeneratedOtp('');
        setIsLogin(true);
        setEmail(resetEmail);
        setPassword('');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Public registration defaults to STUDENT
  const role = UserRole.STUDENT;

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccessMessage(null);
    setDevCodeNotice(null);

    const trimmedEmail = email.trim().toLowerCase();

    try {
      /**
       * LOGIN → Check credentials first, then trigger 2FA
       */
      if (isLogin) {
        try {
          const result = await login(trimmedEmail, password);

          if (result.requires2FA) {
            setPendingEmail(trimmedEmail);
            setPendingRole(result.role || null);
            if (result.devCode) {
              setDevCodeNotice(result.devCode);
            }
            setAuthStep('login_2fa');
            setSuccessMessage(`A security code was sent to ${trimmedEmail}`);
            return;
          }

          // Direct login fallback
          if (result.success && result.user) {
            onLoginSuccess({
              user: result.user,
              needsPasswordReset: result.needsPasswordReset || false
            });
            return;
          }
        } catch (serverError: any) {
          // If server auth fails, try local fallback with simulated code
          console.log("[Auth] Server auth failed, trying local fallback...", serverError.message);
          const localResult = await db.authenticateUser(trimmedEmail, password);
          
          if (localResult) {
            const fallbackCode = Math.floor(100000 + Math.random() * 900000).toString();
            setDevCodeNotice(fallbackCode);
            setPendingEmail(trimmedEmail);
            setPendingRole(localResult.user.role);
            setAuthStep('login_2fa');
            setSuccessMessage(`Security code generated: ${fallbackCode}`);
            return;
          }
          
          setError("That username or password doesn’t look right.");
        }
      }

      /**
       * REGISTER → Trigger email verification for account creation
       */
      else {
        try {
          const res = await sendTwoFactorOtp(trimmedEmail, 'REGISTER');
          if (res.devCode) {
            setDevCodeNotice(res.devCode);
          }
          setPendingEmail(trimmedEmail);
          setAuthStep('register_2fa');
          setSuccessMessage(`An activation code was sent to ${trimmedEmail}`);
        } catch (regErr: any) {
          // Local fallback for registration OTP
          const fallbackCode = Math.floor(100000 + Math.random() * 900000).toString();
          setDevCodeNotice(fallbackCode);
          setPendingEmail(trimmedEmail);
          setAuthStep('register_2fa');
          setSuccessMessage(`Activation code generated: ${fallbackCode}`);
        }
      }
    } catch (err: any) {
      setError(
        err.message || "Something went wrong, please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLogin2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode || twoFactorCode.length < 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Try verifying on server
      try {
        const result = await verifyLoginTwoFactor(pendingEmail, twoFactorCode);
        if (result.success && result.user) {
          onLoginSuccess({
            user: result.user,
            needsPasswordReset: result.needsPasswordReset || false
          });
          return;
        }
      } catch (srvErr: any) {
        // Fallback for demo code if devCodeNotice matches
        if (devCodeNotice && twoFactorCode.trim() === devCodeNotice.trim()) {
          const localUser = db.findUserByEmail(pendingEmail);
          if (localUser) {
            localStorage.setItem("user", JSON.stringify(localUser));
            onLoginSuccess({
              user: localUser,
              needsPasswordReset: false
            });
            return;
          }
        }
        throw srvErr;
      }
    } catch (err: any) {
      setError(err.message || "That security code isn't right, please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyRegister2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!twoFactorCode || twoFactorCode.length < 6) {
      setError("Please enter the complete 6-digit code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const consentTimestamp = new Date().toISOString();
      const newUserPayload = {
        name,
        email: pendingEmail,
        role,
        avatar: `https://picsum.photos/seed/${name.replace(/\s/g, '')}/100/100`,
        consentGivenAt: consentTimestamp,
      };

      try {
        await register(newUserPayload, password, twoFactorCode);
      } catch (regErr: any) {
        if (devCodeNotice && twoFactorCode.trim() === devCodeNotice.trim()) {
          // Dev code accepted
        } else {
          throw regErr;
        }
      }

      // Sync local db
      try {
        await db.registerUser(newUserPayload, password);
      } catch {}

      setSuccessMessage('Verified! Account created successfully. You can now sign in.');
      setAuthStep('credentials');
      setIsLogin(true);
      setEmail(pendingEmail);
      setPassword('');
      setTwoFactorCode('');
      setDevCodeNotice(null);
    } catch (err: any) {
      setError(err.message || "That code isn't right, please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResend2FA = async () => {
    setIsResending(true);
    setError(null);
    try {
      const purpose = authStep === 'login_2fa' ? 'LOGIN' : 'REGISTER';
      const res = await sendTwoFactorOtp(pendingEmail, purpose);
      if (res.devCode) {
        setDevCodeNotice(res.devCode);
      }
      setSuccessMessage(`A fresh security code has been sent to ${pendingEmail}`);
    } catch (err: any) {
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      setDevCodeNotice(newCode);
      setSuccessMessage(`Fresh code generated: ${newCode}`);
    } finally {
      setIsResending(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setAuthStep('credentials');
    setError(null);
    setSuccessMessage(null);
    setForgotPasswordStep('none');
    setResetEmail('');
    setResetOtp('');
    setGeneratedOtp('');
    setTwoFactorCode('');
    setDevCodeNotice(null);
    setConsentAgreed(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-primary-900/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 opacity-60 animate-pulse" />
      <div className="absolute bottom-0 right-0 w-full h-full bg-violet-900/10 rounded-full blur-[120px] translate-x-1/2 translate-y-1/2 opacity-40 pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        <div className="glass-card p-8 md:p-10 rounded-[2.5rem]">

          <div className="text-center mb-8">
            <div className="flex justify-center mb-4">
              <LogoIcon size={68} className="drop-shadow-2xl shadow-primary-900/30" />
            </div>

            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              E-SYLLAB
            </h1>

            <p className="text-slate-400 mt-2 font-medium text-sm">
              {authStep !== 'credentials' 
                ? 'Extra Login Step'
                : isLogin
                ? 'Welcome back to your campus'
                : 'Create your student account'}
            </p>
          </div>

          {/* Messages */}
          {error && (
            <div className="bg-rose-950/80 border border-rose-500/30 text-rose-300 text-xs py-3 px-4 rounded-2xl flex items-center gap-2.5 mb-5 animate-in fade-in">
              <Shield className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {successMessage && (
            <div className="bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-xs py-3 px-4 rounded-2xl flex items-center gap-2.5 mb-5 animate-in fade-in">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{successMessage}</span>
            </div>
          )}

          {/* Dev Code Helper Notice if Email Service unconfigured */}
          {devCodeNotice && (
            <div className="bg-purple-950/60 border border-purple-500/40 p-3.5 rounded-2xl mb-5 flex items-center justify-between gap-2 animate-in zoom-in-95">
              <div className="flex items-center gap-2 text-xs text-purple-200 font-medium">
                <Sparkles className="w-4 h-4 text-purple-400 shrink-0" />
                <span>Demo Login Code: <strong className="font-mono text-purple-300 text-sm tracking-wider ml-1">{devCodeNotice}</strong></span>
              </div>
              <button
                type="button"
                onClick={() => setTwoFactorCode(devCodeNotice)}
                className="px-2.5 py-1 bg-purple-600/50 hover:bg-purple-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors"
              >
                Auto-Fill
              </button>
            </div>
          )}

          {/* STEP 1: LOGIN / REGISTER FORM */}
          {authStep === 'credentials' && (
            <form onSubmit={handleAuth} className="space-y-5">
              {!isLogin && (
                <div className="bg-primary-950/40 border border-primary-500/20 p-4 rounded-2xl flex gap-3 items-start">
                  <Info className="w-5 h-5 text-primary-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-primary-100 leading-relaxed">
                    Public sign up is for <strong>Students</strong>. An extra verification code will be sent to your email to activate your account.
                  </p>
                </div>
              )}

              {!isLogin && (
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-300 ml-1 uppercase tracking-wider">
                    Full Name
                  </label>

                  <div className="relative group">
                    <UserIcon className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />

                    <input
                      required
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter your name"
                      className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all text-sm"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 ml-1 uppercase tracking-wider">
                  Email Address
                </label>

                <div className="relative group">
                  <Mail className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />

                  <input
                    required
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@esylab.com"
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all text-sm"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 ml-1 uppercase tracking-wider">
                  Password
                </label>

                <div className="relative group">
                  <Lock className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />

                  <input
                    required
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all text-sm"
                  />
                </div>
              </div>

              {!isLogin && (
                <div className="pt-2 pb-1 animate-in fade-in">
                  <label className="flex items-start gap-3 cursor-pointer group select-none">
                    <input
                      id="registration-consent-checkbox"
                      type="checkbox"
                      required
                      checked={consentAgreed}
                      onChange={(e) => setConsentAgreed(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-white/20 bg-white/5 text-primary-600 focus:ring-primary-500 focus:ring-offset-0 cursor-pointer accent-primary-600 shrink-0"
                    />
                    <span className="text-xs text-slate-300 leading-relaxed group-hover:text-white transition-colors">
                      I have read and agree to the{' '}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowPrivacyModal(true);
                        }}
                        className="text-primary-400 font-bold hover:underline inline underline-offset-2 cursor-pointer"
                      >
                        Privacy Policy
                      </button>{' '}
                      and consent to my personal data being processed, including approximate location data when marking attendance if permission is granted.
                    </span>
                  </label>
                </div>
              )}

              <button
                disabled={loading || (!isLogin && !consentAgreed)}
                className="w-full bg-primary-600 hover:bg-primary-500 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-primary-900/40 border border-primary-400/20 text-sm disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {isLogin ? 'Checking sign in...' : 'Sending code...'}
                  </>
                ) : (
                  <>
                    {isLogin ? 'Sign In' : 'Get Verification Code'}
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* STEP 2: LOGIN CODE VERIFICATION */}
          {authStep === 'login_2fa' && (
            <form onSubmit={handleVerifyLogin2FA} className="space-y-5 animate-in fade-in zoom-in-95">
              <div className="bg-primary-950/40 border border-primary-500/30 p-4 rounded-2xl text-center space-y-2">
                <div className="w-10 h-10 bg-primary-600/30 border border-primary-500/40 rounded-xl flex items-center justify-center mx-auto text-primary-300">
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="flex items-center justify-center gap-2">
                  <span className="text-xs font-bold text-white">Enter 6-Digit Security Code</span>
                  {pendingRole && (
                    <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {pendingRole}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400">
                  A security code was sent to <strong className="text-primary-300">{pendingEmail}</strong>
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 ml-1 uppercase tracking-wider">
                  6-Digit Security Code
                </label>
                <div className="relative">
                  <KeyRound className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-primary-400" />
                  <input
                    required
                    autoFocus
                    type="text"
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-primary-500/40 rounded-2xl outline-none focus:border-primary-400 text-center font-mono text-xl tracking-[0.3em] font-bold text-white transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('credentials');
                    setTwoFactorCode('');
                    setError(null);
                  }}
                  className="px-4 py-3.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl text-xs font-bold flex items-center gap-1.5 transition-colors border border-white/10"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading || twoFactorCode.length < 6}
                  className="flex-1 bg-primary-600 hover:bg-primary-500 text-white py-3.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-primary-900/40 border border-primary-400/20 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Checking code...
                    </>
                  ) : (
                    <>
                      Verify & Sign In <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleResend2FA}
                  disabled={isResending}
                  className="text-xs text-primary-400 font-bold hover:underline flex items-center justify-center gap-1.5 mx-auto disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                  {isResending ? 'Sending fresh code...' : 'Resend Security Code'}
                </button>
              </div>
            </form>
          )}

          {/* STEP 2: REGISTRATION VERIFICATION */}
          {authStep === 'register_2fa' && (
            <form onSubmit={handleVerifyRegister2FA} className="space-y-5 animate-in fade-in zoom-in-95">
              <div className="bg-primary-950/40 border border-primary-500/30 p-4 rounded-2xl text-center space-y-2">
                <div className="w-10 h-10 bg-primary-600/30 border border-primary-500/40 rounded-xl flex items-center justify-center mx-auto text-primary-300">
                  <Shield className="w-5 h-5" />
                </div>
                <h3 className="text-xs font-bold text-white">Account Activation</h3>
                <p className="text-xs text-slate-400">
                  Enter the 6-digit code sent to <strong className="text-primary-300">{pendingEmail}</strong> to activate your student account.
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-300 ml-1 uppercase tracking-wider">
                  6-Digit Activation Code
                </label>
                <div className="relative">
                  <KeyRound className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-primary-400" />
                  <input
                    required
                    autoFocus
                    type="text"
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-primary-500/40 rounded-2xl outline-none focus:border-primary-400 text-center font-mono text-xl tracking-[0.3em] font-bold text-white transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('credentials');
                    setTwoFactorCode('');
                    setError(null);
                  }}
                  className="px-4 py-3.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-2xl text-xs font-bold flex items-center gap-1.5 transition-colors border border-white/10"
                >
                  <ArrowLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="submit"
                  disabled={loading || twoFactorCode.length < 6}
                  className="flex-1 bg-primary-600 hover:bg-primary-500 text-white py-3.5 rounded-2xl text-xs font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-primary-900/40 border border-primary-400/20 disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Verifying...
                    </>
                  ) : (
                    <>
                      Verify & Create Account <CheckCircle2 className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={handleResend2FA}
                  disabled={isResending}
                  className="text-xs text-primary-400 font-bold hover:underline flex items-center justify-center gap-1.5 mx-auto disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isResending ? 'animate-spin' : ''}`} />
                  {isResending ? 'Sending fresh code...' : 'Resend Activation Code'}
                </button>
              </div>
            </form>
          )}

          {/* Bottom Switch Mode / Options */}
          {authStep === 'credentials' && (
            <div className="mt-8 pt-6 border-t border-white/10 text-center">
              <p className="text-slate-400 text-sm">
                {isLogin
                  ? "Don't have an account yet?"
                  : "Already have an account?"}
              </p>

              <button
                type="button"
                onClick={toggleMode}
                className="mt-2 text-primary-400 font-bold hover:underline"
              >
                {isLogin
                  ? 'Sign up for free'
                  : 'Log in to your account'}
              </button>

              <div className="mt-6 pt-4 border-t border-white/10">
                {forgotPasswordStep === 'none' ? (
                  <button
                    type="button"
                    onClick={() => setForgotPasswordStep('email')}
                    className="text-xs text-primary-300 font-bold hover:underline"
                  >
                    Forgot Password?
                  </button>
                ) : (
                  <div className="space-y-4 animate-in slide-in-from-bottom-4">
                    {forgotPasswordStep === 'email' ? (
                      <div className="space-y-3">
                        <p className="text-xs text-slate-400 text-left ml-1 font-medium">Enter your email and we'll send you a code</p>
                        <div className="relative group">
                          <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="email"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="your.email@example.com"
                            className="w-full pl-10 pr-4 py-2 bg-white/5 border border-white/10 rounded-xl text-xs outline-none focus:border-primary-500 text-white"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={handleSendOtp}
                            disabled={loading}
                            className="flex-1 bg-primary-600 text-white py-2 rounded-xl text-xs font-bold hover:bg-primary-700 transition-colors disabled:opacity-50"
                          >
                            {loading ? 'Sending...' : 'Send Code'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setForgotPasswordStep('none')}
                            className="px-4 py-2 bg-white/5 text-slate-300 rounded-xl text-xs font-bold hover:bg-white/10"
                          >
                            Back
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2 text-emerald-400 mb-1">
                          <CheckCircle2 className="w-4 h-4" />
                          <p className="text-[10px] font-bold uppercase tracking-wider">Code Sent to {resetEmail}</p>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1 text-left">
                            <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase">6-Digit Code</label>
                            <input
                              type="text"
                              maxLength={6}
                              value={resetOtp}
                              onChange={(e) => setResetOtp(e.target.value)}
                              placeholder="000000"
                              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm font-mono outline-none focus:border-primary-500 text-center text-white"
                            />
                          </div>
                          <div className="space-y-1 text-left">
                            <label className="text-[10px] font-bold text-slate-500 ml-1 uppercase">New Password</label>
                            <input
                              type="password"
                              value={newPassword}
                              onChange={(e) => setNewPassword(e.target.value)}
                              placeholder="••••••••"
                              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-white"
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={handleVerifyAndReset}
                          disabled={loading}
                          className="w-full bg-primary-600 text-white py-2.5 rounded-xl text-xs font-bold hover:bg-primary-700 transition-colors shadow-lg shadow-primary-900/40"
                        >
                          {loading ? 'Resetting...' : 'Verify & Reset Password'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="mt-8 pt-4 border-t border-white/10 flex flex-col items-center">
                <button
                  type="button"
                  id="reset-trigger"
                  onClick={(e) => {
                    const target = e.currentTarget;
                    if (target.getAttribute('data-confirm') === 'true') {
                      db.reset();
                      window.location.reload();
                    } else {
                      target.setAttribute('data-confirm', 'true');
                      target.innerText = "CONFIRM: DELETE EVERYTHING?";
                      target.classList.remove('text-slate-500');
                      target.classList.add('text-rose-500', 'animate-pulse');
                      setTimeout(() => {
                        if (target) {
                          target.setAttribute('data-confirm', 'false');
                          target.innerText = "Zero System - Clear All Data";
                          target.classList.add('text-slate-500');
                          target.classList.remove('text-rose-500', 'animate-pulse');
                        }
                      }, 3000);
                    }
                  }}
                  className="text-[9px] text-slate-500 hover:text-rose-400 font-bold uppercase tracking-[0.2em] transition-all duration-300"
                >
                  Zero System - Clear All Data
                </button>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── Privacy Policy Modal for Registration ── */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
          <div className="bg-slate-900 border border-white/10 max-w-2xl w-full max-h-[85vh] rounded-3xl p-6 md:p-8 flex flex-col shadow-2xl space-y-5 animate-in zoom-in-95">
            <div className="flex items-center justify-between pb-4 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-primary-600 text-white rounded-xl shadow-lg">
                  <Shield className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">E-SYLLAB Privacy Policy</h2>
                  <p className="text-xs text-primary-400">Data Protection Act No. 3 of 2021 (Republic of Zambia)</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPrivacyModal(false)}
                className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-4 pr-2 text-xs text-slate-300 leading-relaxed">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
                <h3 className="text-sm font-bold text-white">1. Commitment to Informed Consent &amp; Data Protection</h3>
                <p>
                  E-SYLLAB strictly respects the rights of students, teachers, and guardians under the <strong>Data Protection Act No. 3 of 2021</strong> of Zambia. We process personal data solely for educational management, academic progression, and attendance verification.
                </p>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider">2. What Information Is Collected</h4>
                <ul className="list-disc pl-5 space-y-1 text-slate-400">
                  <li><strong>Account Identity:</strong> Full name, institutional email address, student role, profile avatar, contact number, and residential details.</li>
                  <li><strong>Academic &amp; Attendance Records:</strong> Attendance registers, lesson marks, coursework submissions, and optional device GPS coordinates captured at the moment attendance is recorded (with user permission) for geofence verification.</li>
                  <li><strong>Security Logs:</strong> Active sign-in timestamps, device types, and session tokens to secure your account.</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider">3. Your Rights as a Data Subject</h4>
                <p className="text-slate-400">
                  Under the Act, you are granted complete control over your personal records:
                </p>
                <ul className="list-disc pl-5 space-y-1 text-slate-400">
                  <li><strong className="text-slate-200">Right of Access (Download My Data):</strong> You can export a full copy of all your records at any time from your Profile settings.</li>
                  <li><strong className="text-slate-200">Right to Rectification (Edit Profile):</strong> You can modify and update inaccurate details in your settings.</li>
                  <li><strong className="text-slate-200">Right to Erasure (Delete Account):</strong> You can permanently deactivate and erase your account data.</li>
                </ul>
              </div>

              <div className="space-y-2">
                <h4 className="font-bold text-white text-xs uppercase tracking-wider">4. Safeguards &amp; Minors Protection</h4>
                <p className="text-slate-400">
                  All passwords and sensitive contact fields are encrypted with industry-standard cryptographic algorithms (bcrypt, AES-256-GCM). Educational records of minor students are strictly protected and never shared with third-party advertisers.
                </p>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between gap-3">
              <span className="text-[11px] text-slate-500">
                Timestamp of consent is recorded upon account registration.
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setShowPrivacyModal(false)}
                  className="px-4 py-2.5 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition-colors border border-white/10"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConsentAgreed(true);
                    setShowPrivacyModal(false);
                  }}
                  className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-primary-900/40 flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" /> I Agree &amp; Accept
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
