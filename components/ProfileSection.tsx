import React, { useState, useEffect } from 'react';
import { 
  User as UserIcon, Mail, Phone, School, Home, Save, Pencil, 
  Loader2, Lock
} from 'lucide-react';
import { User } from '../types';
import { db } from '../services/database';

interface ProfileSectionProps {
  user: User;
  onUpdateUser: (user: User) => void;
}

export const ProfileSection: React.FC<ProfileSectionProps> = ({ user, onUpdateUser }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<Partial<User>>({
        name: user.name, 
        email: user.email, 
        contact: user.contact, 
        school: user.school, 
        gender: user.gender, 
        residentialAddress: user.residentialAddress,
    });
    const [newPassword, setNewPassword] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{type: 'success'|'error', text: string} | null>(null);

    useEffect(() => { 
      setFormData({ 
        name: user.name, 
        email: user.email, 
        contact: user.contact, 
        school: user.school, 
        gender: user.gender, 
        residentialAddress: user.residentialAddress 
      }); 
    }, [user]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true); setMessage(null);
        try {
            await new Promise(resolve => setTimeout(resolve, 800));
            const updatedUser = db.updateUserProfile(user.id, formData);
            if (newPassword.trim() !== '') {
                db.updatePassword(user.id, newPassword);
            }
            if (updatedUser) {
                onUpdateUser(updatedUser);
                setMessage({ type: 'success', text: 'Settings updated successfully!' });
                setIsEditing(false);
                setNewPassword('');
            } else { throw new Error('User not found.'); }
        } catch (err: any) { setMessage({ type: 'error', text: err.message || 'Failed to update.' }); }
        finally { setIsLoading(false); }
    };

    const renderField = (label: string, name: keyof User, icon: React.ElementType, value?: string, type = 'text') => {
        const Icon = icon;
        return (
            <div>
                <label className="text-[10px] font-bold text-slate-500 ml-1 flex items-center gap-2 mb-1 uppercase tracking-widest">
                  <Icon className="w-3 h-3 text-primary-400" />{label}
                </label>
                <input 
                  type={type} 
                  name={name} 
                  value={value || ''} 
                  onChange={handleChange} 
                  disabled={!isEditing} 
                  className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 disabled:opacity-50 text-white transition-all placeholder:text-slate-600" 
                />
            </div>
        );
    };

    return (
        <div className="max-w-4xl mx-auto space-y-8">
            <div className="glass-card p-8 rounded-3xl animate-in fade-in">
                <div className="flex items-center justify-between mb-8">
                    <div>
                      <h2 className="text-xl font-bold text-white">Account Settings</h2>
                      <p className="text-sm text-slate-400">Manage your profile information and contact details.</p>
                    </div>
                    {!isEditing && (
                      <button 
                        onClick={() => setIsEditing(true)} 
                        className="flex items-center gap-2 px-4 py-2 bg-primary-950/40 text-primary-400 text-sm font-bold rounded-xl border border-primary-500/20 hover:bg-primary-950/60 transition-all active:scale-95"
                      >
                        <Pencil className="w-4 h-4" /> Edit Profile
                      </button>
                    )}
                </div>
                
                {message && (
                  <div className={`text-sm p-3 rounded-xl mb-4 animate-in slide-in-from-top-2 border ${
                    message.type === 'success' ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/20' : 'bg-rose-950/40 text-rose-400 border-rose-500/20'
                  }`}>
                    {message.text}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField("Full Name", "name", UserIcon, formData.name)}
                      {renderField("Email Address", "email", Mail, formData.email, "email")}
                    </div>
                    {isEditing && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="text-[10px] font-bold text-slate-500 ml-1 flex items-center gap-2 mb-1 uppercase tracking-widest">
                              <Lock className="w-3 h-3 text-primary-400" />New Password
                            </label>
                            <input 
                              type="password" 
                              name="newPassword" 
                              value={newPassword} 
                              onChange={(e) => setNewPassword(e.target.value)} 
                              disabled={!isEditing}
                              placeholder="Leave blank to keep current"
                              className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none focus:border-primary-500 text-white placeholder:text-slate-600 transition-all" 
                            />
                        </div>
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {renderField("Contact Number", "contact", Phone, formData.contact)}
                      {renderField("Institution", "school", School, formData.school)}
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 ml-1 mb-1 block uppercase tracking-widest">Gender Preference</label>
                      <select 
                        name="gender" 
                        value={formData.gender || 'Prefer not to say'} 
                        onChange={handleChange} 
                        disabled={!isEditing} 
                        className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-sm outline-none disabled:opacity-50 text-white focus:border-primary-500 transition-all"
                      >
                        <option className="bg-[#1a1635]">Male</option>
                        <option className="bg-[#1a1635]">Female</option>
                        <option className="bg-[#1a1635]">Other</option>
                        <option className="bg-[#1a1635]">Prefer not to say</option>
                      </select>
                    </div>
                    {renderField("Residential Address", "residentialAddress", Home, formData.residentialAddress)}
                    
                    {isEditing && (
                        <div className="flex items-center gap-4 pt-6 border-t border-white/5">
                            <button 
                              type="button" 
                              onClick={() => { setIsEditing(false); setNewPassword(''); }} 
                              className="px-6 py-2.5 bg-white/5 text-slate-400 text-sm font-bold rounded-xl hover:bg-white/10 transition-all"
                            >
                              Cancel
                            </button>
                            <button 
                              type="submit" 
                              disabled={isLoading} 
                              className="flex items-center gap-2 px-6 py-2.5 bg-primary-600 text-white text-sm font-bold rounded-xl hover:bg-primary-700 transition-all shadow-lg shadow-primary-900/40 disabled:opacity-50 active:scale-95"
                            >
                              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                              Save Changes
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};