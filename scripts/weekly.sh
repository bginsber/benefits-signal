#!/bin/zsh
# Benefits Signal — weekly pipeline run on Ben's Mac (spec § 2 cadence; goal § 3 M3–M5).
#
# Collect → triage → cluster/verify/assess → candidate digest, with the model
# stages running through the Claude Code CLI on the Claude subscription (no
# API key). The digest and review feed are copied into public/ and pushed, so
# the daily GitHub Pages deploy carries them to the review feed in Outlook.
# Publishing an issue stays manual: fill data/reviews/<issue>.json, then
#   node scripts/publish.mjs --issue <date> && git add public/issue.json && git commit && git push
#
# Installed by scripts/install-schedule.sh (launchd, Tuesdays 18:00 local).
# Run by hand any time: scripts/weekly.sh [--no-push]

set -euo pipefail
REPO="${BENEFITS_SIGNAL_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO"
export PATH="${BENEFITS_SIGNAL_PATH:-$PATH}"
export FEED_URL="${FEED_URL:-https://bginsber.github.io/benefits-signal/collated.xml}"
export BENEFITS_SIGNAL_MODEL=claude-code
mkdir -p data/logs
LOG="data/logs/weekly-$(date +%Y-%m-%d-%H%M).log"
exec > >(tee -a "$LOG") 2>&1
echo "== Benefits Signal weekly run $(date) in $REPO"
command -v node >/dev/null || { echo "node not on PATH ($PATH)"; exit 1; }
command -v claude >/dev/null || { echo "claude CLI not on PATH ($PATH)"; exit 1; }

echo "-- collect (30-day window)"
node scripts/collect.mjs --days 30

echo "-- triage (Claude Code, batched)"
node scripts/triage.mjs --claude-code

echo "-- cluster, verify, assess (Claude Code)"
node scripts/assess.mjs --claude-code --open public/issue.json

echo "-- candidate digest and review feed"
node scripts/digest.mjs --feed public/review.xml
ISSUE=$(node -e 'import("./scripts/lib/digest.mjs").then(m=>console.log(m.nextIssueDate()))')
mkdir -p public/digests
cp "data/digests/${ISSUE}.html" public/digests/ 2>/dev/null || true
node scripts/digest.mjs --trustee-agenda >/dev/null || true

echo "-- summary"
node -e '
const l=require("./data/run-log.json");
const t=l.triage??{}, a=l.assess??{};
console.log(`triage: ${t.assessed??0} assessed, ${t.matched??0} matched, ${t.omitted??0} omitted, ${t.skipped??0} skipped; per scan ${JSON.stringify(t.per_scan??{})}; ${t.usage?.calls??0} calls`);
console.log(`assess: ${a.candidates??0} candidates from ${a.clusters??0} clusters; tiers ${JSON.stringify(a.tiers??{})}; verification ${JSON.stringify(a.verified??{})}`);'

if [[ "${1:-}" != "--no-push" ]]; then
  echo "-- push review feed and digest to GitHub (Pages deploys them)"
  git add public/review.xml public/digests/ 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git commit -q -m "Weekly run $(date +%Y-%m-%d): candidate digest for the issue of ${ISSUE}" -m "Automated by scripts/weekly.sh on $(hostname)."
    git push -q origin main && echo "pushed"
  else
    echo "nothing new to push"
  fi
fi
echo "== done $(date); review file: data/reviews/${ISSUE}.json; digest: data/digests/${ISSUE}.md"
