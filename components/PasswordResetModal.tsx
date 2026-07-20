
import React, { useState } from 'react';
import { User } from '../types';
import { db } from '../services/database';
import { KeyRound, ShieldCheck, Loader2, LogOut } from 'lucide-react';

interface PasswordResetModalProps {
    user: User;
    onResetSuccess: () => void;
    onLogout: () => void;
}

export const PasswordResetModal: React.FC<PasswordResetModalProps> = ({ user, onResetSuccess, onLogout }) => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword.length < 6) {
            setError("Password must be at least 6 characters long.");
            return;
        }
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        setLoading(true);
        setError(null);
        
        try {
            await db.updatePassword(user.id, newPassword);
            // Simulate a short delay for user feedback
            setTimeout(() => {
                onResetSuccess();
            }, 1000);
        } catch (err: any) {
            setError(err.message || "Failed to update password.");
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="glass-card shadow-2xl max-w-md w-full p-8 text-center animate-in fade-in zoom-in-95">
                <div className="w-16 h-16 bg-primary-950/40 border border-primary-500/20 rounded-2xl flex items-center justify-center text-primary-400 text-3xl mx-auto mb-6 shadow-xl shadow-primary-950/40">
                    <KeyRound className="w-8 h-8"/>
                </div>
                <h1 className="text-2xl font-extrabold text-white">Set Your New Password</h1>
                <p className="text-slate-400 mt-2 mb-6">For security, you must change your temporary password before proceeding.</p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    {error && (
                        <div className="bg-rose-950/40 border border-rose-500/20 text-rose-400 text-sm py-2 px-3 rounded-xl text-left">
                            {error}
                        </div>
                    )}
                    <input 
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="New Password"
                        className="w-full text-center px-4 py-3 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-primary-500 text-white placeholder:text-slate-600"
                    />
                     <input 
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Confirm New Password"
                        className="w-full text-center px-4 py-3 bg-white/5 border border-white/10 rounded-xl outline-none focus:border-primary-500 text-white placeholder:text-slate-600"
                    />
                    <button 
                        disabled={loading}
                        className="w-full py-3 bg-primary-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-primary-700 transition-all shadow-lg shadow-primary-900/40 disabled:opacity-70 active:scale-95"
                    >
                        {loading ? (
                            <>
                                <Loader2 className="w-5 h-5 animate-spin"/>
                                Securing Account...
                            </>
                        ) : (
                            <>
                                <ShieldCheck className="w-5 h-5"/>
                                Update Password & Continue
                            </>
                        )}
                    </button>
                </form>

                <button 
                    onClick={onLogout}
                    className="mt-6 text-[10px] uppercase tracking-widest text-slate-500 hover:text-primary-400 hover:underline flex items-center justify-center gap-2 mx-auto font-bold transition-colors"
                >
                    <LogOut className="w-3 h-3"/>
                    Log Out
                </button>
            </div>
        </div>
    );
};
