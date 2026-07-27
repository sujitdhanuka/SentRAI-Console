#!/usr/bin/env bash
#
# SentRAI backup — database dump + workspaces archive.
#
# Provider-aware: MariaDB in production (mysqldump), SQLite in dev/demo
# (sqlite3 .backup — a consistent hot copy). Selected by DB_PROVIDER, or
# auto-detected (SQLITE_PATH set ⇒ sqlite, else mariadb).
#
# Timestamped, gzip-compressed, with N-day retention. Reads the SAME environment
# the app uses, so it "just works" on the server. The DB password is taken from
# MYSQL_PWD / DB_PASSWORD via the environment and never appears on a command line
# (so it can't leak into `ps`).
#
# The database dump is the critical artifact: scan results are persisted in the
# DB, so a lost workspaces directory does not lose discovery.
#
# Usage:
#   DB_PROVIDER=mariadb DB_HOST=... DB_USER=... MYSQL_PWD=... DB_NAME=... ./scripts/backup.sh
#   DB_PROVIDER=sqlite  SQLITE_PATH=./dev.db ./scripts/backup.sh
#
set -euo pipefail

BACKUP_DIR="${SENTRAI_BACKUP_DIR:-$HOME/sentrai-backups}"
WORKSPACES_DIR="${WORKSPACES_DIR:-$(pwd)/workspaces}"
RETENTION_DAYS="${SENTRAI_BACKUP_RETENTION_DAYS:-7}"

# ── provider selection ──────────────────────────────────────────────────────
SQLITE_PATH="${SQLITE_PATH:-}"
PROVIDER="${DB_PROVIDER:-}"
if [ -z "$PROVIDER" ]; then
  if [ -n "$SQLITE_PATH" ]; then PROVIDER="sqlite"; else PROVIDER="mariadb"; fi
fi

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

if [ "$PROVIDER" = "sqlite" ]; then
  SQLITE_PATH="${SQLITE_PATH:-./dev.db}"
  [ -f "$SQLITE_PATH" ] || { echo "[backup] ERROR: sqlite db not found: $SQLITE_PATH" >&2; exit 1; }
  db_file="$BACKUP_DIR/sentrai-db-$stamp.sqlite.gz"
  echo "[backup] SQLite $SQLITE_PATH -> $db_file"
  tmp="$(mktemp -t sentrai-bkp).db"
  # .backup takes a consistent snapshot even while the app holds the db open.
  sqlite3 "$SQLITE_PATH" ".backup '$tmp'"
  # Integrity gate: the snapshot must pass PRAGMA integrity_check before we keep it.
  ok="$(sqlite3 "$tmp" 'PRAGMA integrity_check;' | head -1)"
  if [ "$ok" != "ok" ]; then echo "[backup] ERROR: snapshot failed integrity_check ($ok)" >&2; rm -f "$tmp"; exit 1; fi
  gzip -c "$tmp" > "$db_file"; rm -f "$tmp"
  gzip -t "$db_file" || { echo "[backup] ERROR: dump failed gzip check — removing" >&2; rm -f "$db_file"; exit 1; }
else
  DB_HOST="${DB_HOST:-localhost}"; DB_PORT="${DB_PORT:-3306}"
  DB_USER="${DB_USER:-sentrai}"; DB_NAME="${DB_NAME:-sentrai_compliance}"
  # mysqldump reads MYSQL_PWD natively; mirror DB_PASSWORD into it when that's what's set.
  export MYSQL_PWD="${MYSQL_PWD:-${DB_PASSWORD:-}}"
  [ -n "${MYSQL_PWD}" ] || { echo "[backup] ERROR: no DB password in MYSQL_PWD or DB_PASSWORD" >&2; exit 1; }
  db_file="$BACKUP_DIR/sentrai-db-$stamp.sql.gz"
  echo "[backup] MariaDB ${DB_NAME}@${DB_HOST}:${DB_PORT} -> $db_file"
  mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    --single-transaction --quick --routines --triggers --events \
    "$DB_NAME" | gzip -c > "$db_file"
  # A dump that decompresses and ends cleanly is the minimum integrity check.
  if ! gzip -t "$db_file"; then
    echo "[backup] ERROR: dump failed gzip integrity check — removing" >&2
    rm -f "$db_file"; exit 1
  fi
fi

ws_file="$BACKUP_DIR/sentrai-workspaces-$stamp.tar.gz"
if [ -d "$WORKSPACES_DIR" ]; then
  echo "[backup] workspaces $WORKSPACES_DIR -> $ws_file"
  tar -czf "$ws_file" -C "$(dirname "$WORKSPACES_DIR")" "$(basename "$WORKSPACES_DIR")"
else
  echo "[backup] no workspaces dir at $WORKSPACES_DIR — skipping (scan results survive in the DB)"
fi

# Retention: prune backups older than N days.
find "$BACKUP_DIR" -maxdepth 1 -name 'sentrai-*' -type f -mtime "+${RETENTION_DAYS}" -delete || true

echo "[backup] OK ($(du -h "$db_file" | cut -f1) db). Latest in $BACKUP_DIR:"
ls -1t "$BACKUP_DIR" | head -4
