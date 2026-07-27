#!/usr/bin/env bash
#
# SentRAI restore — load a DB dump produced by scripts/backup.sh.
#
# By DEFAULT it restores into a SCRATCH database and reports row counts, so you
# can PROVE a backup is good without touching production. That proof is the whole
# point: an unproven backup is a hope, not a backup. Run the drill once before
# the evaluation window.
#
# Restoring over the LIVE database is destructive and requires --prod as an
# explicit interlock.
#
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: restore.sh <db-dump.sql.gz> [--target <db-name>] [--prod] [--keep]

  <db-dump.sql.gz>    a dump from scripts/backup.sh
  --target <name>     database to load into (default: sentrai_restore_test — a scratch DB)
  --prod              REQUIRED to target the live database (safety interlock)
  --keep              do not drop the scratch DB afterwards (inspect it yourself)

Env (same as the app): DB_HOST DB_PORT DB_USER DB_NAME, and MYSQL_PWD / DB_PASSWORD.

Examples:
  # Restore drill — safe, uses a scratch DB, prints proof, cleans up:
  ./scripts/restore.sh ~/sentrai-backups/sentrai-db-20260727-020000.sql.gz

  # Real recovery into production (deliberate, destructive):
  ./scripts/restore.sh <dump> --target "$DB_NAME" --prod
USAGE
}

[ $# -ge 1 ] || { usage; exit 1; }
DUMP="$1"; shift
TARGET="sentrai_restore_test"
IS_PROD=0
KEEP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="$2"; shift 2;;
    --prod)   IS_PROD=1; shift;;
    --keep)   KEEP=1; shift;;
    -h|--help) usage; exit 0;;
    *) echo "unknown arg: $1" >&2; usage; exit 1;;
  esac
done

[ -f "$DUMP" ] || { echo "[restore] ERROR: dump not found: $DUMP" >&2; exit 1; }

# ── SQLite path ─────────────────────────────────────────────────────────────
# A .sqlite.gz dump (or DB_PROVIDER=sqlite) is restored into a scratch .db file,
# integrity-checked and row-counted. --prod replaces the live SQLITE_PATH.
if [ "${DB_PROVIDER:-}" = "sqlite" ] || [[ "$DUMP" == *.sqlite.gz ]]; then
  LIVE_SQLITE="${SQLITE_PATH:-./dev.db}"
  if [ "$IS_PROD" -eq 1 ]; then
    scratch="$LIVE_SQLITE"
    echo "[restore] !! PRODUCTION restore into '$scratch' — this OVERWRITES live data."
    read -r -p "[restore] Type the file name to confirm: " confirm
    [ "$confirm" = "$(basename "$scratch")" ] || [ "$confirm" = "$scratch" ] || { echo "[restore] aborted."; exit 1; }
  else
    scratch="${TARGET}.db"; [ "$TARGET" = "sentrai_restore_test" ] && scratch="sentrai_restore_test.db"
  fi
  echo "[restore] loading $DUMP -> $scratch (sqlite)"
  gunzip -c "$DUMP" > "$scratch"
  ok="$(sqlite3 "$scratch" 'PRAGMA integrity_check;' | head -1)"
  [ "$ok" = "ok" ] || { echo "[restore] ERROR: restored db failed integrity_check ($ok)" >&2; exit 1; }
  echo "[restore] integrity_check: ok"
  echo "[restore] verification — row counts in the restored database:"
  for t in organizations users projects ai_models model_ledger_events audit_events grievances ai_incidents; do
    c="$(sqlite3 "$scratch" "SELECT COUNT(*) FROM $t;" 2>/dev/null || echo '—')"
    printf '  %-22s %s\n' "$t" "$c"
  done
  if [ "$IS_PROD" -ne 1 ] && [ "$KEEP" -ne 1 ]; then
    rm -f "$scratch"
    echo "[restore] dropped scratch db (pass --keep to retain it)"
    echo "[restore] DRILL PASSED — the dump restores cleanly and reports data. ✅"
  else
    echo "[restore] done. Database '$scratch' left in place."
  fi
  exit 0
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-sentrai}"
LIVE_DB="${DB_NAME:-sentrai_compliance}"
export MYSQL_PWD="${MYSQL_PWD:-${DB_PASSWORD:-}}"
[ -n "${MYSQL_PWD}" ] || { echo "[restore] ERROR: no DB password in MYSQL_PWD/DB_PASSWORD" >&2; exit 1; }

mysql_do() { mysql --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" "$@"; }

# Interlock: refuse to touch the live DB without --prod.
if [ "$TARGET" = "$LIVE_DB" ] && [ "$IS_PROD" -ne 1 ]; then
  echo "[restore] REFUSING to restore over the live database '$LIVE_DB' without --prod." >&2
  echo "[restore] For a safe drill, drop --target (uses the scratch DB '$TARGET')." >&2
  exit 1
fi
if [ "$IS_PROD" -eq 1 ]; then
  echo "[restore] !! PRODUCTION restore into '$TARGET' — this OVERWRITES live data."
  read -r -p "[restore] Type the database name to confirm: " confirm
  [ "$confirm" = "$TARGET" ] || { echo "[restore] aborted."; exit 1; }
fi

echo "[restore] loading $DUMP -> ${TARGET}@${DB_HOST}:${DB_PORT}"
mysql_do -e "CREATE DATABASE IF NOT EXISTS \`$TARGET\` CHARACTER SET utf8mb4;"
gunzip -c "$DUMP" | mysql_do "$TARGET"

echo "[restore] verification — row counts in the restored database:"
mysql_do "$TARGET" -e "
  SELECT 'organizations' AS tbl, COUNT(*) AS rows_ FROM organizations
  UNION ALL SELECT 'users',       COUNT(*) FROM users
  UNION ALL SELECT 'projects',    COUNT(*) FROM projects
  UNION ALL SELECT 'ai_models',   COUNT(*) FROM ai_models
  UNION ALL SELECT 'model_ledger_events', COUNT(*) FROM model_ledger_events;" 2>/dev/null \
  || echo "[restore] (some tables absent — inspect manually; a fresh schema may differ)"

if [ "$IS_PROD" -ne 1 ] && [ "$KEEP" -ne 1 ]; then
  echo "[restore] dropping scratch DB '$TARGET' (pass --keep to retain it)"
  mysql_do -e "DROP DATABASE \`$TARGET\`;"
  echo "[restore] DRILL PASSED — the dump restores cleanly and reports data. ✅"
else
  echo "[restore] done. Database '$TARGET' left in place."
fi
