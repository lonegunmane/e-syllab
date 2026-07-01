/**
 * academicLedger.ts — E-SYLLAB Academic Ledger
 *
 * TASK 2: Grades + credentials recorded as immutable Solana transactions.
 *
 * Same Memo program pattern as attendance, different payload shape.
 * Each grade submission and credential issuance gets:
 *   - An offlineHash (SHA-256 of studentId:subject:score:teacherId)
 *   - A Memo transaction signed by the teacher's Phantom wallet
 *   - A permanent Solana Explorer URL for the student transfer use case
 *
 * Student transfer flow (from your spec):
 *   Teacher exports transcript PDF → receiving school pastes the hashes
 *   into the Verify Credential endpoint → confirmed against Solana on-chain
 *   No intermediary, no central authority needed.
 */

import {
  PublicKey,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { GradeRecord } from '../types';

// ─── Constants ────────────────────────────────────────────────────────────────

const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');

// ─── Types ────────────────────────────────────────────────────────────────────

interface PhantomProvider {
  isPhantom: boolean;
  publicKey: PublicKey | null;
  isConnected: boolean;
  signAndSendTransaction: (tx: Transaction) => Promise<{ signature: string }>;
}

export interface GradeLedgerEntry {
  gradeId: string;
  studentId: string;
  studentName: string;
  teacherId: string;
  teacherName: string;
  subject: string;
  score: number;
  grade: string;           // 'A', 'B+', etc.
  academicYear: string;    // e.g. '2026'
  term: string;            // e.g. 'Term 1'
  schoolId: string;
  offlineHash: string;     // SHA-256 fingerprint — verify without blockchain
  signature?: string;      // Solana tx signature
  slot?: number;
  confirmedOnChain: boolean;
  explorerUrl?: string;
  timestamp: string;
}

export interface CredentialRecord {
  credentialId: string;
  studentId: string;
  studentName: string;
  schoolId: string;
  credentialType: 'completion' | 'distinction' | 'transfer';
  subjects: { subject: string; grade: string; score: number }[];
  issuedBy: string;        // admin/principal name
  issuedById: string;
  academicYear: string;
  offlineHash: string;
  signature?: string;
  slot?: number;
  confirmedOnChain: boolean;
  explorerUrl?: string;
  timestamp: string;
}

export interface LedgerResult {
  success: boolean;
  offlineHash: string;
  signature?: string;
  slot?: number;
  explorerUrl?: string;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPhantom(): PhantomProvider | null {
  if (typeof window === 'undefined') return null;
  const p = (window as any)?.solana;
  return p?.isPhantom ? (p as PhantomProvider) : null;
}

async function fetchBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  const res = await fetch('/api/blockchain/blockhash');
  const d   = await res.json();
  if (!d.success) throw new Error(d.error || 'Failed to fetch blockhash');
  return { blockhash: d.blockhash, lastValidBlockHeight: d.lastValidBlockHeight };
}

function explorerUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

// ─── Core transaction builder ─────────────────────────────────────────────────
// Shared by both grade and credential recording.

async function buildAndSendMemo(
  memoPayload: string,
  phantom: PhantomProvider
): Promise<{ signature: string; slot: number }> {
  const signerPublicKey = phantom.publicKey!.toBase58();
  const feePayer        = new PublicKey(signerPublicKey);

  const { blockhash, lastValidBlockHeight } = await fetchBlockhash();

  const ix = new TransactionInstruction({
    keys:      [{ pubkey: feePayer, isSigner: true, isWritable: false }],
    programId: MEMO_PROGRAM_ID,
    data:      new TextEncoder().encode(memoPayload),
  });

  const tx = new Transaction({ feePayer, blockhash, lastValidBlockHeight });
  tx.add(ix);

  const { signature } = await phantom.signAndSendTransaction(tx);
  console.log('[Ledger] Tx sent:', signature);

  // Confirm via backend
  const confirmRes  = await fetch('/api/blockchain/ledger/confirm', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature }),
  });
  const confirmData = await confirmRes.json();
  if (!confirmData.success) throw new Error(confirmData.error || 'Confirmation failed');

  return { signature, slot: confirmData.slot };
}

// ─── 1. Record a grade submission ─────────────────────────────────────────────

/**
 * Called from GradesView when a teacher saves a grade.
 * Records the grade permanently on Solana Devnet.
 *
 * Returns LedgerResult with signature + explorerUrl to display in the UI.
 */
export async function recordGrade(
  grade: GradeRecord,
  teacherName: string,
  schoolId: string = 'ZMB-KAPASA-001',
  academicYear: string = new Date().getFullYear().toString(),
  term: string = 'Term 1'
): Promise<LedgerResult> {
  const phantom = getPhantom();
  if (!phantom?.publicKey) {
    return { success: false, offlineHash: '', error: 'Phantom wallet not connected. Connect Phantom to record grades on-chain.' };
  }

  try {
    // Step 1: Backend computes hash + builds memo payload
    const prepRes  = await fetch('/api/blockchain/ledger/grade/prepare', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gradeId:      grade.id,
        studentId:    grade.studentId,
        studentName:  grade.studentName,
        teacherId:    grade.teacherId,
        teacherName,
        subject:      grade.subject,
        score:        grade.score,
        grade:        grade.grade,
        academicYear,
        term,
        schoolId,
        signerPublicKey: phantom.publicKey.toBase58(),
        timestamp:    grade.timestamp,
      }),
    });

    const prepData = await prepRes.json();
    if (!prepData.success) throw new Error(prepData.error || 'Failed to prepare grade transaction');

    // Step 2: Sign and send
    const { signature, slot } = await buildAndSendMemo(prepData.memoPayload, phantom);

    const url = explorerUrl(signature);
    console.log(`[Ledger] Grade recorded on-chain: ${grade.studentName} ${grade.subject} ${grade.grade} → ${url}`);

    return {
      success: true,
      offlineHash: prepData.offlineHash,
      signature,
      slot,
      explorerUrl: url,
    };
  } catch (err: any) {
    console.error('[Ledger] Grade recording failed:', err);
    return { success: false, offlineHash: '', error: err.message };
  }
}

// ─── 2. Issue a student credential / transcript ───────────────────────────────

/**
 * Called when an admin issues a credential (e.g. end-of-year, student transfer).
 * Writes all subjects + grades as a single Memo transaction.
 *
 * The resulting signature + offlineHash is embedded in the PDF transcript.
 * The receiving school verifies via /api/blockchain/ledger/verify.
 */
export async function issueCredential(
  credential: Omit<CredentialRecord, 'offlineHash' | 'signature' | 'slot' | 'confirmedOnChain' | 'explorerUrl' | 'timestamp'>
): Promise<LedgerResult> {
  const phantom = getPhantom();
  if (!phantom?.publicKey) {
    return { success: false, offlineHash: '', error: 'Phantom wallet not connected. Only admins with Phantom can issue credentials.' };
  }

  try {
    const prepRes  = await fetch('/api/blockchain/ledger/credential/prepare', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credential,
        signerPublicKey: phantom.publicKey.toBase58(),
        timestamp: new Date().toISOString(),
      }),
    });

    const prepData = await prepRes.json();
    if (!prepData.success) throw new Error(prepData.error || 'Failed to prepare credential');

    const { signature, slot } = await buildAndSendMemo(prepData.memoPayload, phantom);
    const url = explorerUrl(signature);

    console.log(`[Ledger] Credential issued for ${credential.studentName} → ${url}`);

    return {
      success: true,
      offlineHash: prepData.offlineHash,
      signature,
      slot,
      explorerUrl: url,
    };
  } catch (err: any) {
    console.error('[Ledger] Credential issuance failed:', err);
    return { success: false, offlineHash: '', error: err.message };
  }
}

// ─── 3. Verify a credential (receiving school use case) ──────────────────────

/**
 * Given a hash from a student's transfer transcript, checks Solana to confirm
 * the record is genuine and untampered.
 *
 * The receiving school runs this — no Phantom needed, read-only.
 */
export async function verifyCredential(offlineHash: string): Promise<{
  isValid: boolean;
  record?: any;
  explorerUrl?: string;
  message: string;
}> {
  try {
    const res  = await fetch('/api/blockchain/ledger/verify', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offlineHash }),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return {
      isValid: false,
      message: 'Could not reach the verification server. Check your internet connection.',
    };
  }
}
