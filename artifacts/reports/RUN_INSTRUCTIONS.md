# NEWTURE — Fixed project + run instructions

This zip is your full project (backend + frontend) with every fix we made
applied directly to the files. `node_modules`, `dist`, and local database
files are excluded on purpose — see "First-time setup" below.

## What was fixed

### 1. Attendance module was faking data instead of using the database
- **`frontend/src/App.tsx`** — removed the automatic re-seed that ran on
  every page load. Previously, if the `students` table was empty (e.g.
  right after deleting rows), the app silently repopulated it with 10
  hardcoded demo students. Seeding now only happens via the explicit
  "Reset to Demo Data" admin action.
- **`frontend/src/components/ChatbotWidget.tsx`** — removed the
  `localStorage` fallback and the fabricated-data generator in
  `handleStudentPortalSearch()`. A registration number not found in the
  real database now correctly shows "Data Not Available" instead of a
  made-up name/attendance/CGPA.

### 2. Broken import — frontend wouldn't build
- **`frontend/shared/types/index.ts`**, **`shared/interfaces/index.ts`**,
  **`shared/constants/index.ts`** — restored (they existed in git history
  but had been deleted from disk).
- **`frontend/src/types.ts`** — fixed the import path from
  `'../../shared/types/index'` (wrong, pointed outside the project) to
  `'../shared/types/index'`.

### 3. Git / GitHub structure
- **`.gitignore`** (root, new) — covers `node_modules/`, `dist/`, `.env`,
  `backend/data/*.db*`, `backend/uploads/` for both frontend and backend
  in one place. The old nested `frontend/.gitignore` is removed since this
  project should be a single repo at the root, not one nested inside
  `frontend/`.
- **`.gitattributes`** (root, new) — normalizes line endings so config
  files stop showing false "fully changed" diffs from Windows edits.
- Old `node_modules` folders from this zip are Windows binaries
  (`esbuild.exe`, `lightningcss.win32-x64-msvc.node`, etc.) and are not
  included — see setup steps below to reinstall clean for your OS.

## First-time setup

```bash
# unzip, then from the NEWTURE/ folder:

# Backend
cd backend
npm install
npm run dev            # http://localhost:3000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev             # http://localhost:5173
```

Open **http://localhost:5173** — the frontend proxies `/api` calls to the
backend automatically (configured in `frontend/vite.config.ts`).

### Notes
- The database starts **empty** on a fresh run — this is correct now that
  the auto-reseed bug is fixed. Use the admin dashboard's "Reset to Demo
  Data" button if you want sample students/rules/faculty loaded.
- A default admin account is auto-created on first backend start:
  `admin@necn.ac.in` / `Admin@NECN2026` (see `backend/src/database/db.js`).
  Change this before any real deployment.
- `backend/.env` has `GEMINI_API_KEY=` empty — general AI chat (`/api/chat`)
  won't work until you add a real key. Attendance, rules, and the admin
  panel all work without it.
- `backend/data/` and `backend/uploads/` are empty (just `.gitkeep`
  placeholders) — they'll populate as you use the app.

## Putting this under git (single root repo)

```bash
cd NEWTURE
git init
git branch -m main
git remote add origin https://github.com/shaiksameer2431-maker/Newture.git

git add .
git status   # sanity check — node_modules, dist, .env, *.db should NOT appear

git commit -m "Restructure: single root repo, fix shared import, fix attendance auto-reseed bug"
git push origin main --force
```
⚠️ `--force` replaces whatever history currently exists on GitHub (including
the old bloated commits with `node_modules` in them) with this clean state.
Fine for a solo project — just know it rewrites remote history.

If you'd rather keep old commit history and only strip the old
`node_modules` blobs out of it instead of starting fresh, see the
`git filter-repo` approach from our earlier conversation.

## Verifying the attendance fix works
1. Start both servers as above.
2. In the admin dashboard, add a student, note their reg number.
3. Delete that student.
4. Refresh the page — they should **stay deleted** (no auto-reseed).
5. Search that reg number in the chatbot's attendance tracker — should
   show "Data Not Available", not fabricated attendance data.
6. Search a reg number that never existed (e.g. `99999A9999`) — same
   "Data Not Available" result.


## FINAL Windows startup (recommended)

Requirements: Node.js 18–22 and npm.

Backend:
```bat
cd backend
npm run dev
```
The backend `predev` lifecycle script runs `npm install` automatically before `tsx watch server.ts`, so `tsx is not recognized` should not occur on a fresh extraction.

Frontend (second terminal):
```bat
cd frontend
npm install
npm run dev
```

For Semantic RAG, copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY`. After the first website sync, use **Build Semantic Index** in the admin website-knowledge panel.

Automatic synchronization is controlled by `is_scheduled_sync` and `scheduled_interval_hours` in the website knowledge settings. The scheduler performs incremental HTTP validation using ETag/Last-Modified when available and only re-chunks changed pages.


## NECN website crawler canonical host
The crawler uses `https://necn.ac.in/` as the canonical official origin. It automatically normalizes `www.necn.ac.in` links to the apex domain, restricts crawling to the official host, uses IPv4-first DNS ordering, retries transient network failures, and records detailed fetch errors.

## NECN WEBSITE DATASET SYNC (CURRENT)

The official NECN website is the chatbot's external knowledge dataset. Before testing website questions, run the first full sync from the admin dashboard:

1. Start backend: `cd backend` then `npm run dev`.
2. Start frontend in a second terminal: `cd frontend` then `npm run dev`.
3. Open `http://localhost:5173/?admin=true`.
4. Open **NECN Website Knowledge**.
5. Keep **Crawl limit = 0 (all discovered)** and click **Sync Website Now**.
6. Wait for the sync to finish and verify **Pages Indexed**, **Knowledge Chunks**, and **PDF Documents** are non-zero.
7. Test questions such as `Who is the HOD of Mechanical Engineering?` only after indexing completes.

The crawler includes same-domain HTML pages and public PDFs, uses sitemap/robots discovery, and incrementally reuses unchanged pages on later syncs.
