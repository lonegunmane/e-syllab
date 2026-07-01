/**
 * ADD THESE ROUTES TO server.ts
 *
 * Paste them inside the startServer() function, after the existing
 * /api/blockchain/attendance routes.
 *
 * Two groups:
 *   A. Attendance offline sync endpoint (Task 1)
 *   B. Academic ledger endpoints (Task 2)
 */

// ════════════════════════════════════════════════════════════════════════════
//  A. TASK 1 — Offline attendance sync (called by Service Worker)
// ════════════════════════════════════════════════════════════════════════════

// POST /api/blockchain/attendance/sync-offline
// Called by the service worker Background Sync — no Phantom on server side.
// Server builds the tx with its own funded keypair (the "school signing key").
// This requires SCHOOL_SIGNING_KEYPAIR env var (base58 private key with devnet SOL).
app.post("/api/blockchain/attendance/sync-offline", async (req, res) => {
  const { staffId, staffName, date, status, schoolId, localTimestamp, offlineHash: existingHash } = req.body;

  if (!staffId || !date || !status) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    const {
      getConnection, computeOfflineHash,
      MEMO_PROGRAM_ID_STR, SOLANA_ENDPOINT,
    } = await import("./services/blockchain.js");

    const { Connection, PublicKey, Transaction, TransactionInstruction, Keypair } = await import("@solana/web3.js");

    // Load school signing keypair from env (funded devnet account)
    // Generate one: `solana-keygen new --outfile school-keypair.json`
    // Set env: SCHOOL_SIGNING_KEYPAIR=<base58 private key>
    const keypairEnv = process.env.SCHOOL_SIGNING_KEYPAIR;
    if (!keypairEnv) {
      return res.status(500).json({
        success: false,
        error: "SCHOOL_SIGNING_KEYPAIR env var not set. The school needs a funded signing account for offline sync.",
      });
    }

    // Decode base58 private key
    const bs58 = await import("bs58");
    const secretKey = bs58.default.decode(keypairEnv);
    const signingKeypair = Keypair.fromSecretKey(secretKey);

    // Compute hash
    const offlineHash = existingHash || await computeOfflineHash(staffId, date, status);

    // Build memo payload (identical structure to online flow)
    const memoPayload = JSON.stringify({
      app: "E-SYLLAB",
      version: "1.0",
      type: "ATTENDANCE",
      staffId, staffName, schoolId, date, status,
      offlineHash,
      syncedFromOffline: true,
      localTimestamp: localTimestamp || new Date().toISOString(),
      syncedAt: new Date().toISOString(),
    });

    const connection = getConnection();
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");

    const MEMO_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
    const ix = new TransactionInstruction({
      keys: [{ pubkey: signingKeypair.publicKey, isSigner: true, isWritable: false }],
      programId: MEMO_ID,
      data: Buffer.from(memoPayload, "utf-8"),
    });

    const tx = new Transaction({ feePayer: signingKeypair.publicKey, blockhash, lastValidBlockHeight });
    tx.add(ix);
    tx.sign(signingKeypair);

    const signature = await connection.sendRawTransaction(tx.serialize());

    // Confirm
    await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    const txInfo = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });

    console.log(`[Sync-Offline] ✓ ${staffId} | ${date} | ${status} → ${signature.slice(0, 20)}...`);

    res.json({
      success: true,
      signature,
      slot: txInfo?.slot ?? 0,
      offlineHash,
      explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    });
  } catch (err: any) {
    console.error("[Sync-Offline] Failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/blockchain/attendance/hash
// Lightweight endpoint — just returns the offlineHash for a record.
// Called by the frontend when it wants to pre-compute a hash before going offline.
app.post("/api/blockchain/attendance/hash", async (req, res) => {
  const { staffId, date, status } = req.body;
  if (!staffId || !date || !status) {
    return res.status(400).json({ success: false, error: "Missing fields" });
  }
  try {
    const { computeOfflineHash } = await import("./services/blockchain.js");
    const offlineHash = await computeOfflineHash(staffId, date, status);
    res.json({ success: true, offlineHash });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// ════════════════════════════════════════════════════════════════════════════
//  B. TASK 2 — Academic ledger (grades + credentials)
// ════════════════════════════════════════════════════════════════════════════

// In-memory ledger store (replace with Supabase in Phase 2)
// Maps offlineHash → { signature, slot, record }
const ledgerStore: Map<string, { signature: string; slot: number; record: any }> = new Map();

// ── Grade hash helper ─────────────────────────────────────────────────────────

async function computeGradeHash(
  studentId: string,
  subject: string,
  score: number,
  teacherId: string,
  term: string,
  academicYear: string
): Promise<string> {
  const input = `${studentId}:${subject}:${score}:${teacherId}:${term}:${academicYear}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Credential hash helper ────────────────────────────────────────────────────

async function computeCredentialHash(
  studentId: string,
  subjects: any[],
  issuedById: string,
  academicYear: string
): Promise<string> {
  const subjectStr = subjects.map(s => `${s.subject}:${s.grade}`).sort().join("|");
  const input = `CREDENTIAL:${studentId}:${subjectStr}:${issuedById}:${academicYear}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── POST /api/blockchain/ledger/grade/prepare ─────────────────────────────────

app.post("/api/blockchain/ledger/grade/prepare", async (req, res) => {
  const {
    gradeId, studentId, studentName, teacherId, teacherName,
    subject, score, grade, academicYear, term, schoolId,
    signerPublicKey, timestamp,
  } = req.body;

  if (!studentId || !subject || score === undefined || !teacherId) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    const offlineHash = await computeGradeHash(studentId, subject, score, teacherId, term, academicYear);

    const memoPayload = JSON.stringify({
      app:     "E-SYLLAB",
      version: "1.0",
      type:    "GRADE",
      gradeId, studentId, studentName,
      teacherId, teacherName,
      subject, score, grade,
      academicYear, term, schoolId,
      offlineHash,
      timestamp: timestamp || new Date().toISOString(),
    });

    // Store the record so we can look it up by hash during verification
    ledgerStore.set(offlineHash, {
      signature: "", // filled after confirmation
      slot: 0,
      record: { type: "GRADE", gradeId, studentId, studentName, subject, score, grade, academicYear, term, schoolId },
    });

    console.log(`[Ledger] Grade prepared | ${studentName} | ${subject} | ${grade} | hash: ${offlineHash.slice(0, 16)}...`);
    res.json({ success: true, offlineHash, memoPayload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/blockchain/ledger/credential/prepare ────────────────────────────

app.post("/api/blockchain/ledger/credential/prepare", async (req, res) => {
  const {
    credentialId, studentId, studentName, schoolId,
    credentialType, subjects, issuedBy, issuedById,
    academicYear, signerPublicKey, timestamp,
  } = req.body;

  if (!studentId || !subjects?.length || !issuedById) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }

  try {
    const offlineHash = await computeCredentialHash(studentId, subjects, issuedById, academicYear);

    const memoPayload = JSON.stringify({
      app:     "E-SYLLAB",
      version: "1.0",
      type:    "CREDENTIAL",
      credentialId, studentId, studentName, schoolId,
      credentialType, subjects,
      issuedBy, issuedById, academicYear,
      offlineHash,
      timestamp: timestamp || new Date().toISOString(),
    });

    ledgerStore.set(offlineHash, {
      signature: "",
      slot: 0,
      record: { type: "CREDENTIAL", credentialId, studentId, studentName, credentialType, subjects, academicYear, schoolId },
    });

    console.log(`[Ledger] Credential prepared | ${studentName} | ${credentialType} | hash: ${offlineHash.slice(0, 16)}...`);
    res.json({ success: true, offlineHash, memoPayload });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/blockchain/ledger/confirm ───────────────────────────────────────
// Confirms any ledger tx (grade or credential) by signature.

app.post("/api/blockchain/ledger/confirm", async (req, res) => {
  const { signature } = req.body;
  if (!signature) return res.status(400).json({ success: false, error: "Missing signature" });

  try {
    const { getConnection } = await import("./services/blockchain.js");
    const connection = getConnection();

    const MAX_ATTEMPTS = 30;
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      const statusRes = await connection.getSignatureStatuses([signature]);
      const status    = statusRes.value[0];

      if (status) {
        if (status.err) throw new Error(`Transaction failed on-chain: ${JSON.stringify(status.err)}`);
        if (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized") {
          const txInfo = await connection.getTransaction(signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          const slot = txInfo?.slot ?? status.slot ?? 0;

          // Update the ledger store with the real signature + slot
          for (const [hash, entry] of ledgerStore.entries()) {
            if (!entry.signature) {
              entry.signature = signature;
              entry.slot = slot;
              ledgerStore.set(hash, entry);
              break;
            }
          }

          console.log(`[Ledger] Confirmed | slot: ${slot} | sig: ${signature.slice(0, 20)}...`);
          return res.json({
            success: true,
            signature,
            slot,
            explorerUrl: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
          });
        }
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error("Timed out waiting for ledger confirmation");
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/blockchain/ledger/verify ───────────────────────────────────────
// The STUDENT TRANSFER endpoint — receiving school verifies a hash from a PDF transcript.
// No Phantom needed. Read-only.

app.post("/api/blockchain/ledger/verify", async (req, res) => {
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

    // Double-check the signature still exists on-chain
    const { getConnection } = await import("./services/blockchain.js");
    const connection = getConnection();
    const statusRes  = await connection.getSignatureStatuses([entry.signature]);
    const status     = statusRes.value[0];

    const onChain = !!(status && !status.err &&
      (status.confirmationStatus === "confirmed" || status.confirmationStatus === "finalized"));

    if (!onChain) {
      return res.json({
        isValid: false,
        message: "Record was found but the blockchain signature could not be confirmed. It may have been reverted.",
        explorerUrl: `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`,
      });
    }

    console.log(`[Ledger] Verified hash: ${offlineHash.slice(0, 16)}... → ✓`);
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

// ── GET /api/blockchain/ledger/student/:studentId ─────────────────────────────
// Returns all on-chain records for a student (for transcript generation).

app.get("/api/blockchain/ledger/student/:studentId", (req, res) => {
  const { studentId } = req.params;
  const records: any[] = [];

  for (const [hash, entry] of ledgerStore.entries()) {
    if (entry.record?.studentId === studentId && entry.signature) {
      records.push({
        offlineHash: hash,
        signature:   entry.signature,
        slot:        entry.slot,
        explorerUrl: `https://explorer.solana.com/tx/${entry.signature}?cluster=devnet`,
        ...entry.record,
      });
    }
  }

  res.json({ success: true, studentId, count: records.length, records });
});
