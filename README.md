# E-SYLLAB — Blockchain-Secured Digital Learning & Attendance Platform

**E-SYLLAB** is an institutional digital learning, attendance verification, and academic management system tailored for secondary schools. Designed to operate reliably in environments with intermittent internet access, E-SYLLAB pairs **Progressive Web App (PWA) offline-first resilience** with **cryptographic record immutability via the Solana Devnet Memo program**.

---

## 1. System Overview & Problem Statement

In many school environments, administrative records, grade reports, and daily attendance logs suffer from paper-based vulnerabilities, physical loss, or unauthorized record alteration. Furthermore, unstable internet connectivity frequently hinders traditional cloud-only school portals.

E-SYLLAB addresses these challenges with:
- **Offline-First Architecture**: Service Worker caching and an IndexedDB transactional queue allow teachers and students to interact with timetables, take attendance, and view cached curriculum materials without active internet. Transactions automatically synchronize upon reconnection.
- **Immutable Ledger on Solana Devnet**: Rather than relying on high-latency, gas-expensive networks like Ethereum, E-SYLLAB anchors cryptographic hashes and state attestations (attendance, grade approvals, and audit trails) directly onto **Solana Devnet using the native SPL Memo program**, achieving sub-second finality and near-zero transaction overhead.
- **Data Protection Act Compliance**: Full alignment with data sovereignty and privacy standards (e.g., Zambia's Data Protection Act No. 3 of 2021), featuring field-level AES encryption, session revocation, automated audit logs, and self-service personal data export.

---

## 2. User Roles & Capabilities

E-SYLLAB enforces strict Role-Based Access Control (RBAC) across three distinct user roles:

### 🎓 Student Role
- **Timetable & Schedule**: Access daily and weekly class schedules with period indicators and room assignments.
- **ECZ Curriculum Access**: Browse and download approved course materials, syllabus references, and class announcements (up to 2MB).
- **Academic Performance & Assessment**: View confirmed subject grades, teacher feedback, and automated performance charts.
- **Attendance Verification**: Monitor personal attendance logs, verify on-chain transaction hashes, and review verified status badges.
- **Internal Messaging**: Communicate securely with subject teachers and administrative staff.

### 👩‍🏫 Teacher Role
- **Attendance Tracking (Online & Offline)**: Mark classroom attendance with automatic geolocation capture and geofencing verification. Offline records are queued locally and synchronized automatically.
- **Curriculum & Materials Management**: Publish syllabus resources, revision notes, and homework documents for assigned grade levels.
- **Gradebook & Assessments**: Create assessment entries, enter student marks, and provide individualized feedback.
- **Teacher Vault**: Securely submit sensitive educational records, examination drafts, and verification documents to school administration for formal review and approval.

### 🛡️ Administrator Role
- **Institutional Control Panel**: Real-time system monitoring, server health telemetry, and institutional overview.
- **User & Staff Directory**: Provision new teacher and student accounts, reset credentials, and manage profile permissions.
- **Master Timetable Management**: Schedule class periods with real-time conflict detection across teacher assignments, class sections, and room bookings.
- **Vault Review Workflow**: Review, approve, or reject documents submitted to the Administrative Vault.
- **Blockchain Explorer & Audit Trail**: Query, verify, and inspect all cryptographic memos and transactions anchored to Solana Devnet.

---

## 3. Technology Stack

- **Frontend Client**: React 19, TypeScript, Tailwind CSS, Motion, Lucide Icons, Vite.
- **PWA / Offline Layer**: Service Worker (`sw.js`), Cache API, IndexedDB Sync Queue.
- **Backend API**: Node.js, Express, TypeScript (`tsx` in dev, `esbuild` bundled CJS in production).
- **Database**: PostgreSQL with connection pooling (`pg`), accompanied by a persistent in-memory fallback for zero-configuration development.
- **Blockchain Integration**: `@solana/web3.js` & Solana SPL Memo Program on Solana Devnet.
- **Security & Communications**: JSON Web Tokens (`jsonwebtoken`), `bcryptjs` password hashing, AES-256 field encryption, and Resend for transactional 2FA/OTP delivery.

---

## 4. Architecture & Dual-Host Deployment

For cloud deployment, E-SYLLAB is decoupled into two optimized services:

```
┌───────────────────────────────────────┐
│        Vercel (Frontend Client)       │
│  - Static SPA (React + Vite)          │
│  - Service Worker / PWA caching       │
│  - Reverse Proxy rewrite to /api/*    │
└───────────────────┬───────────────────┘
                    │ HTTPS Requests
                    ▼
┌───────────────────────────────────────┐
│         Render (Backend API)          │
│  - Express REST API / Auth Service    │
│  - PostgreSQL Database connection     │
│  - Solana Devnet Keypair & Memo Signer│
└───────────────────────────────────────┘
```

1. **Vercel**: Hosts the compiled static frontend assets (`dist/`) with SPA fallback and `/api/*` rewrites.
2. **Render**: Hosts the Node.js / Express backend service (`server.ts`), handles database queries, and executes Solana Devnet blockchain transactions.

---

## 5. Local Setup & Execution

### Prerequisites
- **Node.js**: v20.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation Steps

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/e-syllab.git
   cd e-syllab
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment Variables:**
   Copy `.env.example` to `.env` (or `.env.local`):
   ```bash
   cp .env.example .env
   ```
   *Fill in the required variables (see section below).*

4. **Start Local Development Server:**
   ```bash
   npm run dev
   ```
   *The combined frontend and API server will be available at `http://localhost:3000`.*

5. **Build for Production:**
   ```bash
   npm run build
   npm run build:server
   npm run start
   ```

---

## 6. Environment Variables Reference

All supported environment variables are declared in `.env.example`. No secret values should ever be committed to source control.

| Variable | Description | Example / Format |
|---|---|---|
| `PORT` | Local and production port for the Express server. | `3000` |
| `DATABASE_URL` | PostgreSQL connection URI. If omitted, uses in-memory store. | `postgresql://user:pass@host:5432/dbname?sslmode=require` |
| `JWT_SECRET` | Cryptographic secret for signing and validating JWT session tokens. | High-entropy string (e.g. 64-char random hex) |
| `SCHOOL_SIGNING_KEYPAIR` | Solana Devnet wallet keypair JSON byte array used for signing on-chain memo attestations. | `[142,55,201,...]` (64 integers) |
| `ALLOWED_ORIGIN` | Allowed CORS origin for frontend client requests. | `https://e-syllab.vercel.app` or `http://localhost:3000` |
| `VITE_API_URL` | Base API URL configured on the frontend client. | `https://e-syllab-api.onrender.com` |
| `GEMINI_API_KEY` | Google Gemini API key for curriculum insights & syllabus analysis. | Secret API key string |
| `RESEND_API_KEY` | Resend API key for sending 2FA verification and OTP password reset emails. | `re_...` |
| `RESEND_FROM_EMAIL` | Verified sender address for transactional emails. | `E-SYLLAB Security <onboarding@resend.dev>` |
| `ENCRYPTION_KEY` | 32-byte hexadecimal key for field-level database encryption. | 64-character hex string |
| `ADMIN_SEED_EMAIL` | Initial default administrator email account created at first boot. | `admin@gmail.com` |
| `ADMIN_SEED_PASSWORD` | Initial default administrator password for system seeding. | Strong temporary password string |
| `ADMIN_SEED_EMAIL_2` | Secondary system administrator email account. | `sysadmin@gmail.com` |
| `ADMIN_SEED_PASSWORD_2` | Secondary system administrator password. | Strong temporary password string |

---

## 7. Database Initialization

The complete PostgreSQL Data Definition Language (DDL) matching the runtime database schema is located at:
```
database/schema.sql
```
When `DATABASE_URL` is supplied, E-SYLLAB auto-provisions tables and indexes on initial startup. You can also manually apply `database/schema.sql` to any PostgreSQL instance using `psql`:
```bash
psql $DATABASE_URL -f database/schema.sql
```

---

## 8. Verification & Examination Checklist

When evaluating the platform:
- **Offline Simulation**: Open browser DevTools, switch network to **Offline**, mark attendance or navigate cached tabs, and re-enable network to observe the background sync.
- **Blockchain Verification**: Inspect any attendance attestation transaction hash on [Solana Explorer (Devnet)](https://explorer.solana.com/?cluster=devnet) to view the immutable SPL Memo record.
- **Timetable Conflict Engine**: Attempt to double-book a teacher or room in the Administrator Control Panel to verify the automated conflict detection rules.
