#!/bin/zsh
set -u

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
REPO="${SCRIPT_DIR:h}"
NODE="/usr/local/bin/node"
GIT="/usr/bin/git"
LOG_DIR="/Users/ganeshtalluri/.local/state/github-profile-token-counter"
LOCK_DIR="$LOG_DIR/token-counter.lock"

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="${TZ:-America/Phoenix}"
export TOKEN_COUNTER_START_DATE="${TOKEN_COUNTER_START_DATE:-2026-01-01}"
export GIT_TERMINAL_PROMPT=0

mkdir -p "$LOG_DIR"
exec >>"$LOG_DIR/token-counter.out.log" 2>>"$LOG_DIR/token-counter.err.log"

echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter start ===="

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another token counter update is already running."
  exit 0
fi

cleanup() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

cd "$REPO" || exit 1

if [ -n "$("$GIT" status --porcelain --untracked-files=no)" ]; then
  echo "Tracked working tree is dirty; aborting before automation."
  "$GIT" status --short
  exit 1
fi

"$GIT" fetch origin main || {
  echo "Unable to fetch origin/main."
  exit 1
}

"$GIT" checkout main

behind_count="$("$GIT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
if [ "$behind_count" != "0" ]; then
  echo "Pulling $behind_count remote commit(s)."
  "$GIT" pull --ff-only origin main
fi

ahead_count="$("$GIT" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [ "$ahead_count" != "0" ]; then
  echo "Pushing $ahead_count pending local commit(s) before update."
  "$GIT" push origin main
fi

"$NODE" scripts/update-codex-token-counter.mjs --no-push
script_status=$?
if [ "$script_status" -ne 0 ]; then
  echo "Token counter script failed with status $script_status."
  exit "$script_status"
fi

ahead_count="$("$GIT" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [ "$ahead_count" != "0" ]; then
  echo "Pushing $ahead_count new token counter commit(s)."
  "$GIT" push origin main
else
  echo "No token counter commit to push."
fi

"$GIT" status --short --branch
echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter complete ===="
