# languageapp-backend

Backend for **Sprachbar**, a speaking-first language-learning app. The mobile
client lives in [language-app-mobile](https://github.com/ibravoh149/language-app-mobile).

This repository is a small monorepo with three services and a PostgreSQL
database, all runnable natively for development or together with Docker Compose.

| Service | Stack | Port | Exposure | Responsibility |
|---|---|---|---|---|
| [`apps/api`](apps/api) | NestJS 10, Drizzle ORM | `3000` | **Public** | Gateway for the mobile app: routing, persistence, and (soon) auth and profiles |
| [`apps/llm`](apps/llm) | Python 3.12, FastAPI | `8000` | Internal | Task-based LLM routing to Ollama or DeepSeek |
| [`apps/audio`](apps/audio) | Python 3.12, FastAPI | `8001` | Internal | Speech-to-text (Faster-Whisper) and text-to-speech (Kokoro, Piper) |
| `postgres` | PostgreSQL 16 | `5432` | Internal | Application data |

```text
                       ┌──────────────────────────────┐
  Mobile app ──HTTP──▶ │  api  (NestJS, /api/v1)      │ ──▶ PostgreSQL
                       └──────┬────────────────┬──────┘
                              │                │
                     ┌────────▼──────┐  ┌──────▼─────────┐
                     │ llm (FastAPI) │  │ audio (FastAPI)│
                     │ Ollama │ Deep │  │ Whisper·Kokoro │
                     │ Seek          │  │ Piper          │
                     └───────────────┘  └────────────────┘
```

The mobile app only ever talks to `api`. The Python services are never exposed
to clients, and provider names and credentials stay inside the backend.

> **Project status — early development.** The service skeletons, provider
> routing and speech adapters work, but there is no authentication, request
> validation or rate limiting yet, and the database only holds a minimal
> `users` table. Do not expose this stack publicly as-is. See
> [Known limitations](#known-limitations).

---

## Contents

- [Quick start](#quick-start)
- [Local development (native)](#local-development-native)
- [Local development (Docker)](#local-development-docker)
- [Database](#database)
- [Configuration](#configuration)
- [API reference](#api-reference)
- [LLM providers and task routing](#llm-providers-and-task-routing)
- [Speech engines](#speech-engines)
- [Production deployment](#production-deployment)
- [Project structure](#project-structure)
- [Extending the backend](#extending-the-backend)
- [Known limitations](#known-limitations)

---

## Quick start

The fastest route to a running stack, assuming Docker Desktop and
[Ollama](https://ollama.com) are installed:

```bash
ollama pull qwen2.5:7b             # or any chat model you prefer
cp .env.example .env               # then set OLLAMA_MODEL to that model
docker compose up --build
curl http://localhost:3000/api/v1/health
```

The first start of the audio service downloads Whisper and Kokoro models
(roughly 800 MB) and the default German Piper voice. Follow progress with
`docker compose logs -f audio`.

---

## Local development (native)

Running each service natively gives hot reload and easier debugging. It is the
recommended day-to-day setup.

### Prerequisites

| Tool | Version | Used by |
|---|---|---|
| Node.js + Yarn | 20+ | `api` |
| Python | 3.12+ | `llm`, `audio` |
| PostgreSQL | 16 recommended | `api` |
| Ollama | latest | `llm` (unless you route everything to DeepSeek) |
| `espeak-ng`, `ffmpeg` | any recent | `audio` (phonemisation and audio decoding) |

```bash
brew install espeak-ng ffmpeg       # macOS
```

### 1. Configure the environment

```bash
cp .env.example .env
```

For native development, point the gateway at `localhost` instead of the Docker
hostnames, and set your database and model:

```bash
DATABASE_URL=postgresql://<user>@localhost:5432/languageapp
LLM_SERVICE_URL=http://localhost:8000
AUDIO_SERVICE_URL=http://localhost:8001
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b
```

### 2. Create the database

```bash
createdb languageapp
cd apps/api && yarn install && yarn db:push
```

### 3. Start the services (one terminal each)

> The Python services need **Python 3.10+** (3.12 recommended). macOS ships
> 3.9, so either `brew install python@3.12` and create the venvs with
> `python3.12 -m venv .venv`, or run a Python service in Docker instead:
> ```bash
> docker build -t languageapp-llm apps/llm
> docker run --rm -p 8000:8000 -e OLLAMA_BASE_URL=http://host.docker.internal:11434 \
>   -e OLLAMA_MODEL=qwen2.5:7b languageapp-llm
> ```

```bash
# LLM service
cd apps/llm
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# Audio service — first start downloads models
cd apps/audio
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

```bash
# API gateway
cd apps/api
yarn start:dev
```

Each Python service keeps its own `.venv`; never share virtual environments
between them.

### 4. Verify

```bash
curl http://localhost:3000/api/v1/health    # {"status":"ok","service":"api"}
curl http://localhost:8000/health           # {"status":"ok","service":"llm"}
curl http://localhost:8001/health           # {"status":"ok","service":"audio"}
```

---

## Local development (Docker)

Use Compose to exercise the services together or to mirror deployment.
Ollama still runs on your host in development; containers reach it through
`host.docker.internal:11434`.

```bash
cp .env.example .env
docker compose up --build        # first run, or after code changes
docker compose up -d             # background
docker compose logs -f audio     # follow one service
docker compose exec api sh       # shell into a container
docker compose down              # stop
docker compose down -v           # stop and delete volumes (database + model cache)
```

Only port `3000` (API) and `5432` (Postgres) are published to the host. The
`audio_model_cache` volume keeps Whisper and Kokoro downloads across restarts.

---

## Testing

With the API running in development and its output written to a file, run the
end-to-end auth check (needs `jq`):

```bash
cd apps/api && yarn build && node dist/main.js > /tmp/api.log 2>&1 &
scripts/smoke-auth.sh http://localhost:3000/api/v1 /tmp/api.log
```

It creates a throwaway user and exercises signup, email verification (codes
are read from the `[dev-email]` log lines), login, token refresh and reuse
detection, profile updates, password reset and logout.

Apple / Google sign-in, with locally signed test tokens instead of real
accounts (development only):

```bash
node apps/api/scripts/oauth-test-keys.js init /tmp/oauth-keys
(cd /tmp/oauth-keys && python3 -m http.server 8765) &
# start the API with OAUTH_TEST_JWKS_URL=http://localhost:8765/jwks.json GOOGLE_CLIENT_IDS=test-google-client
scripts/smoke-oauth.sh http://localhost:3000/api/v1 /tmp/oauth-keys /tmp/api.log
```

Placement (needs `yarn db:seed` once; uses the LLM service when it's running,
otherwise checks the self-rating fallback):

```bash
scripts/smoke-placement.sh http://localhost:3000/api/v1
```

---

## Database

PostgreSQL accessed through [Drizzle ORM](https://orm.drizzle.team). The schema
lives in [`apps/api/src/database/schema.ts`](apps/api/src/database/schema.ts)
and migrations are written to `apps/api/drizzle/`.

All commands run from `apps/api/` and read `DATABASE_URL` from the repository
root `.env`:

| Command | Purpose |
|---|---|
| `yarn db:generate` | Generate a SQL migration from schema changes |
| `yarn db:migrate` | Apply pending migrations |
| `yarn db:push` | Push the schema directly, without a migration (development only) |
| `yarn db:pull` | Introspect an existing database into a schema |
| `yarn db:studio` | Open Drizzle Studio at `localhost:4983` |

Changing the schema:

1. Edit `src/database/schema.ts`.
2. `yarn db:generate` and review the generated SQL.
3. `yarn db:migrate`.
4. Commit the schema and the migration together.

Reference data (the placement prompt bank in
`apps/api/src/database/seed-data/`) is loaded with `yarn db:seed`. It's
idempotent: it inserts what's missing and never duplicates or deletes.

Inject the database anywhere in the API:

```ts
import { Inject } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, DrizzleDB } from '../database/database.module';
import { users } from '../database/schema';

constructor(@Inject(DB) private readonly db: DrizzleDB) {}

await this.db.select().from(users).where(eq(users.email, 'x@example.com'));
```

---

## Configuration

Everything is driven by environment variables in `.env`. Switching LLM
provider, Whisper size or TTS voice never requires a code change. See
[`.env.example`](.env.example) for the annotated full list.

### API (`apps/api`)

| Variable | Default | Description |
|---|---|---|
| `JWT_ACCESS_SECRET` | random per process (dev) | **Required in production.** Signs access tokens |
| `CODE_HMAC_SECRET` | random per process (dev) | **Required in production.** Hashes email codes |
| `GOOGLE_CLIENT_IDS` | _(empty)_ | Google OAuth client IDs accepted for Google sign-in |
| `APPLE_BUNDLE_ID` | `com.languageapp.sprachbar` | Audience for Sign in with Apple tokens |
| `OAUTH_TEST_JWKS_URL` | _(unset)_ | Dev/test only: verify Apple/Google tokens against this JWKS instead of the providers'. Ignored in production |
| `POSTGRES_PORT` | `5432` | Host port for the Compose database (change if 5432 is taken) |
| `PORT` | `3000` | Listen port |
| `NODE_ENV` | `development` | `development` or `production` |
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `LLM_SERVICE_URL` | `http://llm:8000` | Use `http://localhost:8000` natively |
| `AUDIO_SERVICE_URL` | `http://audio:8001` | Use `http://localhost:8001` natively |

### LLM service (`apps/llm`)

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://host.docker.internal:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Dev only. A German-capable chat model (e.g. `qwen2.5:7b`, `gemma3:12b`); avoid coder and reasoning models |
| `DEEPSEEK_API_KEY` | _(empty)_ | Enables the DeepSeek provider when set |
| `DEEPSEEK_MODEL` | `deepseek-chat` | DeepSeek model name |
| `TASK_ROUTING` | every task → `ollama` | JSON map of task → provider |

### Audio service (`apps/audio`)

| Variable | Default | Description |
|---|---|---|
| `WHISPER_MODEL_SIZE` | `small` | `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8` on CPU, `float16` on GPU |
| `KOKORO_DEFAULT_VOICE` | `af_heart` | Default Kokoro voice |
| `KOKORO_DEFAULT_LANG` | `a` | Default Kokoro language code (`a` American English, `b` British, `e` Spanish, `f` French, …) |
| `PIPER_VOICE_<LANG>` | per language | Default Piper voice, e.g. `PIPER_VOICE_DE=de_DE-thorsten-medium` |
| `ELEVENLABS_API_KEY` | _(empty)_ | Optional cloud TTS; disabled when empty |
| `ELEVENLABS_DEFAULT_VOICE_ID` | Rachel | Voice used when the request names none |
| `ELEVENLABS_MODEL` | `eleven_turbo_v2_5` | ElevenLabs model |

---

## API reference

### Public gateway — `http://<host>:3000/api/v1`

These are the only endpoints clients should call.

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness check |
| `POST` | `/llm/generate` | Full LLM response as JSON |
| `POST` | `/llm/stream` | LLM response as a Server-Sent Events token stream |
| `POST` | `/tts/synthesize` | Synthesised speech (WAV, or MP3 for ElevenLabs) |
| `GET` | `/tts/voices` | Voice catalogue and supported languages |
| `POST` | `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/logout` | Email + password accounts and sessions |
| `POST` | `/auth/email/verify`, `/auth/email/resend` | 6-digit email verification |
| `POST` | `/auth/password/forgot`, `/auth/password/reset` | Password reset with a 6-digit code |
| `POST` | `/auth/oauth/google`, `/auth/oauth/apple` | Sign in with Google / Apple (ID token verified server-side) |
| `GET` / `PATCH` | `/me`, `/me/profile` | Current user and onboarding profile |

Full request/response shapes and error codes for auth and onboarding:
[`docs/api/auth-onboarding.md`](docs/api/auth-onboarding.md).

Speech-to-text is implemented in the audio service and wrapped by
`AppService.transcribeAudio`, but no public gateway route exposes it yet.

#### `POST /llm/generate`

```bash
curl -X POST http://localhost:3000/api/v1/llm/generate \
  -H "Content-Type: application/json" \
  -d '{"task":"translation","prompt":"Translate \"good morning\" to German","system":"You are a concise language tutor."}'
```

```json
{ "result": "Guten Morgen", "provider": "OllamaProvider" }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `task` | string | yes | `translation`, `grammar_check`, `vocabulary`, `conversation`, `pronunciation_feedback`, `placement_scoring` |
| `prompt` | string | yes | User message |
| `system` | string | no | System instruction |

The internal LLM service (`:8000/llm/generate`) also accepts `max_tokens`,
`temperature` and `json_output` (ask for one JSON object), and returns
`usage: { prompt_tokens, completion_tokens }`. Every call is logged with its
token usage. Callers should always set `max_tokens` to keep spend low.
Tasks missing from `TASK_ROUTING` fall back to `deepseek` when it's configured,
otherwise to `ollama`.

#### `POST /llm/stream`

Same body as `/llm/generate`. Responds with `text/event-stream`:

```text
data: {"token": "Guten"}
data: {"token": " Morgen"}
data: [DONE]
```

Errors that occur mid-stream arrive as `data: {"error": "..."}`.

#### `POST /tts/synthesize`

```bash
curl -X POST http://localhost:3000/api/v1/tts/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hallo, wie geht es dir?","language":"de"}' \
  --output speech.wav
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `text` | string | yes | Text to speak |
| `language` | string | no | ISO code (`de`, `en`, `fr`, …). Picks the engine automatically and takes precedence over `lang_code` |
| `voice` | string | no | Engine-specific voice ID; defaults per language |
| `lang_code` | string | no | Kokoro-only single-letter code, used when `language` is absent |
| `speed` | number | no | Default `1.0`. Currently honoured by Kokoro only |
| `engine` | string | no | `"elevenlabs"` forces the optional cloud engine |

The response `Content-Type` is `audio/wav` for Kokoro/Piper and `audio/mpeg` for
ElevenLabs.

### Internal services

For debugging only; not reachable from outside Docker.

| Service | Method | Path | Description |
|---|---|---|---|
| llm | `GET` | `/health` | Liveness |
| llm | `POST` | `/llm/generate`, `/llm/stream` | As above |
| audio | `GET` | `/health` | Liveness |
| audio | `POST` | `/stt/transcribe` | Multipart upload: `file`, optional `language`, optional `word_timestamps` |
| audio | `POST` | `/tts/synthesize` | As above |
| audio | `GET` | `/tts/voices` | As above |

`/stt/transcribe` example and response:

```bash
curl -X POST http://localhost:8001/stt/transcribe \
  -F "file=@sample.wav" -F "language=de" -F "word_timestamps=true"
```

```json
{
  "text": "Ich wohne in Berlin",
  "language": "de",
  "language_probability": 0.98,
  "duration": 1.9,
  "words": [{ "word": "Ich", "start": 0.0, "end": 0.21 }]
}
```

`words` is only present when `word_timestamps=true`, and is intended for
highlighting words as they are spoken.

---

## LLM providers and task routing

Both providers use the OpenAI-compatible chat API, so they share one interface
([`providers/base.py`](apps/llm/app/providers/base.py)).

| Provider | Use for | Needs |
|---|---|---|
| `ollama` | Local development, self-hosted production | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` |
| `deepseek` | Hosted production | `DEEPSEEK_API_KEY` |

Every request names a `task`, and `TASK_ROUTING` maps tasks to providers:

```bash
# Development: everything local
TASK_ROUTING={"translation":"ollama","grammar_check":"ollama","vocabulary":"ollama","conversation":"ollama","pronunciation_feedback":"ollama"}

# Early production: everything on DeepSeek
TASK_ROUTING={"translation":"deepseek","grammar_check":"deepseek","vocabulary":"deepseek","conversation":"deepseek","pronunciation_feedback":"deepseek"}

# Mixed
TASK_ROUTING={"translation":"deepseek","grammar_check":"ollama","vocabulary":"ollama","conversation":"deepseek","pronunciation_feedback":"ollama"}
```

A task routed to a provider that is not configured (for example `deepseek`
without an API key) returns HTTP 400.

---

## Speech engines

### Speech-to-text

[Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) with voice-activity
filtering. Omit `language` to auto-detect. Use `small` in development and
`medium` or `large-v3` in production (the production Compose file sets `medium`).

### Text-to-speech

When a request includes `language`, the audio service routes it automatically:

| Engine | Languages |
|---|---|
| [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) | `en`, `en-us`, `en-gb`, `es`, `fr`, `hi`, `it`, `ja`, `pt`, `zh` |
| [Piper](https://github.com/rhasspy/piper) | `de`, `nl`, `pl`, `ru`, `tr`, `ar`, `cs`, `sv`, `nb`, `da`, `fi`, `el`, `uk`, `ko`, `vi`, `hu`, `ro`, `sk`, `ca`, `sr` |
| ElevenLabs (optional) | Any; only when `engine: "elevenlabs"` and an API key is set |

Piper voices download on first use from Hugging Face into
`apps/audio/.piper_models/` (gitignored). At startup the service preloads Whisper,
the default Kokoro pipeline and the default German Piper voice.

The product direction is to run speech on the device where possible and keep
the backend for reasoning, state and assessment; server speech remains available
for gaps. See the shared `ARCHITECTURE-AND-SPEECH-FINDINGS.md` that sits next to
both repositories.

---

## Production deployment

The production override adds restart policies and a larger Whisper model:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

**Hosted LLM (recommended early on).** Set `DEEPSEEK_API_KEY` and route all
tasks to `deepseek`. A small VM (about 4 GB RAM) is enough for the API and audio
services on CPU.

**Self-hosted Ollama.** Uncomment the `ollama` service and the `ollama_data`
volume in `docker-compose.prod.yml`, set `OLLAMA_BASE_URL=http://ollama:11434`,
and allow at least 8 GB RAM for a 7B model. On first start
[`scripts/ollama-entrypoint.sh`](scripts/ollama-entrypoint.sh) pulls
`OLLAMA_MODEL` and keeps it in the volume.

> The production override currently declares `llm.depends_on: ollama` even
> though the `ollama` service is commented out. Either enable the service or
> remove that dependency before deploying with DeepSeek only.

Use a managed PostgreSQL instance in production and set `DATABASE_URL`
accordingly.

---

## Project structure

```text
languageapp-backend/
├── apps/
│   ├── api/                         NestJS gateway (public)
│   │   ├── src/
│   │   │   ├── main.ts              bootstrap, /api/v1 prefix, CORS
│   │   │   ├── app.module.ts
│   │   │   ├── app.controller.ts    health, llm/*, tts/* routes
│   │   │   ├── app.service.ts       HTTP clients for llm and audio
│   │   │   └── database/            Drizzle module and schema
│   │   ├── drizzle/                 generated migrations
│   │   └── drizzle.config.ts
│   ├── llm/                         FastAPI LLM router (internal)
│   │   └── app/
│   │       ├── config.py            settings and provider registry
│   │       ├── router.py            TaskType enum and routing
│   │       ├── providers/           base, ollama, deepseek
│   │       └── routes/              health, llm
│   └── audio/                       FastAPI speech service (internal)
│       └── app/
│           ├── config.py            settings and language → engine routing
│           ├── models/              whisper, kokoro, piper, elevenlabs loaders
│           └── routes/              health, stt, tts
├── scripts/ollama-entrypoint.sh
├── docker-compose.yml               development stack
├── docker-compose.prod.yml          production overrides
└── .env.example
```

---

## Extending the backend

| To add… | Change |
|---|---|
| A database table | `apps/api/src/database/schema.ts`, then `yarn db:generate && yarn db:migrate` |
| An LLM task | `TaskType` in `apps/llm/app/router.py`, and add it to `TASK_ROUTING` |
| An LLM provider | New `LLMProvider` in `apps/llm/app/providers/`, registered in `build_router()` in `config.py` |
| A Piper language | `VOICE_PATHS` and `PIPER_DEFAULT_VOICES` in `models/piper.py`, a `piper_voice_<lang>` setting and mapping in `config.py`, and an entry in `LANGUAGE_ROUTING` |
| A Kokoro language | An entry in `LANGUAGE_ROUTING` in `apps/audio/app/config.py` |
| A public endpoint | A route in `apps/api` that calls the internal service; never expose Python services directly |

---

## Known limitations

These are tracked and expected at this stage:

- No authentication, input validation, quotas or rate limiting on any route.
- The `users` table holds only an email; onboarding preferences and assessment
  results are not persisted yet, and no migrations have been generated.
- No public speech-to-text route on the gateway.
- LLM requests are single-turn: no conversation memory or tutor policy yet.
- TTS audio is fully buffered in Python and again in NestJS rather than streamed.
- Kokoro falls back to the English `af_heart` voice when no voice is given, even
  for French or Spanish; `speed` is ignored by Piper and ElevenLabs.
- Model inference runs inside async request handlers, so concurrent requests
  block each other.
- Piper models are stored outside the `audio_model_cache` volume and are
  re-downloaded when the container is recreated.
- `apps/api` relies on `form-data` and `dotenv` being installed transitively;
  they should be declared as direct dependencies.

---

## Conventions

- Package managers: Yarn for `apps/api`, pip for the Python services.
- Configuration lives in environment variables, not code.
- Never commit `.env` or downloaded model files.
