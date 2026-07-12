#!/bin/sh
set -e

# Start Ollama server in background
ollama serve &
SERVER_PID=$!

# Wait until the server is accepting requests
echo "Waiting for Ollama to start..."
until ollama list > /dev/null 2>&1; do
  sleep 1
done

# Pull model only if not already downloaded (volume persists this across restarts)
if ! ollama list | grep -q "${OLLAMA_MODEL}"; then
  echo "Pulling model: ${OLLAMA_MODEL}"
  ollama pull "${OLLAMA_MODEL}"
else
  echo "Model ${OLLAMA_MODEL} already present, skipping pull"
fi

echo "Ollama ready"

# Hand back to server process
wait $SERVER_PID
