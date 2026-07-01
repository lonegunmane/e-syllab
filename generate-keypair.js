import { Keypair } from "@solana/web3.js";
import fs from "fs";

const keypair = Keypair.generate();

// Save keypair to file
fs.writeFileSync("school-keypair.json", JSON.stringify(Array.from(keypair.secretKey)));

console.log("✅ Keypair generated!");
console.log("Public Key:", keypair.publicKey.toBase58());
console.log("\nAdd this to your .env file:");
console.log(`SCHOOL_SIGNING_KEYPAIR=${JSON.stringify(Array.from(keypair.secretKey))}`);
console.log("\nNow airdrop SOL to your public key at:");
console.log(`https://faucet.solana.com`);