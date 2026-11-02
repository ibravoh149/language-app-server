# API contract — Admin dashboard

Status: **v0.3, draft** (2026-11-02; v0.2: level enum A1–C1, streak and call notes; v0.3: phase A complete). Owner: backend (lead).
Consumer: `languageapp-web` (`apps/admin`, owned by the web agent).
Phase A is being built now; phases B and C are the agreed direction, shapes may still change.

Change rules: update this file in the same commit as the code change, bump the
version line, and message the web agent. Additive optional fields are fine;
renames or removals need agreement first.

Related decisions: D26 admin dashboard in parallel with F2 · D27 `languageapp-web` repo ·
D28 one domain, split by path · D10 LLM spend kept low.

## Basics

- Base URL: `/api/v1/admin` (same server as the app API). In development the
  dashboard runs on Vite (`http://localhost:5173/admin/`) and proxies `/api` to
  `http://localhost:3000`.
- Errors use the shared envelope `{ "error": { "code", "message", "details"? } }`.
  New code: **403 `FORBIDDEN`**, the user is signed in but lacks the permission.
- Times are ISO 8601 UTC. Days are UTC days, `YYYY-MM-DD`.
- Lists are paginated with an opaque cursor: request `?cursor=&limit=` (limit 1–100,
  default 25), response `{ items…, "nextCursor": string | null }`.
- Learners' text (turns, transcripts) is personal data. It is only returned by
  endpoints that need `conversations.read`, and every such read is audit-logged.

## Auth, roles and permissions

Admins are ordinary users with a role. Sign in with the existing
`POST /api/v1/auth/login` (auth-onboarding.md) and use the returned tokens
(`Authorization: Bearer`, refresh with `POST /auth/refresh`). Keep the access token
in memory and the refresh token in `sessionStorage` for now (hardening: B-ADMIN-2).

A user has roles; a role has permissions. Every admin endpoint requires one
permission, listed next to it below. The dashboard hides what the user can't do,
but the server is the authority.

| Permission | Allows |
|---|---|
| `analytics.read` | Overview metrics |
| `llm.read` | LLM usage, cost, failures, call log |
| `users.read` | User list and detail (no conversation text) |
| `users.write` | Verify email, suspend, unsuspend, reset placement |
| `users.delete` | Delete an account and its data |
| `conversations.read` | Read sessions and turns (audit-logged) |
| `conversations.flag` | Flag a tutor reply for the eval set |
| `content.read` / `content.write` | Scenarios and the dictionary |
| `audit.read` | The audit log |
| `team.manage` | Roles, permissions, admin accounts |

Seeded role: **`admin`**, all permissions. Grant it from the backend:
`cd apps/api && yarn admin:grant you@example.com`.

### `GET /admin/me` · any admin role
**200**
```ts
{
  user: { id: string; email: string; name: string | null };
  roles: { key: string; name: string }[];
  permissions: string[];          // e.g. ["analytics.read", "llm.read", …]
}
```
**401** `UNAUTHORIZED` · **403** `FORBIDDEN` (signed in, no admin role).

## Phase A

### `GET /admin/overview?days=30` · `analytics.read`
`days` 7–90, default 30.
```ts
{
  totals: { users: number; verifiedUsers: number; onboardedUsers: number;
            sessions: number; completedSessions: number; turns: number; savedWords: number };
  today: { signups: number; activeUsers: number; turns: number; completedSessions: number };
  series: { date: string; signups: number; activeUsers: number; turns: number;
            completedSessions: number }[];       // oldest first, one entry per day incl. zeros
  levels: { level: 'A1'|'A2'|'B1'|'B2'|'C1'; users: number }[];   // chosen level, all 5 always present
  streaks: { bucket: '0'|'1-2'|'3-6'|'7-29'|'30+'; users: number }[];  // current streak, all buckets present
}
```
"Active" = sent at least one spoken or typed turn that day. A streak whose last day
is before yesterday counts as 0 (it's already broken).

### `GET /admin/llm/usage?days=30` · `llm.read`
Every LLM call the API makes is recorded (task, provider, model, outcome, tokens,
latency; never prompt or reply text).
```ts
{
  totals: { calls: number; failures: number; fallbacks: number;
            promptTokens: number; completionTokens: number; costUsd: number };
  byTask: { task: string; provider: string; calls: number; failures: number;
            failureRate: number;                 // 0–1
            fallbacks: number; p50Ms: number; p95Ms: number;
            promptTokens: number; completionTokens: number; costUsd: number }[];
  series: { date: string; calls: number; failures: number; costUsd: number }[];  // oldest first
}
```
- `failures`: the call errored or returned output the API couldn't use.
  A retried call counts each attempt.
- `fallbacks`: the hosted provider was rate-limited and the local model answered.
- `costUsd` is an estimate from the price table in the API config; local (Ollama) is 0.

### (LLM call notes)
A call that failed before reaching a provider has `provider: "unknown"`, `model: null`,
`outcome: "error"`. Recording started with backend `dbc1813`; there is no earlier history.

### `GET /admin/llm/calls?task=&outcome=&cursor=&limit=` · `llm.read`
Most recent first. `outcome`: `ok` | `invalid` | `error`.
```ts
{ calls: { id: string; at: string; task: string; provider: string; model: string | null;
           outcome: 'ok' | 'invalid' | 'error'; fallback: boolean; error: string | null;
           promptTokens: number | null; completionTokens: number | null; ms: number;
           userId: string | null }[];
  nextCursor: string | null }
```

### `GET /admin/users?q=&cursor=&limit=` · `users.read`
`q` matches email or name (case-insensitive, contains). Newest first.
```ts
{ users: AdminUserRow[]; nextCursor: string | null }

interface AdminUserRow {
  id: string; email: string; name: string | null;
  createdAt: string; emailVerified: boolean; onboarded: boolean;
  suspended: boolean;
  level: string | null;           // chosen level
  streak: number;                 // current
  lastActiveAt: string | null;
  roles: string[];                // role keys, [] for learners
}
```

### `GET /admin/users/:id` · `users.read`
```ts
{
  user: AdminUserRow & { suspendedAt: string | null; suspendedReason: string | null;
                         signInMethods: ('password' | 'google' | 'apple')[] };
  profile: { interfaceLanguage: string; spokenLanguage: string; targetLanguage: string;
             selfRatedLevel: string | null; suggestedLevel: string | null; chosenLevel: string;
             dailyMinutes: number; voiceId: string } | null;
  stats: { sessions: number; completedSessions: number; turns: number; savedWords: number;
           corrections: number; longestStreak: number; llmCalls30d: number; costUsd30d: number };
  recentSessions: { id: string; scenario: string; startedAt: string; endedAt: string | null;
                    turnCount: number }[];   // last 10, no text
}
```
**404** `NOT_FOUND`.

### User actions · `users.write` (delete: `users.delete`)
All return **200** `{ user: AdminUserRow }` (delete: **204**), are audit-logged, and
take an optional JSON body `{ "reason": string }` (max 300) that goes into the audit log.
A malformed or unknown id is **404** `NOT_FOUND`.
- `POST /admin/users/:id/verify-email`: idempotent.
- `POST /admin/users/:id/suspend`: `reason` required. Signs the user out everywhere;
  their login, refresh and API calls then get **403 `ACCOUNT_SUSPENDED`**.
- `POST /admin/users/:id/unsuspend`
- `DELETE /admin/users/:id`: same effect as the user deleting their own account.

You can't suspend or delete yourself: **400 `VALIDATION_FAILED`**.

### `GET /admin/audit?actorId=&action=&cursor=&limit=` · `audit.read`
Most recent first.
```ts
{ entries: { id: string; at: string;
             actor: { id: string | null; email: string };   // id null if the admin was deleted
             action: string;              // e.g. "user.suspend", "conversation.view"
             target: { type: string; id: string } | null;
             reason: string | null;
             meta: Record<string, unknown> | null }[];   // user.delete keeps { email }
  nextCursor: string | null }
```
Actions so far: `user.verify_email`, `user.suspend`, `user.unsuspend`, `user.delete`.

## Phase B (direction)

- Conversations · `conversations.read`: `GET /admin/sessions?userId=&scenario=&cursor=`,
  `GET /admin/sessions/:id` (turns with corrections and actions). Each detail read writes
  a `conversation.view` audit entry.
- Flag a tutor reply · `conversations.flag`: `POST /admin/turns/:id/flag { note }`,
  `GET /admin/flags` (feeds the eval cases).
- Scenarios · `content.read` / `content.write`: list, create, edit, publish/unpublish
  (`active`), with goals, opening line, level, persona, words, phrases, grammar.
- Dictionary · `content.write`: search, edit or delete an entry, list its aliases.
- Placement: attempt list and level distribution, scored vs fallback.

## Phase C (direction)

Roles and permission matrix, admin invites, data export, feature flags · `team.manage`.
