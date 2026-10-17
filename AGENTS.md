# AGENTS.md — languageapp-backend

This repo is part of the Sprachbar workspace. **The workspace rules in
`/Users/ibrahimiliyasu/Projects/languageapp/AGENTS.md` are binding**: worktrees,
branch names, merge lock, fast-forward merge to `main`, quality gates, and the
TRACKER work board. Read that file and `TRACKER.md` first.

## Repo specifics

- Services: `apps/api` (NestJS gateway, the only public service), `apps/llm`
  (FastAPI, LLM routing), `apps/audio` (FastAPI, optional server speech).
- API contracts the mobile app depends on: `docs/api/*.md`. Code and contract
  change together.
- Schema changes: edit `apps/api/src/database/schema.ts`, run `yarn db:generate`,
  and commit the migration with the schema.
- LLM calls: bounded history, `max_tokens`, token usage logged, provider and
  model chosen by env (Ollama in dev, DeepSeek or a cheap hosted model in prod).
  One LLM call per learner turn.
- Never commit `.env`, keys, or model files.

## Quality gates (run in your worktree before merging)

```bash
cd apps/api && yarn install && yarn build
cd apps/llm && python3 -m compileall -q app      # if changed
cd apps/audio && python3 -m compileall -q app    # if changed
```

More detail on setup and architecture: `CLAUDE.md` and `README.md`.
