/**
 * academicLedger.ts — E-SYLLAB Academic Ledger
 *
 * TASK 2: Grades + credentials recorded as immutable Solana transactions
 * via server-side signing keypair.
 */

import { authFetch } from './api';
import type { GradeRecord } from '../types';

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

// ─── 1. Record a grade submission ─────────────────────────────────────────────

/**
 * Called from GradesView when a teacher saves a grade.
 * Records the grade permanently on Solana via server-side school keypair.
 */
export async function recordGrade(
  grade: GradeRecord,
  teacherName: string,
  schoolId: string = 'ZMB-KAPASA-001',
  academicYear: string = new Date().getFullYear().toString(),
  term: string = 'Term 1'
): Promise<LedgerResult> {
  try {
    const res = await authFetch('/api/blockchain/ledger/grade/record', {
      method: 'POST',
      body: JSON.stringify({
        gradeId: grade.id,
        studentId: grade.studentId,
        studentName: grade.studentName,
        teacherId: grade.teacherId,
        teacherName,
        subject: grade.subject,
        score: grade.score,
        grade: grade.grade,
        academicYear,
        term,
        schoolId,
        timestamp: grade.timestamp,
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to record grade on-chain');
    }

    const data = await res.json();
    return {
      success: true,
      offlineHash: data.offlineHash,
      signature: data.signature,
      slot: data.slot,
      explorerUrl: data.explorerUrl,
    };
  } catch (err: any) {
    console.error('[Ledger] Grade recording failed:', err);
    return { success: false, offlineHash: '', error: err.message };
  }
}

// ─── 2. Issue a student credential / transcript ───────────────────────────────

/**
 * Called when an admin issues a credential (e.g. end-of-year, student transfer).
 * Writes all subjects + grades as a single Memo transaction on Solana via server keypair.
 */
export async function issueCredential(
  credential: Omit<CredentialRecord, 'offlineHash' | 'signature' | 'slot' | 'confirmedOnChain' | 'explorerUrl' | 'timestamp'>
): Promise<LedgerResult> {
  try {
    const res = await authFetch('/api/blockchain/ledger/credential/issue', {
      method: 'POST',
      body: JSON.stringify({
        ...credential,
        timestamp: new Date().toISOString(),
      }),
    });

    if (!res.ok) {
      const errData = await res.json();
      throw new Error(errData.error || 'Failed to issue credential');
    }

    const data = await res.json();
    return {
      success: true,
      offlineHash: data.offlineHash,
      signature: data.signature,
      slot: data.slot,
      explorerUrl: data.explorerUrl,
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
 */
export async function verifyCredential(offlineHash: string): Promise<{
  isValid: boolean;
  record?: any;
  explorerUrl?: string;
  message: string;
}> {
  try {
    const res = await authFetch('/api/blockchain/ledger/verify', {
      method: 'POST',
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
