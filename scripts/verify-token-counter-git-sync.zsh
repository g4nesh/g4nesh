#!/bin/zsh
set -euo pipefail

SCRIPT_PATH="${0:A}"
SCRIPT_DIR="${SCRIPT_PATH:h}"
GIT="$(command -v git)"
TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/profile-token-git-sync.XXXXXX")"

source "$SCRIPT_DIR/token-counter-git-sync.zsh"

cleanup() {
  rm -rf "$TEMP_ROOT"
}
trap cleanup EXIT

verify_fast_forward() {
  create_scenario fast-forward
  local scenario="$REPLY"
  commit_file "$scenario/publisher" remote.txt "remote\n" "Remote change"
  "$GIT" -C "$scenario/publisher" push origin main >/dev/null

  (
    cd "$scenario/worker"
    sync_main >/dev/null
  )

  assert_equal \
    "$("$GIT" -C "$scenario/worker" rev-parse HEAD)" \
    "$("$GIT" -C "$scenario/worker" rev-parse origin/main)" \
    "fast-forward did not reach origin/main"
  assert_equal \
    "$(<"$scenario/worker/remote.txt")" \
    "remote" \
    "fast-forward did not retain the remote file"
}

verify_diverged_rebase() {
  create_scenario diverged
  local scenario="$REPLY"
  commit_file "$scenario/worker" local.txt "local\n" "Local automation change"
  commit_file "$scenario/publisher" remote.txt "remote\n" "Remote README change"
  "$GIT" -C "$scenario/publisher" push origin main >/dev/null

  (
    cd "$scenario/worker"
    sync_main >/dev/null
  )

  assert_equal \
    "$("$GIT" -C "$scenario/worker" rev-list --count HEAD..origin/main)" \
    "0" \
    "rebased checkout is still behind"
  assert_equal \
    "$("$GIT" -C "$scenario/worker" rev-list --count origin/main..HEAD)" \
    "1" \
    "rebased checkout lost its local commit"
  [[ -f "$scenario/worker/local.txt" && -f "$scenario/worker/remote.txt" ]]
}

verify_push_race_retry() {
  create_scenario push-race
  local scenario="$REPLY"
  commit_file "$scenario/worker" local.txt "local\n" "Local automation change"
  commit_file "$scenario/publisher" remote.txt "remote\n" "Concurrent remote change"
  "$GIT" -C "$scenario/publisher" push origin main >/dev/null

  (
    cd "$scenario/worker"
    push_main >/dev/null 2>&1
  )

  assert_equal \
    "$("$GIT" -C "$scenario/worker" rev-parse HEAD)" \
    "$("$GIT" --git-dir="$scenario/origin.git" rev-parse refs/heads/main)" \
    "push retry did not publish the rebased commit"
  [[ -f "$scenario/worker/remote.txt" ]]
}

verify_conflict_abort() {
  create_scenario conflict
  local scenario="$REPLY"
  commit_file "$scenario/worker" README.md "local\n" "Local conflicting change"
  local local_head="$("$GIT" -C "$scenario/worker" rev-parse HEAD)"
  commit_file "$scenario/publisher" README.md "remote\n" "Remote conflicting change"
  "$GIT" -C "$scenario/publisher" push origin main >/dev/null

  if (
    cd "$scenario/worker"
    sync_main >/dev/null 2>&1
  ); then
    echo "conflicting rebase unexpectedly succeeded"
    exit 1
  fi

  assert_equal \
    "$("$GIT" -C "$scenario/worker" rev-parse HEAD)" \
    "$local_head" \
    "conflict abort did not restore the local commit"
  assert_equal \
    "$("$GIT" -C "$scenario/worker" status --porcelain)" \
    "" \
    "conflict abort left the checkout dirty"
}

create_scenario() {
  local name="$1"
  local scenario="$TEMP_ROOT/$name"
  mkdir -p "$scenario"
  "$GIT" init --bare --initial-branch=main "$scenario/origin.git" >/dev/null
  "$GIT" clone "$scenario/origin.git" "$scenario/seed" >/dev/null 2>&1
  configure_repo "$scenario/seed"
  commit_file "$scenario/seed" README.md "initial\n" "Initial commit"
  "$GIT" -C "$scenario/seed" push -u origin main >/dev/null
  "$GIT" clone "$scenario/origin.git" "$scenario/worker" >/dev/null 2>&1
  "$GIT" clone "$scenario/origin.git" "$scenario/publisher" >/dev/null 2>&1
  configure_repo "$scenario/worker"
  configure_repo "$scenario/publisher"
  REPLY="$scenario"
}

configure_repo() {
  local repo="$1"
  "$GIT" -C "$repo" config user.name "Git sync verifier"
  "$GIT" -C "$repo" config user.email "git-sync-verifier@example.invalid"
}

commit_file() {
  local repo="$1"
  local relative_path="$2"
  local content="$3"
  local message="$4"
  printf '%b' "$content" > "$repo/$relative_path"
  "$GIT" -C "$repo" add "$relative_path"
  "$GIT" -C "$repo" commit -m "$message" >/dev/null
}

assert_equal() {
  local actual="$1"
  local expected="$2"
  local message="$3"
  if [[ "$actual" != "$expected" ]]; then
    echo "$message: expected $expected, got $actual"
    exit 1
  fi
}

verify_fast_forward
verify_diverged_rebase
verify_push_race_retry
verify_conflict_abort

echo "Verified profile fast-forward, diverged rebase, push-race retry, and conflict abort."
