# languageapp-backend

Backend monorepo for a language learning app. Three services, all containerised via Docker Compose.

## Services

| Service | Stack | Port | Role |
|---|---|---|---|
| `apps/api` | NestJS (TypeScript) | `3000` | Public-facing gateway. Only service the mobile app talks to |
| `apps/llm` | Python / FastAPI | `8000` | LLM routing — internal only |
| `apps/audio` | Python / FastAPI | `8001` | STT + TTS — internal only |

## Key architecture decisions

- **NestJS is the gateway.** Mobile → NestJS → (llm service or audio service). Mobile never calls Python directly.
- **Database.** PostgreSQL via Drizzle ORM. Schema in `apps/api/src/database/schema.ts`. Migrations in `apps/api/drizzle/`. Use `yarn db:generate` then `yarn db:migrate` to evolve the schema.
- **LLM provider pattern.** Two providers: `ollama` (local/self-hosted) and `deepseek` (cloud). Selected per task via `TASK_ROUTING` env var. No code changes needed to switch providers.
- **LLM streaming.** `POST /llm/generate` returns full JSON. `POST /llm/stream` returns SSE token stream. Use stream for conversation/long responses, generate for short tasks.
- **TTS dual-engine.** Kokoro handles English, Spanish, French, Hindi, Italian, Japanese, Portuguese, Mandarin. Piper handles everything else (German, Dutch, Polish, Russian, Turkish, Arabic, and 14 more). Mobile sends `"language": "de"` and the backend routes automatically.
- **STT.** Faster-Whisper. Supports `word_timestamps=true` for per-word timing (used to highlight words as they're spoken).
- **Local dev without Docker.** Run each service natively with hot reload. Ollama runs natively on the host machine — no container needed in dev.

## Dev workflow

### Prerequisites (one-time, native dev)
```bash
brew install espeak-ng ffmpeg   # required by audio service
```

### Database setup (one-time, native dev)

Create the local database:
```bash
createdb languageapp   # uses your local PostgreSQL install
```

Set in `.env`:
```
DATABASE_URL=postgresql://<your-mac-username>@localhost:5432/languageapp
```
If your local PostgreSQL has a password, use: `postgresql://user:password@localhost:5432/languageapp`

Run migrations to create tables:
```bash
cd apps/api && yarn db:migrate
```

### Drizzle workflow

All commands run from `apps/api/`:

| Command | What it does |
|---|---|
| `yarn db:generate` | Generates a new SQL migration file from schema changes |
| `yarn db:migrate` | Applies pending migrations to the database |
| `yarn db:push` | Pushes schema directly without migration files (dev only) |
| `yarn db:pull` | Introspects an existing database and generates schema |
| `yarn db:studio` | Opens Drizzle Studio (visual DB browser) at localhost:4983 |

**Typical flow when changing the schema:**
1. Edit `src/database/schema.ts`
2. `yarn db:generate` — creates `drizzle/<timestamp>_description.sql`
3. Review the generated SQL
4. `yarn db:migrate` — applies it

Commit the generated migration file alongside the schema change.

### Native dev (recommended for day-to-day)
```bash
# Terminal 1 — LLM service
cd apps/llm && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# Terminal 2 — Audio service (downloads models ~800MB on first run)
cd apps/audio && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001

# Terminal 3 — NestJS API
cd apps/api && yarn install && yarn start:dev
```

Set in `.env` for native dev:
```
LLM_SERVICE_URL=http://localhost:8000
AUDIO_SERVICE_URL=http://localhost:8001
OLLAMA_MODEL=qwen2.5-coder:14b   # or whichever model you have in Ollama
```

### Docker dev
```bash
cp .env.example .env   # edit OLLAMA_MODEL
docker compose up --build
```

## Conventions

- **Package manager:** yarn (NestJS), pip (Python)
- **No auto-commits.** Always wait for explicit instruction before committing.
- **Python services** each have their own `.venv` — never share venvs across services.
- **Env vars drive everything.** Switching LLM provider, TTS voice, Whisper model size — all via `.env`, no code changes.

## LLM tasks

Available task types (used in `POST /llm/generate` and `POST /llm/stream`):
`translation` | `grammar_check` | `vocabulary` | `conversation` | `pronunciation_feedback`

## TTS languages

- **Kokoro:** `en`, `en-us`, `en-gb`, `es`, `fr`, `hi`, `it`, `ja`, `pt`, `zh`
- **Piper:** `de`, `nl`, `pl`, `ru`, `tr`, `ar`, `cs`, `sv`, `nb`, `da`, `fi`, `el`, `uk`, `ko`, `vi`, `hu`, `ro`, `sk`, `ca`, `sr`

## Extending the project

**Add a database table:** `apps/api/src/database/schema.ts` → add table, then `yarn db:generate && yarn db:migrate`

**Inject the database into a service:**
```typescript
import { Inject } from '@nestjs/common';
import { DB, DrizzleDB } from '../database/database.module';
import { users } from '../database/schema';

constructor(@Inject(DB) private readonly db: DrizzleDB) {}

// then use:
await this.db.select().from(users).where(eq(users.email, 'x@x.com'));
await this.db.insert(users).values({ email: 'x@x.com' });
await this.db.update(users).set({ email: 'y@y.com' }).where(eq(users.id, 1));
await this.db.delete(users).where(eq(users.id, 1));
```

**Add an LLM task type:** `apps/llm/app/router.py` → `TaskType` enum

**Add an LLM provider:** `apps/llm/app/providers/<name>.py` → implement `LLMProvider`, register in `config.py`

**Add a TTS language (Piper):** `apps/audio/app/models/piper.py` → `VOICE_PATHS` + `PIPER_DEFAULT_VOICES`, then `apps/audio/app/config.py` → `LANGUAGE_ROUTING`

**Add a TTS language (Kokoro):** `apps/audio/app/config.py` → `LANGUAGE_ROUTING`

## Production notes

- Early stage: use DeepSeek cloud API for LLM (`DEEPSEEK_API_KEY` + update `TASK_ROUTING`). Minimum $24/month DO droplet.
- Self-hosted Ollama in prod: uncomment `ollama` service in `docker-compose.prod.yml`. Needs 8GB+ RAM for 7B models.
- Audio models (Whisper + Kokoro + Piper) are stored in `audio_model_cache` Docker volume — persist across restarts.
- Piper voice models are stored in `apps/audio/.piper_models/` — gitignored.

## Repos

- Backend: `git@github.com:ibravoh149/language-app-server.git`
- Mobile: `git@github.com:ibravoh149/language-app-mobile.git`
