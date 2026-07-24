# ET Award — Deploy & Relocation Checklist (Workstream A, your hands required)

Two tasks only you can do: move the repo off the synced folder, and deploy to
sentraiconsole.com. Every command is copy-paste ready. Target: **Fri 25 Jul**.

---

## A1.1 — Move the repo out of the synced folder (30 min, do this FIRST)

The sync tool has corrupted source files and `.git` three times this month.
One incident during evaluation week is unrecoverable in time.

```bash
# 1. Fresh clone to a NON-synced location (never under Documents/Desktop/iCloud/Dropbox)
mkdir -p ~/dev && cd ~/dev
git clone https://github.com/sujitdhanuka/SentRAI-Console.git sentrai
cd sentrai

# 2. Prove the clone is healthy
git fsck --full            # expect: no errors
git log --oneline -3       # expect: latest main commits

# 3. Prove it builds from the new location
npm ci && npm run build
cd console-ui && npm ci && npm run build && cd ..
npm run test:e2e           # expect: all pass

# 4. Retire the old copy (keep as read-only archive for a week, then delete)
mv ~/Documents/Datascience/Projects/rbi-freeai-compliance \
   ~/Documents/Datascience/Projects/rbi-freeai-compliance.ARCHIVED-2026-07-25
```

From now on, all work happens in `~/dev/sentrai`. If the sync tool has a
"manage backed-up folders" setting, also exclude `~/dev` explicitly.

---

## A1.2 — Deploy latest main to sentraiconsole.com (60–90 min)

```bash
# 0. On your machine: confirm what you are about to ship
cd ~/dev/sentrai && git pull && git log --oneline -1

# 1. Build artifacts locally (Hostinger shared hosting should not build)
npm ci && npm run build
cd console-ui && npm ci && npm run build && cd ..
# artifacts: dist/  public/  package.json  package-lock.json

# 2. BEFORE uploading — snapshot production DB (via hPanel > phpMyAdmin export,
#    or ssh): keep the dump locally AND on the server.
#    File name convention: sentrai-prod-YYYYMMDD-pre-deploy.sql

# 3. Upload dist/ + public/ + package.json + package-lock.json to the server
#    (rsync/sftp). Then on the server:
npm ci --omit=dev
#    restart the Node process (hPanel > Node.js app > Restart, or pm2 restart)

# 4. Verify from OUTSIDE the server:
curl -s https://sentraiconsole.com/health
curl -s https://sentraiconsole.com/api/v1/auth/bootstrap-status   # build must be "2026-07-24.scan-column-widen"
curl -s -o /dev/null -w "%{http_code}\n" https://sentraiconsole.com/coverage   # expect 200
```

**5. Verify the big-repo scan fix** (the "GitHub import shows 0 models" bug):
the new build widens `projects.lastScanResult` from TEXT (64 KB, silently
truncated big scans) to MEDIUMTEXT at boot — the app log will show
`Schema guard: widened projects.lastScanResult text → mediumtext`. Then in the
console open **Dhancept-git-dev-v2 → Scan**: expect ~85 models. If it says
"No codebase found", the workspace was wiped by the redeploy — just re-import
the repo via the GitHub button (owner `sujitdhanuka`, repo `Dhancept`, branch
`dev`, your token) and the count will stick this time.

Then click through, hard-refreshed (Cmd-Shift-R): landing → Launch the console
(should land on the React app) → all 12 tabs → /console classic still works.

---

## A1.3 — Production hygiene (after deploy verifies)

```bash
# In the prod console as admin:
#  - disable/delete qa@sentrai.test and any other test users (Users tab)
#  - delete diag-gh@sentrai.test (org "Diag Org GH") — throwaway account used
#    on 24 Jul to diagnose the GitHub-import scan bug; its test projects are
#    already deleted
#  - rotate the admin password (it has appeared in terminals during development)
#  - create your demo-day accounts fresh
```

---

## A1.4 — Seed the Meridian Finance demo tenant on production

```bash
cd ~/dev/sentrai
SENTRAI_URL=https://sentraiconsole.com \
SENTRAI_ADMIN_EMAIL=<prod-admin-email> \
SENTRAI_ADMIN_PASSWORD=<prod-admin-password> \
MERIDIAN_CISO_PASSWORD='<pick-a-strong-demo-password>' \
node scripts/seed-demo.mjs
```

Idempotent — run it again any time to reset/top-up the demo tenant. Optional:
add `MERIDIAN_LLM_URL/_MODEL/_KEY` to give drafts real "AI-drafted via …"
provenance (an Ollama on your laptop works and doubles as the zero-egress
talking point).

**Demo reset between judge sessions** = re-run the same command. The drift
breaker re-arms automatically as long as you haven't clicked "Evaluate now";
after a session that tripped it, reset by deleting + re-seeding the tenant or
simply demo on a re-run (the script recreates staged windows when history is
clean).

---

## A2 — Backup + monitor (Sat–Sun 26–27 Jul)

- Daily DB dump cron on the server; keep 7 days; copy latest off-server weekly.
- Prove ONE restore into a scratch database before 27 Jul — an unproven backup
  is a hope, not a backup.
- Uptime monitor: any free pinger (UptimeRobot etc.) on
  `https://sentraiconsole.com/health`, 5-min interval, alert to your phone.

## Freeze reminders

- **8 Aug** code freeze · **12 Aug** demo-env freeze (final seed, final DB
  snapshot, backup laptop imaged) · **14 Aug** no deploys · **15 Aug →**
  monitoring on, hands off.
