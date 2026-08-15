/**
 * E-SYLLAB Solana Devnet Airdrop Helper
 *
 * Automatically checks wallet balance and requests airdrop if below threshold.
 * Uses multiple faucet sources as fallback for reliability.
 *
 * Place in: src/services/solanaAirdrop.ts
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Connection,
  PublicKey,
  clusterApiUrl,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// ─── Configuration ─────────────────────────────────────────────────────────────

const MINIMUM_BALANCE_SOL = 0.5;  // Request airdrop if below this
const AIRDROP_AMOUNT_SOL = 2;     // Amount to request per airdrop
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

const DEVNET_CONNECTION = new Connection(clusterApiUrl('devnet'), 'confirmed');

// ─── Types ────────────────────────────────────────────────────────────────────

interface AirdropResult {
  success: boolean;
  newBalance: number;
  signature?: string;
  error?: string;
}

// ─── Balance Checker ─────────────────────────────────────────────────────────

/**
 * Get wallet balance in SOL (not lamports)
 */
export async function getBalanceSOL(publicKey: string | PublicKey): Promise<number> {
  const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
  const balanceLamports = await DEVNET_CONNECTION.getBalance(pubkey, 'confirmed');
  return balanceLamports / LAMPORTS_PER_SOL;
}

/**
 * Check if wallet needs airdrop (below minimum threshold)
 */
export async function needsAirdrop(publicKey: string | PublicKey): Promise<boolean> {
  const balance = await getBalanceSOL(publicKey);
  return balance < MINIMUM_BALANCE_SOL;
}

// ─── Airdrop Methods ─────────────────────────────────────────────────────────

/**
 * Method 1: Programmatic airdrop via Solana RPC (most reliable)
 */
async function requestRPCAirdrop(
  publicKey: PublicKey,
  amountSol: number
): Promise<string> {
  const signature = await DEVNET_CONNECTION.requestAirdrop(
    publicKey,
    amountSol * LAMPORTS_PER_SOL
  );

  // Wait for confirmation
  await DEVNET_CONNECTION.confirmTransaction(signature, 'confirmed');
  return signature;
}

/**
 * Method 2: Web faucet fallback (if RPC fails)
 * Opens faucet in new tab for manual claim
 */
function openFaucetFallback(publicKey: string): void {
  const faucets = [
    `https://solfaucet.com/?address=${publicKey}`,
    `https://faucet.quicknode.com/solana/devnet?address=${publicKey}`,
  ];

  // Open first faucet
  window.open(faucets[0], '_blank', 'noopener,noreferrer');
}

// ─── Main Airdrop Function ────────────────────────────────────────────────────

/**
 * Ensures wallet has sufficient SOL for transactions.
 * Auto-requests airdrop if balance is low.
 *
 * @param publicKey - Wallet public key (base58 string or PublicKey object)
 * @returns AirdropResult with new balance
 */
export async function ensureBalance(
  publicKey: string | PublicKey
): Promise<AirdropResult> {
  const pubkey = typeof publicKey === 'string' ? new PublicKey(publicKey) : publicKey;
  const pubkeyStr = pubkey.toBase58();

  try {
    // Check current balance
    const currentBalance = await getBalanceSOL(pubkey);
    console.log(`[Airdrop] Current balance: ${currentBalance.toFixed(4)} SOL`);

    if (currentBalance >= MINIMUM_BALANCE_SOL) {
      return {
        success: true,
        newBalance: currentBalance,
      };
    }

    console.log(`[Airdrop] Balance low (${currentBalance.toFixed(4)} SOL). Requesting ${AIRDROP_AMOUNT_SOL} SOL...`);

    // Try RPC airdrop with retries
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const signature = await requestRPCAirdrop(pubkey, AIRDROP_AMOUNT_SOL);
        console.log(`[Airdrop] Success! Signature: ${signature}`);

        // Get updated balance
        const newBalance = await getBalanceSOL(pubkey);
        console.log(`[Airdrop] New balance: ${newBalance.toFixed(4)} SOL`);

        return {
          success: true,
          newBalance,
          signature,
        };
      } catch (err: any) {
        lastError = err.message;
        console.warn(`[Airdrop] Attempt ${attempt}/${MAX_RETRIES} failed: ${lastError}`);

        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    // All RPC attempts failed — fallback to web faucet
    console.warn('[Airdrop] RPC airdrop failed. Opening web faucet...');
    openFaucetFallback(pubkeyStr);

    return {
      success: false,
      newBalance: currentBalance,
      error: `RPC airdrop failed after ${MAX_RETRIES} attempts. ${lastError}. Web faucet opened.`,
    };

  } catch (err: any) {
    console.error('[Airdrop] Unexpected error:', err);
    return {
      success: false,
      newBalance: 0,
      error: err.message || 'Unknown airdrop error',
    };
  }
}

// ─── Hook for React Components ───────────────────────────────────────────────

/**
 * React hook: Auto-check and airdrop on component mount
 * Usage:
 *   const { balance, isLoading, error, refresh } = useSolanaBalance(walletPublicKey);
 */
export function useSolanaBalance(publicKey: string | null) {
  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    setIsLoading(true);
    setError(null);

    try {
      const bal = await getBalanceSOL(publicKey);
      setBalance(bal);

      if (bal < MINIMUM_BALANCE_SOL) {
        const result = await ensureBalance(publicKey);
        if (result.success) {
          setBalance(result.newBalance);
        } else {
          setError(result.error || 'Airdrop failed');
        }
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balance, isLoading, error, refresh };
}

// ─── Utility: Format SOL for display ─────────────────────────────────────────

export function formatSOL(lamports: number): string {
  return `${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`;
}
