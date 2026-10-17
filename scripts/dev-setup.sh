#!/usr/bin/env bash
# One-time local setup for running the backend against the phone.
#
#   scripts/dev-setup.sh
#
# Safe to re-run. It:
#   1. creates .env from .env.example if missing (random JWT/code secrets, native
#      service URLs, and a free Postgres host port if 5432 is taken),
#   2. starts the Compose Postgres container,
#   3. installs API dependencies, runs migrations and seeds reference data,
#   4. prints how to start everything and what the phone's API URL is.
# An existing .env is never overwritten.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

port_in_use() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1 || nc -z localhost "$1" >/dev/null 2>&1; }
set_env() { # set_env KEY VALUE (replaces an existing line or appends)
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    echo "$1=$2" >> .env
  fi
}
get_env() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }

if [[ ! -f .env ]]; then
  echo "→ creating .env"
  cp .env.example .env
  set_env JWT_ACCESS_SECRET "$(openssl rand -base64 48 | tr -d '\n=+/')"
  set_env CODE_HMAC_SECRET "$(openssl rand -base64 32 | tr -d '\n=+/')"
  set_env LLM_SERVICE_URL http://localhost:8000
  set_env AUDIO_SERVICE_URL http://localhost:8001
  set_env OLLAMA_BASE_URL http://localhost:11434
  # Reuse the port of our own Postgres container if it's already running.
  PG_PORT=$(docker compose -p languageapp-backend port postgres 5432 2>/dev/null | awk -F: '{print $NF}' || true)
  if [[ -n $PG_PORT ]]; then
    echo "  reusing the running Postgres container on port $PG_PORT"
  elif ! port_in_use 5432; then
    PG_PORT=5432
  else
    for p in 5434 5435 5436 5437; do port_in_use "$p" || { PG_PORT=$p; break; }; done
    [[ -n $PG_PORT ]] || { echo "no free Postgres port found (5432-5437)" >&2; exit 1; }
    echo "  port 5432 is taken; using $PG_PORT for Postgres"
  fi
  set_env POSTGRES_PORT "$PG_PORT"
  set_env DATABASE_URL "postgresql://languageapp:languageapp@localhost:$PG_PORT/languageapp"
else
  echo "→ .env exists, leaving it as is"
fi

echo "→ starting Postgres"
docker compose -p languageapp-backend up -d postgres >/dev/null
for _ in $(seq 1 30); do
  docker compose -p languageapp-backend exec -T postgres pg_isready -U languageapp >/dev/null 2>&1 && break
  sleep 1
done

echo "→ installing API dependencies, migrating, seeding"
(cd apps/api && yarn install --silent && yarn -s db:migrate && yarn -s db:seed)

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "<your-mac-ip>")
MODEL=$(get_env OLLAMA_MODEL)
cat <<EOF

✓ Backend ready.

Start it (two terminals):
  1. LLM service (Docker, uses Ollama on this Mac):  scripts/dev-llm.sh
     Needs the model once:                          ollama pull ${MODEL:-qwen2.5:7b}
  2. API with hot reload:                           cd apps/api && yarn start:dev

Phone (languageapp-mobile/.env):
  EXPO_PUBLIC_API_URL=http://$IP:3000/api/v1

Verification and reset codes appear in the API terminal as:
  [dev-email] verify code for you@example.com: 123456
EOF
