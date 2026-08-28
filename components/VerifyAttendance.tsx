import React, { useState, useCallback } from 'react';
import {
  Shield, Search, CheckCircle, XCircle, Loader2,
  ExternalLink, AlertTriangle, Hash, Clock, Database,
} from 'lucide-react';
import {
  Connection,
  clusterApiUrl,
} from '@solana/web3.js';
import { verifyAttendanceHash, verifyLedgerRecord } from '../services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface VerificationResult {
  valid: boolean;
  confirmedOnChain: boolean;
  signature?: string | null;
  slot: number;
  timestamp: string;
  memoData: string;
  hashMatch: boolean;
  blockTime?: number;
  error?: string;
  statusMessage?: string;
}

// ─── Solana Connection ─────────────────────────────────────────────────────────

const DEVNET_CONNECTION = new Connection(clusterApiUrl('devnet'), 'confirmed');
const EXPLORER_BASE = 'https://explorer.solana.com/tx';

// Helper to check valid Solana signature format
const isValidSolanaSig = (sig?: string | null): boolean => {
  if (!sig || typeof sig !== 'string') return false;
  const s = sig.trim();
  return s.length >= 44 &&
    !s.startsWith('queue-') &&
    !s.startsWith('recorded-') &&
    !s.startsWith('pending-') &&
    !s.startsWith('dummy-') &&
    !s.startsWith('ledger-') &&
    !s.startsWith('cred-') &&
    !s.startsWith('att-') &&
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
};

// ─── Component ─────────────────────────────────────────────────────────────────

export const VerifyAttendance: React.FC = () => {
  const [inputType, setInputType] = useState<'signature' | 'hash'>('signature');
  const [inputValue, setInputValue] = useState('');
  const [expectedHash, setExpectedHash] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [recentVerifications, setRecentVerifications] = useState<VerificationResult[]>([]);

  // ── Verify record ─────────────────────────────────────────────────────────
  const verifyOnChain = useCallback(async () => {
    const rawVal = inputValue.trim();
    if (!rawVal) return;

    setIsVerifying(true);
    setResult(null);

    try {
      if (inputType === 'signature') {
        const signature = rawVal;
        if (!isValidSolanaSig(signature)) {
          throw new Error('Invalid transaction reference signature format. A valid Solana signature contains base58 characters.');
        }

        // Fetch transaction from Solana Devnet
        const tx = await DEVNET_CONNECTION.getTransaction(signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (!tx) {
          throw new Error('Record not found on Solana Devnet. The transaction may still be propagating or was rejected.');
        }

        if (tx.meta?.err) {
          throw new Error('Transaction was found on Solana Devnet but failed during execution.');
        }

        // Extract memo data from transaction logs
        const memoLog = tx.meta?.logMessages?.find(
          msg => msg.includes('Memo') && msg.includes('{"app":"E-SYLLAB"')
        );

        if (!memoLog) {
          throw new Error('No E-SYLLAB attendance attestation found in this transaction.');
        }

        const memoMatch = memoLog.match(/Memo \(len \d+\): (.+)/);
        const memoData = memoMatch ? memoMatch[1] : memoLog;

        let parsedMemo: any;
        try {
          parsedMemo = JSON.parse(memoData);
        } catch {
          parsedMemo = { raw: memoData };
        }

        // Check hash match if expected hash provided
        let hashMatch = true;
        if (expectedHash.trim()) {
          hashMatch = memoData.includes(expectedHash.trim()) ||
                     (parsedMemo.offlineHash && parsedMemo.offlineHash === expectedHash.trim());
        }

        const verification: VerificationResult = {
          valid: true,
          confirmedOnChain: true,
          signature,
          slot: tx.slot,
          timestamp: new Date().toISOString(),
          memoData: typeof parsedMemo === 'object' ? JSON.stringify(parsedMemo, null, 2) : memoData,
          hashMatch,
          blockTime: tx.blockTime ?? undefined,
          statusMessage: 'Verified and confirmed on Solana Devnet.',
        };

        setResult(verification);
        setRecentVerifications(prev => [verification, ...prev].slice(0, 10));
      } else {
        // Hash verification: Query backend database & verify hash integrity
        const hashToVerify = rawVal;
        let responseData: any = null;

        try {
          // Attempt ledger verification first
          responseData = await verifyLedgerRecord(hashToVerify);
        } catch (lErr) {
          // Fallback to attendance verify-hash
          responseData = await verifyAttendanceHash({ offlineHash: hashToVerify });
        }

        if (!responseData || !responseData.isValid) {
          throw new Error(responseData?.message || 'Hash not found in the verified school database or records have been tampered with.');
        }

        const hasRealSig = isValidSolanaSig(responseData.signature);
        const confirmedOnChain = Boolean(responseData.confirmedOnChain && hasRealSig);

        const verification: VerificationResult = {
          valid: true,
          confirmedOnChain,
          signature: confirmedOnChain ? responseData.signature : null,
          slot: responseData.slot || 0,
          timestamp: new Date().toISOString(),
          memoData: JSON.stringify(responseData.record || { offlineHash: hashToVerify, status: confirmedOnChain ? 'CONFIRMED' : 'PENDING' }, null, 2),
          hashMatch: true,
          statusMessage: confirmedOnChain
            ? 'Record verified and confirmed on Solana Devnet.'
            : 'Record verified against PostgreSQL school database (Pending on-chain network confirmation).',
        };

        setResult(verification);
        setRecentVerifications(prev => [verification, ...prev].slice(0, 10));
      }
    } catch (err: any) {
      setResult({
        valid: false,
        confirmedOnChain: false,
        signature: null,
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
          Check Record Authenticity
        </h2>
        <p className="text-slate-400 text-sm mt-0.5">
          Confirm that an attendance or academic record is genuine, tamper-free, and verified.
        </p>
      </div>

      {/* Verification Form */}
      <div className="glass-card p-6 rounded-2xl">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => { setInputType('signature'); setResult(null); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              inputType === 'signature'
                ? 'bg-primary-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            Record Reference Number (Solana Tx)
          </button>
          <button
            onClick={() => { setInputType('hash'); setResult(null); }}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
              inputType === 'hash'
                ? 'bg-primary-600 text-white'
                : 'bg-white/5 text-slate-400 hover:text-white'
            }`}
          >
            Record Security Code (SHA-256 Hash)
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
              {inputType === 'signature' ? 'Solana Transaction Signature' : 'Record Security Hash (SHA-256)'}
            </label>
            <div className="relative mt-1">
              <input
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                placeholder={
                  inputType === 'signature'
                    ? 'e.g. 5xV... (44+ character base58 signature)'
                    : 'e.g. a9f82c0192e84d3b6... (64-character hex hash)'
                }
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white font-mono outline-none focus:border-primary-500 transition-colors placeholder:text-slate-600"
              />
              {inputType === 'signature' && inputValue.length > 40 && isValidSolanaSig(inputValue) && (
                <CheckCircle className="absolute right-3 top-3 w-5 h-5 text-emerald-400" />
              )}
            </div>
          </div>

          {inputType === 'signature' && (
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-1">
                Security Code to Check (optional)
              </label>
              <input
                type="text"
                value={expectedHash}
                onChange={e => setExpectedHash(e.target.value)}
                placeholder="Paste the security code to confirm this record matches"
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
              <><Loader2 className="w-4 h-4 animate-spin" /> Checking record authenticity…</>
            ) : (
              <><Search className="w-4 h-4" /> Confirm Record Authenticity</>
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
              <div className="flex items-center gap-2">
                <p className={`font-bold text-sm ${result.valid ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {result.valid ? '✅ Record Confirmed Authentic' : '❌ Could Not Verify Record'}
                </p>
                {result.valid && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    result.confirmedOnChain
                      ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-500/40'
                      : 'bg-amber-900/80 text-amber-300 border border-amber-500/40'
                  }`}>
                    {result.confirmedOnChain ? 'CONFIRMED ON-CHAIN' : 'SAVED LOCALLY (PENDING ON-CHAIN)'}
                  </span>
                )}
              </div>

              {result.statusMessage && (
                <p className="text-xs text-slate-300 mt-1">
                  {result.statusMessage}
                </p>
              )}

              {result.error && (
                <p className="text-xs text-rose-300 mt-1 bg-rose-950/40 p-2 rounded-lg border border-rose-500/10">
                  <AlertTriangle className="w-3 h-3 inline mr-1" />
                  {result.error}
                </p>
              )}

              {result.valid && (
                <div className="mt-3 space-y-2">
                  {/* Signature */}
                  {result.signature && (
                    <div className="flex items-center gap-2 text-xs">
                      <Hash className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Record ID:</span>
                      <span className="font-mono text-emerald-300 truncate">{result.signature}</span>
                    </div>
                  )}

                  {/* Slot */}
                  {result.slot > 0 && (
                    <div className="flex items-center gap-2 text-xs">
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Record Slot:</span>
                      <span className="font-mono text-emerald-300">#{result.slot.toLocaleString()}</span>
                    </div>
                  )}

                  {/* Block Time */}
                  {result.blockTime && (
                    <div className="flex items-center gap-2 text-xs">
                      <Clock className="w-3.5 h-3.5 text-slate-500" />
                      <span className="text-slate-400">Recorded On:</span>
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
                          <span className="text-emerald-400 font-bold">Record Match Confirmed</span>
                          <span className="text-slate-500">— The saved record matches your security code perfectly.</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="w-4 h-4 text-rose-400" />
                          <span className="text-rose-400 font-bold">Security Code Mismatch</span>
                          <span className="text-slate-500">— The saved record does not match the provided security code.</span>
                        </>
                      )}
                    </div>
                  )}

                  {/* Memo Data */}
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Saved Record Details</p>
                    <pre className="bg-black/30 rounded-lg p-3 text-[10px] font-mono text-emerald-300 overflow-x-auto border border-emerald-500/10">
                      {result.memoData}
                    </pre>
                  </div>

                  {/* Explorer Link - Only shown when confirmed on-chain */}
                  {result.confirmedOnChain && result.signature && (
                    <a
                      href={`${EXPLORER_BASE}/${result.signature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 text-xs text-primary-400 hover:text-primary-300 hover:underline font-medium"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      View Public Record on Solana Explorer
                    </a>
                  )}
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
            <h3 className="font-bold text-white text-sm">Recent Checks</h3>
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
                    <p className="text-xs font-mono text-slate-300 truncate">
                      {v.signature ? `${v.signature.slice(0, 20)}…` : 'Local Database Record'}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {v.slot > 0 ? `Record #${v.slot.toLocaleString()}` : 'Stored in School DB'}
                    </p>
                  </div>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  v.confirmedOnChain
                    ? 'text-emerald-400 bg-emerald-950/40 border border-emerald-500/20'
                    : v.valid
                    ? 'text-amber-400 bg-amber-950/40 border border-amber-500/20'
                    : 'text-rose-400 bg-rose-950/40 border border-rose-500/20'
                }`}>
                  {v.confirmedOnChain ? 'CONFIRMED' : v.valid ? 'PENDING' : 'UNVERIFIED'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
