#!/usr/bin/env bash
# Deploy Ping Me to Google Cloud Run (run this inside Google Cloud Shell).
# Usage: ./deploy.sh [service-name] [region]
set -euo pipefail

SERVICE="${1:-ping-me}"
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

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --quiet

# Turn .env into a YAML env file (handles commas/special chars safely). PORT is set by Cloud Run.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
while IFS= read -r line || [ -n "$line" ]; do
  [[ -z "$line" || "$line" =~ ^# ]] && continue
  key="${line%%=*}"; val="${line#*=}"
  [[ "$key" == "PORT" ]] && continue
  printf '%s: "%s"\n' "$key" "$(printf '%s' "$val" | sed 's/\\/\\\\/g; s/"/\\"/g')" >> "$ENV_FILE"
done < .env

# One instance keeps realtime state (sockets, calls) in one place; session affinity + long
# timeout keep WebSockets alive; no CPU throttling lets scheduled/disappearing-message workers run.
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
