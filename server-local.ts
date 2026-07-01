import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { Resend } from "resend";
import { PublicKey, Keypair, Transaction, TransactionInstruction } from "@solana/web3.js";
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
function getSchoolKeypair(): Keypair | null {
  const raw = process.env.SCHOOL_SIGNING_KEYPAIR;
  if (!raw) return null;
  try {
    const secretKey = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.warn("[Server] Could not load SCHOOL_SIGNING_KEYPAIR:", err);
    return null;
  }
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

// ─── Server ───────────────────────────────────────────────────────────────────
async function startServer() {
  const app = express();
  const PORT = 3000;

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
  app.get("/api/blockchain/status", async (_req, res) => {
    try {
      const status = await getNetworkStatus();
      res.json({ success: true, network: "devnet", ...status, queueSize: syncQueue.size });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/prepare
  // Returns unsigned base64 transaction for Phantom to sign
  app.post("/api/blockchain/attendance/prepare", async (req, res) => {
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
      console.log(`[Blockchain] Prepared tx | ${staffId} | ${className || "—"} | ${date} ${time || ""} | ${status} | hash: ${prepared.offlineHash.slice(0, 16)}...`);
      res.json({ success: true, ...prepared });
    } catch (err: any) {
      console.error("[Blockchain] Failed to prepare tx:", err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // POST /api/blockchain/attendance/confirm
  // Called after Phantom signs and submits the tx
  app.post("/api/blockchain/attendance/confirm", async (req, res) => {
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

  // POST /api/blockchain/attendance/queue
  // Saves offline attendance record to sync queue
  app.post("/api/blockchain/attendance/queue", async (req, res) => {
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
      console.log(`[Queue] Saved offline record | ${staffId} | ${className || "—"} | ${date} ${time || ""} | queue size: ${syncQueue.size}`);
      res.json({ success: true, queueId, offlineHash, message: `Queued for sync. Queue size: ${syncQueue.size}` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GET /api/blockchain/attendance/queue
  app.get("/api/blockchain/attendance/queue", (_req, res) => {
    const items = Array.from(syncQueue.values());
    res.json({ success: true, count: items.length, items });
  });

  // DELETE /api/blockchain/attendance/queue/:queueId
  app.delete("/api/blockchain/attendance/queue/:queueId", (req, res) => {
    const { queueId } = req.params;
    if (syncQueue.has(queueId)) {
      syncQueue.delete(queueId);
      res.json({ success: true, message: "Removed from queue" });
    } else {
      res.status(404).json({ success: false, error: "Queue item not found" });
    }
  });

  // POST /api/blockchain/attendance/sync-all
  // Signs and submits EVERY queued record using the school's own funded
  // keypair (no Phantom needed — this is what makes offline records
  // actually reach the blockchain automatically).
  app.post("/api/blockchain/attendance/sync-all", async (_req, res) => {
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

    res.json({ success: true, synced: results.filter(r => r.success).length, failed: results.filter(r => !r.success).length, results });
  });

  // POST /api/blockchain/attendance/verify-hash
  app.post("/api/blockchain/attendance/verify-hash", async (req, res) => {
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
        from: "EduChain <onboarding@resend.dev>",
        to: email,
        subject: "Your Password Reset OTP",
        html: `<div style="font-family:sans-serif;padding:20px;border:1px solid #e2e8f0;border-radius:12px;"><h2 style="color:#4f46e5;">EduChain Security</h2><p>Your OTP:</p><div style="font-size:32px;font-weight:bold;letter-spacing:4px;color:#1e293b;padding:20px 0;">${otp}</div><p style="color:#64748b;font-size:14px;">Ignore if you didn't request this.</p></div>`,
      });
      res.json({ success: true, message: "Email sent" });
    } catch (error) {
      console.error("[SERVER] Email failed:", error);
      res.status(500).json({ error: "Failed to send email" });
    }
  });

  app.post("/api/login", (_req, res) => res.status(401).json({ success: false, message: "Invalid credentials" }));
  app.get("/api/profile", (_req, res) => res.json({ success: true, message: "Profile loaded" }));

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
