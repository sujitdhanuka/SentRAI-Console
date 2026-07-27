# ET-A2 — Disaster-recovery drill record

**What this proves:** the SentRAI backup is restorable, and a catastrophic
database loss can be recovered from that backup. An unproven backup is a hope,
not a backup — this is the proof, with measured RPO/RTO.

Backup and restore are provider-aware (`scripts/backup.sh`, `scripts/restore.sh`):
**MariaDB** in production (`mysqldump` / `mysql`), **SQLite** in dev/demo
(`sqlite3 .backup` — a consistent hot snapshot). Both dumps are gzip-compressed
with an integrity gate (`gzip -t`, and for SQLite `PRAGMA integrity_check`).

## Drill executed — 2026-07-27 (SQLite demo tenant)

Database: the Meridian Finance demo tenant (`scene-demo.db`).

### 1. Backup
```
DB_PROVIDER=sqlite SQLITE_PATH=./scene-demo.db ./scripts/backup.sh
→ sentrai-db-20260727-122447.sqlite.gz  (60 KB)  · integrity_check: ok
```
Elapsed: **0.38 s**.

### 2. Restore drill (safe — scratch DB, no production touched)
```
./scripts/restore.sh <dump>            # DB_PROVIDER=sqlite
→ integrity_check: ok
   organizations 1 · users 3 · projects 2 · ai_models 14
   model_ledger_events 73 · audit_events 123 · grievances 1 · ai_incidents 3
→ DRILL PASSED ✅
```
Elapsed: **0.36 s**. Row counts match the live tenant exactly.

### 3. Full loss → recovery (on a disposable copy, `--prod` path)
```
before loss:  ai_models = 14
rm live.db    → live.db GONE
restore --prod <dump>  → integrity_check: ok · all tables restored
after:        ai_models = 14
```
**RTO: 0.35 s.** Complete recovery of a deleted database from the backup.

## Measured objectives (demo scale)

| Metric | Value | Notes |
|---|---|---|
| Backup time | 0.38 s | SQLite demo DB (60 KB). MariaDB scales with data size. |
| Restore time (RTO) | 0.35 s | Decompress + load + integrity check. |
| RPO | = backup cadence | Nightly cron ⇒ ≤ 24 h; tighten by scheduling `backup.sh` more often. |
| Integrity | ✅ | `PRAGMA integrity_check` (SQLite) / `gzip -t` on every dump. |

## Standing schedule (production)

- **Backups:** cron `scripts/backup.sh` nightly (MariaDB in prod), 7-day retention (`SENTRAI_BACKUP_RETENTION_DAYS`). Take one **before any schema-affecting release**.
- **Restore drill:** re-run `scripts/restore.sh <latest-dump>` (scratch DB) before each evaluation window — it is non-destructive and prints proof.
- **Uptime:** `.github/workflows/uptime.yml` probes `/health` every 15 min; a failed run is a loud signal that prod is down or degraded.

## Still open (not code — infrastructure)

- A true **staging environment** with a promote-to-prod gate. Interim gate: the
  `CI` workflow (`.github/workflows/ci.yml`) runs build + unit + e2e on every
  push/PR, so a broken build is caught before it can reach `main` (which
  auto-deploys). This is the verification gate; a separate staging host is the
  remaining piece.
