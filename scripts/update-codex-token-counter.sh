#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
REPO="${SCRIPT_DIR:h}"
NODE="${NODE:-/usr/local/bin/node}"
GIT="${GIT:-/usr/bin/git}"
LOG_DIR="${GITHUB_PROFILE_TOKEN_COUNTER_LOG_DIR:-$HOME/.local/state/github-profile-token-counter}"
STATE_DIR="${TOKEN_COUNTER_STATE_DIR:-$LOG_DIR}"
SUCCESS_FILE="$STATE_DIR/last-success-date"
LOCK_DIR="$STATE_DIR/token-counter.lock"
LOCK_STALE_SECONDS="${TOKEN_COUNTER_LOCK_STALE_SECONDS:-1800}"
FORCE_RUN="${TOKEN_COUNTER_FORCE:-0}"

if [[ "${1:-}" == "--force" ]]; then
  FORCE_RUN=1
fi

export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ="${TZ:-America/Phoenix}"
export TOKEN_COUNTER_START_DATE="${TOKEN_COUNTER_START_DATE:-2026-01-01}"
export CODEX_USAGE_SPEED="${CODEX_USAGE_SPEED:-fast}"
export CCUSAGE_VERSION="${CCUSAGE_VERSION:-20.0.14}"
export GIT_TERMINAL_PROMPT=0

mkdir -p "$LOG_DIR" "$STATE_DIR"

if [[ "${TOKEN_COUNTER_FOREGROUND:-0}" != "1" ]]; then
  exec >>"$LOG_DIR/token-counter.out.log" 2>>"$LOG_DIR/token-counter.err.log"
fi

echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter start ===="

if [[ -d "$LOCK_DIR" ]]; then
  now="$(date +%s)"
  lock_mtime="$(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0)"
  if (( now - lock_mtime > LOCK_STALE_SECONDS )); then
    echo "Removing stale token counter lock."
    rm -rf "$LOCK_DIR"
  fi
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another token counter update is already running."
  exit 0
fi

cleanup() {
  rm -rf "$LOCK_DIR" 2>/dev/null || true
}
trap cleanup EXIT

push_main() {
  if "$GIT" push origin main; then
    return 0
  fi

  echo "Initial push failed; fetching and rebasing once before retrying."
  "$GIT" fetch origin main
  if ! "$GIT" rebase origin/main; then
    "$GIT" rebase --abort || true
    echo "Unable to rebase token counter commit onto origin/main."
    return 1
  fi
  "$GIT" push origin main
}

pending_commit_is_today_token_update() {
  local subject commit_date
  subject="$("$GIT" log -1 --format=%s)"
  commit_date="$("$GIT" log -1 --date=format-local:'%Y-%m-%d' --format=%ad)"
  [[ "$subject" == "Update Codex token counter" && "$commit_date" == "$today" ]]
}

today="$(date '+%Y-%m-%d')"
if [[ "$FORCE_RUN" != "1" && -f "$SUCCESS_FILE" ]] && grep -qx "$today" "$SUCCESS_FILE"; then
  echo "Profile token counter already completed for $today; skipping."
  echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter complete ===="
  exit 0
fi

cd "$REPO"

"$GIT" config user.name "${TOKEN_COUNTER_GIT_NAME:-MacBook token updater}"
"$GIT" config user.email "${TOKEN_COUNTER_GIT_EMAIL:-g4nesh@users.noreply.github.com}"

if [[ -n "$("$GIT" status --porcelain --untracked-files=no)" ]]; then
  echo "Tracked working tree is dirty; aborting before automation."
  "$GIT" status --short
  exit 1
fi

"$GIT" fetch origin main
"$GIT" checkout main

behind_count="$("$GIT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
if [[ "$behind_count" != "0" ]]; then
  echo "Pulling $behind_count remote commit(s)."
  "$GIT" pull --ff-only origin main
fi

ahead_count="$("$GIT" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [[ "$ahead_count" != "0" ]]; then
  echo "Pushing $ahead_count pending local commit(s) before update."
  push_main
  if pending_commit_is_today_token_update; then
    printf '%s\n' "$today" > "$SUCCESS_FILE"
    echo "Recovered today's pending token counter commit; no second daily update is needed."
    "$GIT" status --short --branch
    echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter complete ===="
    exit 0
  fi
fi

"$NODE" scripts/update-codex-token-counter.mjs --no-push

ahead_count="$("$GIT" rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [[ "$ahead_count" != "0" ]]; then
  echo "Pushing $ahead_count new token counter commit(s)."
  push_main
else
  echo "No token counter commit to push."
fi

printf '%s\n' "$today" > "$SUCCESS_FILE"
"$GIT" status --short --branch
echo "Profile token counter successfully completed for $today."
echo "==== $(date -u '+%Y-%m-%dT%H:%M:%SZ') profile token counter complete ===="
