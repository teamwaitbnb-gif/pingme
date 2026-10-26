#!/usr/bin/env bash
# Deploy Ping Me to Google Cloud Run (run this inside Google Cloud Shell).
# Usage: ./deploy.sh [service-name] [region]
set -euo pipefail

SERVICE="${1:-pingme}"
REGION="${2:-asia-south1}"
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  echo "No .env found. Copy your .env into this folder (or run: npm run setup, then fill in DB_* values)." >&2
  exit 1
fi

PROJECT="$(gcloud config get-value project 2>/dev/null)"
if [ -z "$PROJECT" ]; then
  echo "No Google Cloud project selected. Run: gcloud config set project YOUR_PROJECT_ID" >&2
  exit 1
fi
echo "Project: $PROJECT  Service: $SERVICE  Region: $REGION"
if ! grep -qE '^MEDIA_BUCKET=.+' .env; then
  echo "WARNING: MEDIA_BUCKET is not set in .env — photos and videos are stored in MySQL and can fill the database disk." >&2
fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --quiet

# Turn .env into a YAML env file (handles commas/special chars safely). PORT is set by Cloud Run.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
while IFS= read -r line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  [[ "$key" == "PORT" ]] && continue
  # A key listed twice in .env: the last one wins (same as the app's own .env loading).
  if grep -q "^${key}: " "$ENV_FILE" 2>/dev/null; then sed -i.bak "/^${key}: /d" "$ENV_FILE" && rm -f "$ENV_FILE.bak"; fi
  printf '%s: "%s"\n' "$key" "$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')" >> "$ENV_FILE"
done < .env

# One instance keeps realtime state (sockets, calls) in one place; session affinity + long
# timeout keep WebSockets alive; no CPU throttling lets scheduled/disappearing-message workers run.
# Stamp this release so people can see which version they're on (Settings → About Ping Me).
node -e '
const { execSync } = require("child_process");
const run = (c) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch { return ""; } };
const v = { commit: run("git rev-parse --short HEAD"), date: run("git log -1 --format=%cI"), title: run("git log -1 --format=%s"), deployedAt: new Date().toISOString() };
require("fs").writeFileSync("server/version.json", JSON.stringify(v));
console.log("Release:", v.commit, "-", v.title);
'

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --env-vars-file "$ENV_FILE" \
  --min-instances 1 \
  --max-instances 1 \
  --concurrency 1000 \
  --session-affinity \
  --timeout 3600 \
  --no-cpu-throttling \
  --cpu 1 \
  --memory 1Gi \
  --quiet

URL="$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')"
echo ""
echo "✅ Ping Me is live: $URL"
echo "   Open it on your phone and add it to your Home Screen."
