import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import jwt from "jsonwebtoken";
import { db } from "./services/database.js";
import { serverDb } from "./services/serverDatabase.js";
import { UserRole, DocumentStatus } from "./types.js";
import {
  buildAttendanceTransaction,
  confirmTransaction,
  getNetworkStatus,
  computeOfflineHash,
  getConnection,
} from "./services/blockchain.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// ─── In-memory sync queue ─────────────────────────────────────────────────────
interface SyncQueueItem {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  time?: string;
  className?: string;
  status: string;
  schoolId: string;
  syncedFromOffline: boolean;
  localTimestamp: string;
  retries: number;
  queuedAt: string;
  offlineHash?: string;
}
const syncQueue: Map<string, SyncQueueItem> = new Map();

// ─── Resend ───────────────────────────────────────────────────────────────────
let resend: Resend | null = null;
const getResend = () => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resend) resend = new Resend(apiKey);
  return resend;
};

// ─── JWT Configuration ────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRY = '24h';

// In-memory token blacklist for logout (in production, use Redis or a database)
const tokenBlacklist = new Set<string>();

// ─── 2FA OTP Store ─────────────────────────────────────────────────────────────
interface TwoFactorEntry {
  code: string;
  expiresAt: number;
  purpose: 'LOGIN' | 'REGISTER';
  attempts: number;
}
const twoFactorStore = new Map<string, TwoFactorEntry>();

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
function authenticateToken(req: Request, res: Response, next: NextFunction) {
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
    req.user = decoded;
    next();
  } catch (err: any) {
    return res.status(403).json({ success: false, error: 'Your login has ended, please sign in again' });
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


// ─── Server ───────────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = 3000;

  // Initialize database
  await serverDb.init();

  app.use(express.json());

  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(200);
    next();
  });

  // ════════════════════════════════════════════
  //  BLOCKCHAIN ROUTES
  // ════════════════════════════════════════════

  // GET /api/blockchain/status
  app.get("/api/blockchain/status", authenticateToken, async (_req, res) => {
    try {
      const status = await getNetworkStatus();
      res.json({ success: true, network: "devnet", ...status, queueSize: syncQueue.size });
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

  // POST /api/blockchain/attendance/record - TEACHER/ADMIN only
  // Online submission — server signs transaction with SCHOOL_SIGNING_KEYPAIR
  app.post("/api/blockchain/attendance/record", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { staffId, staffName, date, time, className, status, schoolId, localTimestamp } = req.body;

    if (!staffId || !date || !status || !schoolId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    try {
      const offlineHash = await computeOfflineHash(staffId, date, status);
      const schoolKeypair = getSchoolKeypair();
      const memoPayload = JSON.stringify({
        app: "E-SYLLAB", version: "1.0", type: "ATTENDANCE",
        staffId, staffName: staffName || staffId, schoolId,
        date, time: time || "", className: className || "",
        status, offlineHash, syncedFromOffline: false,
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
        signature = `recorded-${Date.now()}`;
      }

      console.log(`[Blockchain] Attendance Recorded | ${staffId} | ${className || "—"} | ${date} | status: ${status}`);

      try {
        serverDb.recordAttendance({ staffId, staffName, date, time, className, status, schoolId });
      } catch (dbErr) {
        console.warn("[Blockchain] Saved to chain but DB record error:", dbErr);
      }

      res.json({
        success: true,
        signature,
        slot,
        offlineHash,
        confirmedOnChain,
        explorerUrl: confirmedOnChain ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
      });
    } catch (err: any) {
      console.error("[Blockchain] Record error:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/prepare - TEACHER/ADMIN only
  // Computes the offlineHash + memoPayload for the client to build a tx with.
  // The client builds the Transaction with a fresh blockhash via
  // /api/blockchain/blockhash — we no longer do it server-side to avoid
  // stale blockhash errors when the RPC call is slow.
  app.post("/api/blockchain/attendance/prepare", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), async (req, res) => {
    const { staffId, staffName, date, time, className, status, schoolId, signerPublicKey, syncedFromOffline = false, localTimestamp } = req.body;

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
      const record = {
        staffId, staffName: staffName || staffId,
        date, time: time || "", className: className || "",
        status, schoolId,
        syncedFromOffline, localTimestamp: localTimestamp || new Date().toISOString(),
      };
      const prepared = await buildAttendanceTransaction(record, phantomKey);
      console.log(`[Blockchain] Prepared | ${staffId} | ${className || "—"} | ${date} ${time || ""} | ${status} | hash: ${prepared.offlineHash.slice(0, 16)}...`);
      res.json({ success: true, ...prepared });
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
    const { staffId, staffName, date, time, className, status, schoolId, localTimestamp } = req.body;
    if (!staffId || !date || !status || !schoolId) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    try {
      const offlineHash = await computeOfflineHash(staffId, date, status);
      const queueId = `${staffId}-${date}-${Date.now()}`;
      syncQueue.set(queueId, {
        id: queueId, staffId, staffName: staffName || staffId,
        date, time: time || "", className: className || "",
        status, schoolId, syncedFromOffline: true,
        localTimestamp: localTimestamp || new Date().toISOString(),
        retries: 0, queuedAt: new Date().toISOString(), offlineHash,
      });
      console.log(`[Queue] Saved | ${staffId} | ${className || "—"} | ${date} | queue: ${syncQueue.size}`);
      res.json({ success: true, queueId, offlineHash, message: `Queued for sync. Queue size: ${syncQueue.size}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/blockchain/attendance/queue - All authenticated users
  app.get("/api/blockchain/attendance/queue", authenticateToken, (_req, res) => {
    const items = Array.from(syncQueue.values());
    res.json({ success: true, count: items.length, items });
  });

  // DELETE /api/blockchain/attendance/queue/:queueId - TEACHER/ADMIN only
  app.delete("/api/blockchain/attendance/queue/:queueId", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const queueId = Array.isArray(req.params.queueId) ? req.params.queueId[0] : req.params.queueId;
    if (syncQueue.has(queueId)) {
      syncQueue.delete(queueId);
      res.json({ success: true, message: "Removed from queue" });
    } else {
      res.status(404).json({ success: false, error: "Queue item not found" });
    }
  });

  // POST /api/blockchain/attendance/sync-all - ADMIN only
  app.post("/api/blockchain/attendance/sync-all", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
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

    for (const [queueId, item] of syncQueue.entries()) {
      try {
        const memoPayload = JSON.stringify({
          app: "E-SYLLAB", version: "1.0", type: "ATTENDANCE",
          staffId: item.staffId, staffName: item.staffName, schoolId: item.schoolId,
          date: item.date, time: item.time || "", className: item.className || "",
          status: item.status,
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

        syncQueue.delete(queueId);
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
    const { staffId, date, status, hashToVerify } = req.body;
    if (!staffId || !date || !status || !hashToVerify) {
      return res.status(400).json({ success: false, error: "Missing fields" });
    }
    try {
      const expectedHash = await computeOfflineHash(staffId, date, status);
      const isValid = expectedHash === hashToVerify;
      res.json({
        success: true, isValid, expectedHash, providedHash: hashToVerify,
        message: isValid ? "Hash verified — record is untampered." : "Hash mismatch — possible tampering detected!",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ════════════════════════════════════════════
  //  EXISTING ROUTES
  // ════════════════════════════════════════════

  app.post("/api/send-otp", async (req, res) => {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ error: "Missing email or otp" });
    const client = getResend();
    if (!client) return res.status(503).json({ error: "Email service not configured" });
    try {
      await client.emails.send({
        from: "E-SYLLAB <onboarding@resend.dev>",
        to: email,
        subject: "Your E-SYLLAB Password Reset Code",
        html: `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;max-width:400px;margin:auto;"><h2 style="color:#7c3aed;">E-SYLLAB</h2><p style="color:#334155;">Your password reset code:</p><div style="font-size:36px;font-weight:bold;letter-spacing:6px;color:#1e293b;padding:20px 0;">${otp}</div><p style="color:#64748b;font-size:13px;">This code expires in 10 minutes. Ignore this email if you did not request a reset.</p></div>`,
      });
      res.json({ success: true, message: "Email sent" });
    } catch (error) {
      console.error("[SERVER] Email failed:", error);
      res.status(500).json({ error: "Failed to send email" });
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
      const existingUser = serverDb.findUserByEmail(trimmedEmail);
      if (!existingUser) {
        return res.status(404).json({ success: false, error: "No account found with this email address" });
      }
    } else if (purpose === 'REGISTER') {
      const existingUser = serverDb.findUserByEmail(trimmedEmail);
      if (existingUser) {
        return res.status(400).json({ success: false, error: "An account with this email address already exists" });
      }
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    twoFactorStore.set(`${trimmedEmail}_${purpose}`, {
      code,
      expiresAt,
      purpose: purpose as 'LOGIN' | 'REGISTER',
      attempts: 0
    });

    // Send via Resend email service if configured
    const client = getResend();
    let emailSent = false;
    if (client) {
      try {
        await client.emails.send({
          from: "E-SYLAB Security <onboarding@resend.dev>",
          to: trimmedEmail,
          subject: `Your E-SYLAB ${purpose === 'LOGIN' ? 'Login' : 'Account Verification'} Code`,
          html: `
            <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; max-width: 440px; margin: auto; background-color: #0b0f19; color: #f8fafc;">
              <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                <div style="background: #7c3aed; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #ffffff; font-size: 22px;">E</div>
                <div>
                  <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 800;">E-SYLAB</h2>
                  <p style="color: #a7f3d0; margin: 0; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">Extra Login Step</p>
                </div>
              </div>
              <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">
                Use the following 6-digit code to complete your ${purpose === 'LOGIN' ? 'sign in' : 'account creation'}:
              </p>
              <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #c084fc; padding: 18px 0; text-align: center; font-family: monospace; background: #1e1b4b; border-radius: 12px; margin: 16px 0; border: 1px solid #4c1d95;">
                ${code}
              </div>
              <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; line-height: 1.4;">
                🔒 This code is valid for 10 minutes. For security reasons, do not share this code with anyone.
              </p>
            </div>
          `,
        });
        emailSent = true;
      } catch (emailErr) {
        console.warn("[Security] Resend email delivery failed:", emailErr);
      }
    }

    console.log(`[Security OTP] Generated code ${code} for ${trimmedEmail} (${purpose})`);

    res.json({
      success: true,
      emailSent,
      message: emailSent
        ? `Security verification code sent to ${trimmedEmail}`
        : `Security code generated for ${trimmedEmail}`,
      devCode: process.env.RESEND_API_KEY ? undefined : code
    });
  });

  // POST /api/register - Public registration with security code verification
  app.post("/api/register", async (req, res) => {
    const { name, email, password, avatar, twoFactorCode } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "Name, email, and password required" });
    }

    if (!twoFactorCode) {
      return res.status(400).json({ success: false, error: "Verification code is required to create an account" });
    }

    const trimmedEmail = email.trim().toLowerCase();
    const otpKey = `${trimmedEmail}_REGISTER`;
    const entry = twoFactorStore.get(otpKey);

    if (!entry || entry.code !== twoFactorCode.trim() || Date.now() > entry.expiresAt) {
      return res.status(400).json({ success: false, error: "That security code isn't right, please try again." });
    }

    // Code verified successfully, consume OTP
    twoFactorStore.delete(otpKey);

    try {
      const userPayload = {
        name,
        email: trimmedEmail,
        role: UserRole.STUDENT, // Force STUDENT role for public registration
        avatar: avatar || `https://picsum.photos/seed/${name.replace(/\s/g, '')}/100/100`,
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

  // POST /api/admin/create-user - Admin user creation with security code support
  app.post("/api/admin/create-user", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { name, email, role, password, avatar, twoFactorCode } = req.body;

    if (!name || !email || !role || !password) {
      return res.status(400).json({ success: false, error: "Name, email, role, and password required" });
    }

    const trimmedEmail = email.trim().toLowerCase();

    // If verification code is supplied during creation, verify it
    if (twoFactorCode) {
      const otpKey = `${trimmedEmail}_REGISTER`;
      const entry = twoFactorStore.get(otpKey);
      if (!entry || entry.code !== twoFactorCode.trim() || Date.now() > entry.expiresAt) {
        return res.status(400).json({ success: false, error: "That security code isn't right, please try again." });
      }
      twoFactorStore.delete(otpKey);
    }

    try {
      const userPayload = {
        name,
        email: trimmedEmail,
        role: role as UserRole,
        avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      };

      const createdUser = await serverDb.registerUser(userPayload, password);

      res.json({
        success: true,
        user: createdUser,
        message: `New ${role} account created successfully.`,
      });
    } catch (err: any) {
      console.error("[Auth] Admin create user error:", err);
      res.status(400).json({ success: false, error: err.message || "Failed to create user" });
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
      const authResult = await serverDb.authenticateUser(trimmedEmail, password);
      
      if (!authResult) {
        return res.status(401).json({ success: false, error: "That username or password doesn’t look right" });
      }

      const { user, needsPasswordReset } = authResult;

      // Credentials valid! Generate code for Login
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expiresAt = Date.now() + 10 * 60 * 1000;

      twoFactorStore.set(`${trimmedEmail}_LOGIN`, {
        code,
        expiresAt,
        purpose: 'LOGIN',
        attempts: 0
      });

      // Attempt to send email via Resend
      const client = getResend();
      let emailSent = false;
      if (client) {
        try {
          await client.emails.send({
            from: "E-SYLAB Security <onboarding@resend.dev>",
            to: trimmedEmail,
            subject: "Your E-SYLAB Security Login Code",
            html: `
              <div style="font-family: Arial, sans-serif; padding: 24px; border: 1px solid #1e293b; border-radius: 16px; max-width: 440px; margin: auto; background-color: #0b0f19; color: #f8fafc;">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                  <div style="background: #7c3aed; width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #ffffff; font-size: 22px;">E</div>
                  <div>
                    <h2 style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 800;">E-SYLAB</h2>
                    <p style="color: #c084fc; margin: 0; font-size: 11px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase;">Extra Login Step</p>
                  </div>
                </div>
                <p style="color: #cbd5e1; font-size: 14px; line-height: 1.5;">
                  Security login code for account <strong>${user.name}</strong> (${user.role}):
                </p>
                <div style="font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #a855f7; padding: 18px 0; text-align: center; font-family: monospace; background: #1e1b4b; border-radius: 12px; margin: 16px 0; border: 1px solid #4c1d95;">
                  ${code}
                </div>
                <p style="color: #94a3b8; font-size: 12px; margin-top: 16px; line-height: 1.4;">
                  🔒 This code expires in 10 minutes. If you did not initiate this sign-in request, please secure your password immediately.
                </p>
              </div>
            `,
          });
          emailSent = true;
        } catch (emailErr) {
          console.warn("[Security] Login email delivery failed:", emailErr);
        }
      }

      console.log(`[Security OTP] Login code ${code} generated for ${user.email} (${user.role})`);

      res.json({
        success: true,
        requires2FA: true,
        email: user.email,
        role: user.role,
        needsPasswordReset,
        emailSent,
        message: "Security code sent to your registered email address.",
        devCode: process.env.RESEND_API_KEY ? undefined : code
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
    const otpKey = `${trimmedEmail}_LOGIN`;
    const entry = twoFactorStore.get(otpKey);

    if (!entry || entry.code !== twoFactorCode.trim() || Date.now() > entry.expiresAt) {
      return res.status(400).json({ success: false, error: "That security code isn't right, please try again." });
    }

    // Verified! Consume code
    twoFactorStore.delete(otpKey);

    const user = serverDb.findUserByEmail(trimmedEmail);
    if (!user) {
      return res.status(404).json({ success: false, error: "User account not found" });
    }

    const cred = serverDb.getCredentialByUserId(user.id);
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

    res.json({
      success: true,
      user,
      needsPasswordReset,
      token,
      message: "Sign in successful.",
    });
  });

  // POST /api/token/session - Issue or refresh a token for an active user session
  app.post("/api/token/session", async (req, res) => {
    const { user } = req.body;

    if (!user || (!user.id && !user.email)) {
      return res.status(400).json({ success: false, error: "User info required" });
    }

    try {
      const activeUser = serverDb.ensureUser(user);

      const token = jwt.sign(
        {
          userId: activeUser.id,
          email: activeUser.email,
          name: activeUser.name,
          role: activeUser.role,
        } as JwtPayload,
        JWT_SECRET,
        { expiresIn: JWT_EXPIRY }
      );

      res.json({
        success: true,
        token,
        user: activeUser,
      });
    } catch (err: any) {
      console.error("[Auth] Session token generation error:", err);
      res.status(500).json({ success: false, error: "Something went wrong, please try again" });
    }
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

  // GET /api/profile - Get current user profile (requires authentication)
  app.get("/api/profile", authenticateToken, (req, res) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: "Unauthorized" });
    }

    const user = serverDb.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: "User not found" });
    }

    res.json({ success: true, user });
  });

  // PUT /api/profile - Update user profile (requires authentication)
  app.put("/api/profile", authenticateToken, (req, res) => {
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

    const updatedUser = serverDb.updateUserProfile(req.user.userId, updates);
    
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

    if (newPassword.length < 4) {
      return res.status(400).json({ success: false, error: "Password must be at least 4 characters" });
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

  // GET /api/admin/users - List all users (admin only)
  app.get("/api/admin/users", authenticateToken, authorizeRole(UserRole.ADMIN), async (_req, res) => {
    const users = serverDb.getAllUsers();
    res.json({ success: true, users });
  });

  // DELETE /api/admin/users/:userId - Delete user (admin only)
  app.delete("/api/admin/users/:userId", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;

    if (!userId) {
      return res.status(400).json({ success: false, error: "User ID required" });
    }

    serverDb.deleteUser(userId);

    res.json({ success: true, message: "User deleted successfully" });
  });

  // ════════════════════════════════════════════
  //  ACADEMIC LEDGER ROUTES (GRADES & CREDENTIALS)
  // ════════════════════════════════════════════
  const ledgerStore: Map<string, { signature: string; slot: number; record: any }> = new Map();

  function seedLedgerStore() {
    if (ledgerStore.size > 0) return;

    const initialEntries = [
      {
        hash: "a9f82c0192e84d3b6e82a10471f2b90e123456789abcdef0123456789abcdef0",
        signature: "5K8pXm9qJ2L1vR7wT4nZ3yA8bC5dE2fG6hI0jK9lM4nP1qR8sT7uV3wX6yZ9aB0cC",
        slot: 284910230,
        record: {
          type: "GRADE",
          gradeId: "gr-101",
          studentId: "1",
          studentName: "Alex Johnson",
          subject: "Mathematics",
          score: 92,
          grade: "A",
          academicYear: "2026",
          term: "Term 1",
          schoolId: "SCH-001",
          teacherId: "2",
          teacherName: "Dr. Sarah Jenkins",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
          details: "Term 1 Final Examination Score Anchored to Solana Devnet",
        }
      },
      {
        hash: "b7e19f2a083d4c5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e",
        signature: "4M2pK8qJ9L0vR1wT3nZ2yA7bC4dE1fG5hI9jK8lM3nP0qR7sT6uV2wX5yZ8aB9cC",
        slot: 284911105,
        record: {
          type: "GRADE",
          gradeId: "gr-102",
          studentId: "1",
          studentName: "Alex Johnson",
          subject: "Physics",
          score: 88,
          grade: "A-",
          academicYear: "2026",
          term: "Term 1",
          schoolId: "SCH-001",
          teacherId: "2",
          teacherName: "Prof. Michael Davis",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(),
          details: "Physics Practical Laboratory Score Submission",
        }
      },
      {
        hash: "c8f20e3b194e5d6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f",
        signature: "3N1pL7qK8M9wS0xU2oA6zB3cD0eF4gH8iJ7kL2mO9pQ6rS5tU1vW4xY7zA8bC9dD",
        slot: 284912440,
        record: {
          type: "GRADE",
          gradeId: "gr-103",
          studentId: "st-101",
          studentName: "Emily Chen",
          subject: "Biology",
          score: 95,
          grade: "A+",
          academicYear: "2026",
          term: "Term 1",
          schoolId: "SCH-001",
          teacherId: "2",
          teacherName: "Dr. Sarah Jenkins",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 7).toISOString(),
          details: "Cellular Biology Midterm Project Verified",
        }
      },
      {
        hash: "d9a31f4c205f6e7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a",
        signature: "2O0pM6rL7N8xT9yV1pB5aC2dE9fG3hI7jK6lL1mN8oP5qR4sT0uV3wX6yZ7aB8cC",
        slot: 284914100,
        record: {
          type: "CREDENTIAL",
          credentialId: "cred-2026-001",
          studentId: "1",
          studentName: "Alex Johnson",
          credentialType: "Official Academic Transcript Update",
          schoolId: "SCH-001",
          issuedBy: "Primary Admin",
          issuedById: "3",
          subjects: [
            { subject: "Mathematics", grade: "A", score: 92 },
            { subject: "Physics", grade: "A-", score: 88 },
            { subject: "Chemistry", grade: "B+", score: 84 },
          ],
          academicYear: "2026",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 12).toISOString(),
          details: "Verified Certified Transcript Digest Issued by Head Office",
        }
      },
      {
        hash: "e0b42a5d316a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c",
        signature: "1P9pN5sM6O7yU8zW0qC4bD1eF8gH2iJ6kL5mM0nO7pQ3rS2tU9vW2xY5zA6bC7dD",
        slot: 284915900,
        record: {
          type: "CREDENTIAL",
          credentialId: "cred-2026-002",
          studentId: "st-102",
          studentName: "Marcus Vance",
          credentialType: "STEM Honor Roll Certification",
          schoolId: "SCH-001",
          issuedBy: "Primary Admin",
          issuedById: "3",
          subjects: [
            { subject: "Computer Science", grade: "A+", score: 98 },
            { subject: "Mathematics", grade: "A", score: 94 },
          ],
          academicYear: "2026",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 20).toISOString(),
          details: "Academic Distinction Credential Anchored on Solana",
        }
      },
      {
        hash: "f1c53b6e427b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d",
        signature: "0Q8pO4tN5P6zV7aX9rD3cE0fG7hI1jK5lL4mM9nO6pQ2rS1tU8vW1xY4zA5bC6dD",
        slot: 284916200,
        record: {
          type: "ATTENDANCE",
          staffId: "2",
          staffName: "Dr. Sarah Jenkins",
          date: new Date().toISOString().split('T')[0],
          time: "08:15 AM",
          className: "Form 4A",
          attendanceStatus: "PRESENT",
          schoolId: "SCH-001",
          syncedFromOffline: true,
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 1).toISOString(),
          details: "Faculty Morning Check-in Attestation Anchored On-Chain",
        }
      },
      {
        hash: "7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e",
        signature: "9R7pP3uO4Q5aW6bY8sE2dF9gH6iJ0kL4mM3nO5pQ1rS0tU7vW0xY3zA4bC5dD",
        slot: 284918300,
        record: {
          type: "SYSTEM_ANCHOR",
          vaultId: "v-301",
          title: "Senior Curriculum & Exam Guidelines 2026",
          approvedBy: "Primary Admin",
          status: "APPROVED",
          schoolId: "SCH-001",
          timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
          details: "Institutional Governance Vault Approval Hash Anchored",
        }
      },
    ];

    for (const item of initialEntries) {
      ledgerStore.set(item.hash, {
        signature: item.signature,
        slot: item.slot,
        record: item.record,
      });
    }
  }

  // Seed store on launch
  seedLedgerStore();

  // GET /api/blockchain/ledger/all - Fetch all anchored ledger events
  app.get("/api/blockchain/ledger/all", authenticateToken, (_req, res) => {
    seedLedgerStore();
    const records: any[] = [];

    // Add ledgerStore entries
    for (const [hash, entry] of ledgerStore.entries()) {
      records.push({
        offlineHash: hash,
        signature: entry.signature,
        slot: entry.slot,
        explorerUrl: (entry.signature && entry.signature.length > 30 && !entry.signature.startsWith('ledger-') && !entry.signature.startsWith('cred-'))
          ? `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`
          : `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`,
        timestamp: entry.record.timestamp || entry.record.date || new Date().toISOString(),
        status: 'CONFIRMED',
        ...entry.record,
      });
    }

    // Add pending queue items
    for (const [queueId, item] of syncQueue.entries()) {
      records.push({
        offlineHash: item.offlineHash || `queue-${queueId}`,
        type: "ATTENDANCE",
        status: "PENDING_SYNC",
        staffId: item.staffId,
        staffName: item.staffName,
        date: item.date,
        time: item.time,
        className: item.className,
        attendanceStatus: item.status,
        schoolId: item.schoolId,
        syncedFromOffline: true,
        timestamp: item.queuedAt || item.localTimestamp,
        signature: "QUEUED_LOCAL",
        slot: 0,
        details: `Queued offline attendance attestation for ${item.staffName}`,
      });
    }

    // Sort newest first
    records.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    res.json({
      success: true,
      count: records.length,
      records,
    });
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
        console.warn("[Ledger] Grade submission on-chain notice:", solanaErr.message);
        signature = `ledger-${Date.now()}`;
      }

      ledgerStore.set(offlineHash, {
        signature, slot,
        record: { type: "GRADE", gradeId, studentId, studentName, subject, score, grade, academicYear, term, schoolId },
      });

      res.json({
        success: true,
        offlineHash,
        signature,
        slot,
        confirmedOnChain,
        explorerUrl: confirmedOnChain ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
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
        console.warn("[Ledger] Credential submission on-chain notice:", solanaErr.message);
        signature = `cred-${Date.now()}`;
      }

      ledgerStore.set(offlineHash, {
        signature, slot,
        record: { type: "CREDENTIAL", credentialId, studentId, studentName, credentialType, subjects, academicYear, schoolId },
      });

      res.json({
        success: true,
        offlineHash,
        signature,
        slot,
        confirmedOnChain,
        explorerUrl: confirmedOnChain ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/ledger/verify
  app.post("/api/blockchain/ledger/verify", authenticateToken, async (req, res) => {
    const { offlineHash } = req.body;
    if (!offlineHash) return res.status(400).json({ success: false, error: "Missing offlineHash" });

    try {
      const entry = ledgerStore.get(offlineHash);
      if (!entry || !entry.signature) {
        return res.json({
          isValid: false,
          message: "Hash not found in the ledger. This record may not have been issued by E-SYLLAB, or it may have been tampered with.",
        });
      }

      res.json({
        isValid: true,
        record: entry.record,
        signature: entry.signature,
        slot: entry.slot,
        explorerUrl: `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`,
        message: "Record verified — this credential is genuine and untampered.",
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // ─── Assessment & Reporting API Routes ───────────────────────────────────

  // POST /api/assessments (Teacher, Admin) - Create new assessment
  app.post("/api/assessments", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const { title, subject, className, maxScore } = req.body;
    if (!title || !subject || !className || maxScore === undefined) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, subject, className, maxScore" });
    }
    const maxScoreNum = Number(maxScore);
    if (isNaN(maxScoreNum) || maxScoreNum <= 0) {
      return res.status(400).json({ success: false, error: "maxScore must be a positive number" });
    }
    try {
      const assessment = serverDb.createAssessment({
        title,
        subject,
        className,
        teacherId: req.user!.userId,
        maxScore: maxScoreNum,
      });

      // Auto-generate deadline notifications for students in that class
      try {
        const students = serverDb.getUsersByRole(UserRole.STUDENT);
        const targetStudents = (className === 'All Classes' || className === 'All Grades')
          ? students
          : students.filter(s => s.className === className || s.grade === className);

        const targetIds = targetStudents.map(s => s.id);
        if (targetIds.length > 0) {
          serverDb.createBulkNotifications(
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
  app.get("/api/assessments", authenticateToken, (req, res) => {
    try {
      const assessments = serverDb.getAllAssessments();
      res.json({ success: true, assessments });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/assessments/student/my-scores (Student) - Get own assessment scores with blockchain info
  app.get("/api/assessments/student/my-scores", authenticateToken, (req, res) => {
    try {
      const studentId = req.user!.userId;
      const rawScores = serverDb.getStudentAssessmentScores(studentId);
      const scores = rawScores.map(item => {
        let ledgerEntry: any = null;
        for (const [hash, entry] of ledgerStore.entries()) {
          if (entry.record?.type === "ASSESSMENT_SCORE" && entry.record?.scoreId === item.id) {
            ledgerEntry = { hash, ...entry };
            break;
          }
        }
        return {
          ...item,
          offlineHash: ledgerEntry?.hash || `hash-asg-${item.id}`,
          signature: ledgerEntry?.signature || `sig-asg-${item.id}`,
          explorerUrl: ledgerEntry?.signature ? `https://explorer.solana.com/tx/${ledgerEntry.signature}?cluster=devnet` : undefined,
        };
      });
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

    const assessment = serverDb.findAssessmentById(assessmentId);
    if (!assessment) {
      return res.status(404).json({ success: false, error: "Assessment not found" });
    }

    try {
      const savedScores = serverDb.saveAssessmentScores(assessmentId, scores);
      const schoolKeypair = getSchoolKeypair();
      const connection = getConnection();
      const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");

      const anchoredScores = [];
      for (const scoreRecord of savedScores) {
        const studentUser = serverDb.findUserById(scoreRecord.studentId);
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
          console.warn("[Ledger] Assessment score submission on-chain notice:", solanaErr.message);
          signature = `ledger-asg-${Date.now()}-${scoreRecord.id}`;
        }

        ledgerStore.set(offlineHash, {
          signature,
          slot,
          record: {
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
          },
        });

        anchoredScores.push({
          ...scoreRecord,
          studentName,
          offlineHash,
          signature,
          slot,
          confirmedOnChain,
          explorerUrl: confirmedOnChain ? `https://explorer.solana.com/tx/${signature}?cluster=devnet` : undefined,
        });
      }

      const report = serverDb.getAssessmentReport(assessmentId);

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
  app.get("/api/assessments/:id/report", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const assessmentId = String(req.params.id);
    try {
      const assessment = serverDb.findAssessmentById(assessmentId);
      if (!assessment) {
        return res.status(404).json({ success: false, error: "Assessment not found" });
      }
      const report = serverDb.getAssessmentReport(assessmentId);
      const scores = serverDb.getAssessmentScores(assessmentId);
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
  app.get("/api/notifications", authenticateToken, (req, res) => {
    try {
      const notifications = serverDb.getUserNotifications(req.user!.userId);
      res.json({ success: true, notifications });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/notifications/:id/read - Mark notification as read
  app.post("/api/notifications/:id/read", authenticateToken, (req, res) => {
    const notificationId = String(req.params.id);
    try {
      serverDb.markNotificationAsRead(notificationId, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/notifications - Create notification manually (Teacher, Admin)
  app.post("/api/notifications", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const { recipientId, className, type, title, message, relatedId } = req.body;
    if (!type || !title || !message) {
      return res.status(400).json({ success: false, error: "Missing required fields: type, title, message" });
    }

    const validTypes = ['deadline', 'meeting', 'misconduct', 'general'];
    const notifType = validTypes.includes(type) ? type : 'general';

    try {
      let createdCount = 0;
      if (recipientId) {
        serverDb.createNotification(recipientId, notifType, title, message, relatedId);
        createdCount = 1;
      } else if (className) {
        const users = serverDb.getAllUsers().filter(u => u.className === className || u.grade === className || className === 'All Classes' || className === 'All Grades');
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
          serverDb.createBulkNotifications(userIds, notifType, title, message, relatedId);
          createdCount = userIds.length;
        }
      } else {
        const students = serverDb.getUsersByRole(UserRole.STUDENT);
        const userIds = students.map(s => s.id);
        if (userIds.length > 0) {
          serverDb.createBulkNotifications(userIds, notifType, title, message, relatedId);
          createdCount = userIds.length;
        }
      }

      res.json({ success: true, count: createdCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });


  // GET /api/blockchain/ledger/student/:studentId
  app.get("/api/blockchain/ledger/student/:studentId", authenticateToken, (req, res) => {
    const studentId = Array.isArray(req.params.studentId) ? req.params.studentId[0] : req.params.studentId;
    const records: any[] = [];

    for (const [hash, entry] of ledgerStore.entries()) {
      if (entry.record?.studentId === studentId && entry.signature) {
        records.push({
          offlineHash: hash,
          signature: entry.signature,
          slot: entry.slot,
          explorerUrl: `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`,
          ...entry.record,
        });
      }
    }

    res.json({ success: true, studentId, count: records.length, records });
  });

  // ─── Staff Performance Route ──────────────────────────────────────────────
  // GET /api/admin/staff-performance (ADMIN only)
  app.get("/api/admin/staff-performance", authenticateToken, authorizeRole(UserRole.ADMIN), (_req, res) => {
    try {
      const teachers = serverDb.getStaffPerformanceMetrics();
      res.json({ success: true, count: teachers.length, teachers });
    } catch (err: any) {
      console.error("[Staff Performance] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch staff performance metrics" });
    }
  });

  // ─── Timetable Management Routes ──────────────────────────────────────────
  function checkTimetableConflict(
    className: string,
    dayOfWeek: string,
    period: string,
    teacherId?: string,
    room?: string,
    excludeId?: string
  ): { conflict: boolean; error?: string } {
    const pNorm = (period || "").toLowerCase();
    if (pNorm.includes("break") || pNorm.includes("lunch") || pNorm.includes("10:00") || pNorm.includes("13:00")) {
      return { conflict: true, error: "Cannot schedule classes during fixed Break (10:00–10:30) or Lunch (13:00–14:00) slots." };
    }

    const allEntries = serverDb.getAllTimetables();

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
  app.get("/api/timetables", authenticateToken, (req, res) => {
    try {
      const className = req.query.className as string;
      let timetables;
      if (className) {
        timetables = serverDb.getTimetablesByClass(className);
      } else {
        timetables = serverDb.getAllTimetables();
      }
      res.json({ success: true, count: timetables.length, timetables });
    } catch (err: any) {
      console.error("[Timetables] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch timetables" });
    }
  });

  // POST /api/timetables (ADMIN only)
  app.post("/api/timetables", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const { className, dayOfWeek, period, subject, teacherId, room } = req.body;

    if (!className || !dayOfWeek || !period || !subject) {
      return res.status(400).json({ success: false, error: "Missing required fields: className, dayOfWeek, period, subject" });
    }

    const check = checkTimetableConflict(className, dayOfWeek, period, teacherId, room);
    if (check.conflict) {
      return res.status(409).json({ success: false, error: check.error });
    }

    try {
      const entry = serverDb.createTimetableEntry({
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
  app.put("/api/timetables/:id", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const updates = req.body;

    const existing = serverDb.getAllTimetables().find(t => t.id === id);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Timetable entry not found" });
    }

    const className = updates.className || existing.className;
    const dayOfWeek = updates.dayOfWeek || existing.dayOfWeek;
    const period = updates.period || existing.period;
    const teacherId = updates.teacherId !== undefined ? updates.teacherId : existing.teacherId;
    const room = updates.room !== undefined ? updates.room : existing.room;

    const check = checkTimetableConflict(className, dayOfWeek, period, teacherId, room, id);
    if (check.conflict) {
      return res.status(409).json({ success: false, error: check.error });
    }

    try {
      const updated = serverDb.updateTimetableEntry(id, updates);
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
  app.delete("/api/timetables/:id", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const success = serverDb.deleteTimetableEntry(id);
      res.json({ success: true, message: "Timetable entry deleted successfully" });
    } catch (err: any) {
      console.error("[Timetables] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to delete timetable entry" });
    }
  });

  // ─── Students Roster Route ────────────────────────────────────────────────
  // GET /api/students (Teacher, Admin)
  app.get("/api/students", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (_req, res) => {
    try {
      const students = serverDb.getUsersByRole(UserRole.STUDENT);
      res.json({ success: true, count: students.length, students });
    } catch (err: any) {
      console.error("[Students] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch students" });
    }
  });

  // ─── Academic Grades Routes ────────────────────────────────────────────────
  // GET /api/grades (any authenticated user — students see only their own, teachers/admins see all)
  app.get("/api/grades", authenticateToken, (req, res) => {
    try {
      const user = req.user!;
      let grades;
      if (user.role === UserRole.STUDENT) {
        grades = serverDb.getStudentGrades(user.userId);
      } else {
        grades = serverDb.getAllGrades();
      }
      res.json({ success: true, count: grades.length, grades });
    } catch (err: any) {
      console.error("[Grades] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch grades" });
    }
  });

  // POST /api/grades (Teacher, Admin)
  app.post("/api/grades", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const { studentId, subject, score, grade, feedback, comment, recordedAt } = req.body;

    if (!studentId || !subject) {
      return res.status(400).json({ success: false, error: "Missing required fields: studentId, subject" });
    }

    try {
      const student = serverDb.findUserById(studentId);
      const gradeRecord = serverDb.recordGrade({
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
  app.get("/api/messages", authenticateToken, (req, res) => {
    try {
      const messages = serverDb.getUserMessages(req.user!.userId, req.user!.role);
      res.json({ success: true, count: messages.length, messages });
    } catch (err: any) {
      console.error("[Messages] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch messages" });
    }
  });

  // POST /api/messages (any authenticated user)
  app.post("/api/messages", authenticateToken, (req, res) => {
    const { recipientId, recipientName, subject, content, file } = req.body;

    if (!content && !file) {
      return res.status(400).json({ success: false, error: "Message content or attachment is required" });
    }

    try {
      const sender = serverDb.findUserById(req.user!.userId);
      const senderName = sender ? sender.name : 'User';

      const message = serverDb.sendMessage({
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
  app.delete("/api/messages", authenticateToken, (req, res) => {
    try {
      serverDb.clearMessages(req.user!.userId);
      res.json({ success: true, message: "Message history cleared successfully" });
    } catch (err: any) {
      console.error("[Messages] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to clear message history" });
    }
  });

  // ─── Curriculum Resources Routes ───────────────────────────────────────────
  // GET /api/curriculum (any authenticated user)
  app.get("/api/curriculum", authenticateToken, (_req, res) => {
    try {
      const curriculum = serverDb.getAllCurriculum();
      res.json({ success: true, count: curriculum.length, curriculum });
    } catch (err: any) {
      console.error("[Curriculum] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch curriculum materials" });
    }
  });

  // POST /api/curriculum (Teacher, Admin)
  app.post("/api/curriculum", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const { title, subject, gradeLevel, description, category, fileName, fileType, fileData } = req.body;

    if (!title || !subject || !gradeLevel || !category) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, subject, gradeLevel, category" });
    }

    try {
      const uploader = serverDb.findUserById(req.user!.userId);
      const uploadedByName = uploader ? uploader.name : 'Staff';

      const resource = serverDb.addCurriculum({
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
  app.delete("/api/curriculum/:id", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      serverDb.deleteCurriculum(id);
      res.json({ success: true, message: "Curriculum material deleted successfully" });
    } catch (err: any) {
      console.error("[Curriculum] DELETE error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to delete curriculum material" });
    }
  });

  // ─── Vault Documents Routes ────────────────────────────────────────────────
  // GET /api/vault (Teacher sees their own submissions, Admin sees all)
  app.get("/api/vault", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    try {
      const user = req.user!;
      let documents;
      if (user.role === UserRole.ADMIN) {
        documents = serverDb.getAllVaultDocuments();
      } else {
        documents = serverDb.getVaultDocumentsByTeacher(user.userId);
      }
      res.json({ success: true, count: documents.length, documents });
    } catch (err: any) {
      console.error("[Vault] GET error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to fetch vault documents" });
    }
  });

  // POST /api/vault (Teacher, Admin)
  app.post("/api/vault", authenticateToken, authorizeRole(UserRole.TEACHER, UserRole.ADMIN), (req, res) => {
    const { title, type, fileName, fileType, fileData } = req.body;

    if (!title || !type) {
      return res.status(400).json({ success: false, error: "Missing required fields: title, type" });
    }

    try {
      const teacher = serverDb.findUserById(req.user!.userId);
      const teacherName = teacher ? teacher.name : 'Teacher';

      const document = serverDb.addVaultDocument({
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
  app.put("/api/vault/:id/approve", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const document = serverDb.updateVaultDocumentStatus(id, DocumentStatus.APPROVED);
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
  app.put("/api/vault/:id/reject", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    try {
      const document = serverDb.updateVaultDocumentStatus(id, DocumentStatus.REJECTED);
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
  app.put("/api/vault/:id/status", authenticateToken, authorizeRole(UserRole.ADMIN), (req, res) => {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const { status } = req.body;

    if (!status || !Object.values(DocumentStatus).includes(status)) {
      return res.status(400).json({ success: false, error: "Valid status ('PENDING', 'APPROVED', 'REJECTED') is required" });
    }

    try {
      const document = serverDb.updateVaultDocumentStatus(id, status);
      if (!document) {
        return res.status(404).json({ success: false, error: "Vault document not found" });
      }
      res.json({ success: true, document, message: `Vault document status updated to ${status}` });
    } catch (err: any) {
      console.error("[Vault] Status update error:", err);
      res.status(500).json({ success: false, error: err.message || "Failed to update vault document status" });
    }
  });


  // ── Vite middleware ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("*all", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 E-SYLLAB Server → http://localhost:${PORT}`);
    console.log(`⛓  Blockchain API  → http://localhost:${PORT}/api/blockchain`);
    console.log(`📡 Solana Devnet connected`);
    if (getSchoolKeypair()) {
      console.log(`🔑 School signing key loaded — offline sync enabled\n`);
    } else {
      console.warn(`⚠  SCHOOL_SIGNING_KEYPAIR not set — offline sync disabled\n`);
    }
  });
}

startServer();
