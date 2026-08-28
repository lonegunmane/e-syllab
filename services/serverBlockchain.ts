// serverBlockchain.ts — Node-only Solana instruction building (Future/Reserved).
//
// NOTE: Active production and demo attendance in E-SYLLAB utilizes the standard
// Solana Memo Program (MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr) with SHA-256
// cryptographic hashes in server.ts.
// The custom instruction builder below is reserved for future Anchor/Rust smart contract deployments.
//
// This is deliberately SEPARATE from services/blockchain.ts, which is a
// shared file bundled into BOTH the frontend (Vite/browser) and backend
// (esbuild/Node). This file uses Node's built-in `crypto` module, which
// does not exist in a browser — putting it in the shared file breaks the
// frontend build. This file must only ever be imported by server.ts,
// never by any .tsx component.

import { PublicKey, TransactionInstruction, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";
import { PROGRAM_ID } from "./blockchain.js";

// 8-byte Anchor instruction discriminator for `record_attendance`,
// computed as the first 8 bytes of SHA-256("global:record_attendance").
// This is a fixed value tied to the deployed program — do not change it
// unless the Rust program's instruction name changes and is redeployed.
const RECORD_ATTENDANCE_DISCRIMINATOR = Buffer.from([79, 87, 96, 24, 25, 169, 16, 201]);

function borshEncodeString(str: string): Buffer {
  const strBytes = Buffer.from(str, "utf8");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBytes.length, 0);
  return Buffer.concat([lenBuf, strBytes]);
}

export function shortStaffIdHash(staffId: string): string {
  return createHash("sha256").update(staffId).digest("hex").slice(0, 16);
}

function normalizeStatusForChain(status: string): string {
  const map: Record<string, string> = {
    Present: "PRESENT",
    Absent: "ABSENT",
    Late: "LATE",
    OnLeave: "ON_LEAVE",
  };
  return map[status] || status.toUpperCase();
}

export function buildAttendanceAnchorInstruction(
  authorityPublicKey: PublicKey,
  staffId: string,
  date: string,
  status: string,
  recordHash: string
): { instruction: TransactionInstruction; pda: PublicKey } {
  const staffIdHash = shortStaffIdHash(staffId);
  const normalizedStatus = normalizeStatusForChain(status);

  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("attendance"), Buffer.from(staffIdHash, "utf8"), Buffer.from(date, "utf8")],
    PROGRAM_ID
  );

  const data = Buffer.concat([
    RECORD_ATTENDANCE_DISCRIMINATOR,
    borshEncodeString(staffIdHash),
    borshEncodeString(date),
    borshEncodeString(normalizedStatus),
    borshEncodeString(recordHash.slice(0, 64)),
  ]);

  const instruction = new TransactionInstruction({
    keys: [
      { pubkey: pda, isSigner: false, isWritable: true },
      { pubkey: authorityPublicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });

  return { instruction, pda };
}