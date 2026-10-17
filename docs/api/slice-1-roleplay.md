# API contract — Slice 1: roleplay conversation

Status: **v1, PARKED** (2026-10-17): slice 1 resumes after F1 Auth + Onboarding (TRACKER D17). Identity will switch from the dev user to the F1 auth guard. Owner: backend (lead).
Consumers: `languageapp-mobile` (`src/services/roleplay-api.ts`).

Change rules: update this file in the same commit as the code change, bump the
version line, and notify the mobile agent. Additive changes (new optional
fields) are fine; renames or removals need agreement first.

## Conventions

- Base URL: `${EXPO_PUBLIC_API_URL}` = `http://<host>:3000/api/v1`.
- JSON in and out, `Content-Type: application/json`. Field names are camelCase.
- IDs are UUID strings. Timestamps are ISO-8601 UTC strings.
- **Identity (temporary, until auth B-FLOW-1):** no auth header. The server
  attributes every request to a seeded development user (`DEV_USER_ID` env,
  default created by the seed script). Clients must not send a user ID.
- Language codes are lowercase ISO 639-1 (`de`, `en`, `fr`, `es`, `tr`, `ar`).
- Speech is on the device (D5). The client sends **text** (its on-device
  transcript); the server never receives audio in this slice.

### Errors

Non-2xx responses have this body:

```json
{ "error": { "code": "SESSION_NOT_FOUND", "message": "Human-readable, safe to log" } }
```

| HTTP | `code` | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body is missing or malformed fields |
| 404 | `SCENARIO_NOT_FOUND` / `SESSION_NOT_FOUND` | Unknown ID |
| 409 | `SESSION_ENDED` | Turn posted to an ended session |
| 429 | `RATE_LIMITED` | Per-user daily turn cap reached (B-LLM-1) |
| 502 | `TUTOR_UNAVAILABLE` | LLM provider failed or returned invalid output after retry |

The client should show a retry option for `502` and keep the learner's text so
it can be re-sent.

## Types

```ts
type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

interface ScenarioSummary {
  id: string;
  slug: string;              // 'doctor', 'cafe', 'flat', 'train'
  title: string;             // German-learner-facing title in English for v1, e.g. "At the doctor"
  subtitle: string;          // "describe symptoms"
  emoji: string;             // "🏥"
  level: CEFRLevel;
  estimatedMinutes: number;
  wordCount: number;
}

interface Scenario extends ScenarioSummary {
  situation: string;         // the scene, 1–3 sentences
  youAre: string;            // "the patient"
  aiIs: string;              // "Lena, the doctor"
  goals: string[];           // what the learner should achieve
  words: { de: string; en: string }[];   // useful words, German with article
  phrases: string[];         // German example phrases
  grammar: string[];         // grammar focus labels, e.g. "Perfekt (haben/sein)"
}

interface Turn {
  id: string;
  role: 'user' | 'ai';
  text: string;              // German for AI turns
  createdAt: string;
}

interface Correction {
  id: string;
  turnId: string;            // the learner turn it belongs to
  original: string;          // the learner's wrong fragment or sentence
  corrected: string;         // corrected German
  ruleKey: string;           // stable key, e.g. 'perfekt-sein-movement'
  ruleName: string;          // short label, e.g. "Perfekt with sein"
  explanation: string;       // the "why", in the session's explanationLanguage
}

interface Streak {
  current: number;           // days in a row with ≥1 understood learner turn
  extendedToday: boolean;    // true if THIS request moved the streak
}
```

## Endpoints

### `GET /scenarios`
List scenarios for the scenario picker.

**200**
```json
{ "scenarios": [ /* ScenarioSummary[] */ ] }
```

### `GET /scenarios/:id`
Full scenario for the prep brief. `:id` may be the UUID or the `slug`.

**200** `{ "scenario": Scenario }` · **404** `SCENARIO_NOT_FOUND`

### `POST /sessions`
Start a roleplay. The AI's opening line comes from the scenario data (no LLM
call), so it's instant and free.

Request
```json
{ "scenarioId": "<uuid or slug>", "explanationLanguage": "en" }
```
`explanationLanguage`: the learner's own language, used for correction
explanations. Defaults to `en` if omitted or unsupported.

**201**
```json
{
  "session": {
    "id": "…",
    "scenarioId": "…",
    "explanationLanguage": "en",
    "startedAt": "2026-10-17T18:00:00Z",
    "endedAt": null
  },
  "opening": { "id": "…", "role": "ai", "text": "Guten Tag! Was kann ich für Sie tun?", "createdAt": "…" }
}
```

### `POST /sessions/:id/turns`
Submit one learner turn and get the AI reply plus corrections. **One LLM call
per request.**

Request
```json
{ "text": "Ich habe Kopfschmerzen seit gestern.", "inputMode": "voice" }
```
| Field | Type | Notes |
|---|---|---|
| `text` | string, 1–500 chars | The learner's sentence (on-device transcript or typed) |
| `inputMode` | `"voice"` \| `"text"` | For analytics; only voice/text production counts for the streak either way |

**200**
```json
{
  "userTurn": { "id": "…", "role": "user", "text": "Ich habe Kopfschmerzen seit gestern.", "createdAt": "…" },
  "reply":    { "id": "…", "role": "ai",   "text": "Das tut mir leid. Haben Sie auch Fieber?", "createdAt": "…" },
  "understood": true,
  "corrections": [ /* Correction[] — empty when the sentence was correct */ ],
  "streak": { "current": 1, "extendedToday": true }
}
```
- `understood`: the tutor could follow the learner's meaning. Only understood
  turns count as production (D1) and can extend the streak.
- The reply stays in character, in German, at the scenario's level.
- **409** `SESSION_ENDED` · **429** `RATE_LIMITED` · **502** `TUTOR_UNAVAILABLE`

### `GET /sessions/:id/corrections`
All corrections in the session, oldest first, for the correction screen.

**200** `{ "corrections": Correction[] }`

### `POST /sessions/:id/end`
End the session. Idempotent.

**200**
```json
{ "session": { "id": "…", "endedAt": "…" }, "summary": { "turnCount": 6, "correctionCount": 2, "durationSec": 241 } }
```

## Not in this slice

Streaming replies (B-LLM-4), audio upload, pronunciation scoring (B-LLM-3),
auth (B-FLOW-1), saving words from the conversation, "Save rule" persistence.
The correction screen's "Save rule" button can be shown but is a no-op for now.
