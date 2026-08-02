import React, { useState } from 'react';
import {
  Shield,
  Mail,
  Lock,
  User as UserIcon,
  ArrowRight,
  Loader2,
  CheckCircle2,
  Info
} from 'lucide-react';
import { User, UserRole } from '../types';
import { db } from '../services/database';
import { login, register } from '../services/api';

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

  const handleSendOtp = async () => {
    if (!resetEmail) {
      setError("Please enter your email");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Check if user exists
      const user = db.findUserByEmail(resetEmail);
      if (!user) {
        throw new Error("No account found with this email");
      }

      // Generate the OTP
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      setGeneratedOtp(otp);
      
      // Call the server to send the actual email
      const response = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: resetEmail, otp })
      });

      const data = await response.json();

      if (!response.ok) {
        // If the server doesn't have the API key, it will return a specific error
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
        setSuccessMessage(`Password for ${resetEmail} has been reset successfully! You can now log in with your new credentials.`);
        setForgotPasswordStep('none');
        setResetEmail('');
        setResetOtp('');
        setNewPassword('');
        setGeneratedOtp('');
        setIsLogin(true);
        // Clear login form fields
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

    try {
      /**
       * LOGIN → Authenticate via server (JWT-based)
       */
      if (isLogin) {
        const trimmedEmail = email.trim();
        
        try {
          // Try server-side authentication first (with JWT)
          const result = await login(trimmedEmail, password);

          if (result.success && result.user) {
            onLoginSuccess({
              user: result.user,
              needsPasswordReset: result.needsPasswordReset || false
            });
            return;
          }
        } catch (serverError: any) {
          // If server auth fails, try local fallback
          console.log("[Auth] Server auth failed, trying local fallback...", serverError.message);
          const localResult = await db.authenticateUser(trimmedEmail, password);
          
          if (localResult) {
            // Store token for local user (for compatibility)
            // In a real app, you'd have the server handle this
            localStorage.setItem(
              "user",
              JSON.stringify(localResult.user)
            );

            onLoginSuccess({
              user: localResult.user,
              needsPasswordReset: localResult.needsPasswordReset
            });
            return;
          }
          
          setError("Invalid email or password.");
        }
      }

      /**
       * REGISTER → Uses server database endpoint
       */
      else {
        const newUserPayload = {
          name,
          email,
          role,
          avatar: `https://picsum.photos/seed/${name.replace(/\s/g, '')}/100/100`
        };

        await register(newUserPayload, password);

        // Also sync local db if available for fallback
        try {
          await db.registerUser(newUserPayload, password);
        } catch {
          // Ignore if local db already exists or fails
        }

        setSuccessMessage(
          'Account created! You can now sign in.'
        );

        setIsLogin(true);

        // Clear fields
        setName('');
        setEmail('');
        setPassword('');
      }
    } catch (err: any) {
      setError(
        err.message || "Something went wrong. Please check your internet connection and try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setIsLogin(!isLogin);
    setError(null);
    setSuccessMessage(null);
    setForgotPasswordStep('none');
    setResetEmail('');
    setResetOtp('');
    setGeneratedOtp('');
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">
      {/* Background Decorations */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-primary-900/20 rounded-full blur-[120px] -translate-x-1/2 -translate-y-1/2 opacity-60 animate-pulse" />
      <div className="absolute bottom-0 right-0 w-full h-full bg-violet-900/10 rounded-full blur-[120px] translate-x-1/2 translate-y-1/2 opacity-40 pointer-events-none" />

      <div className="max-w-md w-full relative z-10">
        <div className="glass-card p-8 md:p-10 rounded-[2.5rem]">

          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-primary-600 rounded-2xl flex items-center justify-center text-white text-3xl font-bold mx-auto mb-4 shadow-xl shadow-primary-900/20">
              E
            </div>

            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              E-SYLAB
            </h1>

            <p className="text-slate-400 mt-2 font-medium">
              {isLogin
                ? 'Welcome back to your campus'
                : 'Create your secure student account'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-5">

            {error && (
              <div className="bg-rose-50 border border-rose-100 text-rose-600 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                <Shield className="w-4 h-4" />
                {error}
              </div>
            )}

            {successMessage && (
              <div className="bg-emerald-50 border border-emerald-100 text-emerald-600 text-sm py-3 px-4 rounded-xl flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {successMessage}
              </div>
            )}

            {!isLogin && (
              <div className="bg-primary-950/40 border border-primary-500/20 p-4 rounded-2xl flex gap-3 items-start">
                <Info className="w-5 h-5 text-primary-400 shrink-0 mt-0.5" />
                <p className="text-xs text-primary-100 leading-relaxed">
                  Public registration is for <strong>Students</strong> only.
                  Faculty members must obtain credentials from the school administration.
                </p>
              </div>
            )}

            {!isLogin && (
              <div className="space-y-2">
                <label className="text-sm font-bold text-slate-300 ml-1">
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
                    className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-300 ml-1">
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
                  className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-bold text-slate-300 ml-1">
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
                  className="w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-2xl outline-none focus:border-primary-500 text-white placeholder:text-slate-500 transition-all"
                />
              </div>
            </div>

            <button
              disabled={loading}
              className="w-full bg-primary-600 hover:bg-primary-700 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] shadow-lg shadow-primary-900/40"
            >
              {loading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  {isLogin ? 'Authenticating...' : 'Creating Record...'}
                </>
              ) : (
                <>
                  {isLogin ? 'Sign In' : 'Create Account'}
                  <ArrowRight className="w-5 h-5" />
                </>
              )}
            </button>
          </form>

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

        </div>
      </div>
    </div>
  );
};
