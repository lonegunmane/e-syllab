# E-SYLLAB Deployment Guide — Vercel (Frontend) + Render (Backend)

This guide documents deploying the **E-SYLLAB** platform using the dual-host cloud architecture:
- **Vercel** hosts the static React/Vite Progressive Web App frontend.
- **Render** hosts the Node.js/Express backend API (PostgreSQL database client & Solana Devnet transaction signer).

---

## 1. Project Structure & Key Deployment Files

All files are located directly at the root of the repository:

| File | Location | Purpose |
|---|---|---|
| `vercel.json` | `/vercel.json` | Configures Vercel build output and rewrites `/api/*` requests to the Render backend |
| `render.yaml` | `/render.yaml` | Render Blueprint specification for the web service |
| `package.json` | `/package.json` | Node dependencies, `build` (frontend), `build:server` (backend bundle), and `start` scripts |
| `server.ts` | `/server.ts` | Express API entry point |
| `database/schema.sql`| `/database/schema.sql` | PostgreSQL DDL table definitions and indexes |
| `.env.example` | `/.env.example` | Reference documentation for all environment variables |

---

## 2. Core Environment Variables

Ensure these core environment variables are configured in their respective service dashboards:

### Backend Variables (Render Dashboard)
- `PORT`: Set to `3000` (Render dynamically manages port binding, default configured).
- `DATABASE_URL`: PostgreSQL connection string (e.g. from Render PostgreSQL, Supabase, Neon, or Cloud SQL).
- `JWT_SECRET`: High-entropy secret string used to sign and verify user session tokens.
- `SCHOOL_SIGNING_KEYPAIR`: Solana Devnet keypair formatted as a 64-byte JSON integer array (e.g. `[142,55,201,...]`) for signing on-chain memo transactions.
- `ALLOWED_ORIGIN`: Exact URL of your deployed Vercel frontend without trailing slashes (e.g. `https://e-syllab.vercel.app`).
- `RESEND_API_KEY`: *(Optional)* API key from Resend for transactional 2FA/OTP emails.
- `RESEND_FROM_EMAIL`: *(Optional)* Sender address (defaults to `E-SYLLAB Security <onboarding@resend.dev>`).
- `ENCRYPTION_KEY`: *(Optional)* 32-byte hex string for field-level encryption.
- `ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`: *(Optional)* Custom seed administrator credentials.

### Frontend Variables (Vercel Dashboard)
- `VITE_API_URL`: The public HTTPS URL of your Render backend API service (e.g. `https://e-syllab-api.onrender.com`).

---

## 3. Step-by-Step Deployment Instructions

### Step 1: Push Code to Your GitHub Repository
From the root directory of the project:
```bash
git init
git add .
git commit -m "E-SYLLAB production deployment ready"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/e-syllab.git
git push -u origin main
```

---

### Step 2: Deploy Backend Web Service to Render (First)
*Deploy the backend first so you obtain its live public URL.*

1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** → **Web Service**.
3. Select **Build and deploy from a Git repository** and connect your `e-syllab` repository.
4. Configure the service settings:
   - **Name:** `e-syllab-api`
   - **Region:** Choose the region closest to your users (e.g., Oregon, Frankfurt).
   - **Branch:** `main`
   - **Root Directory:** *(Leave blank / empty — uses repository root)*
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build:server`
   - **Start Command:** `npm run start`
   - **Plan:** `Free`
5. Under **Environment Variables**, add:
   - `NODE_ENV` = `production`
   - `PORT` = `3000`
   - `DATABASE_URL` = *your PostgreSQL connection string*
   - `JWT_SECRET` = *your generated random JWT secret*
   - `SCHOOL_SIGNING_KEYPAIR` = *your Solana Devnet keypair JSON array*
   - `ALLOWED_ORIGIN` = `https://e-syllab.vercel.app` *(update with your exact Vercel URL once known)*
   - `RESEND_API_KEY` = *(optional)*
6. Click **Create Web Service**.
7. Once deployment succeeds, copy your Render Web Service URL (e.g., `https://e-syllab-api.onrender.com`).

---

### Step 3: Configure `vercel.json` with your Render API URL
Open `vercel.json` in the root directory and ensure the destination matches your Render API URL:

```json
{
  "version": 2,
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [
    {
      "source": "/api/(.*)",
      "destination": "https://e-syllab-api.onrender.com/api/$1"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ]
}
```

Commit and push this change if modified:
```bash
git add vercel.json
git commit -m "Configure production API rewrite target"
git push origin main
```

---

### Step 4: Deploy Frontend Client to Vercel
1. Log in to [Vercel Dashboard](https://vercel.com).
2. Click **Add New...** → **Project**.
3. Import your `e-syllab` repository from GitHub.
4. Configure Project Settings:
   - **Framework Preset:** `Vite` (auto-detected)
   - **Root Directory:** `./` *(default root directory)*
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Expand **Environment Variables** and add:
   - `VITE_API_URL` = `https://e-syllab-api.onrender.com` *(your Render API URL)*
6. Click **Deploy**.
7. Once deployed, note your live Vercel URL (e.g., `https://e-syllab.vercel.app`).

---

### Step 5: Finalize CORS Configuration on Render
1. Navigate back to your **Render Dashboard** → select `e-syllab-api` → **Environment**.
2. Update the `ALLOWED_ORIGIN` variable to match your exact Vercel domain:
   ```
   ALLOWED_ORIGIN=https://e-syllab.vercel.app
   ```
3. Save changes. Render will automatically redeploy the backend with updated CORS headers.

---

## 4. Verification & Testing

1. Open your Vercel URL in a browser.
2. Sign in with the administrator or staff account.
3. Open Browser Developer Tools (Console & Network tab):
   - Confirm `/api/auth/profile` and `/api/blockchain/status` return `200 OK`.
   - Verify that there are no CORS header mismatch warnings.
4. Test marking an attendance record and verify the Solana Devnet transaction signature generated in the response.

---

## 5. Mobile APK Generation (Optional)

To package E-SYLLAB as an installable Android APK:
1. Navigate to [PWABuilder](https://www.pwabuilder.com/).
2. Enter your live Vercel URL (e.g. `https://e-syllab.vercel.app`).
3. Verify that the Service Worker, Web Manifest, and icon assets pass all validation checks.
4. Click **Package for Android** to generate a signed Android App Bundle (AAB) or testing APK.
