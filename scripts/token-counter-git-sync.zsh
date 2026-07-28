#!/bin/zsh

rebase_main_onto_origin() {
  if "$GIT" rebase origin/main; then
    return 0
  fi

  "$GIT" rebase --abort >/dev/null 2>&1 || true
  echo "Unable to rebase automated commits onto origin/main; rebase aborted."
  return 1
}

sync_main() {
  "$GIT" checkout main
  "$GIT" fetch origin main

  local ahead_count behind_count
  ahead_count="$("$GIT" rev-list --count origin/main..HEAD)"
  behind_count="$("$GIT" rev-list --count HEAD..origin/main)"

  if [[ "$behind_count" == "0" ]]; then
    return 0
  fi

  if [[ "$ahead_count" == "0" ]]; then
    echo "Fast-forwarding main by $behind_count remote commit(s)."
    "$GIT" merge --ff-only origin/main
    return 0
  fi

  echo "Rebasing $ahead_count local commit(s) onto $behind_count new remote commit(s)."
  rebase_main_onto_origin
}

push_main() {
  if "$GIT" push origin main; then
    return 0
  fi

  echo "Initial push failed; fetching and rebasing once before retrying."
  "$GIT" fetch origin main
  rebase_main_onto_origin
  "$GIT" push origin main
}
