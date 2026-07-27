# GitHub profile token-counter LaunchAgent

`com.ganeshtalluri.github-profile-token-counter` runs at login and once per
hour. A Phoenix-date success marker limits publishing to one successful update
per day. If a commit could not be pushed, a later invocation retries it before
generating another update.

The output uses cumulative machine snapshots. The existing GitHub data is the
legacy baseline; `ganstlr-macbook-2026` is refreshed by subtracting its prior
snapshot and adding its latest local snapshot. Repeated runs are therefore
idempotent, and the public total cannot reset merely because this Mac does not
contain the old Mac's private Codex session archive.

## Runtime

This Mac uses:

```text
Repository: /Users/ganstlr/.local/share/github-profile-token-counter/g4nesh
Tools:      /Users/ganstlr/.local/share/codex-usage-tools
State/logs: /Users/ganstlr/.local/state/github-profile-token-counter
```

The LaunchAgent supplies absolute paths for Node, Git, Python with Pillow, and
the pinned `ccusage` 20.0.14 CLI. It does not depend on interactive shell
configuration. GitHub authentication is provided by GitHub CLI's Git
credential helper.

The tools directory currently points to the Codex-bundled Node, Git, and Python
distributions. Recreate those links if the Codex runtime cache is removed or
relocated.

## Safe manual test

The generator can be run without committing or pushing:

```zsh
cd /Users/ganstlr/.local/share/github-profile-token-counter/g4nesh
CCUSAGE_COMMAND="/Users/ganstlr/.local/share/codex-usage-tools/runtime/node/bin/node /Users/ganstlr/.local/share/codex-usage-tools/node_modules/ccusage/src/cli.js" \
PYTHON_WITH_PIL="/Users/ganstlr/.local/share/codex-usage-tools/runtime/python/bin/python3" \
PATH="/Users/ganstlr/.local/share/codex-usage-tools/runtime/bin/fallback:/Users/ganstlr/.local/share/codex-usage-tools/runtime/node/bin:/Users/ganstlr/.local/bin:/usr/bin:/bin:/usr/sbin:/sbin" \
/Users/ganstlr/.local/share/codex-usage-tools/runtime/node/bin/node \
  scripts/update-codex-token-counter.mjs --no-commit --no-push
```

Review `git status --short`, then restore the generated README, JSON, SVG, and
GIF files if the test should not be retained.

To exercise the daily wrapper without suppressing output:

```zsh
TOKEN_COUNTER_FOREGROUND=1 TOKEN_COUNTER_FORCE=1 \
  scripts/update-codex-token-counter.sh --force
```

That wrapper invocation can commit and push. Use the generator-only command
above for a non-publishing test.

## Install and inspect

The installed plist belongs at:

```text
/Users/ganstlr/Library/LaunchAgents/com.ganeshtalluri.github-profile-token-counter.plist
```

Validate and load it with:

```zsh
plutil -lint launchd/com.ganeshtalluri.github-profile-token-counter.plist
launchctl bootstrap "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.ganeshtalluri.github-profile-token-counter.plist"
launchctl print "gui/$(id -u)/com.ganeshtalluri.github-profile-token-counter"
```

`RunAtLoad` starts the wrapper immediately and may commit and push if today's
success marker is absent.

To unload it:

```zsh
launchctl bootout \
  "gui/$(id -u)/com.ganeshtalluri.github-profile-token-counter"
```

LaunchAgent stdout/stderr and wrapper logs are written below
`~/.local/state/github-profile-token-counter/`.
