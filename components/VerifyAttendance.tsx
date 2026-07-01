import React, { useState, useCallback } from 'react';
import {
  Shield, Search, CheckCircle, XCircle, Loader2,
  ExternalLink, AlertTriangle, Hash, Clock, Database,
} from 'lucide-react';
import {
  Connection,
  PublicKey,
  clusterApiUrl,
} from '@solana/web3.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerificationResult {
  valid: boolean;
  signature: string;
  slot: number;
  timestamp: string;
  memoData: string;
  hashMatch: boolean;
  blockTime?: number;
  error?: string;
}

// ─── Solana Connection ─────────────────────────────────────────────────────────

const DEVNET_CONNECTION = new Connection(clusterApiUrl('devnet'), 'confirmed');
const EXPLORER_BASE = 'https://explorer.solana.com/tx';

// ─── Component ─────────────────────────────────────────────────────────────────

export const VerifyAttendance: React.FC = () => {
  const [inputType, setInputType] = useState<'signature' | 'hash'>('signature');
  const [inputValue, setInputValue] = useState('');
  const [expectedHash, setExpectedHash] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [recentVerifications, setRecentVerifications] = useState<VerificationResult[]>([]);

  // ── Verify on-chain ─────────────────────────────────────────────────────────
  const verifyOnChain = useCallback(async () => {
    if (!inputValue.trim()) return;

    setIsVerifying(true);
    setResult(null);

    try {
      let signature: string;

      if (inputType === 'signature') {
        signature = inputValue.trim();
      } else {
        // If user provided a hash, we'd need to query the DB to find the signature
        // For now, show a message
        throw new Error('Hash lookup requires backend database query. Please use the transaction signature instead.');
      }

      // Fetch transaction from Solana
      const tx = await DEVNET_CONNECTION.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        throw new Error('Transaction not found on Solana Devnet. It may be too old or the signature is invalid.');
      }

      // Extract memo data from transaction logs
      const memoLog = tx.meta?.logMessages?.find(
        msg => msg.includes('Memo') && msg.includes('{"app":"E-SYLLAB"')
      );

      if (!memoLog) {
        throw new Error('No E-SYLLAB attendance memo found in this transaction.');
      }

      // Parse memo JSON from log
      // Log format: "Program log: Memo (len 123): {"app":"E-SYLLAB",...}"
      const memoMatch = memoLog.match(/Memo \(len \d+\): (.+)/);
      const memoData = memoMatch ? memoMatch[1] : memoLog;

      let parsedMemo: any;
      try {
        parsedMemo = JSON.parse(memoData);
      } catch {
        parsedMemo = { raw: memoData };
      }

      // Check hash match if expected hash provided
      let hashMatch = false;
      if (expectedHash.trim()) {
        hashMatch = memoData.includes(expectedHash) ||
                   (parsedMemo.offlineHash && parsedMemo.offlineHash === expectedHash);
      }

      const verification: VerificationResult = {
        valid: true,
        signature,
        slot: tx.slot,
        timestamp: new Date().toISOString(),
        memoData: typeof parsedMemo === 'object' ? JSON.stringify(parsedMemo, null, 2) : memoData,
        hashMatch: expectedHash.trim() ? hashMatch : true,
        blockTime: tx.blockTime ?? undefined,
      };

      setResult(verification);
      setRecentVerifications(prev => [verification, ...prev].slice(0, 10));

    } catch (err: any) {
      setResult({
        valid: false,
        signature: inputValue,
        slot: 0,
        timestamp: new Date().toISOString(),
        memoData: '',
        hashMatch: false,
        error: err.message || 'Verification failed',
      });
    } finally {
      setIsVerifying(false);
    }
  }, [inputValue, inputType, expectedHash]);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2">

      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Shield className="w-5 h-5 text-primary-400" />
          Verify On-Chain Integrity
        </h2>
        <p className="text-slate-400 text-sm mt-0.5">
          Independently verify any attendance record against the Solana blockchain.
        </p>
      </div>

      {/* Verification Form */}
      <div className="glass-card p-6 rounded-2xl">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setInputType('signature')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              inputType === 'signature'
                ? 'bg-primary-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            Transaction Signature
          </button>
          <button
            onClick={() => setInputType('hash')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              inputType === 'hash'
                ? 'bg-primary-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            Offline Hash
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
              {inputType === 'signature' ? 'Solana Transaction Signature' : 'SHA-256 Offline Hash'}
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={
                  inputType === 'signature'
                    ? '5xV... (base58 encoded signature)'
                    : '7ab5c8e... (64-character hex hash)'
                }
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono outline-none focus:border-primary-500 transition-colors placeholder:text-slate-600"
              />
              {inputType === 'signature' && inputValue.length > 80 && (
                <CheckCircle className="absolute right-3 top-3 w-5 h-5 text-emerald-400" />
              )}
            </div>
          </div>

          {inputType === 'signature' && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Expected Offline Hash (optional — for integrity check)
              </label>
              <input
                type="text"
                value={expectedHash}
                onChange={e => setExpectedHash(e.target.value)}
                placeholder="Paste the offline hash to verify it matches the on-chain record"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono outline-none focus:border-primary-500 transition-colors placeholder:text-slate-600 mt-1"
              />
            </div>
          )}

          <button
            onClick={verifyOnChain}
            disabled={isVerifying || !inputValue.trim()}
            className="w-full py-3 bg-primary-600 text-white rounded-xl font-bold text-sm flex items-center justify-center gap-2 hover:bg-primary-700 transition-all active:scale-95 shadow-lg shadow-primary-900/40 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isVerifying ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Querying Solana Devnet…</>
            ) : (
              <><Search className="w-4 h-4" /> Verify on Blockchain</>
            )}
          </button>
        </div>
      </div>

      {/* Verification Result */}
      {result && (
        <div className={`p-5 rounded-2xl border animate-in slide-in-from-top-2 ${
          result.valid
            ? 'bg-emerald-950/30 border-emerald-500/30'
            : 'bg-rose-950/30 border-rose-500/30'
        }`}>
          <div className="flex items-start gap-3">
            {result.valid ? (
              <CheckCircle className="w-6 h-6 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="w-6 h-6 text-rose-400 mt-0.5 shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className={`font-bold text-sm ${result.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                {result.valid ? '✅ Record Verified on Solana Devnet!' : '❌ Verification Failed'}
              </p>

              {result.error && (
                <p className="text-xs text-rose-300 mt-1 bg-rose-950/40 p-2 rounded-lg border border-rose-500/10">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  {result.error}
                </p>
              )}

              {result.valid && (
                <div className="mt-3 space-y-2">
                  {/* Signature */}
                  <div className="flex items-center gap-2 text-xs">
                    <Hash className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-400">Signature:</span>
                    <span className="font-mono text-emerald-300 truncate">{result.signature}</span>
                  </div>

                  {/* Slot */}
                  <div className="flex items-center gap-2 text-xs">
                    <Database className="w-3.5 h-3.5 text-slate-500" />
                    <span className="text-slate-400">PoH Slot:</span>
                    <span className="font-mono text-emerald-300">{result.slot.toLocaleString()}</span>
                  </div>

                  {/* Block Time */}
                  {result.blockTime && (
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Timestamp:</span>
                      <span className="text-emerald-300">
                        {new Date(result.blockTime * 1000).toLocaleString()}
                      </span>
                    </div>
                  )}

                  {/* Hash Match */}
                  {expectedHash.trim() && (
                    <div className="flex items-center gap-2 text-xs mt-2 p-2 rounded-lg bg-black/20 border border-white/5">
                      {result.hashMatch ? (
                        <>
                          <CheckCircle className="w-4 h-4 text-emerald-400" />
                          <span className="text-emerald-400 font-bold">Hash Match Confirmed</span>
                          <span className="text-slate-500">— The on-chain record matches your expected hash.</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-rose-400" />
                          <span className="text-rose-400 font-bold">Hash Mismatch!</span>
                          <span className="text-slate-500">— The on-chain data does not match your hash.</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Memo Data */}
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">On-Chain Memo Data</p>
                    <pre className="bg-black/30 rounded-lg p-3 text-[10px] font-mono text-emerald-300 overflow-x-auto border border-emerald-500/10">
                      {result.memoData}
                    </pre>
                  </div>

                  {/* Explorer Link */}
                  <a
                    href={`${EXPLORER_BASE}/${result.signature}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 hover:underline font-medium"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    View Full Transaction on Solana Explorer
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Recent Verifications */}
      {recentVerifications.length > 0 && (
        <div className="glass-card rounded-2xl overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <h3 className="font-bold text-white text-sm">Recent Verifications</h3>
          </div>
          <div className="divide-y divide-white/5">
            {recentVerifications.map((v, i) => (
              <div key={i} className="p-4 flex items-center justify-between hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  {v.valid ? (
                    <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-slate-300 truncate">{v.signature.slice(0, 20)}…</p>
                    <p className="text-[10px] text-slate-500">Slot {v.slot.toLocaleString()}</p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  v.valid ? 'text-emerald-400 bg-emerald-950/40' : 'text-rose-400 bg-rose-950/40'
                }`}>
                  {v.valid ? 'Valid' : 'Invalid'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
