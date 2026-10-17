#!/usr/bin/env bash
# Run the LLM service in Docker on port 8000, talking to Ollama on this Mac.
# Use this when the local Python is older than 3.10 (macOS ships 3.9).
#
#   scripts/dev-llm.sh            # foreground; Ctrl+C stops it
#
# Reads OLLAMA_MODEL, DEEPSEEK_API_KEY, DEEPSEEK_MODEL and TASK_ROUTING from .env.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
[[ -f .env ]] || { echo "No .env — run scripts/dev-setup.sh first" >&2; exit 1; }
# Read single keys without sourcing .env (TASK_ROUTING is JSON and would break `source`).
get_env() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }

docker build -q -t languageapp-llm:dev apps/llm >/dev/null
echo "LLM service on http://localhost:8000 (model: $(get_env OLLAMA_MODEL))"
exec docker run --rm --name languageapp-llm-dev -p 8000:8000 \
  -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
  -e OLLAMA_MODEL="$(get_env OLLAMA_MODEL)" \
  -e DEEPSEEK_API_KEY="$(get_env DEEPSEEK_API_KEY)" \
  -e DEEPSEEK_MODEL="$(get_env DEEPSEEK_MODEL)" \
  -e TASK_ROUTING="$(get_env TASK_ROUTING)" \
  languageapp-llm:dev
