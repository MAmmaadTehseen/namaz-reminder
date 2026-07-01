#!/usr/bin/env bash
# Commit the dedupe markers under state/ back to the repo so exactly-once delivery
# survives stateless CI runs. Idempotent: exits cleanly when nothing changed, and
# retries with rebase if a concurrent run pushed first.
set -euo pipefail

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

if [[ -z "$(git status --porcelain state/)" ]]; then
  echo "commit-state: no changes"
  exit 0
fi

git add state/
git commit -m "chore(state): update namaz dedupe markers [skip ci]"

for attempt in 1 2 3; do
  if git push; then
    echo "commit-state: pushed on attempt ${attempt}"
    exit 0
  fi
  echo "commit-state: push rejected, rebasing (attempt ${attempt})"
  git pull --rebase --autostash origin "$(git rev-parse --abbrev-ref HEAD)"
done

echo "commit-state: failed to push after retries" >&2
exit 1
