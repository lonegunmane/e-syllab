
import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCcw } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const triggerSync = () => {
    setIsSyncing(true);
    setTimeout(() => setIsSyncing(false), 2000);
  };

  return (
    <div className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 px-4 py-2 rounded-full shadow-lg border transition-all ${
      isOnline ? 'bg-white border-emerald-100' : 'bg-amber-50 border-amber-200'
    }`}>
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4 text-emerald-500" />
          <span className="text-xs font-medium text-slate-600">Connected</span>
          <button 
            onClick={triggerSync}
            className={`p-1 hover:bg-slate-100 rounded-full ${isSyncing ? 'animate-spin' : ''}`}
          >
            <RefreshCcw className="w-3 h-3 text-slate-400" />
          </button>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 text-amber-500" />
          <span className="text-xs font-medium text-amber-700">Offline Mode</span>
        </>
      )}
    </div>
  );
};
