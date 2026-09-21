# GitHub profile repository

The token-counter LaunchAgent publishes OpenAI account usage across devices.
Keep its persistent publication policy scoped to this repository; do not
change Portfolio or other publishers as a side effect.

Use `docker build --tag github-profile:verify .` for isolated verification.
The Node.js 22 image installs Git and zsh inside the container only. The
equivalent local checks are documented in `launchd/README.md` for environments
where Docker is unavailable. Do not install host packages.

Keep local publication state, logs, and usage archives outside Git. Never
reset schedule state to retry a failed update or bypass the scheduling gate.
The preview command is read-only; wrapper execution may commit and push.
