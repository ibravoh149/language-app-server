#!/usr/bin/env bash
# End-to-end smoke test for Sign in with Google / Apple, using locally signed test tokens.
#
#   scripts/smoke-oauth.sh <api-base-url> <keys-dir> <api-log-file>
#
# Setup (development only):
#   node apps/api/scripts/oauth-test-keys.js init /tmp/oauth-keys
#   (cd /tmp/oauth-keys && python3 -m http.server 8765) &
#   start the API with:
#     OAUTH_TEST_JWKS_URL=http://localhost:8765/jwks.json
#     GOOGLE_CLIENT_IDS=test-google-client   APPLE_BUNDLE_ID=com.languageapp.sprachbar
#   and its output written to <api-log-file> (verification codes are read from it).
# Requires curl, jq and node.
set -euo pipefail

BASE=${1:?api base url}
KEYS=${2:?keys dir}
LOG=${3:?api log file}
HERE=$(cd "$(dirname "$0")/.." && pwd)
TOOL="$HERE/apps/api/scripts/oauth-test-keys.js"
GOOGLE_AUD=test-google-client
APPLE_AUD=com.languageapp.sprachbar
RUN=$(date +%s)$RANDOM
pass=0

ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n    %s\n' "$1" "$2" >&2; exit 1; }
tok() { node "$TOOL" token "$KEYS" "$@"; }
req() {
  local args=(-s -o /tmp/smoke_body -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json')
  [[ -n ${3:-} ]] && args+=(-d "$3")
  STATUS=$(curl "${args[@]}")
  BODY=$(cat /tmp/smoke_body)
}
expect() {
  [[ $STATUS == "$1" ]] || fail "$3" "expected HTTP $1, got $STATUS: $BODY"
  if [[ -n $2 ]]; then [[ $(jq -r '.error.code' <<<"$BODY") == "$2" ]] || fail "$3" "expected $2: $BODY"; fi
  ok "$3"
}
j() { jq -r "$1" <<<"$BODY"; }
code_for() {
  local c=""
  for _ in $(seq 1 20); do
    c=$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | grep -F "verify code for $1:" | tail -1 | grep -oE '[0-9]{6}$' || true)
    [[ -n $c ]] && break
    sleep 0.25
  done
  [[ -n $c ]] || fail "read code" "no code for $1"
  echo "$c"
}

PROFILE='{"interfaceLanguage":"tr","spokenLanguage":"tr","targetLanguage":"de","selfRatedLevel":"A2","suggestedLevel":"A2","chosenLevel":"A2","dailyMinutes":30,"reminderEnabled":true,"reminderTime":"07:15","voiceId":"lena","voiceSpeed":1}'
echo "OAuth smoke test against $BASE"

G_EMAIL="g$RUN@example.com"
req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-$RUN "$G_EMAIL")\",\"profile\":$PROFILE}"
expect 200 "" "Google: new account"
G_ID=$(j .user.id)
[[ $(j .isNewUser) == true && $(j .user.emailVerified) == true && $(j .user.onboardingCompleted) == true && $(j '.user.authProviders|join(",")') == google ]] \
  || fail "new Google user is verified, onboarded, google-only" "$BODY"
ok "new Google user is verified, onboarded, provider=google"

req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-$RUN "$G_EMAIL")\"}"
expect 200 "" "Google: returning user"
[[ $(j .isNewUser) == false && $(j .user.id) == "$G_ID" ]] || fail "same account" "$BODY"
ok "returning Google user maps to the same account"

req POST /auth/oauth/google "{\"idToken\":\"$(tok google wrong-audience g-$RUN "$G_EMAIL")\"}"
expect 401 OAUTH_TOKEN_INVALID "Google: wrong audience rejected"

req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-exp-$RUN "x$G_EMAIL" true -1m)\"}"
expect 401 OAUTH_TOKEN_INVALID "Google: expired token rejected"

req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-unv-$RUN "u$G_EMAIL" false)\"}"
expect 401 OAUTH_TOKEN_INVALID "Google: unverified email rejected for a new account"

req POST /auth/oauth/apple "{\"identityToken\":\"$(tok apple $APPLE_AUD a-$RUN -)\"}"
expect 401 OAUTH_TOKEN_INVALID "Apple: first sign-in without email rejected"

A_EMAIL="a$RUN@privaterelay.appleid.com"
req POST /auth/oauth/apple "{\"identityToken\":\"$(tok apple $APPLE_AUD a-$RUN "$A_EMAIL" true)\",\"name\":\"Ada\"}"
expect 200 "" "Apple: new account (email_verified as string)"
A_ID=$(j .user.id)
[[ $(j .user.name) == Ada && $(j .user.onboardingCompleted) == false && $(j .profile) == null ]] || fail "apple name + no profile" "$BODY"
ok "Apple name kept; no profile → onboarding not completed"

req POST /auth/oauth/apple "{\"identityToken\":\"$(tok apple $APPLE_AUD a-$RUN -)\",\"profile\":$PROFILE}"
expect 200 "" "Apple: returning user without email (matched by subject)"
[[ $(j .user.id) == "$A_ID" && $(j .user.onboardingCompleted) == true ]] || fail "profile applied on return" "$BODY"
ok "returning Apple user gets the profile applied"

# Linking to an UNVERIFIED password account: the password must stop working.
U_EMAIL="unverified$RUN@example.com"
req POST /auth/signup "{\"name\":\"Mallory\",\"email\":\"$U_EMAIL\",\"password\":\"attacker-pass-1\"}"
expect 201 "" "unverified password account exists"
U_ID=$(j .user.id); U_REFRESH=$(j .tokens.refreshToken)
req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-u-$RUN "$U_EMAIL")\"}"
expect 200 "" "Google links to the existing email"
[[ $(j .user.id) == "$U_ID" && $(j '.user.authProviders|join(",")') == google && $(j .user.emailVerified) == true ]] \
  || fail "unverified password removed on link" "$BODY"
ok "unverified password removed; account now google-only and verified"
req POST /auth/login "{\"email\":\"$U_EMAIL\",\"password\":\"attacker-pass-1\"}"
expect 409 ACCOUNT_USES_SOCIAL "old password no longer works"
req POST /auth/refresh "{\"refreshToken\":\"$U_REFRESH\"}"
expect 401 REFRESH_INVALID "old password sessions revoked"

# Linking to a VERIFIED password account keeps the password.
V_EMAIL="verified$RUN@example.com"
req POST /auth/signup "{\"name\":\"Vera\",\"email\":\"$V_EMAIL\",\"password\":\"vera-pass-123\"}"
V_ACCESS=$(j .tokens.accessToken)
CODE=$(code_for "$V_EMAIL")
[[ $(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/auth/email/verify" -H 'Content-Type: application/json' -H "Authorization: Bearer $V_ACCESS" -d "{\"code\":\"$CODE\"}") == 200 ]] || fail "verify" "verification failed"
req POST /auth/oauth/google "{\"idToken\":\"$(tok google $GOOGLE_AUD g-v-$RUN "$V_EMAIL")\"}"
expect 200 "" "Google links to a verified password account"
[[ $(j '.user.authProviders|sort|join(",")') == "google,password" ]] || fail "both providers" "$BODY"
ok "verified account keeps its password and gains google"
req POST /auth/login "{\"email\":\"$V_EMAIL\",\"password\":\"vera-pass-123\"}"
expect 200 "" "password login still works"

echo "All $pass checks passed."
