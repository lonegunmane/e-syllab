import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { serverDb } from "./services/serverDatabase.js";
import { UserRole, DocumentStatus } from "./types.js";
import { validatePassword } from "./services/passwordValidation.js";
import {
  buildAttendanceTransaction,
  confirmTransaction,
  getNetworkStatus,
  computeOfflineHash,
  getConnection,
} from "./services/blockchain.js";

const rootDir = process.cwd();

// ─── School signing keypair (used to auto-sync offline records) ──────────────
// Generate once with: node generate-keypair.js
// Then add the printed line to .env.local:
//   SCHOOL_SIGNING_KEYPAIR=[12,45,67,...]
let _fallbackSchoolKeypair: Keypair | null = null;
function getSchoolKeypair(): Keypair {
  const raw = process.env.SCHOOL_SIGNING_KEYPAIR;
  if (raw) {
    try {
      const secretKey = Uint8Array.from(JSON.parse(raw));
      return Keypair.fromSecretKey(secretKey);
    } catch (err) {
      console.warn("[Server] Could not load SCHOOL_SIGNING_KEYPAIR from env:", err);
    }
  }
  if (!_fallbackSchoolKeypair) {
    _fallbackSchoolKeypair = Keypair.generate();
    console.log("[Server] Generated ephemeral SCHOOL_SIGNING_KEYPAIR:", _fallbackSchoolKeypair.publicKey.toBase58());
  }
  return _fallbackSchoolKeypair;
}

// ─── Resend ───────────────────────────────────────────────────────────────────
let resend: Resend | null = null;
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
};

function getValidResendFromEmail(): string {
  const custom = process.env.RESEND_FROM_EMAIL?.trim();
  if (custom) {
    const lower = custom.toLowerCase();
    // Public webmail domains cannot be verified on Resend and trigger validation_error
    const isPublicDomain = /@(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|mac|aol|proton|protonmail|zoho|mail)\.com/i.test(lower);
    if (!isPublicDomain && lower.includes('@')) {
      return custom;
    }
    console.warn(`[Resend] RESEND_FROM_EMAIL ("${custom}") uses a public webmail domain that cannot be verified on Resend. Falling back to "E-SYLLAB <onboarding@resend.dev>".`);
  }
  return "E-SYLLAB <onboarding@resend.dev>";
}

async function sendResendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; error?: string }> {
  const client = getResend();
  if (!client) {
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const primaryFrom = getValidResendFromEmail();

  try {
    let result = await client.emails.send({
      from: primaryFrom,
      to,
      subject,
      html,
    });

    // If there was an error (e.g. domain not verified) and we didn't use onboarding@resend.dev, try the standard sandbox address
    if (result.error && primaryFrom !== "E-SYLLAB <onboarding@resend.dev>") {
      console.warn(`[Resend] Delivery with "${primaryFrom}" failed (${result.error.name}: ${result.error.message}). Retrying with "E-SYLLAB <onboarding@resend.dev>"...`);
      result = await client.emails.send({
        from: "E-SYLLAB <onboarding@resend.dev>",
        to,
        subject,
        html,
      });
    }

    if (result.error) {
      const isSandboxRestriction = result.error.name === 'validation_error' && result.error.message?.includes('testing emails');
      if (isSandboxRestriction) {
        console.info(`[Resend Notice] Recipient ${to} is not the Resend account owner in sandbox mode. Generated local code successfully.`);
      } else {
        console.warn("[Resend] Email delivery failed:", result.error.name, result.error.message);
      }
      return { success: false, error: result.error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn("[Resend] Email delivery exception:", err?.message || err);
    return { success: false, error: err?.message || "Email delivery failed" };
  }
}

// ─── JWT Configuration ────────────────────────────────────────────────────────
const isProduction = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (isProduction ? "" : "your-secret-key-change-in-production");

if (isProduction && !process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET environment variable is missing in production. Refusing to start.");
  process.exit(1);
}

const JWT_EXPIRY = '12h';

// In-memory token blacklist for logout (in production, use Redis or a database)
const tokenBlacklist = new Set<string>();

// Interface for JWT payload
interface JwtPayload {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

// Extended Express Request to include user info
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

// ─── Authentication Middleware ────────────────────────────────────────────────
async function authenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ success: false, error: 'Please sign in to continue' });
  }

  // Check if token is blacklisted
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ success: false, error: 'Your login has ended, please sign in again' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    const dbUser = await serverDb.findUserById(decoded.userId);
    if (dbUser && dbUser.active === false) {
      return res.status(403).json({ success: false, error: 'This account has been deactivated' });
    }
    req.user = decoded;
    next();
  } catch (err: any) {
    return res.status(401).json({ success: false, error: 'Your login has ended, please sign in again' });
  }
}

// ─── Role-Based Access Control Middleware ─────────────────────────────────────
function authorizeRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Please sign in to continue' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: "You don't have permission to perform this action" });
    }

    next();
  };
}

// ─── Device Information Parser ────────────────────────────────────────────────
function parseDevice(userAgent: string): string {
  if (!userAgent || userAgent === 'Unknown') return 'Web Browser';
  if (/mobile|android|iphone|ipad|ipod/i.test(userAgent)) {
    if (/iphone/i.test(userAgent)) return 'iPhone (Mobile Safari)';
    if (/ipad/i.test(userAgent)) return 'iPad (Tablet)';
    if (/android/i.test(userAgent)) return 'Android Device (Mobile)';
    return 'Mobile Browser';
  }
  if (/macintosh|mac os x/i.test(userAgent)) {
    if (/chrome/i.test(userAgent) && !/edg/i.test(userAgent)) return 'Mac (Chrome)';
    if (/safari/i.test(userAgent) && !/chrome/i.test(userAgent)) return 'Mac (Safari)';
    return 'Mac (Desktop)';
  }
  if (/windows/i.test(userAgent)) {
    if (/edg/i.test(userAgent)) return 'Windows (Edge)';
    if (/chrome/i.test(userAgent)) return 'Windows (Chrome)';
    if (/firefox/i.test(userAgent)) return 'Windows (Firefox)';
    return 'Windows PC (Desktop)';
  }
  if (/linux/i.test(userAgent)) return 'Linux (Desktop)';
  return 'Desktop Browser';
}

// ─── Server ───────────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  // Initialize database
  await serverDb.init();

  app.use(express.json());

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const allowedOriginEnv = process.env.ALLOWED_ORIGIN?.trim();
    const defaultProdOrigin = "https://e-syllab.vercel.app";

    if (process.env.NODE_ENV === "production") {
      const allowedOrigins = allowedOriginEnv 
        ? allowedOriginEnv.split(",").map(o => o.trim()).filter(Boolean)
        : [defaultProdOrigin];

      if (origin && allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
      } else if (!origin) {
        res.header("Access-Control-Allow-Origin", allowedOrigins[0] || defaultProdOrigin);
      } else {
        res.header("Access-Control-Allow-Origin", allowedOrigins[0] || defaultProdOrigin);
      }
    } else {
      res.header("Access-Control-Allow-Origin", origin || "*");
    }

    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // ════════════════════════════════════════════
  //  BLOCKCHAIN ROUTES
  // ════════════════════════════════════════════

  // GET /api/blockchain/status
  app.get("/api/blockchain/status", async (_req, res) => {
    try {
      const status = await getNetworkStatus();
      const queueSize = await serverDb.getSyncQueueSize();
      res.json({ success: true, network: "devnet", ...status, queueSize });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/blockchain/blockhash
  // Frontend fetches blockhash through here to avoid CORS / ECONNREFUSED
  // errors when the browser tries to call Solana RPC directly.
  app.get("/api/blockchain/blockhash", authenticateToken, async (_req, res) => {
    try {
      const connection = getConnection();
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
      res.json({ success: true, blockhash, lastValidBlockHeight });
    } catch (err: any) {
      console.error("[Blockchain] Failed to fetch blockhash:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/blockchain/balance?pubkey=...
  app.get("/api/blockchain/balance", authenticateToken, async (req, res) => {
    const { pubkey } = req.query;
    if (!pubkey || typeof pubkey !== "string") {
      return res.status(400).json({ success: false, error: "Missing pubkey" });
    }
    try {
      const connection = getConnection();
      const lamports = await connection.getBalance(new PublicKey(pubkey), "confirmed");
      res.json({ success: true, lamports, sol: lamports / 1e9 });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

// ─── Haversine Distance & Location Evaluation ─────────────────────────
function calculateHaversineDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth's radius in meters
  const toRad = (val: number) => (val * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaPhi = toRad(lat2 - lat1);
  const deltaLambda = toRad(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function evaluateAttendanceLocation(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  schoolConfig: { latitude: number; longitude: number; radiusMeters: number }
): {
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  locationFlagged: boolean;
} {
  const hasValidCoords =
    latitude !== undefined &&
    latitude !== null &&
    longitude !== undefined &&
    longitude !== null &&
    !isNaN(Number(latitude)) &&
    !isNaN(Number(longitude));

  if (!hasValidCoords) {
    return {
      latitude: null,
      longitude: null,
      distanceMeters: null,
      locationFlagged: true,
    };
  }

  const latNum = Number(latitude);
  const lonNum = Number(longitude);
  const distanceMeters = calculateHaversineDistanceMeters(
    latNum,
    lonNum,
    schoolConfig.latitude,
    schoolConfig.longitude
  );

  const locationFlagged = distanceMeters > (schoolConfig.radiusMeters || 150);

  return {
    latitude: latNum,
    longitude: lonNum,
    distanceMeters: Math.round(distanceMeters * 10) / 10,
    locationFlagged,
  };
}

  // ─── Admin School Location & Geofencing Routes ─────────────────────────
  // GET /api/admin/school-location - ADMIN only
  app.get("/api/admin/school-location", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    try {
      const location = await serverDb.getSchoolLocation();
      res.json({ success: true, location });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/school-location - ADMIN only
  app.post("/api/admin/school-location", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { latitude, longitude, radiusMeters } = req.body;
    if (
      latitude === undefined || longitude === undefined || radiusMeters === undefined ||
      isNaN(Number(latitude)) || isNaN(Number(longitude)) || isNaN(Number(radiusMeters))
    ) {
      return res.status(400).json({ success: false, error: "Please provide valid numeric coordinates and radius (meters)" });
    }

    try {
      await serverDb.setSchoolLocation({
        latitude: Number(latitude),
        longitude: Number(longitude),
        radiusMeters: Math.max(10, Number(radiusMeters)),
      });
      const updated = await serverDb.getSchoolLocation();
      res.json({ success: true, location: updated, message: "School location & geofence updated successfully" });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/admin/attendance/records - ADMIN only
  app.get("/api/admin/attendance/records", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    try {
      const flaggedOnly = req.query.flagged === 'true';
      const records = await serverDb.getAllAttendanceRecords(flaggedOnly);
      res.json({ success: true, count: records.length, records });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/record - TEACHER/ADMIN only
  // Online submission — server signs transaction with SCHOOL_SIGNING_KEYPAIR
  app.post("/api/blockchain/attendance/record", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { staffId, staffName, date, time, className, status, schoolId, localTimestamp, latitude, longitude } = req.body;

    if (!staffId || !date || !status || !schoolId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    try {
      const schoolConfig = await serverDb.getSchoolLocation();
      const locEval = evaluateAttendanceLocation(latitude, longitude, schoolConfig);

      const offlineHash = await computeOfflineHash(staffId, date, status, { latitude: locEval.latitude, longitude: locEval.longitude });
      const schoolKeypair = getSchoolKeypair();
      const memoPayload = JSON.stringify({
        app: "E-SYLLAB", version: "1.0", type: "ATTENDANCE",
        staffId, staffName: staffName || staffId, schoolId,
        date, time: time || "", className: className || "",
        status,
        latitude: locEval.latitude,
        longitude: locEval.longitude,
        locationFlagged: locEval.locationFlagged,
        distanceMeters: locEval.distanceMeters,
        offlineHash, syncedFromOffline: false,
        localTimestamp: localTimestamp || new Date().toISOString(),
        recordedAt: new Date().toISOString(),
      });

      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      let signature = "";
      let slot = 0;
      let confirmedOnChain = false;

      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const ix = new TransactionInstruction({
          keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: new TextEncoder().encode(memoPayload) as any,
        });

        const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
        tx.add(ix);
        tx.sign(schoolKeypair);

        signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        slot = txInfo?.slot ?? 0;
        confirmedOnChain = true;
      } catch (solanaErr: any) {
        console.warn("[Blockchain] On-chain submission failed or timed out:", solanaErr.message);
        signature = "";
        confirmedOnChain = false;
        slot = 0;
      }

      console.log(`[Blockchain] Attendance Recorded | ${staffId} | ${className || "—"} | ${date} | status: ${status} | flagged: ${locEval.locationFlagged} | onChain: ${confirmedOnChain}`);

      try {
        await serverDb.recordAttendance({
          staffId, staffName, date, time, className, status, schoolId,
          latitude: locEval.latitude,
          longitude: locEval.longitude,
          locationFlagged: locEval.locationFlagged,
          distanceMeters: locEval.distanceMeters,
          signature: confirmedOnChain ? signature : "",
          offlineHash,
        });
      } catch (dbErr) {
        console.warn("[Blockchain] DB record error:", dbErr);
      }

      res.json({
        success: true,
        signature: (confirmedOnChain && signature) ? signature : null,
        slot,
        offlineHash,
        confirmedOnChain,
        latitude: locEval.latitude,
        longitude: locEval.longitude,
        locationFlagged: locEval.locationFlagged,
        distanceMeters: locEval.distanceMeters,
        explorerUrl: (confirmedOnChain && signature) ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
        message: confirmedOnChain
          ? "Saved. This cannot be changed."
          : "Saved at school. Waiting to lock.",
      });
    } catch (err: any) {
      console.error("[Blockchain] Record error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/hash - Compute offline SHA-256 hash
  app.post("/api/blockchain/attendance/hash", authenticateToken, async (req, res) => {
    const { staffId, date, status, latitude, longitude } = req.body;
    if (!staffId || !date || !status) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    try {
      const locData = (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null)
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null;
      const offlineHash = await computeOfflineHash(staffId, date, status, locData);
      res.json({ success: true, offlineHash });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/prepare - TEACHER/ADMIN only
  // Computes the offlineHash + memoPayload for the client to build a tx with.
  // The client builds the Transaction with a fresh blockhash via
  // /api/blockchain/blockhash — we no longer do it server-side to avoid
  // stale blockhash errors when the RPC call is slow.
  app.post("/api/blockchain/attendance/prepare", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { staffId, staffName, date, time, className, status, schoolId, signerPublicKey, syncedFromOffline = false, localTimestamp, latitude, longitude } = req.body;

    if (!staffId || !date || !status || !schoolId || !signerPublicKey) {
      return res.status(400).json({ success: false, error: "Missing required fields: staffId, date, status, schoolId, signerPublicKey" });
    }

    const validStatuses = ["Present", "Absent", "Late", "OnLeave"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, error: `Invalid status. Must be one of: ${validStatuses.join(", ")}` });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "Invalid date format. Use YYYY-MM-DD" });
    }

    let phantomKey: PublicKey;
    try {
      phantomKey = new PublicKey(signerPublicKey);
    } catch {
      return res.status(400).json({ success: false, error: "Invalid Solana public key" });
    }

    try {
      const schoolConfig = await serverDb.getSchoolLocation();
      const locEval = evaluateAttendanceLocation(latitude, longitude, schoolConfig);

      const record = {
        staffId, staffName: staffName || staffId,
        date, time: time || "", className: className || "",
        status, schoolId,
        latitude: locEval.latitude,
        longitude: locEval.longitude,
        locationFlagged: locEval.locationFlagged,
        distanceMeters: locEval.distanceMeters,
        syncedFromOffline, localTimestamp: localTimestamp || new Date().toISOString(),
      };
      const prepared = await buildAttendanceTransaction(record as any, phantomKey);
      console.log(`[Blockchain] Prepared | ${staffId} | ${className || "—"} | ${date} ${time || ""} | ${status} | hash: ${prepared.offlineHash.slice(0, 16)}...`);
      res.json({ success: true, ...prepared, locationFlagged: locEval.locationFlagged, distanceMeters: locEval.distanceMeters });
    } catch (err: any) {
      console.error("[Blockchain] Failed to prepare tx:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/confirm - TEACHER/ADMIN only
  // Called after Phantom signs and submits the tx
  app.post("/api/blockchain/attendance/confirm", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { signature, offlineHash } = req.body;
    if (!signature || !offlineHash) {
      return res.status(400).json({ success: false, error: "Missing signature or offlineHash" });
    }
    try {
      const receipt = await confirmTransaction(signature, offlineHash);
      console.log(`[Blockchain] Confirmed | sig: ${signature.slice(0, 20)}... | slot: ${receipt.slot}`);
      res.json({ success: true, receipt });
    } catch (err: any) {
      console.error("[Blockchain] Confirmation failed:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/queue - TEACHER/ADMIN only
  // Saves offline attendance record to sync queue
  app.post("/api/blockchain/attendance/queue", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { staffId, staffName, date, time, className, status, schoolId, localTimestamp, latitude, longitude } = req.body;
    if (!staffId || !date || !status || !schoolId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    try {
      const schoolConfig = await serverDb.getSchoolLocation();
      const locEval = evaluateAttendanceLocation(latitude, longitude, schoolConfig);

      const offlineHash = await computeOfflineHash(staffId, date, status, { latitude: locEval.latitude, longitude: locEval.longitude });
      const queueId = `${staffId}-${date}-${Date.now()}`;
      await serverDb.addToSyncQueue({
        id: queueId,
        staffId,
        staffName: staffName || staffId,
        date,
        time: time || "",
        className: className || "",
        status,
        schoolId,
        latitude: locEval.latitude,
        longitude: locEval.longitude,
        locationFlagged: locEval.locationFlagged,
        distanceMeters: locEval.distanceMeters,
        offlineHash,
        localTimestamp: localTimestamp || new Date().toISOString(),
        queuedAt: new Date().toISOString(),
      });

      try {
        await serverDb.recordAttendance({
          staffId, staffName, date, time, className, status, schoolId,
          latitude: locEval.latitude,
          longitude: locEval.longitude,
          locationFlagged: locEval.locationFlagged,
          distanceMeters: locEval.distanceMeters,
          signature: queueId,
          offlineHash,
        });
      } catch (dbErr) {
        console.warn("[Queue] DB record error:", dbErr);
      }

      const queueSize = await serverDb.getSyncQueueSize();
      console.log(`[Queue] Saved | ${staffId} | ${className || "—"} | ${date} | queue: ${queueSize}`);
      res.json({
        success: true,
        queueId,
        offlineHash,
        locationFlagged: locEval.locationFlagged,
        distanceMeters: locEval.distanceMeters,
        message: `Queued for sync. Queue size: ${queueSize}`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/blockchain/attendance/queue - All authenticated users
  app.get("/api/blockchain/attendance/queue", authenticateToken, async (_req, res) => {
    try {
      const items = await serverDb.getSyncQueue();
      res.json({ success: true, count: items.length, items });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // DELETE /api/blockchain/attendance/queue/:queueId - TEACHER/ADMIN only
  app.delete("/api/blockchain/attendance/queue/:queueId", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const queueId = Array.isArray(req.params.queueId) ? req.params.queueId[0] : req.params.queueId;
    try {
      const deleted = await serverDb.deleteFromSyncQueue(queueId);
      if (deleted) {
        res.json({ success: true, message: "Removed from queue" });
      } else {
        res.status(404).json({ success: false, error: "Queue item not found" });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/sync-all - TEACHER/ADMIN only
  app.post("/api/blockchain/attendance/sync-all", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (_req, res) => {
    const schoolKeypair = getSchoolKeypair();
    if (!schoolKeypair) {
      return res.status(503).json({
        success: false,
        error: "SCHOOL_SIGNING_KEYPAIR not set in .env.local — offline sync is disabled.",
      });
    }

    const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const connection = getConnection();
    const results: any[] = [];

    // Test connectivity first — if Solana RPC is unreachable, fail fast
    // instead of hanging for 30+ seconds per record.
    try {
      const healthCheck = await Promise.race([
        connection.getSlot(),
        new Promise((_, reject) => setTimeout(() => reject(new Error("RPC timeout")), 8000)),
      ]);
      console.log(`[Sync] RPC reachable — slot ${healthCheck}`);
    } catch (err: any) {
      console.warn("[Sync] Solana RPC unreachable:", err.message);
      return res.json({
        success: true,
        synced: 0,
        failed: 0,
        rpcUnreachable: true,
        message: "Cannot reach Solana network right now. Records are queued and will sync when the network is available.",
        results: [],
      });
    }

    const queueItems = await serverDb.getSyncQueue();
    for (const item of queueItems) {
      const queueId = item.id;
      try {
        const memoPayload = JSON.stringify({
          app: "E-SYLLAB", version: "1.0", type: "ATTENDANCE",
          staffId: item.staffId, staffName: item.staffName, schoolId: item.schoolId,
          date: item.date, time: item.time || "", className: item.className || "",
          status: item.status,
          latitude: item.latitude ?? null,
          longitude: item.longitude ?? null,
          locationFlagged: item.locationFlagged ?? false,
          distanceMeters: item.distanceMeters ?? null,
          offlineHash: item.offlineHash, syncedFromOffline: true,
          localTimestamp: item.localTimestamp, syncedAt: new Date().toISOString(),
        });

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

        const ix = new TransactionInstruction({
          keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: new TextEncoder().encode(memoPayload) as any,
        });

        const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
        tx.add(ix);
        tx.sign(schoolKeypair);

        const signature = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
        const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

        await serverDb.deleteFromSyncQueue(queueId);
        results.push({
          queueId, success: true, signature, slot: txInfo?.slot ?? 0,
          staffId: item.staffId, date: item.date, status: item.status,
          explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
        });
        console.log(`[Sync] ✓ ${item.staffId} | ${item.date} → ${signature.slice(0, 20)}...`);
      } catch (err: any) {
        results.push({ queueId, success: false, error: err.message });
        console.warn(`[Sync] ✗ ${item.staffId} | ${item.date} → ${err.message}`);
      }
    }

    res.json({
      success: true,
      synced: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    });
  });

  // POST /api/blockchain/attendance/verify-hash
  app.post("/api/blockchain/attendance/verify-hash", authenticateToken, async (req, res) => {
    const { staffId, date, status, hashToVerify, signature, latitude, longitude } = req.body;
    if (!staffId || !date || !status) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    try {
      const locData = (latitude !== undefined && longitude !== undefined && latitude !== null && longitude !== null)
        ? { latitude: Number(latitude), longitude: Number(longitude) }
        : null;
      const expectedHash = await computeOfflineHash(staffId, date, status, locData);
      
      let isValid = false;
      let onChainVerified = false;
      let memoVerified = false;

      const hasProvidedHash = Boolean(hashToVerify && typeof hashToVerify === 'string' && hashToVerify.trim());
      let hashMatches = false;
      if (hasProvidedHash) {
        hashMatches = (expectedHash.toLowerCase() === String(hashToVerify).trim().toLowerCase());
      }

      const rawSig = typeof signature === 'string' ? signature.trim() : '';
      const isRealSignature = rawSig.length >= 44 &&
        !rawSig.startsWith('recorded-') &&
        !rawSig.startsWith('queue-') &&
        !rawSig.startsWith('pending-') &&
        !rawSig.startsWith('dummy-') &&
        !rawSig.startsWith('mock-') &&
        !rawSig.startsWith('ledger-') &&
        !rawSig.startsWith('att-') &&
        /^[1-9A-HJ-NP-Za-km-z]+$/.test(rawSig);

      if (isRealSignature) {
        try {
          const connection = getConnection();
          const tx = await connection.getTransaction(rawSig, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          if (tx && !tx.meta?.err) {
            onChainVerified = true;
            const logs = tx.meta?.logMessages || [];
            const memoLog = logs.find(l => l.includes(expectedHash) || (hasProvidedHash && l.includes(String(hashToVerify).trim())));
            if (memoLog) {
              memoVerified = true;
            }
          }
        } catch (chainErr: any) {
          console.warn("[Verify] On-chain check note:", chainErr.message);
        }
      }

      if (hasProvidedHash && isRealSignature) {
        isValid = hashMatches && onChainVerified;
      } else if (hasProvidedHash) {
        isValid = hashMatches;
      } else if (isRealSignature) {
        isValid = onChainVerified;
      } else {
        isValid = false;
      }

      let message = "Cryptographic proof verified — record data is authentic and untampered.";
      if (!isValid) {
        if (!hasProvidedHash && !isRealSignature) {
          message = "No cryptographic hash or valid transaction signature was provided to verify.";
        } else if (hasProvidedHash && !hashMatches) {
          message = "Hash mismatch — possible tampering detected!";
        } else if (isRealSignature && !onChainVerified) {
          message = "Transaction signature not found on Solana Devnet ledger.";
        } else {
          message = "Verification failed — record data does not match on-chain proof.";
        }
      }

      res.json({
        success: true,
        isValid,
        expectedHash,
        providedHash: hashToVerify || null,
        onChainVerified,
        memoVerified,
        message,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════
  //  EXISTING ROUTES
  // ════════════════════════════════════════════

  // ════════════════════════════════════════════
  //  PASSWORD RESET / FORGOT PASSWORD ROUTES
  // ════════════════════════════════════════════

  // POST /api/send-otp - Request password reset verification code
  app.post("/api/send-otp", async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: "Missing email address" });

    const trimmedEmail = email.trim().toLowerCase();
    const existingUser = await serverDb.findUserByEmail(trimmedEmail);
    if (!existingUser) {
      return res.status(404).json({ success: false, error: "No account found with this email address" });
    }
    if (existingUser.active === false) {
      return res.status(403).json({ success: false, error: "This account has been deactivated" });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    await serverDb.saveOtp(trimmedEmail, 'RESET', otp, 10 * 60 * 1000, 5);

    const sendResult = await sendResendEmail({
      to: trimmedEmail,
      subject: "Your E-SYLLAB Password Reset Code",
      html: `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;max-width:400px;margin:auto;"><h2 style="color:#7c3aed;">E-SYLLAB</h2><p style="color:#334155;">Your password reset code:</p><div style="font-size:36px;font-weight:bold;letter-spacing:6px;color:#1e293b;padding:20px 0;">${otp}</div><p style="color:#64748b;font-size:13px;">This code expires in 10 minutes. Ignore this email if you did not request a reset.</p></div>`,
    });

    res.json({
      success: true,
      emailSent: sendResult.success,
      message: sendResult.success ? `Password reset code sent to ${trimmedEmail}` : "Reset code generated",
      devOtp: (process.env.NODE_ENV !== "production" || !sendResult.success) ? otp : undefined,
    });
  });

  // POST /api/auth/reset-password-with-otp - Verify OTP and update password in PostgreSQL
  app.post("/api/auth/reset-password-with-otp", async (req, res) => {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, error: "Email, reset code, and new password are required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.errorMessage });
    }

    const user = await serverDb.findUserByEmail(trimmedEmail);
    if (!user) {
      return res.status(404).json({ success: false, error: "No account found with this email address." });
    }
    if (user.active === false) {
      return res.status(403).json({ success: false, error: "This account has been deactivated." });
    }

    const isNonProd = process.env.NODE_ENV !== 'production';
    const otpVerify = await serverDb.verifyAndConsumeOtp(trimmedEmail, 'RESET', otp, isNonProd);

    if (!otpVerify.valid) {
      return res.status(400).json({ success: false, error: otpVerify.error || "Invalid or expired reset code." });
    }

    try {
      await serverDb.updatePassword(user.id, newPassword);
      await serverDb.revokeAllUserSessions(user.id);

      res.json({
        success: true,
        message: "Password updated successfully! You can now sign in with your new password.",
      });
    } catch (err: any) {
      console.error("[Auth] Reset password error:", err);
      res.status(500).json({ success: false, error: "Failed to update password. Please try again." });
    }
  });

  // ════════════════════════════════════════════
  //  SIGN IN & SECURITY CODE ROUTES
  // ════════════════════════════════════════════

  // POST /api/auth/2fa/send-otp - Request a security code via email
  app.post("/api/auth/2fa/send-otp", async (req, res) => {
    const { email, purpose } = req.body;
    if (!email || !purpose) {
      return res.status(400).json({ success: false, error: "Email and purpose ('LOGIN' or 'REGISTER') required" });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (purpose === 'LOGIN') {
      const existingUser = await serverDb.findUserByEmail(trimmedEmail);
      if (!existingUser) {
        return res.status(404).json({ success: false, error: "No account found with this email address" });
      }
      if (existingUser.active === false) {
        return res.status(403).json({ success: false, error: "This account has been deactivated" });
      }
    } else if (purpose === 'REGISTER') {
      const existingUser = await serverDb.findUserByEmail(trimmedEmail);
      if (existingUser) {
        return res.status(400).json({ success: false, error: "An account with this email address already exists" });
      }
    }

    // Rate limit check
    const rateCheck = await serverDb.checkEmailRateLimit(trimmedEmail, 5);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        success: false,
        error: `Too many sign-in code requests. Please wait ${rateCheck.retryAfterMinutes || 60} minutes before trying again.`,
      });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    await serverDb.saveOtp(trimmedEmail, purpose, code, 10 * 60 * 1000, 5);

    // Send via Resend email service if configured
    const sendResult = await sendResendEmail({
      to: trimmedEmail,
      subject: "Your E-SYLLAB sign-in code",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; max-width: 440px; margin: auto; background-color: #0b0f19; color: #f8fafc;">
          <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
            <div style="background: #7c3aed; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #ffffff; font-size: 22px;">E</div>
            <div>
              <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 800;">E-SYLLAB</h2>
              <p style="color: #c084fc; margin: 0; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">School Sign-In</p>
            </div>
          </div>
          <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">
            Your school sign-in code is:
          </p>
          <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #a855f7; padding: 18px 0; text-align: center; font-family: monospace; background: #1e1b4b; border-radius: 12px; margin: 16px 0; border: 1px solid #4c1d95;">
            ${code}
          </div>
          <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; line-height: 1.4;">
            Your school sign-in code is ${code}. It works for 10 minutes. If you did not try to sign in, ignore this.
          </p>
        </div>
      `,
    });

    console.log(`[Security OTP] Generated code ${code} for ${trimmedEmail} (${purpose}) - Email delivered: ${sendResult.success}`);

    res.json({
      success: true,
      emailSent: sendResult.success,
      message: sendResult.success
        ? `Security verification code sent to ${trimmedEmail}`
        : `Security code generated for ${trimmedEmail}`,
      devCode: (!sendResult.success || !isProduction) ? code : undefined
    });
  });

  // POST /api/register - Public registration with security code verification
  app.post("/api/register", async (req, res) => {
    const { name, email, password, avatar, twoFactorCode, consentGivenAt } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "Name, email, and password required" });
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.errorMessage });
    }

    if (!twoFactorCode) {
      return res.status(400).json({ success: false, error: "Verification code is required to create an account" });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check if email was invited by school
    const isPending = await serverDb.isPendingInvite(trimmedEmail);
    if (isPending) {
      return res.status(400).json({
        success: false,
        error: "This email was added by the school. Please choose 'I was added by the school' or sign in to set your password.",
      });
    }

    const isNonProd = process.env.NODE_ENV !== 'production';

    const otpVerify = await serverDb.verifyAndConsumeOtp(trimmedEmail, 'REGISTER', twoFactorCode, isNonProd);
    if (!otpVerify.valid) {
      return res.status(400).json({ success: false, error: otpVerify.error || "That security code isn't right, please try again." });
    }

    try {
      const userPayload = {
        name,
        email: trimmedEmail,
        role: UserRole.STUDENT, // Force STUDENT role for public registration
        avatar: avatar || `https://picsum.photos/seed/${name.replace(/\s/g, '')}/100/100`,
        consentGivenAt: consentGivenAt || new Date().toISOString(),
      };

      const createdUser = await serverDb.registerUser(userPayload, password);

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: createdUser.id,
          email: createdUser.email,
          name: createdUser.name,
          role: createdUser.role,
        } as JwtPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      // Record session
      const userAgent = (req.headers['user-agent'] as string) || '';
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      await serverDb.createSession(createdUser.id, parseDevice(userAgent), ipAddress, token);

      res.json({
        success: true,
        user: createdUser,
        token,
        message: "Account created successfully!",
      });
    } catch (err: any) {
      console.error("[Auth] Public registration error:", err);
      res.status(400).json({ success: false, error: err.message || "Registration failed" });
    }
  });

  // POST /api/admin/create-user - Admin invites teacher or admin (Name + Email only, no password)
  app.post("/api/admin/create-user", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { name, email, role, avatar } = req.body;

    if (!name || !email || !role) {
      return res.status(400).json({ success: false, error: "Full name, email address, and role are required." });
    }

    const trimmedEmail = email.trim().toLowerCase();

    if (role !== UserRole.TEACHER && role !== UserRole.ADMIN) {
      return res.status(400).json({ success: false, error: "Only TEACHER or ADMIN roles can be invited." });
    }

    if (role === UserRole.ADMIN) {
      const activeAdmins = await serverDb.getUsersByRole(UserRole.ADMIN);
      if (activeAdmins.length >= 2) {
        return res.status(400).json({ success: false, error: "Maximum limit of 2 administrator accounts reached." });
      }
    }

    try {
      const existingUser = await serverDb.findUserByEmail(trimmedEmail);
      if (existingUser) {
        const isPending = await serverDb.isPendingInvite(trimmedEmail);
        if (!isPending) {
          return res.status(400).json({ success: false, error: "An active account with this email already exists." });
        }
      }

      const invite = await serverDb.createOrUpdateInvite(name.trim(), trimmedEmail, role as UserRole, req.user!.userId);

      return res.json({
        success: true,
        message: `${name.trim()} can now open E-SYLLAB, enter this email, and choose their password.`,
        user: {
          name: name.trim(),
          email: trimmedEmail,
          role: invite.role,
        },
      });
    } catch (err: any) {
      console.error("[Auth] Admin invite user error:", err);
      return res.status(400).json({ success: false, error: err.message || "Failed to invite user." });
    }
  });

  // POST /api/auth/accept-invite - Invited faculty/admin sets password on first sign in
  app.post("/api/auth/accept-invite", async (req, res) => {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password are required." });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const passwordValidation = validatePassword(password);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.errorMessage });
    }

    try {
      const user = await serverDb.acceptInvite(trimmedEmail, password, name);

      // Generate JWT token
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        } as JwtPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      // Record session
      const userAgent = (req.headers['user-agent'] as string) || '';
      const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
      await serverDb.createSession(user.id, parseDevice(userAgent), ipAddress, token);

      return res.json({
        success: true,
        token,
        user,
        message: "Password created successfully! Welcome to E-SYLLAB.",
      });
    } catch (err: any) {
      console.error("[Auth] Accept invite error:", err);
      return res.status(400).json({ success: false, error: err.message || "Could not set password for this account." });
    }
  });

  // POST /api/login - Step 1: Validate sign in & send security code
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }

    const trimmedEmail = email.trim().toLowerCase();

    try {
      const existingUser = await serverDb.findUserByEmail(trimmedEmail);
      if (existingUser && existingUser.active === false) {
        return res.status(403).json({ success: false, error: "This account has been deactivated" });
      }

      // Check if this is an invited user who hasn't set their password yet
      const isPending = await serverDb.isPendingInvite(trimmedEmail);
      if (isPending) {
        return res.status(200).json({
          success: false,
          mustSetPassword: true,
          error: "This email was added by the school. Create your password to continue.",
        });
      }

      const authResult = await serverDb.authenticateUser(trimmedEmail, password);
      
      if (!authResult) {
        return res.status(401).json({ success: false, error: "That username or password doesn’t look right" });
      }

      if (authResult.deactivated || authResult.user.active === false) {
        return res.status(403).json({ success: false, error: "This account has been deactivated" });
      }

      const { user, needsPasswordReset } = authResult;

      // If email is already verified: issue JWT directly (no 2FA needed)
      if (user.emailVerifiedAt) {
        const token = jwt.sign(
          {
            userId: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          } as JwtPayload,
          JWT_SECRET,
          { expiresIn: JWT_EXPIRY }
        );

        const userAgent = (req.headers['user-agent'] as string) || '';
        const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
        await serverDb.createSession(user.id, parseDevice(userAgent), ipAddress, token);

        return res.json({
          success: true,
          requires2FA: false,
          user,
          needsPasswordReset,
          token,
          message: "Sign in successful.",
        });
      }

      // First time sign-in: require 2FA OTP code
      // Rate limiting: max 5 sends per email per hour
      const rateCheck = await serverDb.checkEmailRateLimit(trimmedEmail, 5);
      if (!rateCheck.allowed) {
        return res.status(429).json({
          success: false,
          error: `Too many sign-in code requests. Please wait ${rateCheck.retryAfterMinutes || 60} minutes before trying again.`,
        });
      }

      // Generate 6-digit code for Login (10 min expiry)
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      await serverDb.saveOtp(trimmedEmail, 'LOGIN', code, 10 * 60 * 1000, 5);

      // Attempt to send email via Resend
      const sendResult = await sendResendEmail({
        to: trimmedEmail,
        subject: "Your E-SYLLAB sign-in code",
        html: `
          <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; max-width: 440px; margin: auto; background-color: #0b0f19; color: #f8fafc;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
              <div style="background: #7c3aed; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #ffffff; font-size: 22px;">E</div>
              <div>
                <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 800;">E-SYLLAB</h2>
                <p style="color: #c084fc; margin: 0; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">School Sign-In</p>
              </div>
            </div>
            <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">
              Your school sign-in code is:
            </p>
            <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #a855f7; padding: 18px 0; text-align: center; font-family: monospace; background: #1e1b4b; border-radius: 12px; margin: 16px 0; border: 1px solid #4c1d95;">
              ${code}
            </div>
            <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; line-height: 1.4;">
              Your school sign-in code is ${code}. It works for 10 minutes. If you did not try to sign in, ignore this.
            </p>
          </div>
        `,
      });

      console.log(`[Security OTP] Login code ${code} generated for ${user.email} (${user.role}) - Email delivered: ${sendResult.success}`);

      return res.json({
        success: true,
        requires2FA: true,
        email: user.email,
        role: user.role,
        needsPasswordReset,
        emailSent: sendResult.success,
        message: sendResult.success
          ? "A 6-digit sign-in code was sent to " + user.email
          : "Security code generated for your account.",
        devCode: (!sendResult.success || !isProduction) ? code : undefined,
      });
    } catch (err: any) {
      console.error("[Auth] Login error:", err);
      res.status(500).json({ success: false, error: "Something went wrong, please try again" });
    }
  });

  // POST /api/login/verify-2fa - Step 2: Verify security code and issue session
  app.post("/api/login/verify-2fa", async (req, res) => {
    const { email, twoFactorCode } = req.body;

    if (!email || !twoFactorCode) {
      return res.status(400).json({ success: false, error: "Email and security code required" });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const isNonProd = process.env.NODE_ENV !== 'production';

    const otpVerify = await serverDb.verifyAndConsumeOtp(trimmedEmail, 'LOGIN', twoFactorCode, isNonProd);
    if (!otpVerify.valid) {
      return res.status(400).json({ success: false, error: otpVerify.error || "That security code isn't right, please try again." });
    }

    const user = await serverDb.findUserByEmail(trimmedEmail);
    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found" });
    }

    if (user.active === false) {
      return res.status(403).json({ success: false, error: "This account has been deactivated" });
    }

    // Mark email verified for subsequent logins
    await serverDb.markEmailVerified(user.id);
    const verifiedUser = { ...user, emailVerifiedAt: new Date().toISOString() };

    const cred = await serverDb.getCredentialByUserId(user.id);
    const needsPasswordReset = cred ? !!cred.passwordResetRequired : false;

    // Generate final JWT token
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      } as JwtPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    // Record session
    const userAgent = (req.headers['user-agent'] as string) || '';
    const ipAddress = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    await serverDb.createSession(user.id, parseDevice(userAgent), ipAddress, token);

    res.json({
      success: true,
      user: verifiedUser,
      needsPasswordReset,
      token,
      message: "Sign in successful.",
    });
  });

  // POST /api/logout - Revoke JWT token
  app.post("/api/logout", authenticateToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      tokenBlacklist.add(token);
    }

    res.json({ success: true, message: "Logout successful" });
  });

  // GET /api/sessions - List active user sessions
  app.get("/api/sessions", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Please sign in to continue" });
    }

    const authHeader = req.headers['authorization'];
    const currentToken = authHeader && authHeader.split(' ')[1];

    const rawSessions = await serverDb.getUserSessions(req.user.userId);
    const sessions = rawSessions.map((s: any) => ({
      id: s.id,
      userId: s.userId,
      deviceInfo: s.deviceInfo,
      ipAddress: s.ipAddress,
      loginAt: s.loginAt,
      lastActiveAt: s.lastActiveAt,
      isCurrent: Boolean(currentToken && s.token === currentToken),
    }));

    res.json({ success: true, sessions });
  });

  // POST /api/sessions/:id/revoke - Revoke a specific session
  app.post("/api/sessions/:id/revoke", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Please sign in to continue" });
    }

    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const session = await serverDb.getSessionById(sessionId);

    if (!session || session.userId !== req.user.userId) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    await serverDb.revokeSession(sessionId, req.user.userId);

    if (session.token) {
      tokenBlacklist.add(session.token);
    }

    res.json({ success: true, message: "Device session has been logged out." });
  });

  // DELETE /api/users/me - Delete own account with password confirmation & admin safeguard
  app.delete("/api/users/me", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Please sign in to continue" });
    }

    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, error: "Password confirmation is required to delete your account." });
    }

    const userId = req.user.userId;
    const user = await serverDb.findUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found." });
    }

    // Verify password against auth credentials
    const cred = await serverDb.getCredentialByUserId(userId);
    if (!cred) {
      return res.status(400).json({ success: false, error: "Security credentials not found for this account." });
    }

    const isMatch = await bcrypt.compare(password, cred.passwordHash);
    if (!isMatch) {
      return res.status(400).json({ success: false, error: "Incorrect password. Please verify and try again." });
    }

    // Critical safeguard: if requesting user is Admin, ensure not the last remaining Admin account
    if (user.role === UserRole.ADMIN) {
      const adminUsers = await serverDb.getUsersByRole(UserRole.ADMIN);
      if (adminUsers.length <= 1) {
        return res.status(400).json({
          success: false,
          error: "Cannot delete the last remaining administrator account. Another admin must exist first."
        });
      }
    }

    // Revoke all sessions and blacklist current token
    await serverDb.revokeAllUserSessions(userId);
    const authHeader = req.headers['authorization'];
    const currentToken = authHeader && authHeader.split(' ')[1];
    if (currentToken) {
      tokenBlacklist.add(currentToken);
    }

    // Soft delete / deactivate user
    await serverDb.deleteUser(userId);

    res.json({ success: true, message: "Your account has been deactivated." });
  });

  // GET /api/users/me/export - Data Protection Act No. 3 of 2021 (Personal Data Portability & Access)
  app.get("/api/users/me/export", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Please sign in to export your data." });
    }

    const userId = req.user.userId;
    const user = await serverDb.findUserById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found." });
    }

    // 1. Profile information
    const profile = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      avatar: user.avatar,
      blockchainId: user.blockchainId,
      contact: user.contact,
      school: user.school,
      gender: user.gender,
      residentialAddress: user.residentialAddress,
      grade: user.grade,
      className: user.className,
      enrolledSubjects: user.enrolledSubjects,
      teachingGrades: user.teachingGrades,
      teachingClasses: user.teachingClasses,
      teachingSubjects: user.teachingSubjects,
      isProfileComplete: user.isProfileComplete,
      consentGivenAt: user.consentGivenAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    // 2. Grades
    const studentGrades = await serverDb.getStudentGrades(userId);
    const teacherGrades = user.role === UserRole.TEACHER ? await serverDb.getGradesByTeacher(userId) : undefined;

    // 3. Attendance records
    const attendanceRecords = await serverDb.getUserAttendanceRecords(userId);

    // 4. Messages
    const messages = await serverDb.getUserMessages(userId, user.role);

    // 5. Assessment scores
    const assessmentScores = await serverDb.getStudentAssessmentScores(userId);

    const exportData = {
      complianceNotice: "Exported in accordance with Zambia Data Protection Act No. 3 of 2021 (Right of Access and Data Portability).",
      exportTimestamp: new Date().toISOString(),
      user: profile,
      grades: {
        studentGrades,
        ...(teacherGrades ? { submittedGrades: teacherGrades } : {}),
      },
      attendanceRecords,
      messages,
      assessmentScores,
    };

    const filename = `esylab-personal-data-${user.id}-${Date.now()}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(exportData, null, 2));
  });

  // GET /api/profile - Get current user profile (requires authentication)
  app.get("/api/profile", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const user = await serverDb.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    const cred = await serverDb.getCredentialByUserId(req.user.userId);
    const needsPasswordReset = Boolean(cred?.passwordResetRequired);

    res.json({ success: true, user, needsPasswordReset });
  });

  // PUT /api/profile - Update user profile (requires authentication)
  app.put("/api/profile", authenticateToken, async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const { name, avatar, contact, school, gender, residentialAddress, teachingGrades, teachingClasses, teachingSubjects, grade, className, enrolledSubjects, isProfileComplete } = req.body;

    const updates = {
      ...(name && { name }),
      ...(avatar && { avatar }),
      ...(contact && { contact }),
      ...(school && { school }),
      ...(gender && { gender }),
      ...(residentialAddress && { residentialAddress }),
      ...(teachingGrades && { teachingGrades }),
      ...(teachingClasses && { teachingClasses }),
      ...(teachingSubjects && { teachingSubjects }),
      ...(grade && { grade }),
      ...(className && { className }),
      ...(enrolledSubjects && { enrolledSubjects }),
      ...(isProfileComplete !== undefined && { isProfileComplete }),
    };

    const updatedUser = await serverDb.updateUserProfile(req.user.userId, updates);
    
    if (!updatedUser) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, user: updatedUser, message: "Profile updated successfully" });
  });

  // POST /api/reset-password - Update password (requires authentication)
  app.post("/api/reset-password", authenticateToken, async (req, res) => {
    const { newPassword } = req.body;

    if (!req.user || !newPassword) {
      return res.status(400).json({ success: false, error: "Password required" });
    }

    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return res.status(400).json({ success: false, error: passwordValidation.errorMessage });
    }

    try {
      await serverDb.updatePassword(req.user.userId, newPassword);

      res.json({ success: true, message: "Password updated successfully" });
    } catch (err: any) {
      console.error("[Auth] Password reset error:", err);
      res.status(500).json({ success: false, error: "Failed to update password" });
    }
  });

  // ════════════════════════════════════════════
  //  ADMIN ONLY ROUTES
  // ════════════════════════════════════════════

  // GET /api/users - List active users for student/teacher pickers
  app.get("/api/users", authenticateToken, async (_req, res) => {
    try {
      const allUsers = await serverDb.getAllUsers();
      const users = allUsers.filter((u: any) => u.active !== false);
      res.json({ success: true, users });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/admin/users - List all users (admin only)
  app.get("/api/admin/users", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    const users = await serverDb.getAllUsers();
    res.json({ success: true, users });
  });

  // DELETE /api/admin/users/:userId - Delete user (admin only)
  app.delete("/api/admin/users/:userId", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID required" });
    }

    await serverDb.deleteUser(userId);

    res.json({ success: true, message: "User deleted successfully" });
  });

  // GET /api/admin/activity - School-wide activity list (Admin only)
  app.get("/api/admin/activity", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    try {
      const rows: Array<{
        id: string;
        type: 'Attendance' | 'Grade' | 'Assessment' | 'Paper';
        who: string;
        whoRole: 'Teacher' | 'Student';
        className: string;
        date: string;
        summary: string;
        confirmedOnChain: boolean;
        signature: string | null;
        explorerUrl?: string;
        timestamp: string;
      }> = [];

      // 1. Attendance Records
      try {
        const attendanceRecords = await serverDb.getAllAttendanceRecords();
        for (const att of attendanceRecords) {
          const isRealSig = isValidSolanaSig(att.signature);
          const date = att.date || (att.createdAt ? att.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
          const who = att.staffName || 'Teacher';
          const className = att.className || 'General';
          rows.push({
            id: att.id,
            type: 'Attendance',
            who,
            whoRole: 'Teacher',
            className,
            date,
            summary: `Attendance: ${att.status} (${className})`,
            confirmedOnChain: isRealSig,
            signature: isRealSig ? att.signature : null,
            explorerUrl: (isRealSig && att.signature) ? `https://explorer.solana.com/tx/${att.signature}?cluster=devnet` : undefined,
            timestamp: att.createdAt || new Date().toISOString(),
          });
        }
      } catch (err: any) {
        console.warn("[Admin Activity] Error loading attendance:", err.message);
      }

      // 2. Grades
      try {
        const grades = await serverDb.getAllGrades();
        const allLedger = await serverDb.getAllLedgerEntries();
        for (const g of grades) {
          const matchingLedger = allLedger.find(e => e.payload?.gradeId === g.id || e.hash === g.id);
          const rawSig = matchingLedger?.signature || (g as any).signature;
          const isRealSig = Boolean(isValidSolanaSig(rawSig) && (matchingLedger ? matchingLedger.confirmedOnChain : true));
          const date = g.recordedAt ? g.recordedAt.slice(0, 10) : (g.createdAt ? g.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
          const who = g.studentName || 'Student';
          const scoreDisplay = g.score !== undefined ? g.score : g.grade;
          rows.push({
            id: g.id,
            type: 'Grade',
            who,
            whoRole: 'Student',
            className: (g as any).className || 'Class',
            date,
            summary: `Grade: ${g.subject} - Score ${scoreDisplay} (${g.grade})`,
            confirmedOnChain: isRealSig,
            signature: isRealSig ? rawSig : null,
            explorerUrl: (isRealSig && rawSig) ? `https://explorer.solana.com/tx/${rawSig}?cluster=devnet` : undefined,
            timestamp: g.recordedAt || g.createdAt || new Date().toISOString(),
          });
        }
      } catch (err: any) {
        console.warn("[Admin Activity] Error loading grades:", err.message);
      }

      // 3. Assessment Scores
      try {
        const scores = await serverDb.getAllAssessmentScores();
        for (const sc of scores) {
          const ledgerEntry = await serverDb.getLedgerEntryByScoreId(sc.id);
          const isRealSig = Boolean(ledgerEntry && isValidSolanaSig(ledgerEntry.signature) && ledgerEntry.confirmedOnChain);
          const date = sc.createdAt ? sc.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
          const who = sc.studentName || 'Student';
          rows.push({
            id: sc.id,
            type: 'Assessment',
            who,
            whoRole: 'Student',
            className: sc.className || 'Class',
            date,
            summary: `Assessment: ${sc.assessmentTitle || 'Assessment'} (${sc.subject || 'General'}) - Score ${sc.score}`,
            confirmedOnChain: isRealSig,
            signature: (isRealSig && ledgerEntry?.signature) ? ledgerEntry.signature : null,
            explorerUrl: (isRealSig && ledgerEntry?.signature) ? `https://explorer.solana.com/tx/${ledgerEntry.signature}?cluster=devnet` : undefined,
            timestamp: sc.createdAt || new Date().toISOString(),
          });
        }
      } catch (err: any) {
        console.warn("[Admin Activity] Error loading assessments:", err.message);
      }

      // 4. Vault Documents (Papers)
      try {
        const vaultDocs = await serverDb.getAllVaultDocuments();
        for (const doc of vaultDocs) {
          const date = doc.createdAt ? doc.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
          const who = doc.teacherName || 'Teacher';
          rows.push({
            id: doc.id,
            type: 'Paper',
            who,
            whoRole: 'Teacher',
            className: 'School Vault',
            date,
            summary: `Paper: ${doc.title} (${doc.type}) - ${doc.status}`,
            confirmedOnChain: false,
            signature: null,
            explorerUrl: undefined,
            timestamp: doc.createdAt || new Date().toISOString(),
          });
        }
      } catch (err: any) {
        console.warn("[Admin Activity] Error loading vault docs:", err.message);
      }

      // Sort newest first
      rows.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({
        success: true,
        count: rows.length,
        activity: rows,
      });
    } catch (err: any) {
      console.error("[Admin Activity] Error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/admin/activity/:id/check - Verify single record on-chain (Admin only)
  app.post("/api/admin/activity/:id/check", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) {
      return res.status(400).json({ match: false, locked: false, message: "This record does not match school records." });
    }

    try {
      // 1. Check Attendance Record
      const att = await serverDb.findAttendanceRecordById(id);
      if (att) {
        let isLocked = false;
        const validSig = isValidSolanaSig(att.signature) ? att.signature : null;
        if (validSig) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(validSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (tx && !tx.meta?.err) {
              isLocked = true;
            }
          } catch (err: any) {
            console.warn("[Check Activity] Solana check notice:", err.message);
          }
        }
        return res.json({
          match: true,
          locked: isLocked,
          message: isLocked ? "Matches record saved at school and locked on public ledger." : "Matches record saved at school. Waiting to lock.",
          explorerUrl: isLocked && validSig ? `https://explorer.solana.com/tx/${validSig}?cluster=devnet` : undefined,
        });
      }

      // 2. Check Grade Record
      const grade = await serverDb.findGradeById(id);
      if (grade) {
        let isLocked = false;
        let validSig: string | null = null;
        const ledgerEntries = await serverDb.getAllLedgerEntries();
        const matchingLedger = ledgerEntries.find(e => e.payload?.gradeId === id || e.hash === id);
        if (matchingLedger && isValidSolanaSig(matchingLedger.signature) && matchingLedger.confirmedOnChain) {
          validSig = matchingLedger.signature;
        } else if (isValidSolanaSig((grade as any).signature)) {
          validSig = (grade as any).signature;
        }

        if (validSig) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(validSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (tx && !tx.meta?.err) {
              isLocked = true;
            }
          } catch (err: any) {
            console.warn("[Check Activity] Grade on-chain check notice:", err.message);
          }
        }

        return res.json({
          match: true,
          locked: isLocked,
          message: isLocked ? "Matches record saved at school and locked on public ledger." : "Matches record saved at school. Waiting to lock.",
          explorerUrl: isLocked && validSig ? `https://explorer.solana.com/tx/${validSig}?cluster=devnet` : undefined,
        });
      }

      // 3. Check Assessment Score
      const scoreLedger = await serverDb.getLedgerEntryByScoreId(id);
      if (scoreLedger) {
        let isLocked = false;
        const validSig = isValidSolanaSig(scoreLedger.signature) && scoreLedger.confirmedOnChain ? scoreLedger.signature : null;
        if (validSig) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(validSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (tx && !tx.meta?.err) {
              isLocked = true;
            }
          } catch (err: any) {
            console.warn("[Check Activity] Assessment on-chain check notice:", err.message);
          }
        }
        return res.json({
          match: true,
          locked: isLocked,
          message: isLocked ? "Matches record saved at school and locked on public ledger." : "Matches record saved at school. Waiting to lock.",
          explorerUrl: isLocked && validSig ? `https://explorer.solana.com/tx/${validSig}?cluster=devnet` : undefined,
        });
      }

      // Also check general ledger entries by hash
      const ledgerEntry = await serverDb.getLedgerEntryByHash(id);
      if (ledgerEntry) {
        let isLocked = false;
        const validSig = isValidSolanaSig(ledgerEntry.signature) && ledgerEntry.confirmedOnChain ? ledgerEntry.signature : null;
        if (validSig) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(validSig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
            if (tx && !tx.meta?.err) {
              isLocked = true;
            }
          } catch (err: any) {
            console.warn("[Check Activity] Ledger on-chain check notice:", err.message);
          }
        }
        return res.json({
          match: true,
          locked: isLocked,
          message: isLocked ? "Matches record saved at school and locked on public ledger." : "Matches record saved at school. Waiting to lock.",
          explorerUrl: isLocked && validSig ? `https://explorer.solana.com/tx/${validSig}?cluster=devnet` : undefined,
        });
      }

      // 4. Check Vault Document
      const vaultDoc = await serverDb.findVaultDocById(id);
      if (vaultDoc) {
        return res.json({
          match: true,
          locked: false,
          message: "Matches paper saved at school.",
          explorerUrl: undefined,
        });
      }

      // Not found
      return res.json({
        match: false,
        locked: false,
        message: "This record does not match school records.",
      });
    } catch (err: any) {
      console.error("[Check Activity] Error:", err);
      res.status(500).json({ match: false, locked: false, message: "Error checking record." });
    }
  });

  // POST /api/admin/activity/lock-waiting - Retry Solana Memo for waiting items (Admin only)
  app.post("/api/admin/activity/lock-waiting", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    try {
      const connection = getConnection();
      const schoolKeypair = getSchoolKeypair();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      // Check RPC connection first
      try {
        await Promise.race([
          connection.getSlot("confirmed"),
          new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout connecting to public network")), 5000))
        ]);
      } catch (connErr: any) {
        return res.json({
          success: true,
          attempted: 0,
          locked: 0,
          failed: 0,
          rpcUnreachable: true,
          message: "Cannot lock on public ledger right now. Saved at school.",
        });
      }

      let attempted = 0;
      let locked = 0;
      let failed = 0;

      // 1. Process waiting attendance records
      const allAttendance = await serverDb.getAllAttendanceRecords();
      const waitingAttendance = allAttendance.filter(a => !isValidSolanaSig(a.signature));

      for (const att of waitingAttendance) {
        attempted++;
        try {
          const memoPayload = JSON.stringify({
            app: "E-SYLLAB",
            type: "ATTENDANCE",
            id: att.id,
            staffId: att.staffId,
            staffName: att.staffName,
            date: att.date,
            time: att.time,
            className: att.className,
            status: att.status,
            schoolId: att.schoolId,
            timestamp: att.createdAt || new Date().toISOString(),
          });

          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
          const ix = new TransactionInstruction({
            keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
            programId: MEMO_PROGRAM_ID,
            data: new TextEncoder().encode(memoPayload) as any,
          });

          const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
          tx.add(ix);
          tx.sign(schoolKeypair);

          const sig = await connection.sendRawTransaction(tx.serialize());
          await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

          await serverDb.updateAttendanceSignature(att.id, sig);
          await serverDb.deleteFromSyncQueue(att.id);

          locked++;
        } catch (err: any) {
          console.warn(`[Lock Waiting] Failed for attendance ${att.id}:`, err.message);
          failed++;
        }
      }

      // 2. Process waiting ledger entries
      const allLedger = await serverDb.getAllLedgerEntries();
      const waitingLedger = allLedger.filter(e => !e.confirmedOnChain || !isValidSolanaSig(e.signature));

      for (const entry of waitingLedger) {
        attempted++;
        try {
          const memoPayload = JSON.stringify({
            app: "E-SYLLAB",
            type: entry.type,
            hash: entry.hash,
            payload: entry.payload,
            timestamp: entry.createdAt || new Date().toISOString(),
          });

          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
          const ix = new TransactionInstruction({
            keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
            programId: MEMO_PROGRAM_ID,
            data: new TextEncoder().encode(memoPayload) as any,
          });

          const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
          tx.add(ix);
          tx.sign(schoolKeypair);

          const sig = await connection.sendRawTransaction(tx.serialize());
          await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

          const txInfo = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
          await serverDb.recordLedgerEntry({
            hash: entry.hash,
            type: entry.type,
            signature: sig,
            slot: txInfo?.slot || 0,
            payload: entry.payload,
            confirmedOnChain: true,
            createdAt: entry.createdAt,
          });

          locked++;
        } catch (err: any) {
          console.warn(`[Lock Waiting] Failed for ledger ${entry.hash}:`, err.message);
          failed++;
        }
      }

      const message = locked > 0
        ? `Successfully locked ${locked} record${locked > 1 ? 's' : ''} on the public ledger.`
        : "Cannot lock on public ledger right now. Saved at school.";

      return res.json({
        success: true,
        attempted,
        locked,
        failed,
        message,
      });
    } catch (err: any) {
      console.error("[Lock Waiting] Error:", err);
      return res.json({
        success: true,
        attempted: 0,
        locked: 0,
        failed: 0,
        message: "Cannot lock on public ledger right now. Saved at school.",
      });
    }
  });

  // ════════════════════════════════════════════
  //  ACADEMIC LEDGER ROUTES (GRADES & CREDENTIALS)
  // ════════════════════════════════════════════

  // Helper to check if a signature string is a valid Solana transaction signature
  const isValidSolanaSig = (sig?: string | null) => {
    if (!sig || typeof sig !== 'string') return false;
    const s = sig.trim();
    return s.length >= 44 &&
      !s.startsWith('ledger-') &&
      !s.startsWith('cred-') &&
      !s.startsWith('queue-') &&
      !s.startsWith('recorded-') &&
      !s.startsWith('pending-') &&
      !s.startsWith('dummy-') &&
      !s.startsWith('att-') &&
      /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
  };

  // GET /api/blockchain/ledger/all - Fetch all records (Admin check records)
  app.get("/api/blockchain/ledger/all", authenticateToken, async (_req, res) => {
    try {
      const records: any[] = [];

      // 1. Fetch persisted academic ledger entries from database
      const ledgerEntries = await serverDb.getAllLedgerEntries();
      for (const entry of ledgerEntries) {
        const isRealSig = isValidSolanaSig(entry.signature) && entry.confirmedOnChain;
        const payload = entry.payload || {};
        const rawType = (entry.type || payload.type || 'GRADE').toUpperCase();
        let displayType: 'Attendance' | 'Grade' | 'Paper' = 'Grade';
        if (rawType.includes('ATTEND')) displayType = 'Attendance';
        else if (rawType.includes('PAPER') || rawType.includes('VAULT') || rawType.includes('DOC')) displayType = 'Paper';

        const person = payload.studentName || payload.studentId || payload.teacherName || payload.staffName || payload.issuedBy || 'Student';
        const date = (payload.timestamp || entry.createdAt || new Date().toISOString()).slice(0, 10);

        records.push({
          id: (entry as any).id || entry.hash,
          offlineHash: entry.hash,
          type: displayType,
          person,
          date,
          signature: isRealSig ? entry.signature : null,
          slot: entry.slot || 0,
          confirmedOnChain: isRealSig,
          explorerUrl: (isRealSig && entry.signature) ? `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet` : undefined,
          timestamp: payload.timestamp || entry.createdAt || new Date().toISOString(),
          status: isRealSig ? 'Locked' : 'Waiting',
          details: payload.details || `${displayType} record for ${person}`,
          ...payload,
        });
      }

      // 2. Add live attendance records from database
      try {
        const liveAttendance = await serverDb.getAllAttendanceRecords();
        for (const att of liveAttendance) {
          const isRealSig = isValidSolanaSig(att.signature);
          const date = att.date || (att.createdAt ? att.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
          const person = att.staffName || 'Teacher';
          records.push({
            id: att.id,
            offlineHash: att.offlineHash || att.id,
            type: "Attendance",
            person,
            date,
            status: isRealSig ? "Locked" : "Waiting",
            confirmedOnChain: isRealSig,
            staffId: att.staffId,
            staffName: att.staffName,
            time: att.time,
            className: att.className,
            attendanceStatus: att.status,
            schoolId: att.schoolId,
            syncedFromOffline: true,
            timestamp: att.createdAt || new Date().toISOString(),
            signature: isRealSig ? att.signature : null,
            slot: 0,
            details: `Attendance for ${person} (${att.className || 'General'}) - ${att.status}`,
            explorerUrl: (isRealSig && att.signature) ? `https://explorer.solana.com/tx/${att.signature}?cluster=devnet` : undefined,
          });
        }
      } catch (attErr) {
        console.warn("[Ledger] Could not load live attendance records:", attErr);
      }

      // 3. Add pending queue items
      const queueItems = await serverDb.getSyncQueue();
      for (const item of queueItems) {
        const date = item.date || (item.createdAt ? item.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10));
        const person = item.staffName || 'Teacher';
        records.push({
          id: item.id,
          offlineHash: item.offlineHash || `queue-${item.id}`,
          type: "Attendance",
          person,
          date,
          status: "Waiting",
          confirmedOnChain: false,
          staffId: item.staffId,
          staffName: item.staffName,
          time: item.time,
          className: item.className,
          attendanceStatus: item.status,
          schoolId: item.schoolId,
          syncedFromOffline: true,
          timestamp: item.queuedAt || item.localTimestamp || item.createdAt || new Date().toISOString(),
          signature: null,
          slot: 0,
          details: `Queued attendance for ${person}`,
          explorerUrl: undefined,
        });
      }

      // 4. Add Vault Documents (Papers)
      try {
        const vaultDocs = await serverDb.getAllVaultDocuments();
        for (const doc of vaultDocs) {
          const date = doc.createdAt ? doc.createdAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
          const person = doc.teacherName || 'Teacher';
          records.push({
            id: doc.id,
            offlineHash: doc.hash || (doc as any).evidenceHash || doc.id,
            type: "Paper",
            person,
            date,
            status: "Waiting",
            confirmedOnChain: false,
            timestamp: doc.createdAt || new Date().toISOString(),
            signature: null,
            slot: 0,
            title: doc.title,
            details: `Paper: ${doc.title} (${doc.type || (doc as any).category || 'Document'}) - ${doc.status}`,
            explorerUrl: undefined,
          });
        }
      } catch (vaultErr) {
        console.warn("[Ledger] Could not load vault documents:", vaultErr);
      }

      // Sort newest first
      records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      res.json({
        success: true,
        count: records.length,
        records,
      });
    } catch (err: any) {
      console.error("[Ledger] GET /all error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  async function computeGradeHash(studentId: string, subject: string, score: number, teacherId: string, term: string, academicYear: string): Promise<string> {
    const input = `${studentId}:${subject}:${score}:${teacherId}:${term}:${academicYear}`;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  async function computeCredentialHash(studentId: string, subjects: any[], issuedById: string, academicYear: string): Promise<string> {
    const subjectStr = subjects.map((s: any) => `${s.subject}:${s.grade}`).sort().join("|");
    const input = `CREDENTIAL:${studentId}:${subjectStr}:${issuedById}:${academicYear}`;
    const data = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  // POST /api/blockchain/ledger/grade/record - TEACHER/ADMIN only
  app.post("/api/blockchain/ledger/grade/record", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { gradeId, studentId, studentName, teacherId, teacherName, subject, score, grade, academicYear, term, schoolId, timestamp } = req.body;

    if (!studentId || !subject || score === undefined || !teacherId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    try {
      const offlineHash = await computeGradeHash(studentId, subject, score, teacherId, term || "Term 1", academicYear || "2026");
      const schoolKeypair = getSchoolKeypair();
      const memoPayload = JSON.stringify({
        app: "E-SYLLAB", version: "1.0", type: "GRADE",
        gradeId, studentId, studentName, teacherId, teacherName,
        subject, score, grade, academicYear, term, schoolId,
        offlineHash, timestamp: timestamp || new Date().toISOString(),
      });

      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      let signature: string | null = null;
      let slot = 0;
      let confirmedOnChain = false;

      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const ix = new TransactionInstruction({
          keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: new TextEncoder().encode(memoPayload) as any,
        });

        const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
        tx.add(ix);
        tx.sign(schoolKeypair);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        const txInfo = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        slot = txInfo?.slot ?? 0;
        signature = sig;
        confirmedOnChain = true;
      } catch (solanaErr: any) {
        console.warn("[Ledger] Grade submission on-chain notice:", solanaErr.message);
        signature = null;
        slot = 0;
        confirmedOnChain = false;
      }

      await serverDb.recordLedgerEntry({
        hash: offlineHash,
        type: "GRADE",
        signature: confirmedOnChain ? signature : null,
        slot: confirmedOnChain ? slot : 0,
        payload: {
          type: "GRADE",
          gradeId,
          studentId,
          studentName,
          teacherId,
          teacherName,
          subject,
          score,
          grade,
          academicYear,
          term,
          schoolId,
          timestamp: timestamp || new Date().toISOString(),
          details: `Grade attestation for ${studentName} - ${subject} (${grade})`,
        },
        confirmedOnChain,
        createdAt: timestamp || new Date().toISOString(),
      });

      res.json({
        success: true,
        offlineHash,
        signature: confirmedOnChain ? signature : null,
        slot: confirmedOnChain ? slot : 0,
        confirmedOnChain,
        explorerUrl: confirmedOnChain && signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/ledger/credential/issue - ADMIN only
  app.post("/api/blockchain/ledger/credential/issue", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { credentialId, studentId, studentName, schoolId, credentialType, subjects, issuedBy, issuedById, academicYear, timestamp } = req.body;

    if (!studentId || !subjects?.length || !issuedById) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    try {
      const offlineHash = await computeCredentialHash(studentId, subjects, issuedById, academicYear || "2026");
      const schoolKeypair = getSchoolKeypair();
      const memoPayload = JSON.stringify({
        app: "E-SYLLAB", version: "1.0", type: "CREDENTIAL",
        credentialId, studentId, studentName, schoolId,
        credentialType, subjects, issuedBy, issuedById, academicYear,
        offlineHash, timestamp: timestamp || new Date().toISOString(),
      });

      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      let signature: string | null = null;
      let slot = 0;
      let confirmedOnChain = false;

      try {
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const ix = new TransactionInstruction({
          keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
          programId: MEMO_PROGRAM_ID,
          data: new TextEncoder().encode(memoPayload) as any,
        });

        const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
        tx.add(ix);
        tx.sign(schoolKeypair);

        const sig = await connection.sendRawTransaction(tx.serialize());
        await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        const txInfo = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
        slot = txInfo?.slot ?? 0;
        signature = sig;
        confirmedOnChain = true;
      } catch (solanaErr: any) {
        console.warn("[Ledger] Credential submission on-chain notice:", solanaErr.message);
        signature = null;
        slot = 0;
        confirmedOnChain = false;
      }

      await serverDb.recordLedgerEntry({
        hash: offlineHash,
        type: "CREDENTIAL",
        signature: confirmedOnChain ? signature : null,
        slot: confirmedOnChain ? slot : 0,
        payload: {
          type: "CREDENTIAL",
          credentialId,
          studentId,
          studentName,
          schoolId,
          credentialType,
          subjects,
          issuedBy,
          issuedById,
          academicYear,
          timestamp: timestamp || new Date().toISOString(),
          details: `${credentialType || 'Official Credential'} issued to ${studentName}`,
        },
        confirmedOnChain,
        createdAt: timestamp || new Date().toISOString(),
      });

      res.json({
        success: true,
        offlineHash,
        signature: confirmedOnChain ? signature : null,
        slot: confirmedOnChain ? slot : 0,
        confirmedOnChain,
        explorerUrl: confirmedOnChain && signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/ledger/verify
  app.post("/api/blockchain/ledger/verify", authenticateToken, async (req, res) => {
    const { offlineHash } = req.body;
    if (!offlineHash || typeof offlineHash !== 'string') {
      return res.status(400).json({ success: false, error: "Missing or invalid record code" });
    }

    try {
      const code = offlineHash.trim();

      // 1. Check ledger entries
      const entry = await serverDb.getLedgerEntryByHash(code);
      if (entry) {
        const isRealSig = isValidSolanaSig(entry.signature) && entry.confirmedOnChain;
        let onChainVerified = false;

        if (isRealSig && entry.signature) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(entry.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            if (tx && !tx.meta?.err) {
              onChainVerified = true;
            }
          } catch (chainErr: any) {
            console.warn("[Verify] On-chain check note:", chainErr.message);
          }
        }

        const confirmedOnChain = Boolean(onChainVerified || (isRealSig && entry.confirmedOnChain));
        return res.json({
          success: true,
          isValid: true,
          confirmedOnChain,
          record: entry.payload,
          signature: (isRealSig && confirmedOnChain) ? entry.signature : null,
          slot: entry.slot || 0,
          explorerUrl: (isRealSig && confirmedOnChain && entry.signature) ? `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet` : undefined,
          message: "This record matches",
        });
      }

      // 2. Check attendance records
      const allAttendance = await serverDb.getAllAttendanceRecords();
      const att = allAttendance.find(a => a.offlineHash === code || a.id === code || a.signature === code);
      if (att) {
        const isRealSig = isValidSolanaSig(att.signature);
        let onChainVerified = false;
        if (isRealSig && att.signature) {
          try {
            const connection = getConnection();
            const tx = await connection.getTransaction(att.signature, {
              commitment: "confirmed",
              maxSupportedTransactionVersion: 0,
            });
            if (tx && !tx.meta?.err) {
              onChainVerified = true;
            }
          } catch (chainErr: any) {
            console.warn("[Verify] Attendance on-chain check note:", chainErr.message);
          }
        }

        const confirmedOnChain = Boolean(onChainVerified || isRealSig);
        return res.json({
          success: true,
          isValid: true,
          confirmedOnChain,
          signature: (isRealSig && confirmedOnChain) ? att.signature : null,
          explorerUrl: (isRealSig && confirmedOnChain && att.signature) ? `https://explorer.solana.com/tx/${att.signature}?cluster=devnet` : undefined,
          message: "This record matches",
        });
      }

      // 3. Check vault documents (papers)
      const allVault = await serverDb.getAllVaultDocuments();
      const vDoc = allVault.find(d => d.id === code || d.hash === code || (d as any).evidenceHash === code);
      if (vDoc) {
        return res.json({
          success: true,
          isValid: true,
          confirmedOnChain: false,
          signature: null,
          message: "This record matches",
        });
      }

      // 4. Check sync queue
      const syncQueue = await serverDb.getSyncQueue();
      const qItem = syncQueue.find(q => q.id === code || q.offlineHash === code);
      if (qItem) {
        return res.json({
          success: true,
          isValid: true,
          confirmedOnChain: false,
          signature: null,
          message: "This record matches",
        });
      }

      // Not found
      return res.json({
        success: true,
        isValid: false,
        confirmedOnChain: false,
        signature: null,
        message: "This record does not match",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Assessment & Reporting API Routes ───────────────────────────────────

  // POST /api/assessments (Teacher, Admin) - Create new assessment
  app.post("/api/assessments", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { title, subject, className, maxScore } = req.body;
    if (!title || !subject || !className || maxScore === undefined) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, subject, className, maxScore" });
    }
    const maxScoreNum = Number(maxScore);
    if (isNaN(maxScoreNum) || maxScoreNum <= 0) {
      return res.status(400).json({ success: false, error: "maxScore must be a positive number" });
    }
    try {
      const assessment = await serverDb.createAssessment({
        title,
        subject,
        className,
        teacherId: req.user!.userId,
        maxScore: maxScoreNum,
      });

      // Auto-generate deadline notifications for students in that class
      try {
        const students = await serverDb.getUsersByRole(UserRole.STUDENT);
        const targetStudents = (className === 'All Classes' || className === 'All Grades')
          ? students
          : students.filter(s => s.className === className || s.grade === className);

        const targetIds = targetStudents.map(s => s.id);
        if (targetIds.length > 0) {
          await serverDb.createBulkNotifications(
            targetIds,
            'deadline',
            `New Assessment Deadline: ${title}`,
            `An assessment for ${subject} (${className}) worth ${maxScoreNum} marks has been scheduled.`,
            assessment.id
          );
        }
      } catch (notifErr) {
        console.warn('[Server] Error creating assessment deadline notifications:', notifErr);
      }

      res.json({ success: true, assessment });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/assessments (any authenticated user) - List assessments
  app.get("/api/assessments", authenticateToken, async (req, res) => {
    try {
      const assessments = await serverDb.getAllAssessments();
      res.json({ success: true, assessments });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/assessments/student/my-scores (Student) - Get own assessment scores with blockchain info
  app.get("/api/assessments/student/my-scores", authenticateToken, async (req, res) => {
    try {
      const studentId = req.user!.userId;
      const rawScores = await serverDb.getStudentAssessmentScores(studentId);
      const scores = await Promise.all(rawScores.map(async (item) => {
        const ledgerEntry = await serverDb.getLedgerEntryByScoreId(item.id);
        const isConfirmed = Boolean(ledgerEntry?.confirmedOnChain && ledgerEntry?.signature && isValidSolanaSig(ledgerEntry.signature));
        return {
          ...item,
          offlineHash: ledgerEntry?.hash || null,
          signature: isConfirmed ? ledgerEntry!.signature : null,
          slot: ledgerEntry?.slot || 0,
          confirmedOnChain: isConfirmed,
          explorerUrl: isConfirmed && ledgerEntry?.signature ? `https://explorer.solana.com/tx/${ledgerEntry.signature}?cluster=devnet` : undefined,
        };
      }));
      res.json({ success: true, scores });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/assessments/:id/scores (Teacher, Admin) - Submit scores for students & anchor on-chain
  app.post("/api/assessments/:id/scores", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const assessmentId = String(req.params.id);
    const { scores } = req.body;

    if (!Array.isArray(scores)) {
      return res.status(400).json({ success: false, error: "scores must be an array" });
    }

    const assessment = await serverDb.findAssessmentById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ success: false, error: "Assessment not found" });
    }

    try {
      const savedScores = await serverDb.saveAssessmentScores(assessmentId, scores);
      const schoolKeypair = getSchoolKeypair();
      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      const anchoredScores = [];
      for (const scoreRecord of savedScores) {
        const studentUser = await serverDb.findUserById(scoreRecord.studentId);
        const studentName = studentUser ? studentUser.name : 'Student';

        const offlineHash = await computeGradeHash(
          scoreRecord.studentId,
          assessment.subject,
          scoreRecord.score,
          req.user!.userId,
          assessment.title,
          "2026"
        );

        const memoPayload = JSON.stringify({
          app: "E-SYLLAB",
          type: "ASSESSMENT_SCORE",
          assessmentId,
          scoreId: scoreRecord.id,
          studentId: scoreRecord.studentId,
          studentName,
          title: assessment.title,
          subject: assessment.subject,
          score: scoreRecord.score,
          maxScore: assessment.maxScore,
          offlineHash,
          timestamp: scoreRecord.createdAt,
        });

        let signature: string | null = null;
        let slot = 0;
        let confirmedOnChain = false;

        try {
          const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
          const ix = new TransactionInstruction({
            keys: [{ pubkey: schoolKeypair.publicKey, isSigner: true, isWritable: false }],
            programId: MEMO_PROGRAM_ID,
            data: new TextEncoder().encode(memoPayload) as any,
          });

          const tx = new Transaction({ feePayer: schoolKeypair.publicKey, blockhash, lastValidBlockHeight });
          tx.add(ix);
          tx.sign(schoolKeypair);

          const sig = await connection.sendRawTransaction(tx.serialize());
          await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
          const txInfo = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
          slot = txInfo?.slot ?? 0;
          signature = sig;
          confirmedOnChain = true;
        } catch (solanaErr: any) {
          console.warn("[Ledger] Assessment score submission on-chain notice:", solanaErr.message);
          signature = null;
          slot = 0;
          confirmedOnChain = false;
        }

        await serverDb.recordLedgerEntry({
          hash: offlineHash,
          type: "ASSESSMENT_SCORE",
          signature: confirmedOnChain ? signature : null,
          slot: confirmedOnChain ? slot : 0,
          payload: {
            type: "ASSESSMENT_SCORE",
            assessmentId,
            scoreId: scoreRecord.id,
            studentId: scoreRecord.studentId,
            studentName,
            title: assessment.title,
            subject: assessment.subject,
            score: scoreRecord.score,
            maxScore: assessment.maxScore,
            timestamp: scoreRecord.createdAt,
            details: `Assessment score: ${assessment.title} - ${assessment.subject} (${scoreRecord.score}/${assessment.maxScore})`,
          },
          confirmedOnChain,
          createdAt: scoreRecord.createdAt || new Date().toISOString(),
        });

        anchoredScores.push({
          ...scoreRecord,
          studentName,
          offlineHash,
          signature: confirmedOnChain ? signature : null,
          slot: confirmedOnChain ? slot : 0,
          confirmedOnChain,
          explorerUrl: confirmedOnChain && signature ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
        });
      }

      const report = await serverDb.getAssessmentReport(assessmentId);

      res.json({
        success: true,
        scores: anchoredScores,
        report,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/assessments/:id/report (Teacher, Admin) - Return report & scores for an assessment
  app.get("/api/assessments/:id/report", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const assessmentId = String(req.params.id);
    try {
      const assessment = await serverDb.findAssessmentById(assessmentId);
      if (!assessment) {
        return res.status(404).json({ success: false, error: "Assessment not found" });
      }
      const report = await serverDb.getAssessmentReport(assessmentId);
      const scores = await serverDb.getAssessmentScores(assessmentId);
      res.json({
        success: true,
        assessment,
        report,
        scores,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── System Notifications & Alerts API Routes ──────────────────────────────

  // GET /api/notifications - Get logged-in user's notifications
  app.get("/api/notifications", authenticateToken, async (req, res) => {
    try {
      const notifications = await serverDb.getUserNotifications(req.user!.userId);
      res.json({ success: true, notifications });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/notifications/:id/read - Mark notification as read
  app.post("/api/notifications/:id/read", authenticateToken, async (req, res) => {
    const notificationId = String(req.params.id);
    try {
      await serverDb.markNotificationAsRead(notificationId, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/notifications - Create notification manually (Teacher, Admin)
  app.post("/api/notifications", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { recipientId, className, type, title, message, relatedId } = req.body;
    if (!type || !title || !message) {
      return res.status(400).json({ success: false, error: "Missing required fields: type, title, message" });
    }

    const validTypes = ['deadline', 'meeting', 'misconduct', 'general'];
    const notifType = validTypes.includes(type) ? type : 'general';

    try {
      let createdCount = 0;
      if (recipientId) {
        await serverDb.createNotification(recipientId, notifType, title, message, relatedId);
        createdCount = 1;
      } else if (className) {
        const allUsers = await serverDb.getAllUsers();
        const users = allUsers.filter(u => u.className === className || u.grade === className || className === 'All Classes' || className === 'All Grades');
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
          await serverDb.createBulkNotifications(userIds, notifType, title, message, relatedId);
          createdCount = userIds.length;
        }
      } else {
        const students = await serverDb.getUsersByRole(UserRole.STUDENT);
        const userIds = students.map(s => s.id);
        if (userIds.length > 0) {
          await serverDb.createBulkNotifications(userIds, notifType, title, message, relatedId);
          createdCount = userIds.length;
        }
      }

      res.json({ success: true, count: createdCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // GET /api/blockchain/ledger/student/:studentId
  app.get("/api/blockchain/ledger/student/:studentId", authenticateToken, async (req, res) => {
    const studentId = Array.isArray(req.params.studentId) ? req.params.studentId[0] : req.params.studentId;
    try {
      const ledgerEntries = await serverDb.getLedgerEntriesByStudent(studentId);
      const records = ledgerEntries.map(entry => {
        const isConfirmed = Boolean(entry.confirmedOnChain && entry.signature && isValidSolanaSig(entry.signature));
        return {
          offlineHash: entry.hash,
          signature: isConfirmed ? entry.signature : null,
          slot: entry.slot || 0,
          confirmedOnChain: isConfirmed,
          status: isConfirmed ? 'CONFIRMED' : 'PENDING',
          explorerUrl: isConfirmed && entry.signature ? `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet` : undefined,
          ...entry.payload,
        };
      });
      res.json({ success: true, studentId, count: records.length, records });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Staff Performance Route ──────────────────────────────────────────────
  // GET /api/admin/staff-performance (ADMIN only)
  app.get("/api/admin/staff-performance", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    try {
      const teachers = await serverDb.getStaffPerformanceMetrics();
      res.json({ success: true, count: teachers.length, teachers });
    } catch (err: any) {
      console.error("[Staff Performance] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch staff performance metrics" });
    }
  });

  // ─── Timetable Management Routes ──────────────────────────────────────────
  async function checkTimetableConflict(
    className: string,
    dayOfWeek: string,
    period: string,
    teacherId?: string,
    room?: string,
    excludeId?: string
  ): Promise<{ conflict: boolean; error?: string }> {
    const pNorm = (period || "").toLowerCase();
    if (pNorm.includes("break") || pNorm.includes("lunch") || pNorm.includes("10:00") || pNorm.includes("13:00")) {
      return { conflict: true, error: "Cannot schedule classes during fixed Break (10:00–10:30) or Lunch (13:00–14:00) slots." };
    }

    const allEntries = await serverDb.getAllTimetables();

    for (const existing of allEntries) {
      if (excludeId && existing.id === excludeId) continue;

      const sameDay = existing.dayOfWeek.trim().toLowerCase() === dayOfWeek.trim().toLowerCase();
      const samePeriod = existing.period.trim().toLowerCase() === period.trim().toLowerCase();

      if (sameDay && samePeriod) {
        // Rule 1: Teacher conflict
        if (teacherId && existing.teacherId && existing.teacherId === teacherId) {
          const teacherName = existing.teacherName || "The assigned teacher";
          return {
            conflict: true,
            error: `Teacher Conflict: ${teacherName} is already scheduled in ${existing.className} (${existing.subject}) on ${dayOfWeek} during ${period}.`,
          };
        }

        // Rule 2: Class conflict
        if (existing.className.trim().toLowerCase() === className.trim().toLowerCase()) {
          return {
            conflict: true,
            error: `Class Conflict: ${className} already has ${existing.subject} scheduled on ${dayOfWeek} during ${period}.`,
          };
        }

        // Rule 3: Room conflict
        if (room && room.trim() && existing.room && existing.room.trim().toLowerCase() === room.trim().toLowerCase()) {
          return {
            conflict: true,
            error: `Room Conflict: Room "${room}" is already booked for ${existing.className} (${existing.subject}) on ${dayOfWeek} during ${period}.`,
          };
        }
      }
    }

    return { conflict: false };
  }

  // GET /api/timetables (any authenticated user)
  app.get("/api/timetables", authenticateToken, async (req, res) => {
    try {
      const className = req.query.className as string;
      let timetables;
      if (className) {
        timetables = await serverDb.getTimetablesByClass(className);
      } else {
        timetables = await serverDb.getAllTimetables();
      }
      res.json({ success: true, count: timetables.length, timetables });
    } catch (err: any) {
      console.error("[Timetables] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch timetables" });
    }
  });

  // POST /api/timetables (ADMIN only)
  app.post("/api/timetables", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { className, dayOfWeek, period, subject, teacherId, room } = req.body;

    if (!className || !dayOfWeek || !period || !subject) {
      return res.status(400).json({ success: false, error: "Missing required fields: className, dayOfWeek, period, subject" });
    }

    const check = await checkTimetableConflict(className, dayOfWeek, period, teacherId, room);
    if (check.conflict) {
      return res.status(409).json({ success: false, error: check.error });
    }

    try {
      const entry = await serverDb.createTimetableEntry({
        className,
        dayOfWeek,
        period,
        subject,
        teacherId,
        room,
      });
      res.json({ success: true, timetable: entry, message: "Timetable entry created successfully" });
    } catch (err: any) {
      console.error("[Timetables] POST error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to create timetable entry" });
    }
  });

  // PUT /api/timetables/:id (ADMIN only)
  app.put("/api/timetables/:id", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updates = req.body;

    const allEntries = await serverDb.getAllTimetables();
    const existing = allEntries.find(t => t.id === id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Timetable entry not found" });
    }

    const className = updates.className || existing.className;
    const dayOfWeek = updates.dayOfWeek || existing.dayOfWeek;
    const period = updates.period || existing.period;
    const teacherId = updates.teacherId !== undefined ? updates.teacherId : existing.teacherId;
    const room = updates.room !== undefined ? updates.room : existing.room;

    const check = await checkTimetableConflict(className, dayOfWeek, period, teacherId, room, id);
    if (check.conflict) {
      return res.status(409).json({ success: false, error: check.error });
    }

    try {
      const updated = await serverDb.updateTimetableEntry(id, updates);
      if (!updated) {
        return res.status(404).json({ success: false, error: "Timetable entry not found" });
      }
      res.json({ success: true, timetable: updated, message: "Timetable entry updated successfully" });
    } catch (err: any) {
      console.error("[Timetables] PUT error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to update timetable entry" });
    }
  });

  // DELETE /api/timetables/:id (ADMIN only)
  app.delete("/api/timetables/:id", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      await serverDb.deleteTimetableEntry(id);
      res.json({ success: true, message: "Timetable entry deleted successfully" });
    } catch (err: any) {
      console.error("[Timetables] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to delete timetable entry" });
    }
  });

  // ─── Students Roster Route ────────────────────────────────────────────────
  // GET /api/students (Teacher, Admin)
  app.get("/api/students", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (_req, res) => {
    try {
      const students = await serverDb.getUsersByRole(UserRole.STUDENT);
      res.json({ success: true, count: students.length, students });
    } catch (err: any) {
      console.error("[Students] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch students" });
    }
  });

  // ─── Academic Grades Routes ────────────────────────────────────────────────
  // GET /api/grades (any authenticated user — students see only their own, teachers/admins see all)
  app.get("/api/grades", authenticateToken, async (req, res) => {
    try {
      const user = req.user!;
      let grades;
      if (user.role === UserRole.STUDENT) {
        grades = await serverDb.getStudentGrades(user.userId);
      } else {
        grades = await serverDb.getAllGrades();
      }
      res.json({ success: true, count: grades.length, grades });
    } catch (err: any) {
      console.error("[Grades] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch grades" });
    }
  });

  // POST /api/grades (Teacher, Admin)
  app.post("/api/grades", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { studentId, subject, score, grade, feedback, comment, recordedAt } = req.body;

    if (!studentId || !subject) {
      return res.status(400).json({ success: false, error: "Missing required fields: studentId, subject" });
    }

    try {
      const student = await serverDb.findUserById(studentId);
      const gradeRecord = await serverDb.recordGrade({
        studentId,
        studentName: student ? student.name : undefined,
        teacherId: req.user!.userId,
        subject,
        score: score !== undefined ? parseFloat(score) : undefined,
        grade,
        feedback,
        comment,
        recordedAt,
      });

      res.json({ success: true, grade: gradeRecord, message: "Grade recorded successfully" });
    } catch (err: any) {
      console.error("[Grades] POST error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to record grade" });
    }
  });

  // ─── Messages Routes ───────────────────────────────────────────────────────
  // GET /api/messages (any authenticated user — only their own sent/received/broadcasts)
  app.get("/api/messages", authenticateToken, async (req, res) => {
    try {
      const messages = await serverDb.getUserMessages(req.user!.userId, req.user!.role);
      res.json({ success: true, count: messages.length, messages });
    } catch (err: any) {
      console.error("[Messages] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch messages" });
    }
  });

  // POST /api/messages (any authenticated user)
  app.post("/api/messages", authenticateToken, async (req, res) => {
    const { recipientId, recipientName, subject, content, file } = req.body;

    if (!content && !file) {
      return res.status(400).json({ success: false, error: "Message content or attachment is required" });
    }

    try {
      const sender = await serverDb.findUserById(req.user!.userId);
      const senderName = sender ? sender.name : 'User';

      const message = await serverDb.sendMessage({
        senderId: req.user!.userId,
        senderName,
        recipientId,
        recipientName,
        subject,
        content: content || '',
        file,
      });

      res.json({ success: true, message, successMessage: "Message sent successfully" });
    } catch (err: any) {
      console.error("[Messages] POST error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to send message" });
    }
  });

  // DELETE /api/messages (any authenticated user — clears user's message history)
  app.delete("/api/messages", authenticateToken, async (req, res) => {
    try {
      await serverDb.clearMessages(req.user!.userId);
      res.json({ success: true, message: "Message history cleared successfully" });
    } catch (err: any) {
      console.error("[Messages] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to clear message history" });
    }
  });

  // ─── Curriculum Resources Routes ───────────────────────────────────────────
  // GET /api/curriculum (any authenticated user)
  app.get("/api/curriculum", authenticateToken, async (_req, res) => {
    try {
      const curriculum = await serverDb.getAllCurriculum();
      res.json({ success: true, count: curriculum.length, curriculum });
    } catch (err: any) {
      console.error("[Curriculum] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch curriculum materials" });
    }
  });

  // POST /api/curriculum (Teacher, Admin)
  app.post("/api/curriculum", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { title, subject, gradeLevel, description, category, fileName, fileType, fileData } = req.body;

    if (!title || !subject || !gradeLevel || !category) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, subject, gradeLevel, category" });
    }

    // 2MB file limit validation
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    if (fileData && typeof fileData === 'string') {
      const base64Content = fileData.includes(',') ? fileData.split(',')[1] : fileData;
      const approxSizeBytes = Math.round((base64Content.length * 3) / 4);
      if (approxSizeBytes > MAX_FILE_BYTES) {
        return res.status(400).json({
          success: false,
          error: `File size (${(approxSizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the 2MB limit. Please upload a file under 2MB.`,
        });
      }
    }

    try {
      const uploader = await serverDb.findUserById(req.user!.userId);
      const uploadedByName = uploader ? uploader.name : 'Staff';

      const resource = await serverDb.addCurriculum({
        title,
        subject,
        gradeLevel,
        description: description || '',
        category,
        authorRole: req.user!.role,
        uploadedById: req.user!.userId,
        uploadedByName,
        fileName,
        fileType,
        fileData,
      });

      res.json({ success: true, resource, message: "Curriculum material uploaded successfully" });
    } catch (err: any) {
      console.error("[Curriculum] POST error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to create curriculum material" });
    }
  });

  // DELETE /api/curriculum/:id (Teacher, Admin)
  app.delete("/api/curriculum/:id", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      await serverDb.deleteCurriculum(id);
      res.json({ success: true, message: "Curriculum material deleted successfully" });
    } catch (err: any) {
      console.error("[Curriculum] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to delete curriculum material" });
    }
  });

  // ─── Vault Documents Routes ────────────────────────────────────────────────
  // GET /api/vault (Teacher sees their own submissions, Admin sees all)
  app.get("/api/vault", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    try {
      const user = req.user!;
      let documents;
      if (user.role === UserRole.ADMIN) {
        documents = await serverDb.getAllVaultDocuments();
      } else {
        documents = await serverDb.getVaultDocumentsByTeacher(user.userId);
      }
      res.json({ success: true, count: documents.length, documents });
    } catch (err: any) {
      console.error("[Vault] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch vault documents" });
    }
  });

  // POST /api/vault (Teacher, Admin)
  app.post("/api/vault", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { title, type, fileName, fileType, fileData } = req.body;

    if (!title || !type) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, type" });
    }

    // 2MB file limit validation
    const MAX_FILE_BYTES = 2 * 1024 * 1024;
    if (fileData && typeof fileData === 'string') {
      const base64Content = fileData.includes(',') ? fileData.split(',')[1] : fileData;
      const approxSizeBytes = Math.round((base64Content.length * 3) / 4);
      if (approxSizeBytes > MAX_FILE_BYTES) {
        return res.status(400).json({
          success: false,
          error: `File size (${(approxSizeBytes / (1024 * 1024)).toFixed(1)}MB) exceeds the 2MB limit. Please upload a file under 2MB.`,
        });
      }
    }

    try {
      const teacher = await serverDb.findUserById(req.user!.userId);
      const teacherName = teacher ? teacher.name : 'Teacher';

      const document = await serverDb.addVaultDocument({
        title,
        type,
        status: DocumentStatus.PENDING,
        teacherId: req.user!.userId,
        teacherName,
        fileName,
        fileType,
        fileData,
      });

      res.json({ success: true, document, message: "Document submitted to vault successfully" });
    } catch (err: any) {
      console.error("[Vault] POST error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to submit document to vault" });
    }
  });

  // PUT /api/vault/:id/approve (Admin only)
  app.put("/api/vault/:id/approve", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const document = await serverDb.updateVaultDocumentStatus(id, DocumentStatus.APPROVED);
      if (!document) {
        return res.status(404).json({ success: false, error: "Vault document not found" });
      }
      res.json({ success: true, document, message: "Vault document approved successfully" });
    } catch (err: any) {
      console.error("[Vault] Approve error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to approve vault document" });
    }
  });

  // PUT /api/vault/:id/reject (Admin only)
  app.put("/api/vault/:id/reject", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const document = await serverDb.updateVaultDocumentStatus(id, DocumentStatus.REJECTED);
      if (!document) {
        return res.status(404).json({ success: false, error: "Vault document not found" });
      }
      res.json({ success: true, document, message: "Vault document rejected successfully" });
    } catch (err: any) {
      console.error("[Vault] Reject error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to reject vault document" });
    }
  });

  // PUT /api/vault/:id/status (Admin only)
  app.put("/api/vault/:id/status", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status } = req.body;

    if (!status || !Object.values(DocumentStatus).includes(status)) {
      return res.status(400).json({ success: false, error: "Valid status ('PENDING', 'APPROVED', 'REJECTED') is required" });
    }

    try {
      const document = await serverDb.updateVaultDocumentStatus(id, status);
      if (!document) {
        return res.status(404).json({ success: false, error: "Vault document not found" });
      }
      res.json({ success: true, document, message: `Vault document status updated to ${status}` });
    } catch (err: any) {
      console.error("[Vault] Status update error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to update vault document status" });
    }
  });

  // ── Service Worker & PWA Manifest routes ────────────────────────────────────
  app.get("/sw.js", (_req, res) => {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", "application/javascript");
    res.sendFile(path.join(rootDir, "sw.js"));
  });

  app.get("/manifest.json", (_req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.sendFile(path.join(rootDir, "manifest.json"));
  });

  // ── Vite middleware ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(rootDir, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 E-SYLLAB Server → http://localhost:${PORT}`);
    console.log(`⛓  Blockchain API  → http://localhost:${PORT}/api/blockchain`);
    console.log(`📡 Solana Devnet connected`);
    if (process.env.NODE_ENV !== "production") {
      console.warn("WARNING: test OTP bypass is active (non-production only).");
    }
    if (getSchoolKeypair()) {
      console.log(`🔑 School signing key loaded — offline sync enabled\n`);
    } else {
      console.warn(`⚠  SCHOOL_SIGNING_KEYPAIR not set — offline sync disabled\n`);
    }
  });
}

startServer();
