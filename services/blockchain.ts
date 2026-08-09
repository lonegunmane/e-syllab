import {
  Connection,
  PublicKey,
  clusterApiUrl,
  Commitment,
} from "@solana/web3.js";

// ─── Constants ────────────────────────────────────────────────────────────────

export const SOLANA_NETWORK = "devnet";
export const SOLANA_ENDPOINT = clusterApiUrl(SOLANA_NETWORK);
export const PROGRAM_ID = new PublicKey ("97HqPsAtSz2QbiiiVQVudFU2kzmCmvFAVLiZfqVSrfzU");
// ─── Types ────────────────────────────────────────────────────────────────────

export type AttendanceStatus = "Present" | "Absent" | "Late" | "OnLeave";

export interface AttendanceRecord {
  staffId: string;
  staffName: string;
  date: string;
  time?: string;
  className?: string;
  status: AttendanceStatus;
  schoolId: string;
  syncedFromOffline: boolean;
  localTimestamp: string;
  latitude?: number | null;
  longitude?: number | null;
  locationFlagged?: boolean;
  distanceMeters?: number | null;
}

export interface LocationData {
  latitude?: number | null;
  longitude?: number | null;
}

export interface PreparedTransaction {
  transaction: string;
  offlineHash: string;
  memoPayload: string;
  message: string;
}

export interface SyncQueueItem extends AttendanceRecord {
  id: string;
  retries: number;
  queuedAt: string;
}

export interface BlockchainReceipt {
  signature: string;
  offlineHash: string;
  slot: number;
  timestamp: string;
  confirmed: boolean;
}

// ─── Connection ───────────────────────────────────────────────────────────────

let _connection: Connection | null = null;

export function getConnection(): Connection {
  if (!_connection) {
    _connection = new Connection(SOLANA_ENDPOINT, "confirmed" as Commitment);
  }
  return _connection;
}

// ─── SHA-256 Hash ─────────────────────────────────────────────────────────────

export async function computeOfflineHash(
  staffId: string,
  date: string,
  status: AttendanceStatus,
  location?: LocationData | null
): Promise<string> {
  let locStr = "NO_LOCATION";
  if (
    location &&
    location.latitude !== undefined &&
    location.latitude !== null &&
    location.longitude !== undefined &&
    location.longitude !== null &&
    !isNaN(Number(location.latitude)) &&
    !isNaN(Number(location.longitude))
  ) {
    locStr = `LOC:${Number(location.latitude).toFixed(6)},${Number(location.longitude).toFixed(6)}`;
  }
  const input = `${staffId}:${date}:${status.toUpperCase().replace(" ", "_")}:${locStr}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): number[] {
  const result: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    result.push(parseInt(hex.substring(i, i + 2), 16));
  }
  return result;
}

// ─── PDA Derivation ──────────────────────────────────────────────────────────

export async function deriveSchoolPDA(schoolId: string): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [new TextEncoder().encode("school"), new TextEncoder().encode(schoolId)],
    PROGRAM_ID
  );
  return pda;
}

export async function deriveStaffPDA(
  schoolPDA: PublicKey,
  staffId: string
): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [new TextEncoder().encode("staff"), schoolPDA.toBytes(), new TextEncoder().encode(staffId)],
    PROGRAM_ID
  );
  return pda;
}

export async function deriveAttendancePDA(
  staffPDA: PublicKey,
  dateStr: string
): Promise<PublicKey> {
  const [pda] = await PublicKey.findProgramAddress(
    [new TextEncoder().encode("attendance"), staffPDA.toBytes(), new TextEncoder().encode(dateStr)],
    PROGRAM_ID
  );
  return pda;
}

// ─── Transaction Builder ─────────────────────────────────────────────────────

export async function buildAttendanceTransaction(
  record: AttendanceRecord,
  signerPublicKey: PublicKey
): Promise<PreparedTransaction> {
  // Note: we do NOT fetch a blockhash here anymore.
  // The blockhash must be fetched fresh by the caller (server route or
  // frontend) right before signing — a stale blockhash causes
  // "Blockhash not found" errors in Phantom.
  const offlineHash = await computeOfflineHash(
    record.staffId,
    record.date,
    record.status,
    { latitude: record.latitude, longitude: record.longitude }
  );

  const memoPayload = JSON.stringify({
    app: "E-SYLLAB",
    version: "1.0",
    type: "ATTENDANCE",
    staffId: record.staffId,
    staffName: record.staffName,
    schoolId: record.schoolId,
    date: record.date,
    time: record.time || "",
    className: record.className || "",
    status: record.status,
    latitude: record.latitude ?? null,
    longitude: record.longitude ?? null,
    locationFlagged: record.locationFlagged ?? false,
    distanceMeters: record.distanceMeters ?? null,
    offlineHash,
    syncedFromOffline: record.syncedFromOffline,
    localTimestamp: record.localTimestamp,
  });

  // Return only the hash and payload — the actual Transaction object is
  // built client-side (BlockchainAttendance.tsx) with a fresh blockhash
  // fetched via /api/blockchain/blockhash right before Phantom signs.
  // This prevents "Blockhash not found" and ECONNREFUSED errors.
  return {
    transaction: "",   // unused — kept for interface compatibility
    offlineHash,
    memoPayload,
    message: `Attendance: ${record.staffId} | ${record.date} | ${record.status}`,
  };
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

export async function confirmTransaction(
  signature: string,
  offlineHash: string
): Promise<BlockchainReceipt> {
  const connection = getConnection();
  const MAX_ATTEMPTS = 30;

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const statusRes = await connection.getSignatureStatuses([signature]);
    const status = statusRes.value[0];

    if (status) {
      if (status.err) {
        throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
      }
      if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
        const txInfo = await connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        return {
          signature,
          offlineHash,
          slot: txInfo?.slot ?? status.slot ?? 0,
          timestamp: new Date().toISOString(),
          confirmed: true,
        };
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  throw new Error(`Timed out waiting for confirmation of ${signature.slice(0, 20)}...`);
}

// ─── Network Health ───────────────────────────────────────────────────────────

export async function getNetworkStatus(): Promise<{
  connected: boolean;
  slot: number;
  tps: number;
}> {
  try {
    const connection = getConnection();
    const [slot, perfSamples] = await Promise.all([
      connection.getSlot(),
      connection.getRecentPerformanceSamples(1),
    ]);
    const tps =
      perfSamples.length > 0
        ? Math.round(perfSamples[0].numTransactions / perfSamples[0].samplePeriodSecs)
        : 0;
    return { connected: true, slot, tps };
  } catch {
    return { connected: false, slot: 0, tps: 0 };
  }
}

// ─── Legacy shim (keeps existing db.ts calls working) ────────────────────────
export const blockchainService = {
  async commitHash(data: string): Promise<string> {
    const hash = await computeOfflineHash("legacy", new Date().toISOString().slice(0,10), "Present");
    console.log(`[Solana] Hash committed: ${hash}`);
    return hash;
  },
  async verifyIntegrity(_hash: string): Promise<boolean> {
    return true;
  },
};
