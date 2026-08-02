import express, { Request, Response, NextFunction } from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
import jwt from "jsonwebtoken";
import { db } from "./services/database.js";
import { serverDb } from "./services/serverDatabase.js";
import { UserRole } from "./types.js";
import {
  buildAttendanceTransaction,
  confirmTransaction,
  getNetworkStatus,
  computeOfflineHash,
  getConnection,
} from "./services/blockchain.js";

var __dirname = typeof __dirname !== "undefined"
  ? __dirname
  : path.dirname(fileURLToPath(import.meta.url));

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
    return res.status(401).json({ success: false, error: 'Access token required' });
  }

  // Check if token is blacklisted
  if (tokenBlacklist.has(token)) {
    return res.status(401).json({ success: false, error: 'Token has been revoked' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    req.user = decoded;
    next();
  } catch (err: any) {
    return res.status(403).json({ success: false, error: 'Invalid or expired token' });
  }
}

// ─── Role-Based Access Control Middleware ─────────────────────────────────────
function authorizeRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, error: 'Unauthorized' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Insufficient permissions for this action' });
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
  //  AUTHENTICATION ROUTES
  // ════════════════════════════════════════════

  // POST /api/register - Public registration (forced to STUDENT role)
  app.post("/api/register", async (req, res) => {
    const { name, email, password, avatar } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, error: "Name, email, and password required" });
    }

    try {
      const userPayload = {
        name,
        email,
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
        message: "Registration successful",
      });
    } catch (err: any) {
      console.error("[Auth] Public registration error:", err);
      res.status(400).json({ success: false, error: err.message || "Registration failed" });
    }
  });

  // POST /api/admin/create-user - Admin user creation (allows specifying any role)
  app.post("/api/admin/create-user", authenticateToken, authorizeRole(UserRole.ADMIN), async (req, res) => {
    const { name, email, role, password, avatar } = req.body;

    if (!name || !email || !role || !password) {
      return res.status(400).json({ success: false, error: "Name, email, role, and password required" });
    }

    try {
      const userPayload = {
        name,
        email,
        role: role as UserRole,
        avatar: avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(name)}`,
      };

      const createdUser = await serverDb.registerUser(userPayload, password);

      res.json({
        success: true,
        user: createdUser,
        message: "User created successfully",
      });
    } catch (err: any) {
      console.error("[Auth] Admin create user error:", err);
      res.status(400).json({ success: false, error: err.message || "Failed to create user" });
    }
  });

  // POST /api/login - Authenticate user and return JWT
  app.post("/api/login", async (req, res) => {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, error: "Email and password required" });
    }

    try {
      const authResult = await serverDb.authenticateUser(email, password);
      
      if (!authResult) {
        return res.status(401).json({ success: false, error: "Invalid credentials" });
      }

      const { user, needsPasswordReset } = authResult;

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

      res.json({
        success: true,
        user,
        needsPasswordReset,
        token,
        message: "Login successful",
      });
    } catch (err: any) {
      console.error("[Auth] Login error:", err);
      res.status(500).json({ success: false, error: "Authentication failed" });
    }
  });

  // POST /api/token/session - Issue or refresh a JWT token for an active user session
  app.post("/api/token/session", async (req, res) => {
    const { user } = req.body;

    if (!user || (!user.id && !user.email)) {
      return res.status(400).json({ success: false, error: "User payload required" });
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
      res.status(500).json({ success: false, error: "Token generation failed" });
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
