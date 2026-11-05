# API contract — F2: Roleplay conversation

Status: **v3.3, agreed** (2026-11-05; v2.1 practice time, v3 tutor actions + My Words, v3.1 idempotent turns, v3.2 word lookup, v3.3 multi-language wording, D29). Owner: backend (lead).
Consumers: `languageapp-mobile` (`src/services/roleplay-api.ts`).
Supersedes the parked slice 1 draft (v1), which used a dev user instead of auth.

Change rules: update this file in the same commit as the code change, bump the
version line, and message the mobile agent. Additive optional fields are fine;
renames or removals need agreement first.

Related decisions: D1 production over recognition · D5 speech on the device · D10
LLM spend kept low · D12 German voice, explanations as text.

## Conventions

- Base URL `${EXPO_PUBLIC_API_URL}` (`/api/v1`); JSON; camelCase; UUID ids; ISO-8601 UTC.
- **Auth:** every route needs `Authorization: Bearer <accessToken>` **and a verified
  email** (✅ in `auth-onboarding.md`): `401 UNAUTHORIZED`, `403 EMAIL_NOT_VERIFIED`.
- **Speech stays on the device.** The client sends its on-device transcript as text
  and speaks the AI's reply with the learner's chosen Piper voice
  (`profile.voiceId`, `profile.voiceSpeed`). No audio goes to the server.
- **Language:** every scenario has a target language (D29; only German so far). `GET /scenarios` lists only scenarios
  in the learner's `targetLanguage`. The AI's lines are in that language at the scenario's level. Corrections'
  `explanation` and `ruleName` are in the learner's `profile.spokenLanguage`
  (D12: explanations are text, not speech).
- Errors use the shared envelope `{ "error": { "code", "message", "fields?" } }`.

| HTTP | `code` | When / client action |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Bad body. Show `fields` |
| 404 | `NOT_FOUND` | Unknown scenario or session (or not yours) |
| 409 | `SESSION_ENDED` | Turn posted to an ended session. Offer a new session |
| 409 | `IDEMPOTENCY_KEY_REUSED` | A `clientTurnId` was reused with different text (a client bug, not a retry) |
| 429 | `RATE_LIMITED` | Daily turn cap reached (cost control, D10). `Retry-After` in seconds |
| 502 | `TUTOR_UNAVAILABLE` | LLM failed or returned unusable output after one retry. Keep the learner's text and offer retry; nothing is stored |

## Types

```ts
type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

interface ScenarioSummary {
  id: string;
  slug: string;              // 'doctor' | 'cafe' | 'flat' | 'train' | …
  title: string;             // learner-facing, in English for v2 ("At the doctor")
  subtitle: string;          // "describe symptoms"
  emoji: string;             // "🏥"
  level: CEFRLevel;
  estimatedMinutes: number;
  wordCount: number;
  // Learner's history with this scenario (from their sessions)
  timesPracticed: number;
  lastPracticedAt: string | null;
}

interface Scenario extends ScenarioSummary {
  situation: string;         // the scene, 1–3 sentences (English for v2)
  youAre: string;            // "the patient"
  aiIs: string;              // "the doctor"
  goals: string[];           // what the learner should achieve
  words: { de: string; en: string }[];   // useful words: `de` = the word in the target language (with article), `en` = English meaning; key names are historical (B-LANG-1)
  phrases: string[];         // example phrases in the target language
  grammar: string[];         // grammar focus labels, e.g. "Perfekt (haben/sein)"
}

interface Turn {
  id: string;
  role: 'user' | 'ai';
  text: string;
  createdAt: string;
}

interface Correction {
  id: string;
  turnId: string;            // the learner turn it belongs to
  original: string;          // the learner's wrong fragment
  corrected: string;         // corrected text in the target language
  ruleKey: string;           // stable kebab-case key, e.g. 'perfekt-sein-movement'
  ruleName: string;          // short label in spokenLanguage, e.g. "Perfekt with sein"
  explanation: string;       // the "why", 1–3 sentences in spokenLanguage
}

interface Streak {
  current: number;           // consecutive days with ≥1 understood learner turn
  longest: number;
  producedToday: boolean;
  extendedToday: boolean;    // true only in the response that moved the streak
}
```

```ts
/** A word in the learner's list. Details come from the server's dictionary cache. */
interface Word {
  id: string;                // user_words id (null-free once saved)
  lemma: string;             // base form without article: "Kaution"
  article: 'der' | 'die' | 'das' | null;   // null for non-nouns. German articles today; widens with the next target language (B-LANG-1)
  plural: string | null;     // "Kautionen"
  partOfSpeech: 'noun' | 'verb' | 'adjective' | 'adverb' | 'phrase' | 'other';
  meaning: string;           // in the learner's spokenLanguage: "deposit"
  example: string;           // short example sentence in the target language
  saved: boolean;            // in My Words?
  source: 'roleplay' | 'manual';
  createdAt: string | null;  // when saved; null if not saved
}

/**
 * Things the tutor asks the app to do this turn (D24). The app renders them in
 * order after the reply; unknown types must be ignored (new ones may be added).
 */
type Action =
  | { type: 'word_card'; word: Word }                  // show a word; `word.saved` says if it was saved
  | { type: 'play'; text: string }                     // speak a target-language phrase in the learner's voice
  | { type: 'grammar_card'; ruleKey: string; ruleName: string; explanation: string; examples: string[] }
  | { type: 'goal_achieved'; goalIndex: number; goal: string }   // index into scenario.goals
  | { type: 'scenario_complete'; reason: string };     // the scene reached its end (learner-language sentence)
```

The streak day is the **UTC** calendar day for now (BACKLOG: switch to the
learner's timezone once it's stored).

## Endpoints

### ✅ `GET /scenarios`
**200** `{ "scenarios": ScenarioSummary[] }`, ordered by level, then title.

### ✅ `GET /scenarios/:idOrSlug`
**200** `{ "scenario": Scenario }` · **404** `NOT_FOUND`

### ✅ `POST /sessions`
Start a roleplay. The AI's opening line comes from the scenario data: **no LLM
call**, so it's instant and free.

Request `{ "scenarioId": "<uuid or slug>" }`

**201**
```json
{
  "session": { "id": "…", "scenarioId": "…", "startedAt": "…", "endedAt": null },
  "opening": { "id": "…", "role": "ai", "text": "Guten Tag! Was kann ich für Sie tun?", "createdAt": "…" }
}
```

### ✅ `POST /sessions/:id/turns`
One learner turn → the AI's in-character reply plus corrections, from **one LLM
call** with a bounded history window (D10).

Request
```json
{ "text": "Ich habe seit gestern Kopfschmerzen.", "inputMode": "voice" }
```
| Field | Type | Notes |
|---|---|---|
| `text` | string, 1–500 chars (trimmed) | The learner's on-device transcript or typed text |
| `inputMode` | `"voice"` \| `"text"` | Stored for analytics; both count as production |
| `clientTurnId` | UUID, optional (recommended) | Idempotency key: generate one per learner turn and **reuse it on every retry** of that turn |

**200**
```json
{
  "userTurn": { "id": "…", "role": "user", "text": "Ich habe seit gestern Kopfschmerzen.", "createdAt": "…" },
  "reply":    { "id": "…", "role": "ai",   "text": "Das tut mir leid. Haben Sie auch Fieber?", "createdAt": "…" },
  "understood": true,
  "corrections": [],
  "streak": { "current": 1, "longest": 1, "producedToday": true, "extendedToday": true },
  "actions": [
    { "type": "word_card", "word": { "id": "…", "lemma": "Fieber", "article": "das", "plural": null, "partOfSpeech": "noun",
      "meaning": "fever", "example": "Ich habe seit gestern Fieber.", "saved": true, "source": "roleplay", "createdAt": "…" } },
    { "type": "goal_achieved", "goalIndex": 0, "goal": "Explain what hurts and since when" }
  ],
  "goalsAchieved": [0]
}
```
- `actions` (v3): what the tutor chose to do, at most 4 per turn. The tutor picks
  them; the server validates and resolves them (a `word_card` word comes from the
  dictionary cache, and is saved to My Words when the learner asked to save it or
  asked what a word means). Render them after the reply; ignore unknown types.
- `goalsAchieved` (v3): indexes of `scenario.goals` met so far in this session,
  ascending. A `scenario_complete` action is a suggestion; the session only ends
  when the client calls `/end`.
- The tutor also sees the learner's recent mistakes and recently saved words
  (personal memory) and may weave them into the conversation.
- `understood`: the tutor followed the learner's meaning. Only understood turns
  count as production (D1) and can extend the streak.
- `corrections` is empty when the sentence was correct. At most 3 per turn, most
  important first; small slips that don't matter at the level are skipped.
- On `502 TUTOR_UNAVAILABLE` **nothing is stored**: re-sending the same text is safe.
- **Idempotency (v3.1):** a request with a `clientTurnId` already used in this session
  returns the **stored response unchanged** (200, same ids, same corrections and actions):
  no LLM call, no new writes, even if the session has since ended. Same key with
  different text → `409 IDEMPOTENCY_KEY_REUSED`. Two simultaneous copies end up as one
  turn (a unique index on session + key). Without a key, a retry after a lost response
  stores a second turn.
- **409** `SESSION_ENDED` · **429** `RATE_LIMITED` · **404** `NOT_FOUND`

### ✅ `GET /sessions/:id`
The transcript so far, e.g. to resume after the app was killed.

**200** `{ "session": {…}, "scenario": ScenarioSummary, "turns": Turn[], "corrections": Correction[], "goalsAchieved": number[] }`

### ✅ `GET /sessions/:id/corrections`
**200** `{ "corrections": Correction[] }`, oldest first. For the correction screen.

### ✅ `POST /sessions/:id/end`
Idempotent.

**200**
```json
{
  "session": { "id": "…", "endedAt": "…" },
  "summary": { "turnCount": 6, "understoodCount": 5, "correctionCount": 2, "durationSec": 241 }
}
```

### ✅ `GET /me/progress`
For the home screen.

**200**
```json
{
  "streak": { "current": 3, "longest": 5, "producedToday": true, "extendedToday": false },
  "spokenTurnsToday": 4,
  "sessionsCompleted": 3,
  "secondsPracticedToday": 412,
  "week": [
    { "date": "2026-10-12", "secondsPracticed": 0, "turns": 0 },
    …
    { "date": "2026-10-18", "secondsPracticed": 412, "turns": 4 }
  ]
}
```
- `week`: the last 7 UTC days, **oldest first**, always 7 entries (zeros included).
- Practice time is **active** time: the gaps between consecutive turns in a
  conversation, each capped at 2 minutes. A conversation left open doesn't count
  as practice, and unfinished sessions still count. Compare
  `secondsPracticedToday` with `profile.dailyMinutes × 60` for the daily-goal ring.
- `secondsPracticedToday` and `week` were added in v2.1; clients should treat them
  as optional.

### ✅ `GET /me/words`
My Words, newest first. **200** `{ "words": Word[] }` (all with `saved: true`).

### ✅ `POST /me/words`
Save a word manually, e.g. the save toggle on a word card. Body `{ "lemma": "Kaution" }`
(article optional: "die Kaution" works). Looked up in the dictionary cache first.
**201** `{ "word": Word }` · **200** if it was already saved · **400** `VALIDATION_FAILED`
· **502** `TUTOR_UNAVAILABLE` if the dictionary entry couldn't be created.

### ✅ `GET /me/words/lookup?q=<word>&context=<sentence>` (v3.2)
Look a word up **without saving it**, e.g. tap-a-word in an AI reply.
- `q`: the word as tapped, 1–60 characters; inflected forms are fine ("Schmerzen", "hatte").
  The answer is the dictionary form ("hatte" → "haben").
- `context` (optional): the sentence or reply the word came from, up to 2000 characters
  (the first 300 are used). It only helps disambiguation the first time a form is looked up.

**200** `{ "word": Word }`: `saved` says whether it's in My Words; `id` is the
`user_words` id when saved, else the dictionary id (same rule as `word_card`).
**400** `VALIDATION_FAILED` · **429** `RATE_LIMITED` (300 lookups/hour) · **502** `TUTOR_UNAVAILABLE`.

**When an LLM call happens (D10).** Words live in one dictionary shared by all users, per
meaning language; My Words rows point into it. Every word resolution (this lookup,
`POST /me/words`, the tutor's `word` action) checks, in order:
1. the dictionary by lemma (covers the learner's own saved words and anything any user looked up before);
2. the alias table: a surface form ("hatte") already resolved once, by anyone;
3. only on a miss, one bounded LLM call (120 tokens). The result is stored in the dictionary,
   plus an alias when the form differs from the lemma, so the next lookup by anyone is free.

The first lookup of a new word can take 1–2 s; after that it's a database read.

### ✅ `DELETE /me/words/:id`
Remove from My Words. **204** · **404** `NOT_FOUND`.

## Not in F2

Streaming replies (B-LLM-4), audio upload and pronunciation scoring (B-LLM-3),
spaced repetition for My Words (next feature), persisting "Save rule" to the Why library, scenario
packs, learner-written custom scenarios. The correction screen's "Save rule"
button can be shown disabled or hidden.
