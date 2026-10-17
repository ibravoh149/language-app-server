#!/usr/bin/env bash
# End-to-end smoke test for the F1 email/password auth flow.
#
#   scripts/smoke-auth.sh <api-base-url> <api-log-file>
#   e.g. scripts/smoke-auth.sh http://localhost:3000/api/v1 /tmp/api.log
#
# The API must be running in development mode with its output going to the log
# file: verification and reset codes are read from the "[dev-email]" lines (D19).
# Requires curl and jq. Creates a throwaway user with a random email.
set -euo pipefail

BASE=${1:?api base url}
LOG=${2:?api log file}
EMAIL="smoke+$(date +%s)$RANDOM@example.com"
PASS="correct-horse-1"
NEWPASS="battery-staple-2"
pass=0

ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n    %s\n' "$1" "$2" >&2; exit 1; }

# req METHOD PATH [JSON] [TOKEN] → sets $STATUS and $BODY
req() {
  local args=(-s -o /tmp/smoke_body -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json')
  [[ -n ${3:-} ]] && args+=(-d "$3")
  [[ -n ${4:-} ]] && args+=(-H "Authorization: Bearer $4")
  STATUS=$(curl "${args[@]}")
  BODY=$(cat /tmp/smoke_body)
}
expect() { # expect STATUS [error-code] label
  [[ $STATUS == "$1" ]] || fail "$3" "expected HTTP $1, got $STATUS: $BODY"
  if [[ -n $2 ]]; then
    [[ $(jq -r '.error.code' <<<"$BODY") == "$2" ]] || fail "$3" "expected error $2, got: $BODY"
  fi
  ok "$3"
}
code_for() { # latest code logged for this email and purpose
  local c=""
  for _ in $(seq 1 20); do
    # Strip ANSI colours from Nest's logger, then match the email literally.
    c=$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | grep -F "$1 code for $EMAIL:" | tail -1 | grep -oE '[0-9]{6}$' || true)
    [[ -n $c ]] && break
    sleep 0.25
  done
  [[ -n $c ]] || fail "read $1 code from log" "no code for $EMAIL in $LOG"
  echo "$c"
}

PROFILE='{"interfaceLanguage":"en","spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B1","suggestedLevel":"B1","chosenLevel":"B1","dailyMinutes":15,"reminderEnabled":true,"reminderTime":"19:00","voiceId":"lena","voiceSpeed":1}'

echo "Smoke test against $BASE as $EMAIL"
curl -s --retry 30 --retry-connrefused --retry-delay 1 "$BASE/health" >/dev/null || fail "health" "API not reachable"
ok "API reachable"

req POST /auth/signup '{"name":"","email":"not-an-email","password":"short"}'
expect 400 VALIDATION_FAILED "signup validation errors"

req POST /auth/signup "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"$PASS\",\"profile\":$PROFILE}"
expect 201 "" "signup with profile"
ACCESS=$(jq -r '.tokens.accessToken' <<<"$BODY"); REFRESH=$(jq -r '.tokens.refreshToken' <<<"$BODY")
[[ $(jq -r '.user.emailVerified' <<<"$BODY") == false ]] || fail "new user unverified" "$BODY"
[[ $(jq -r '.user.onboardingCompleted' <<<"$BODY") == true ]] || fail "onboarding completed" "$BODY"
[[ $(jq -r '.profile.reminderTime' <<<"$BODY") == "19:00" ]] || fail "profile saved" "$BODY"
ok "signup returns unverified user, completed onboarding, saved profile"

req POST /auth/signup "{\"name\":\"Smoke\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
expect 409 EMAIL_TAKEN "duplicate signup"

req GET /me
expect 401 UNAUTHORIZED "GET /me without token"

req GET /me "" "$ACCESS"
expect 200 "" "GET /me works while unverified"

req POST /auth/email/resend "" "$ACCESS"
expect 429 RATE_LIMITED "resend within cooldown"

req POST /auth/email/verify '{"code":"000000"}' "$ACCESS"
[[ $STATUS == 400 ]] || fail "wrong code" "$STATUS $BODY"
ok "wrong verification code rejected"

CODE=$(code_for verify)
req POST /auth/email/verify "{\"code\":\"$CODE\"}" "$ACCESS"
expect 200 "" "verify with logged code"
[[ $(jq -r '.user.emailVerified' <<<"$BODY") == true ]] || fail "verified" "$BODY"

req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"wrong-password\"}"
expect 401 INVALID_CREDENTIALS "login with wrong password"

UPPER_EMAIL=$(tr "[:lower:]" "[:upper:]" <<<"$EMAIL")
req POST /auth/login "{\"email\":\"$UPPER_EMAIL\",\"password\":\"$PASS\"}"
expect 200 "" "login (email is case-insensitive)"

req POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"
expect 200 "" "refresh rotates tokens"
NEW_REFRESH=$(jq -r '.tokens.refreshToken' <<<"$BODY"); ACCESS=$(jq -r '.tokens.accessToken' <<<"$BODY")

req POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"
expect 401 REFRESH_INVALID "reusing a rotated refresh token is rejected"

req POST /auth/refresh "{\"refreshToken\":\"$NEW_REFRESH\"}"
expect 401 REFRESH_INVALID "token reuse revoked the whole session family"

req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$PASS\"}"
ACCESS=$(jq -r '.tokens.accessToken' <<<"$BODY"); REFRESH=$(jq -r '.tokens.refreshToken' <<<"$BODY")

req PATCH /me/profile '{"chosenLevel":"B2","voiceSpeed":1.25}' "$ACCESS"
expect 200 "" "PATCH /me/profile"
[[ $(jq -r '.profile.chosenLevel' <<<"$BODY") == B2 ]] || fail "profile patched" "$BODY"

req PATCH /me/profile '{"dailyMinutes":7}' "$ACCESS"
expect 400 VALIDATION_FAILED "invalid profile patch"

req POST /auth/password/forgot '{"email":"nobody-here@example.com"}'
expect 202 "" "forgot password for unknown email still 202"

req POST /auth/password/forgot "{\"email\":\"$EMAIL\"}"
expect 202 "" "forgot password"
RCODE=$(code_for reset)

req POST /auth/password/reset "{\"email\":\"$EMAIL\",\"code\":\"$RCODE\",\"newPassword\":\"$NEWPASS\"}"
expect 200 "" "reset password with logged code"

req POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"
expect 401 REFRESH_INVALID "reset revoked older sessions"

req POST /auth/login "{\"email\":\"$EMAIL\",\"password\":\"$NEWPASS\"}"
expect 200 "" "login with new password"
ACCESS=$(jq -r '.tokens.accessToken' <<<"$BODY"); REFRESH=$(jq -r '.tokens.refreshToken' <<<"$BODY")

req POST /auth/logout "{\"refreshToken\":\"$REFRESH\"}" "$ACCESS"
expect 204 "" "logout"

req POST /auth/refresh "{\"refreshToken\":\"$REFRESH\"}"
expect 401 REFRESH_INVALID "refresh after logout"

echo "All $pass checks passed."
