import React, { useState, useEffect, useCallback } from 'react';
import {
  History, ExternalLink, Loader2, RefreshCw, Wallet,
  TrendingUp, TrendingDown, Zap, ArrowUpRight,
} from 'lucide-react';
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxRecord {
  signature: string;
  slot: number;
  blockTime: number | null;
  fee: number;
  status: 'success' | 'failed';
  memo?: string;
}

interface WalletStats {
  balance: number;
  totalTxs: number;
  totalFees: number;
  avgFee: number;
  successRate: number;
}

// ─── Solana Connection ─────────────────────────────────────────────────────────

const DEVNET_CONNECTION = new Connection(clusterApiUrl('devnet'), 'confirmed');
const EXPLORER_BASE = 'https://explorer.solana.com/tx';

// ─── Component ─────────────────────────────────────────────────────────────────

interface Props {
  walletAddress: string | null;
}

export const TxHistory: React.FC<Props> = ({ walletAddress }) => {
  const [records, setRecords] = useState<TxRecord[]>([]);
  const [stats, setStats] = useState<WalletStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // ── Fetch transaction history ───────────────────────────────────────────────
  const fetchHistory = useCallback(async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    setError('');

    try {
      const pubkey = new PublicKey(walletAddress);

      // Get signatures for address (last 50)
      const signatures = await DEVNET_CONNECTION.getSignaturesForAddress(
        pubkey,
        { limit: 50 }
      );

      // Get balance
      const balanceLamports = await DEVNET_CONNECTION.getBalance(pubkey);
      const balance = balanceLamports / LAMPORTS_PER_SOL;

      // Fetch details for each transaction
      const txs: TxRecord[] = [];
      let totalFees = 0;
      let successCount = 0;

      for (const sigInfo of signatures) {
        try {
          const tx = await DEVNET_CONNECTION.getTransaction(sigInfo.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (!tx) continue;

          // Extract memo from logs
          const memoLog = tx.meta?.logMessages?.find(
            msg => msg.includes('Memo') && msg.includes('E-SYLLAB')
          );
          let memo: string | undefined;
          if (memoLog) {
            const match = memoLog.match(/Memo \(len \d+\): (.+)/);
            memo = match ? match[1] : undefined;
          }

          const fee = (tx.meta?.fee ?? 0) / LAMPORTS_PER_SOL;
          totalFees += fee;
          if (!sigInfo.err) successCount++;

          txs.push({
            signature: sigInfo.signature,
            slot: sigInfo.slot,
            blockTime: sigInfo.blockTime ?? null,
            fee,
            status: sigInfo.err ? 'failed' : 'success',
            memo,
          });
        } catch {
          // Skip failed individual tx fetches
        }
      }

      setRecords(txs);
      setStats({
        balance,
        totalTxs: signatures.length,
        totalFees,
        avgFee: signatures.length > 0 ? totalFees / signatures.length : 0,
        successRate: signatures.length > 0 ? (successCount / signatures.length) * 100 : 0,
      });

    } catch (err: any) {
      setError(err.message || 'Failed to fetch transaction history');
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // ── Format helpers ──────────────────────────────────────────────────────────
  const formatDate = (blockTime: number | null): string => {
    if (!blockTime) return 'Unknown';
    return new Date(blockTime * 1000).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFee = (fee: number): string => {
    if (fee < 0.000001) return '< 0.000001 SOL';
    return `${fee.toFixed(6)} SOL`;
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!walletAddress) {
    return (
      <div className="glass-card p-8 rounded-2xl text-center">
        <Wallet className="w-10 h-10 text-slate-600 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">Connect your Phantom wallet to view transaction history.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <History className="w-5 h-5 text-primary-400" />
            Account Activity &amp; Record History
          </h2>
          <p className="text-slate-400 text-sm mt-0.5">
            All verified school records associated with your account.
          </p>
        </div>
        <button
          onClick={fetchHistory}
          disabled={isLoading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs text-slate-400 hover:text-white hover:border-primary-500/40 transition-all"
        >
          {isLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Network Credits</p>
            <p className="text-lg font-bold text-white mt-1">{stats.balance.toFixed(4)} SOL</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Secure Network</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Records</p>
            <p className="text-lg font-bold text-white mt-1">{stats.totalTxs}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Permanent records</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Network Usage</p>
            <p className="text-lg font-bold text-emerald-400 mt-1">{stats.totalFees.toFixed(6)}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Activity cost</p>
          </div>
          <div className="glass-card p-4 rounded-2xl">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Success Rate</p>
            <p className="text-lg font-bold text-emerald-400 mt-1">{stats.successRate.toFixed(1)}%</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Verified entries</p>
          </div>
        </div>
      )}

      {/* Fee Trend Mini-Chart */}
      {records.length > 1 && (
        <div className="glass-card p-4 rounded-2xl">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Activity Trend (Last {Math.min(records.length, 20)} Records)</p>
          <div className="flex items-end gap-1 h-16">
            {records.slice(0, 20).reverse().map((tx, i) => {
              const maxFee = Math.max(...records.map(r => r.fee)) || 1;
              const height = (tx.fee / maxFee) * 100;
              return (
                <div
                  key={i}
                  className={`flex-1 rounded-t-sm transition-all hover:opacity-80 ${
                    tx.status === 'success' ? 'bg-emerald-500/60' : 'bg-rose-500/60'
                  }`}
                  style={{ height: `${Math.max(height, 5)}%` }}
                  title={`Cost: ${formatFee(tx.fee)} | ${formatDate(tx.blockTime)}`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Transaction Table */}
      <div className="glass-card rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-white/5 flex justify-between items-center">
          <h3 className="font-bold text-white text-sm">Recent Activity</h3>
          <span className="px-2 py-0.5 bg-primary-950/40 text-primary-400 text-[10px] font-bold rounded-full border border-primary-500/20">
            {records.length} Records
          </span>
        </div>

        {isLoading ? (
          <div className="p-12 text-center">
            <Loader2 className="w-8 h-8 text-primary-400 animate-spin mx-auto mb-3" />
            <p className="text-slate-500 text-sm">Loading activity records…</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400 text-sm">{error}</div>
        ) : records.length === 0 ? (
          <div className="p-12 text-center text-slate-500 italic text-sm">
            <History className="w-10 h-10 mx-auto mb-3 opacity-10" />
            No saved records found for your account yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-slate-500 font-bold uppercase text-[10px] tracking-widest">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Record Reference</th>
                  <th className="px-4 py-3">Record #</th>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Cost</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Public Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {records.map((tx, i) => (
                  <tr key={i} className="hover:bg-white/5 transition-colors">
                    <td className="px-4 py-3">
                      {tx.status === 'success' ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400">
                          <TrendingUp className="w-3 h-3" /> Verified
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-rose-400">
                          <TrendingDown className="w-3 h-3" /> Unresolved
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[10px] text-slate-300">
                        {tx.signature.slice(0, 12)}…{tx.signature.slice(-6)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">
                      {tx.slot.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-[10px] text-slate-400">
                      {formatDate(tx.blockTime)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[10px] font-mono text-slate-300">
                        {formatFee(tx.fee)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {tx.memo ? (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-primary-400">
                          <Zap className="w-3 h-3" /> E-SYLLAB
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-600">Other</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <a
                        href={`${EXPLORER_BASE}/${tx.signature}?cluster=devnet`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] text-primary-400 hover:text-primary-300 transition-colors"
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        View Proof
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
