FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git zsh \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
RUN node --check scripts/profile-publication-schedule.mjs \
    && zsh -n scripts/update-codex-token-counter.sh \
    && node scripts/verify-publication-schedule.mjs \
    && node scripts/verify-cumulative-usage.mjs \
    && node scripts/verify-codex-token-counter.mjs \
    && zsh scripts/verify-token-counter-git-sync.zsh
