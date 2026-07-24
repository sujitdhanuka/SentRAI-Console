#!/usr/bin/env bash
#
# SentRAI production backup — MariaDB dump + workspaces archive.
#
# Timestamped, gzip-compressed, with N-day retention. Reads the SAME environment
# the app uses, so it "just works" on the server. The DB password is taken from
# MYSQL_PWD / DB_PASSWORD via the environment and never appears on a command line
# (so it can't leak into `ps`).
#
# The database dump is the critical artifact: scan results are persisted in the
# DB, so a lost workspaces directory does not lose discovery. Back up both, but
# if you must choose, the DB is the one that matters.
#
# Usage:
#   DB_HOST=... DB_USER=... MYSQL_PWD=... DB_NAME=... ./scripts/backup.sh
#   (or rely on the defaults / an env file you source first)
#
set -euo pipefail

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-sentrai}"
DB_NAME="${DB_NAME:-sentrai_compliance}"
# mysqldump reads MYSQL_PWD natively; mirror DB_PASSWORD into it when that's what's set.
export MYSQL_PWD="${MYSQL_PWD:-${DB_PASSWORD:-}}"

BACKUP_DIR="${SENTRAI_BACKUP_DIR:-$HOME/sentrai-backups}"
WORKSPACES_DIR="${WORKSPACES_DIR:-$(pwd)/workspaces}"
RETENTION_DAYS="${SENTRAI_BACKUP_RETENTION_DAYS:-7}"

if [ -z "${MYSQL_PWD}" ]; then
  echo "[backup] ERROR: no DB password in MYSQL_PWD or DB_PASSWORD" >&2
  exit 1
fi

stamp="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
db_file="$BACKUP_DIR/sentrai-db-$stamp.sql.gz"
ws_file="$BACKUP_DIR/sentrai-workspaces-$stamp.tar.gz"

echo "[backup] DB ${DB_NAME}@${DB_HOST}:${DB_PORT} -> $db_file"
mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
  --single-transaction --quick --routines --triggers --events \
  "$DB_NAME" | gzip -c > "$db_file"

# A dump that decompresses and ends cleanly is the minimum integrity check.
if ! gzip -t "$db_file"; then
  echo "[backup] ERROR: dump failed gzip integrity check — removing" >&2
  rm -f "$db_file"; exit 1
fi

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
