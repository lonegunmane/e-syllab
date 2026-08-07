import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, Paperclip, File, Film, Music, Image as ImageIcon, 
  Download, Search, User as UserIcon, MessageSquare, MoreVertical,
  X, Trash2, Check, CheckCheck, Info
} from 'lucide-react';
import { User, UserRole, Message } from '../types';
import { db } from '../services/database';
import { getMessages, sendMessage as apiSendMessage, clearMessages as apiClearMessages, authFetch } from '../services/api';

interface MessagingViewProps {
  currentUser: User;
}

export const MessagingView: React.FC<MessagingViewProps> = ({ currentUser }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [recipients, setRecipients] = useState<User[]>([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [selectedFile, setSelectedFile] = useState<{ name: string, type: string, data: string, size: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const handleClearCurrentThread = () => {
    setShowDropdown(false);
    if (!selectedRecipientId) {
      // Clear broadcast thread from local state
      setMessages(prev => prev.filter(m => m.recipientId !== 'ALL_ADMINS' && m.recipientId !== 'TEACHER_BROADCAST'));
    } else {
      // Clear specific recipient thread from local state
      setMessages(prev => prev.filter(m => 
        !(
          (m.senderId === currentUser.id && m.recipientId === selectedRecipientId) ||
          (m.senderId === selectedRecipientId && m.recipientId === currentUser.id)
        )
      ));
    }
  };

  useEffect(() => {
    // Load potential recipients
    const loadRecipients = async () => {
      try {
        if (currentUser.role === UserRole.ADMIN) {
          const res = await authFetch('/api/admin/users');
          if (res.ok) {
            const data = await res.json();
            if (data.success && Array.isArray(data.users)) {
              setRecipients(data.users.filter((u: User) => u.role === UserRole.TEACHER));
              return;
            }
          }
          setRecipients(db.getUsersByRole(UserRole.TEACHER));
        } else {
          setRecipients(db.getUsersByRole(UserRole.ADMIN));
        }
      } catch {
        if (currentUser.role === UserRole.ADMIN) {
          setRecipients(db.getUsersByRole(UserRole.TEACHER));
        } else {
          setRecipients(db.getUsersByRole(UserRole.ADMIN));
        }
      }
    };
    loadRecipients();
  }, [currentUser.role]);

  const loadMessages = async () => {
    try {
      const res = await getMessages();
      if (res.success && Array.isArray(res.messages)) {
        setMessages(res.messages);
        return;
      }
      setMessages(db.getMessages(currentUser.id));
    } catch {
      setMessages(db.getMessages(currentUser.id));
    }
  };

  useEffect(() => {
    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [currentUser.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedRecipientId]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() && !selectedFile) return;

    const recipientId = selectedRecipientId || (currentUser.role === UserRole.ADMIN ? 'TEACHER_BROADCAST' : 'ALL_ADMINS');
    const recipient = recipients.find(r => r.id === recipientId);
    const content = inputValue;
    const file = selectedFile || undefined;

    setInputValue('');
    setSelectedFile(null);

    try {
      // Send to server API
      await apiSendMessage({
        recipientId,
        recipientName: recipient?.name,
        subject: '',
        content,
        file,
      });

      // Mirror to local db
      db.sendMessage({
        senderId: currentUser.id,
        senderName: currentUser.name,
        recipientId: recipientId,
        content,
        file,
      });

      await loadMessages();
    } catch (err) {
      console.error('Failed to send message:', err);
      // fallback to local db
      try {
        db.sendMessage({
          senderId: currentUser.id,
          senderName: currentUser.name,
          recipientId: recipientId,
          content,
          file,
        });
        setMessages(db.getMessages(currentUser.id));
      } catch (dbErr) {
        console.error('Failed to cache message locally:', dbErr);
      }
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to clear your message history? This will free up storage space for new secure attachments.')) {
      try {
        await apiClearMessages();
      } catch (err) {
        console.error('Failed to clear server history:', err);
      }
      try {
        db.clearMessages(currentUser.id);
        setMessages([]);
      } catch (err) {
        console.error('Failed to clear history:', err);
      }
    }
  };

  const currentChatMessages = useMemo(() => {
    if (!selectedRecipientId) {
      // If no specific recipient, show broadcast/group messages
      return messages.filter(m => 
        m.recipientId === 'ALL_ADMINS' || 
        m.recipientId === 'TEACHER_BROADCAST'
      );
    }
    // Individual chat
    return messages.filter(m => 
      (m.senderId === currentUser.id && m.recipientId === selectedRecipientId) ||
      (m.senderId === selectedRecipientId && m.recipientId === currentUser.id)
    );
  }, [messages, selectedRecipientId, currentUser.id]);

  const filteredMessages = currentChatMessages.filter(m => 
    m.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    m.senderName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    let file: File | undefined;
    
    if ('files' in e.target && (e.target as HTMLInputElement).files) {
      file = (e.target as HTMLInputElement).files?.[0];
    } else if ('dataTransfer' in e) {
      file = (e as React.DragEvent).dataTransfer.files?.[0];
    }

    if (!file) return;

    // Limit to 5MB for localStorage demo purposes
    if (file.size > 5 * 1024 * 1024) {
      alert('File too large for local storage preview. Browser limit is approximately 5MB-10MB total. Please limit attachments to 5MB.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setSelectedFile({
        name: file!.name,
        type: file!.type,
        data: event.target?.result as string,
        size: file!.size
      });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };
    reader.readAsDataURL(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileUpload(e);
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return <ImageIcon className="w-5 h-5 text-emerald-400" />;
    if (type.startsWith('video/')) return <Film className="w-5 h-5 text-indigo-400" />;
    if (type.startsWith('audio/')) return <Music className="w-5 h-5 text-amber-400" />;
    return <File className="w-5 h-5 text-blue-400" />;
  };

  return (
    <div 
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex h-[calc(100vh-140px)] bg-[#0a0a1a]/50 rounded-3xl border transition-all overflow-hidden backdrop-blur-xl animate-in fade-in zoom-in-95 ${
        isDragging ? 'border-primary-500 bg-primary-500/10 scale-[0.99]' : 'border-white/10'
      }`}
    >
      {/* Sidebar - Recipient Selector */}
      <div className="w-72 border-r border-white/10 bg-white/5 flex flex-col hidden lg:flex">
        <div className="p-6 border-b border-white/10">
          <h3 className="text-sm font-bold text-white uppercase tracking-widest">Contacts</h3>
          <p className="text-[10px] text-slate-500 mt-1">Select a person to message</p>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <button 
            onClick={() => setSelectedRecipientId(null)}
            className={`w-full p-4 rounded-2xl flex items-center gap-3 transition-all ${
              selectedRecipientId === null 
                ? 'bg-primary-600/20 border border-primary-500/30 text-white' 
                : 'bg-white/5 border border-transparent text-slate-400 hover:bg-white/10'
            }`}
          >
            <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div className="text-left">
              <p className="text-xs font-bold uppercase tracking-wider">All Teachers</p>
              <p className="text-[10px] opacity-60">Group announcement</p>
            </div>
          </button>

          {recipients.map((r) => (
            <button 
              key={r.id}
              onClick={() => setSelectedRecipientId(r.id)}
              className={`w-full p-4 rounded-2xl flex items-center gap-3 transition-all ${
                selectedRecipientId === r.id 
                  ? 'bg-primary-600/20 border border-primary-500/30 text-white' 
                  : 'bg-white/5 border border-transparent text-slate-400 hover:bg-white/10'
              }`}
            >
              <div className="relative">
                <img src={r.avatar} className="w-10 h-10 rounded-xl object-cover bg-white/10" alt={r.name} />
                <div className="absolute -bottom-1 -right-1 w-3 h-3 bg-emerald-500 border-2 border-[#0a0a1a] rounded-full"></div>
              </div>
              <div className="text-left min-w-0">
                <p className="text-xs font-bold truncate">{r.name}</p>
                <p className="text-[10px] opacity-60 uppercase tracking-tighter">{r.role}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="p-6 border-b border-white/10 bg-white/5 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center lg:hidden">
              <MessageSquare className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                {selectedRecipientId 
                  ? recipients.find(r => r.id === selectedRecipientId)?.name 
                  : 'Messages'}
              </h2>
              <p className="text-slate-400 text-xs flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                Private &amp; Protected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden md:block">Send to:</span>
              <select 
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-primary-500 transition-all cursor-pointer hover:bg-white/10"
                value={selectedRecipientId || ''}
                onChange={(e) => setSelectedRecipientId(e.target.value || null)}
              >
                <option value="" className="bg-[#0a0a1a]">All Teachers (Group)</option>
                {recipients.map(r => (
                  <option key={r.id} value={r.id} className="bg-[#0a0a1a]">{r.name} ({r.role})</option>
                ))}
              </select>
            </div>

            <div className="hidden md:flex items-center bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 gap-2">
              <Search className="w-3 h-3 text-slate-400" />
              <input 
                type="text" 
                placeholder="Search history..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border-none outline-none text-xs text-white w-32"
              />
            </div>
            <button 
              onClick={handleClearHistory}
              title="Clear Channel History"
              className="p-2 text-slate-400 hover:text-rose-400 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
            <div className="relative" ref={dropdownRef}>
              <button 
                onClick={() => setShowDropdown(prev => !prev)}
                title="Conversation Options"
                className="p-2 text-slate-400 hover:text-white transition-colors rounded-xl hover:bg-white/5 cursor-pointer"
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {showDropdown && (
                <div className="absolute right-0 top-full mt-2 w-52 py-2 glass-card rounded-2xl border border-white/10 shadow-2xl z-30 space-y-1 animate-in fade-in zoom-in-95">
                  <button
                    type="button"
                    onClick={() => {
                      setShowDropdown(false);
                      setShowInfoModal(true);
                    }}
                    className="w-full px-4 py-2.5 text-left text-xs text-slate-200 hover:text-white hover:bg-white/10 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4 text-primary-400" />
                    <span>Conversation Info</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleClearCurrentThread}
                    className="w-full px-4 py-2.5 text-left text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/30 flex items-center gap-2.5 transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4 text-rose-400" />
                    <span>Clear Conversation</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

      {/* Messages Area */}
      <div 
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-white/10"
      >
        <AnimatePresence initial={false}>
          {filteredMessages.map((msg) => {
            const isMe = msg.senderId === currentUser.id;
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 20, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div className={`max-w-[80%] lg:max-w-[60%] flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-center gap-2 mb-1 px-1`}>
                    {!isMe && <span className="text-[10px] font-bold text-primary-400 uppercase tracking-wider">{msg.senderName}</span>}
                    <span className="text-[9px] text-slate-500">{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  
                  <div className={`relative px-4 py-3 rounded-2xl border ${
                    isMe 
                      ? 'bg-primary-600/20 border-primary-500/30 text-white rounded-tr-none' 
                      : 'bg-white/5 border-white/10 text-slate-200 rounded-tl-none'
                  }`}>
                    {msg.content && <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>}
                    
                    {msg.file && (
                      <div className={`mt-3 p-3 rounded-xl bg-black/30 border border-white/5 flex items-center gap-4 group/file`}>
                        <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center">
                          {getFileIcon(msg.file.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-white truncate">{msg.file.name}</p>
                          <p className="text-[10px] text-slate-500">{formatSize(msg.file.size)}</p>
                        </div>
                        <a 
                          href={msg.file.data} 
                          download={msg.file.name}
                          className="w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center opacity-0 group-hover/file:opacity-100 transition-opacity hover:scale-110 active:scale-95"
                          title="Download File"
                        >
                          <Download className="w-4 h-4" />
                        </a>
                      </div>
                    )}

                    <div className="absolute -bottom-5 right-0 flex items-center gap-1">
                      {isMe && <CheckCheck className="w-3 h-3 text-primary-400" />}
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {filteredMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center opacity-50 space-y-4">
            <div className="w-20 h-20 rounded-full bg-white/5 flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-slate-400" />
            </div>
            <div>
              <p className="text-white font-medium">No messages yet</p>
              <p className="text-xs text-slate-500">Your messages will appear here.</p>
            </div>
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="p-6 bg-white/5 border-t border-white/10">
        <form onSubmit={handleSendMessage} className="relative">
          <AnimatePresence>
            {selectedFile && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute -top-20 left-0 right-0 p-3 bg-primary-600 rounded-2xl flex items-center gap-3 border border-primary-400/50 shadow-2xl shadow-primary-950/40"
              >
                <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                  <File className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{selectedFile.name}</p>
                  <p className="text-[10px] text-white/70 tracking-wider uppercase font-bold">{formatSize(selectedFile.size)} READY</p>
                </div>
                <button 
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="w-8 h-8 rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="relative group">
            <input 
              type="text" 
              placeholder={selectedFile ? "Add a caption..." : "Type your message..."}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-2xl px-6 py-4 pr-32 text-sm text-white outline-none focus:border-primary-500 transition-all placeholder:text-slate-600"
            />
            <div className="absolute right-2 top-2 bottom-2 flex items-center gap-1">
              <input 
                type="file" 
                ref={fileInputRef}
                className="hidden" 
                onChange={handleFileUpload}
                accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx"
              />
              <button 
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title="Attach Media (Max 5MB)"
                className="p-2.5 text-slate-400 hover:text-white hover:bg-white/5 rounded-xl transition-all group/btn"
              >
                <Paperclip className="w-5 h-5 group-hover/btn:rotate-12 transition-transform" />
              </button>
              <button 
                type="submit"
                disabled={!inputValue.trim() && !selectedFile}
                className="p-2.5 bg-primary-600 text-white rounded-xl shadow-lg shadow-primary-900/40 hover:bg-primary-500 transition-all disabled:opacity-50 disabled:grayscale active:scale-95 group/send"
              >
                <Send className="w-5 h-5 group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 transition-transform" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>

    {/* Conversation Info Modal */}
    {showInfoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in">
        <div className="bg-slate-900 border border-white/10 max-w-md w-full rounded-3xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
          <div className="flex items-center justify-between pb-4 border-b border-white/10">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-primary-600/30 border border-primary-500/40 text-primary-400 rounded-xl">
                <Info className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white">Conversation Info</h2>
                <p className="text-xs text-slate-400">Thread Details &amp; Summary</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowInfoModal(false)}
              className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-white/5 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-3 text-xs">
            <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Participant:</span>
                <span className="text-white font-bold">
                  {selectedRecipientId 
                    ? (recipients.find(r => r.id === selectedRecipientId)?.name || 'Direct Contact')
                    : 'All Teachers (Group)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Role:</span>
                <span className="px-2 py-0.5 rounded bg-primary-950/40 border border-primary-500/20 text-primary-400 font-bold uppercase text-[10px]">
                  {selectedRecipientId 
                    ? (recipients.find(r => r.id === selectedRecipientId)?.role || 'User')
                    : 'Broadcast Channel'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Total Messages:</span>
                <span className="text-white font-mono font-bold">{currentChatMessages.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400">Encryption:</span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> End-to-End Local / DB
                </span>
              </div>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setShowInfoModal(false)}
              className="px-5 py-2.5 bg-primary-600 hover:bg-primary-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-primary-900/40 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
  );
};
