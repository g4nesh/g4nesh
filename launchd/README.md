# GitHub profile token-counter LaunchAgent

`com.ganeshtalluri.github-profile-token-counter` checks at login and once per
hour. A persistent local schedule permits at most one publishing attempt on
an eligible date, after a varied time between 10:00 and 21:00 America/Phoenix.
Actual execution is on the next hourly check while the Mac is awake, before
23:00. Later checks let that date expire.

- Weekdays have one possible update, with roughly 15% left unscheduled.
- Each weekend selects either Saturday or Sunday, allowing at most one update
  across the entire weekend. A pause or a missed selected date can yield zero.
- Short pauses last 4–5 calendar days, separated by 25–50 days.
- The first 14-day pause starts 120–240 days after initialization. Later long
  pauses start 180–365 days after the preceding long pause ends.
- Long pauses take priority over short pauses and weekend publication.

The random seed and start date live in `publication-schedule.json` under the
state directory. Restarts and repeated checks preserve the plan. Missed dates
expire; there is no burst of catch-up commits. The next eligible update still
collects cumulative usage, including usage accumulated during pauses.

The wrapper acquires its existing lock and reserves an eligible date before
any Git operation. A failed or interrupted attempt consumes that date. On the
next eligible date, pending commits are pushed without generating another
update. Corrupt state stops publication rather than silently resetting the
schedule. Initialization imports `last-success-date` to avoid repeating an
update already completed that day. The old `--force` and `TOKEN_COUNTER_FORCE`
options no longer bypass scheduling; direct generator use remains available.

This policy applies only to this profile counter. It does not change Portfolio,
other repositories, manual commits, or GitHub Actions. Author information,
commit messages, and real commit timestamps remain unchanged.

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

To preview the next 366 days without generating data or publishing, after the
state has been initialized:

```zsh
node scripts/profile-publication-schedule.mjs --preview \
  "$HOME/.local/state/github-profile-token-counter/publication-schedule.json"
```

The preview is read-only. Each row describes a date's eligibility and planned
time, not a guarantee of a commit: the Mac must be awake and the updater must
succeed. To initialize once without publishing, use `--initialize` with the
same state path (its parent directory must exist). Do not delete schedule state
to retry a failed update, since that would reset the persistent plan.

To run the wrapper with visible logs while respecting the schedule:

```zsh
TOKEN_COUNTER_FOREGROUND=1 scripts/update-codex-token-counter.sh
```

That wrapper invocation can commit and push on an eligible date. Use the
read-only preview or generator-only command above for a non-publishing test.

## Verification

Use `docker build --tag github-profile:verify .` for the container checks. With
Node.js 22 or newer, Git, and zsh already available, the equivalent checks are:

```zsh
node --check scripts/profile-publication-schedule.mjs
zsh -n scripts/update-codex-token-counter.sh
node scripts/verify-publication-schedule.mjs
node scripts/verify-cumulative-usage.mjs
node scripts/verify-codex-token-counter.mjs
zsh scripts/verify-token-counter-git-sync.zsh
```

The schedule verifier simulates two years for 12 seeds and checks weekend
limits, both short pause lengths, long pauses, timezone boundaries, durable
reservations, migration, preview immutability, and wrapper refusal before Git.

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

`RunAtLoad` starts the wrapper immediately, but publication occurs only when
the persistent schedule allows it. The installed plist stays hourly; the
schedule is enforced inside the wrapper, including manual starts.

To unload it:

```zsh
launchctl bootout \
  "gui/$(id -u)/com.ganeshtalluri.github-profile-token-counter"
```

LaunchAgent stdout/stderr and wrapper logs are written below
`~/.local/state/github-profile-token-counter/`.
