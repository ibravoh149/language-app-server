# languageapp-backend

Monorepo for the two backend services:

| Service | Stack | Port |
|---|---|---|
| `apps/api` | NestJS | `3000` (public) |
| `apps/llm` | Python / FastAPI | `8000` (internal only) |

The NestJS API is the only service exposed to the outside world. The Python LLM service is internal — only `api` talks to it.

---

## Project structure

```
languageapp-backend/
├── apps/
│   ├── api/                    # NestJS — main API, public-facing
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── app.controller.ts
│   │   │   └── app.service.ts  # callLlm() proxies requests to Python service
│   │   └── Dockerfile
│   └── llm/                    # Python — LLM routing service, internal
│       ├── app/
│       │   ├── main.py
│       │   ├── config.py       # builds providers and router from env vars
│       │   ├── router.py       # maps task_type -> provider
│       │   ├── providers/
│       │   │   ├── base.py     # LLMProvider interface
│       │   │   ├── ollama.py   # local / self-hosted Ollama
│       │   │   └── deepseek.py # DeepSeek cloud API
│       │   └── routes/
│       │       ├── health.py
│       │       └── llm.py      # POST /llm/generate
│       └── Dockerfile
├── scripts/
│   └── ollama-entrypoint.sh    # auto-pulls model on first Ollama container start
├── docker-compose.yml          # dev
├── docker-compose.prod.yml     # prod overrides
└── .env.example
```

---

## Prerequisites

**For native development (recommended):**
- [Node.js](https://nodejs.org) 20+
- [Python](https://www.python.org) 3.12+
- [Ollama](https://ollama.com)

**For Docker development / production:**
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Ollama](https://ollama.com)

---

## Local development

You do not need Docker for day-to-day development. Running services natively gives you hot reload, faster startup, and easier debugging. Use Docker when you want to test services talking to each other, or when deploying.

| Scenario | Approach |
|---|---|
| Day-to-day development | Native |
| Testing inter-service communication | Docker Compose |
| Deploying | Docker Compose |

### Option A — Native (recommended for dev)

#### 1. Pull your model in Ollama

```bash
ollama list                       # check what you have
ollama pull qwen2.5-coder:14b     # pull if not present
```

#### 2. Create your env file

```bash
cp .env.example .env
```

Open `.env` and make two changes:

```bash
OLLAMA_MODEL=qwen2.5-coder:14b
LLM_SERVICE_URL=http://localhost:8000   # override the Docker hostname
```

#### 3. Start the Python LLM service

```bash
cd apps/llm
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

#### 4. Start the NestJS API (separate terminal)

```bash
cd apps/api
yarn install
yarn start:dev                   # hot reload on file changes
```

Services will be available at:
- NestJS API → `http://localhost:3000`
- Python LLM → `http://localhost:8000`

#### 5. Verify everything is running

```bash
# NestJS health check
curl http://localhost:3000/api/v1/health

# Python LLM health check
curl http://localhost:8000/health

# Test LLM generate endpoint
curl -X POST http://localhost:8000/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"task": "translation", "prompt": "Translate hello to French"}'
```

---

### Option B — Docker Compose

#### 1. Pull your model in Ollama

```bash
ollama list
ollama pull qwen2.5-coder:14b
```

#### 2. Create your env file

```bash
cp .env.example .env
```

Open `.env` and set:

```bash
OLLAMA_MODEL=qwen2.5-coder:14b
# LLM_SERVICE_URL stays as http://llm:8000 (Docker internal hostname)
```

#### 3. Start the stack

```bash
docker compose up --build
```

On subsequent starts (no code changes):

```bash
docker compose up
```

Services will be available at:
- NestJS API → `http://localhost:3000`
- Python LLM → internal only (not exposed outside Docker)

#### 4. Verify everything is running

```bash
# NestJS health check
curl http://localhost:3000/api/v1/health
```

---

## Useful Docker commands

```bash
# Start stack (build images first)
docker compose up --build

# Start stack (no rebuild)
docker compose up

# Start in background
docker compose up -d

# Stop stack
docker compose down

# Stop stack and remove volumes (wipes data)
docker compose down -v

# View logs for a specific service
docker compose logs -f api
docker compose logs -f llm

# Rebuild a single service
docker compose up --build api

# Open a shell inside a running container
docker compose exec api sh
docker compose exec llm sh
```

---

## LLM providers

Two providers are implemented. Both use the OpenAI-compatible API — same interface, different URLs.

| Provider | When to use | Config needed |
|---|---|---|
| `ollama` | Local dev, self-hosted prod | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| `deepseek` | Cloud prod | `DEEPSEEK_API_KEY` |

### Task routing

Every request to the LLM service includes a `task` field. The router maps each task to a provider using the `TASK_ROUTING` env var (JSON).

Available tasks: `translation`, `grammar_check`, `vocabulary`, `conversation`, `pronunciation_feedback`

**Dev — all tasks go to local Ollama:**

```bash
TASK_ROUTING={"translation":"ollama","grammar_check":"ollama","vocabulary":"ollama","conversation":"ollama","pronunciation_feedback":"ollama"}
```

**Prod early-stage — all tasks go to DeepSeek cloud:**

```bash
TASK_ROUTING={"translation":"deepseek","grammar_check":"deepseek","vocabulary":"deepseek","conversation":"deepseek","pronunciation_feedback":"deepseek"}
```

**Prod mixed — route by task:**

```bash
TASK_ROUTING={"translation":"deepseek","grammar_check":"ollama","vocabulary":"ollama","conversation":"deepseek","pronunciation_feedback":"ollama"}
```

Switching providers never requires a code change — only `.env` changes.

### Adding a new provider

1. Create `apps/llm/app/providers/<name>.py` implementing `LLMProvider`
2. Register it in `apps/llm/app/config.py` inside `build_router()`
3. Use its name as a value in `TASK_ROUTING`

---

## Production deployment

### Without self-hosted Ollama (early stage — recommended)

Use DeepSeek cloud API. Set in your production `.env`:

```bash
DEEPSEEK_API_KEY=your-key-here
TASK_ROUTING={"translation":"deepseek","grammar_check":"deepseek","vocabulary":"deepseek","conversation":"deepseek","pronunciation_feedback":"deepseek"}
```

Deploy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### With self-hosted Ollama (when you're ready)

1. Uncomment the `ollama` service block in `docker-compose.prod.yml`
2. Uncomment the `volumes` block at the bottom of `docker-compose.prod.yml`
3. Set in `.env`:

```bash
OLLAMA_BASE_URL=http://ollama:11434
OLLAMA_MODEL=deepseek-r1:14b       # or whichever model you want to self-host
```

4. Deploy:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

On first start, the `scripts/ollama-entrypoint.sh` script will automatically pull the model. This takes several minutes for large models. The Python LLM service will wait (via Docker healthcheck) until Ollama is ready before it starts.

To pull the model manually instead:

```bash
docker compose exec ollama ollama pull deepseek-r1:14b
```

The model is stored in the `ollama_data` Docker volume and persists across container restarts — it only downloads once per server.

### Prod Docker commands

```bash
# Start prod stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

# Stop prod stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# View prod logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f

# Pull Ollama model manually (only needed if entrypoint script is not used)
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec ollama ollama pull deepseek-r1:14b
```

---

## Environment variables reference

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | NestJS listen port |
| `NODE_ENV` | `development` | `development` or `production` |
| `LLM_SERVICE_URL` | `http://llm:8000` | Internal URL NestJS uses to reach Python service |
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama server URL. Use `http://ollama:11434` in prod |
| `OLLAMA_MODEL` | `deepseek-r1:14b` | Any model available in your Ollama instance |
| `DEEPSEEK_API_KEY` | _(empty)_ | DeepSeek cloud API key. Provider is disabled if empty |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek model name |
| `TASK_ROUTING` | all → `ollama` | JSON map of task name to provider name |

---

## Renaming the project

All occurrences of `languageapp` live in:

- `apps/api/package.json` → `name` field
- `apps/llm/app/main.py` → `title` field
- `docker-compose.yml` → network name
- `app.json` (mobile repo)

A search-and-replace across both repos is all that's needed.
