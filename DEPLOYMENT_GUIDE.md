# E-SYLLAB Deployment Guide — Vercel (frontend) + Render (backend)

Your app currently runs as one combined Express server (frontend + API on
port 3000). For free-tier deployment, it gets **split into two services**:

- **Vercel** hosts the React frontend (static build)
- **Render** hosts the Node.js/Express backend (the blockchain API)

They talk to each other over HTTPS. The files in this folder make that split work.

---

## Files in this package and where they go

| File | Destination | Purpose |
|---|---|---|
| `vercel.json` | `google-drive-main/vercel.json` | Tells Vercel how to build + routes `/api/*` to Render |
| `render.yaml` | `google-drive-main/render.yaml` | Render's service definition (optional — can also configure via dashboard) |
| `package.json` | `google-drive-main/package.json` | Updated `start` script for production |
| `server.ts` | `google-drive-main/server.ts` | API-only — no longer serves the frontend |
| `.env.render.example` | reference only | Copy values into Render's dashboard |
| `.env.vercel.example` | reference only | Copy values into Vercel's dashboard |
| `.gitignore` | `google-drive-main/.gitignore` | Keeps secrets out of GitHub |

---

## Step 1 — Push your code to GitHub

```bash
cd google-drive-main
git init
git add .
git commit -m "E-SYLLAB prototype ready for deployment"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/e-syllab.git
git push -u origin main
```

If you don't have a GitHub repo yet, create one first at github.com/new.

---

## Step 2 — Deploy the backend to Render FIRST

(Backend first because the frontend needs to know its URL.)

1. Go to **https://render.com** → sign up with GitHub
2. Click **New +** → **Web Service**
3. Connect your `e-syllab` repository
4. Render will detect `render.yaml` automatically — confirm settings:
   - **Root Directory:** `google-drive-main`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run start`
5. Click **Advanced** → add environment variables (see `.env.render.example`):
   - `SCHOOL_SIGNING_KEYPAIR` — paste your keypair JSON array
   - `ALLOWED_ORIGIN` — leave as `https://e-syllab.vercel.app` for now, you'll update this in Step 4
   - `RESEND_API_KEY` — optional
6. Click **Create Web Service**
7. Wait ~3 minutes for the first deploy. You'll get a URL like:
   ```
   https://e-syllab-api.onrender.com
   ```
8. **Copy this URL** — you need it for Step 3.

> Free tier note: Render spins down after 15 minutes of inactivity. The
> first request after idle takes ~30 seconds to wake up. Fine for a
> prototype demo.

---

## Step 3 — Update vercel.json with your real Render URL

Open `vercel.json` and replace the placeholder:

```json
"destination": "https://e-syllab-api.onrender.com/api/$1"
```

with your actual Render URL from Step 2. Commit and push this change.

---

## Step 4 — Deploy the frontend to Vercel

1. Go to **https://vercel.com** → sign up with GitHub
2. Click **Add New** → **Project**
3. Import your `e-syllab` repository
4. Configure:
   - **Root Directory:** `google-drive-main`
   - **Framework Preset:** Vite (auto-detected)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Add environment variable (see `.env.vercel.example`):
   - `VITE_API_URL` = your Render URL from Step 2
6. Click **Deploy**
7. Wait ~2 minutes. You'll get a URL like:
   ```
   https://e-syllab.vercel.app
   ```

---

## Step 5 — Connect the two (final step)

Now that both are live, go back to **Render** → your service → **Environment**
→ update `ALLOWED_ORIGIN` to your exact Vercel URL from Step 4:

```
ALLOWED_ORIGIN=https://e-syllab.vercel.app
```

Save — Render will auto-redeploy with the new CORS setting.

---

## Step 6 — Test it

Visit your Vercel URL. Try:
- Logging in as admin
- Marking attendance with Phantom (Devnet)
- Check the browser console (F12) for any CORS errors

If you see a CORS error, double check `ALLOWED_ORIGIN` on Render matches
your Vercel URL **exactly** (no trailing slash, correct https://).

---

## Step 7 — Use this URL for your APK

Once confirmed working, go to **https://pwabuilder.com**, paste your
Vercel URL, and generate the Android APK as discussed earlier.

---

## Updating after this point

Any `git push` to your `main` branch auto-redeploys both Vercel and
Render — that's what `autoDeploy: true` in `render.yaml` does, and
Vercel does this by default.
