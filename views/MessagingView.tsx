import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, Paperclip, File, Film, Music, Image as ImageIcon, 
  Download, Search, User as UserIcon, MessageSquare, MoreVertical,
  X, Trash2, Check, CheckCheck
} from 'lucide-react';
import { User, UserRole, Message } from '../types';
import { db } from '../services/database';

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
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load potential recipients
    if (currentUser.role === UserRole.ADMIN) {
      setRecipients(db.getUsersByRole(UserRole.TEACHER));
    } else {
      setRecipients(db.getUsersByRole(UserRole.ADMIN));
    }
  }, [currentUser.role]);

  useEffect(() => {
    const loadMessages = () => {
      setMessages(db.getMessages(currentUser.id));
    };
    loadMessages();
    const interval = setInterval(loadMessages, 3000);
    return () => clearInterval(interval);
  }, [currentUser.id]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, selectedRecipientId]);

  const handleSendMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputValue.trim() && !selectedFile) return;

    const recipientId = selectedRecipientId || (currentUser.role === UserRole.ADMIN ? 'TEACHER_BROADCAST' : 'ALL_ADMINS');

    try {
      db.sendMessage({
        senderId: currentUser.id,
        senderName: currentUser.name,
        recipientId: recipientId,
        content: inputValue,
        file: selectedFile || undefined
      });

      setInputValue('');
      setSelectedFile(null);
      setMessages(db.getMessages(currentUser.id));
    } catch (err) {
      console.error('Failed to send message:', err);
      // alert is handled in database.ts throw block
    }
  };

  const handleClearHistory = () => {
    if (window.confirm('Are you sure you want to clear your message history? This will free up storage space for new secure attachments.')) {
      try {
        db.clearMessages(currentUser.id);
        setMessages(db.getMessages(currentUser.id));
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
          <p className="text-[10px] text-slate-500 mt-1">Select a recipient for direct link</p>
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
              <p className="text-xs font-bold uppercase tracking-wider">Broadcast</p>
              <p className="text-[10px] opacity-60">Common Channel</p>
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
                  : 'Secure Communication'}
              </h2>
              <p className="text-slate-400 text-xs flex items-center gap-2">
                <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.6)]"></span>
                Encrypted Direct Link
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest hidden md:block">Channel:</span>
              <select 
                className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white outline-none focus:border-primary-500 transition-all cursor-pointer hover:bg-white/10"
                value={selectedRecipientId || ''}
                onChange={(e) => setSelectedRecipientId(e.target.value || null)}
              >
                <option value="" className="bg-[#0a0a1a]">Broadcast Channel</option>
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
            <button className="p-2 text-slate-400 hover:text-white transition-colors">
              <MoreVertical className="w-5 h-5" />
            </button>
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
              <p className="text-xs text-slate-500">History will be preserved on the blockchain.</p>
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
  </div>
  );
};
