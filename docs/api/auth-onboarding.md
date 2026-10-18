# API contract — F1: Auth + Onboarding

Status: **v1.4, agreed** (2026-10-18; v1.1 level cap, v1.2 account linking, v1.3 placement rubric, v1.4 account deletion). Owner: backend (lead).
Consumers: `languageapp-mobile` (`src/services/auth-api.ts`, `src/services/placement-api.ts`).

Decisions behind it (TRACKER): D18 email + Apple + Google · D19 dev codes logged
to the console · D20 placement really scored · D7 onboarding happens **before**
signup.

Change rules: update this file in the same commit as the code change, bump the
version line, and message the mobile agent. Additive optional fields are fine;
renames or removals need agreement first.

---

## Conventions

- Base URL: `${EXPO_PUBLIC_API_URL}` = `http://<host>:3000/api/v1`.
- JSON in and out; camelCase; UUID string IDs; ISO-8601 UTC timestamps.
- Language codes: lowercase ISO 639-1 (`en`, `de`, `fr`, `es`, `tr`, `ar`).
- CEFR levels: `A1` `A2` `B1` `B2` `C1`.

### Errors

Every non-2xx response:
```json
{ "error": { "code": "EMAIL_TAKEN", "message": "Human-readable, safe to show or log", "fields": { "email": "already registered" } } }
```
`fields` is present only for `VALIDATION_FAILED`.

| HTTP | `code` | Meaning / client action |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Show per-field messages from `fields` |
| 400 | `CODE_INVALID` | Wrong 6-digit code. Let the user retry |
| 400 | `CODE_EXPIRED` | Code older than 10 minutes. Offer resend |
| 401 | `UNAUTHORIZED` | Missing or expired access token. Refresh once, then retry |
| 401 | `INVALID_CREDENTIALS` | Wrong email or password (deliberately not saying which) |
| 401 | `REFRESH_INVALID` | Refresh token unknown, expired or revoked. Sign the user out |
| 401 | `OAUTH_TOKEN_INVALID` | Apple or Google token failed verification |
| 403 | `EMAIL_NOT_VERIFIED` | The route needs a verified email. Go to the verify screen |
| 404 | `NOT_FOUND` | Unknown resource (for example a placement attempt) |
| 409 | `EMAIL_TAKEN` | Signup with an existing email. Suggest login |
| 409 | `ACCOUNT_USES_SOCIAL` | Password login on an account that only has Apple/Google. Show those buttons |
| 429 | `RATE_LIMITED` | Too many attempts. `Retry-After` header in seconds |
| 500 | `INTERNAL` | Unexpected. Generic error with retry |

### Authentication

- **Access token:** JWT, 15-minute lifetime, sent as
  `Authorization: Bearer <accessToken>`.
- **Refresh token:** opaque random string, 30-day lifetime, **rotated on every
  refresh** (the old one stops working). Store both in secure storage on the
  device.
- On `401 UNAUTHORIZED`, call `POST /auth/refresh` once and retry the original
  request. If refresh returns `REFRESH_INVALID`, clear tokens and go to welcome.
- Routes marked 🔒 need an access token. Routes marked ✅ also need a verified
  email. Unmarked routes are public.

---

## Types

```ts
type Lang = 'en' | 'de' | 'fr' | 'es' | 'tr' | 'ar';
type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

interface Tokens {
  accessToken: string;
  accessTokenExpiresAt: string;   // ISO
  refreshToken: string;
  refreshTokenExpiresAt: string;  // ISO
}

interface User {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;          // true immediately for Apple/Google accounts
  authProviders: ('password' | 'apple' | 'google')[];
  onboardingCompleted: boolean;    // true once a full profile has been saved
  createdAt: string;
}

/** Everything collected during onboarding. Stored server-side per user. */
interface Profile {
  interfaceLanguage: Lang;         // app UI language
  spokenLanguage: Lang;            // learner's own language (explanations, placement prompts)
  targetLanguage: 'de';            // learning language; only German is available
  selfRatedLevel: CEFRLevel | null;
  suggestedLevel: CEFRLevel | null; // from placement scoring
  chosenLevel: CEFRLevel;           // what the learner starts at
  dailyMinutes: 5 | 15 | 30;
  reminderEnabled: boolean;
  reminderTime: string;             // "HH:MM", local wall-clock, 24h
  voiceId: string;                  // persona id, e.g. "lena"
  voiceSpeed: 0.75 | 1 | 1.25;
}

interface AuthResult {
  user: User;
  profile: Profile | null;          // null until onboarding is saved
  tokens: Tokens;
  isNewUser: boolean;               // true when this call created the account
}
```

---

## Placement (public, before signup)

Placement runs during onboarding, before an account exists. An **attempt ID
doubles as the `assessmentId`** that signup links to the new account.
Rate-limited per IP.

### `POST /placement/attempts`
Issue a prompt. The server chooses the text (D8). A fresh call can return a
different prompt.

Request
```json
{ "spokenLanguage": "en", "targetLanguage": "de", "selfRatedLevel": "B1" }
```
`selfRatedLevel` may be `null` (treated as `A1`).

**201**
```json
{ "attempt": { "id": "…", "prompt": { "text": "I've lived in Berlin for two years, but I used to live in a small town.", "language": "en" }, "expiresAt": "…" } }
```
The learner says the German translation of `prompt.text` aloud (the existing
speaking-sample task). Attempts expire after 1 hour.

### `POST /placement/attempts/:id/submit`
Submit the on-device transcript, or skip.

Request
```json
{ "transcript": "Ich wohne seit zwei Jahren in Berlin, aber früher …", "skipped": false }
```
- `transcript`: 0–1000 chars. Required (non-empty) unless `skipped: true`.
- One submission per attempt. A second one returns the stored result.

**200**
```json
{
  "result": {
    "assessmentId": "…",            // same as the attempt id
    "suggestedLevel": "B1",
    "selfRatedLevel": "B1",
    "scored": true,                 // false when skipped or scoring was unavailable
    "reason": "Clear meaning and correct word order; past tense needs work.",   // in spokenLanguage; null when scored=false
    "strengths": ["word order"],    // short labels, spokenLanguage; may be empty
    "focusAreas": ["Perfekt"]       // short labels; may be empty
  }
}
```
Scoring rules:
- One LLM call with bounded tokens (D10).
- The model reports observations, not a level: whether the meaning came across
  (`full` / `partial` / `none`) and how many major and minor errors there are. The
  server then applies the rubric: `none` → **A1**; `full` with no major errors →
  the **prompt's level**; anything else → **one level below** the prompt's level.
  `suggestedLevel` is therefore never above the prompt's level. The self-rating is
  not sent to the model.
- If the LLM fails or returns invalid output, the server returns
  `scored: false` with `suggestedLevel = selfRatedLevel` (or `A1`). That is
  **not an error**, so onboarding never blocks.
- Skipped: `scored: false`, `suggestedLevel = selfRatedLevel ?? 'A1'`.

**404** `NOT_FOUND` · **400** `VALIDATION_FAILED` · **429** `RATE_LIMITED`

---

## Email + password

### `POST /auth/signup`
Create an account at the end of onboarding. Sends a verification code (logged to
the backend console in development, D19).

Request
```json
{
  "name": "Alex",
  "email": "alex@example.com",
  "password": "at-least-8-chars",
  "profile": { /* Profile */ },
  "assessmentId": "…"              // optional: links the placement result
}
```
- `email` is case-insensitive and trimmed. `password` is 8–128 chars.
- `profile` is optional (for example a user who signs up from the login screen
  without onboarding). When present, `onboardingCompleted = true`.

**201** `AuthResult` (with `user.emailVerified = false`) · **409** `EMAIL_TAKEN` · **400** `VALIDATION_FAILED`

### `POST /auth/login`
Request `{ "email": "…", "password": "…" }`

**200** `AuthResult` (`isNewUser: false`) · **401** `INVALID_CREDENTIALS` · **409** `ACCOUNT_USES_SOCIAL` · **429** `RATE_LIMITED`

An unverified user can still log in; the client routes them to the verify screen.

### 🔒 `POST /auth/email/verify`
Request `{ "code": "123456" }`

**200** `{ "user": User }` (now `emailVerified: true`) · **400** `CODE_INVALID` / `CODE_EXPIRED` · **429** after 5 wrong attempts per code

### 🔒 `POST /auth/email/resend`
Sends a new code and invalidates the previous one. At most 1 per 60 seconds and
5 per hour.

**202** `{ "resendAvailableAt": "…" }` · **429** `RATE_LIMITED`

### `POST /auth/password/forgot`
Request `{ "email": "…" }`

**202** `{}`, **always**, whether or not the email exists (no account
enumeration). If it exists and has a password, a 6-digit reset code is sent
(logged in development).

### `POST /auth/password/reset`
Request `{ "email": "…", "code": "123456", "newPassword": "…" }`

**200** `AuthResult`: signs the user in and **revokes all their other sessions**.
**400** `CODE_INVALID` / `CODE_EXPIRED` / `VALIDATION_FAILED` · **429**

### `POST /auth/refresh`
Request `{ "refreshToken": "…" }`

**200** `{ "tokens": Tokens }` (new pair; the old refresh token is now invalid) · **401** `REFRESH_INVALID`

### 🔒 `POST /auth/logout`
Request `{ "refreshToken": "…" }` revokes that session.

**204**

---

## Apple and Google

The app signs in with the native SDK and sends the provider's **ID token**; the
backend verifies it (signature, issuer, audience, expiry) and creates or links
the account. Provider-verified emails count as verified.

Account linking:
- A returning provider user is matched by the provider's subject ID, even when
  the token has no email (Apple sends it only on the first sign-in).
- Otherwise, if an account with the same email exists, the provider is added to
  it. If that account's email was **never verified**, its password is removed and
  its sessions revoked: the provider proved who owns the inbox, so a password set
  by someone else must not keep working. Its `authProviders` then no longer
  includes `password`.
- Otherwise a new account is created.
- A new account needs an email the provider marks as verified; if not,
  `401 OAUTH_TOKEN_INVALID`.

### `POST /auth/oauth/google`
```json
{ "idToken": "…", "profile": { /* optional Profile */ }, "assessmentId": "…" }
```

### `POST /auth/oauth/apple`
```json
{ "identityToken": "…", "name": "Alex", "profile": { /* optional */ }, "assessmentId": "…" }
```
Apple returns the user's name **only on the first sign-in**, so the client sends
it when it's available. Apple users may use a private relay email; that's fine.

Both: **200** `AuthResult` (`isNewUser` tells the client whether to continue
onboarding) · **401** `OAUTH_TOKEN_INVALID`

`profile` and `assessmentId` are applied only when the account is new or has no
profile yet.

**Configuration** (env, not secrets in code):

| Side | Variable | Value |
|---|---|---|
| Backend | `GOOGLE_CLIENT_IDS` | Comma-separated accepted audiences: iOS, Android and Web client IDs |
| Backend | `APPLE_BUNDLE_ID` | `com.languageapp.sprachbar` (accepted audience for Apple tokens) |
| Backend | `JWT_ACCESS_SECRET` | Random 32+ bytes |
| Mobile | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | From Google Cloud Console |

Apple sign-in is **iOS only** in F1 (Android needs the web flow, BACKLOG B-AUTH-1).

---

## Me

### 🔒 `GET /me`
**200** `{ "user": User, "profile": Profile | null }`

The app calls this on launch, after restoring tokens, to decide where to go:

| State | Route |
|---|---|
| No tokens / refresh fails | Welcome |
| `emailVerified = false` | Verify email |
| `onboardingCompleted = false` | Onboarding (then `PATCH /me/profile`) |
| Otherwise | The app (tabs) |

`GET /me` is 🔒 but **not** ✅, so an unverified user can still read their own
state. Every other route marked ✅ returns `403 EMAIL_NOT_VERIFIED` when the
email isn't verified.

### 🔒 `PATCH /me/profile`
Partial update of `Profile`. Saving all required fields for the first time sets
`onboardingCompleted = true`. Accepts `assessmentId` too (to link a placement
done after a social sign-in).

Request `{ "chosenLevel": "B2", "voiceSpeed": 1.25 }`

**200** `{ "user": User, "profile": Profile }` · **400** `VALIDATION_FAILED`

---

### 🔒 `POST /me/delete/code`
Emails a 6-digit code that confirms account deletion (logged to the console in
development). Same cooldown as verification resend.

**202** `{ "resendAvailableAt": "…" }` · **429** `RATE_LIMITED`

### 🔒 `DELETE /me`
Permanently deletes the account. Re-authentication is required in the JSON body:

```json
{ "password": "…" }      // accounts with a password
{ "code": "123456" }     // any account; required when authProviders has no "password"
```

Deletes the user, profile, Apple/Google links, sessions and codes, **and the user's
placement attempts** (their transcripts are personal data). All tokens stop
working immediately. The email can be used to sign up again.

**204** · **400** `VALIDATION_FAILED` (neither given) / `CODE_INVALID` / `CODE_EXPIRED`
· **401** `INVALID_CREDENTIALS` (wrong password) · **429** `RATE_LIMITED`

Client: `api.delete('/me', { data: { password } })`, then clear local state and go
to welcome. Required by the App Store for apps that offer signup.

---

## Development notes

- Codes appear in the backend console like
  `[dev-email] verify code for alex@example.com: 123456`.
- Rate limits are relaxed when `NODE_ENV=development`, but still enforced.
- Not in F1: data export (BACKLOG B-AUTH-2), real email delivery (B-PLAT-9),
  Apple on Android (B-AUTH-1).
