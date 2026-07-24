#!/usr/bin/env bash
#
# Stage the golden-path demo repo for beat 2 ("live scan"), so both demo paths
# are ready:
#
#   1. ALWAYS builds  demo-repo.zip  — the reliable upload fallback (wizard → Zip).
#   2. With --publish <owner/name>, creates a PUBLIC GitHub mirror and pushes the
#      demo repo to it, so the preferred live GitHub-import beat works. (You run
#      this; it publishes under your account via `gh`.)
#
# The demo repo intentionally contains a *fake* secret (WAREHOUSE_KEY) as a demo
# beat. It is not a real credential. If GitHub push-protection ever flags it,
# allow it for this demo repo, or just use the zip path.
#
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$here/repo"
OUT="${DEMO_ZIP_OUT:-$HOME/Desktop}"
PUBLISH=""

while [ $# -gt 0 ]; do
  case "$1" in
    --publish) PUBLISH="$2"; shift 2;;
    --out)     OUT="$2"; shift 2;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 0;;
    *) echo "unknown arg: $1" >&2; exit 1;;
  esac
done

[ -d "$SRC" ] || { echo "[stage] ERROR: demo repo not found at $SRC" >&2; exit 1; }

# 1. Build the zip fallback.
mkdir -p "$OUT"
zip_path="$OUT/demo-repo.zip"
rm -f "$zip_path"
( cd "$SRC" && zip -q -r "$zip_path" . -x '.*' )
echo "[stage] zip fallback ready: $zip_path ($(du -h "$zip_path" | cut -f1))"

# 2. Optionally publish the public GitHub mirror.
if [ -n "$PUBLISH" ]; then
  command -v gh >/dev/null || { echo "[stage] ERROR: gh CLI not found — install it or use the zip path" >&2; exit 1; }
  echo "[stage] publishing public mirror $PUBLISH …"
  tmp="$(mktemp -d)"
  cp -R "$SRC/." "$tmp/"
  ( cd "$tmp"
    git init -q
    git add -A
    git -c user.email=demo@sentrai.local -c user.name="SentRAI Demo" commit -qm "Meridian Finance retail lending platform (demo)"
    # Creates the repo under your account and pushes; --public is deliberate for the demo.
    gh repo create "$PUBLISH" --public --source=. --remote=origin --push
  )
  rm -rf "$tmp"
  echo "[stage] live-scan URL for beat 2:  https://github.com/$PUBLISH"
fi

echo "[stage] done. Beat 2 is covered by:"
echo "  · GitHub import → ${PUBLISH:+https://github.com/$PUBLISH}${PUBLISH:-'(run again with --publish owner/name)'}"
echo "  · Zip upload    → $zip_path"
