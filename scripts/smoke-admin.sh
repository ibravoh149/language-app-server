#!/usr/bin/env bash
# End-to-end smoke test for the admin API (docs/api/admin.md).
#
#   scripts/smoke-admin.sh <api-base-url> <api-log-file>
#
# Needs the API in development (codes are read from its log) and the built grant
# script (`yarn build` in apps/api). Creates a throwaway learner and a throwaway admin.
# Requires curl and jq.
set -euo pipefail

BASE=${1:?api base url}
LOG=${2:?api log file}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
STAMP="$(date +%s)$RANDOM"
pass=0

ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n    %s\n' "$1" "$2" >&2; exit 1; }
req() { # req METHOD PATH [JSON] [TOKEN]
  local args=(-s -m 60 -o /tmp/smoke_admin_body -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json')
  [[ -n ${3:-} ]] && args+=(-d "$3")
  [[ -n ${4:-} ]] && args+=(-H "Authorization: Bearer $4")
  STATUS=$(curl "${args[@]}")
  BODY=$(cat /tmp/smoke_admin_body)
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
PROFILE='{"interfaceLanguage":"en","spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B1","suggestedLevel":"B1","chosenLevel":"B1","dailyMinutes":15,"reminderEnabled":false,"reminderTime":"19:00","voiceId":"mara","voiceSpeed":1}'
signup() { # signup EMAIL → sets TOKEN (verified)
  req POST /auth/signup "{\"name\":\"Smoke\",\"email\":\"$1\",\"password\":\"admin-pass-123\",\"profile\":$PROFILE}"
  [[ $STATUS == 201 ]] || fail "signup $1" "$STATUS $BODY"
  TOKEN=$(j .tokens.accessToken)
  req POST /auth/email/verify "{\"code\":\"$(code_for "$1")\"}" "$TOKEN"
  [[ $STATUS == 200 ]] || fail "verify $1" "$STATUS $BODY"
}

echo "Admin smoke test against $BASE"

LEARNER_EMAIL="learner+$STAMP@example.com"
ADMIN_EMAIL="admin+$STAMP@example.com"
signup "$LEARNER_EMAIL"; LEARNER=$TOKEN
signup "$ADMIN_EMAIL"; ADMIN=$TOKEN
ok "created a learner and an admin-to-be"

# Access
req GET /admin/me ""
expect 401 UNAUTHORIZED "no token → 401"
req GET /admin/me "" "$LEARNER"
expect 403 FORBIDDEN "learner → 403 FORBIDDEN"
(cd "$ROOT/apps/api" && node dist/admin/grant.js "$ADMIN_EMAIL" >/dev/null) || fail "grant" "admin:grant failed"
ok "granted the admin role"
req GET /admin/me "" "$ADMIN"
expect 200 "" "admin → /admin/me"
[[ $(j .user.email) == "$ADMIN_EMAIL" && $(j '.roles[0].key') == admin ]] || fail "me shape" "$BODY"
[[ $(j '.permissions | length') -ge 11 && $(j '.permissions | index("users.delete")') != null ]] || fail "admin has every permission" "$BODY"
ok "admin role has all $(j '.permissions | length') permissions"

ADMIN_ID=$(j .user.id)

# LLM usage (needs the LLM service). A made-up word forces one dictionary call, attributed to the admin.
req GET "/me/words/lookup?q=Smoketestwort$STAMP" "" "$ADMIN"
[[ $STATUS == 200 || $STATUS == 502 ]] || fail "lookup to create an llm call" "$STATUS $BODY"
req GET "/admin/llm/calls?task=vocabulary&limit=1" "" "$ADMIN"
expect 200 "" "llm call log"
[[ $(j '.calls[0].userId') == "$ADMIN_ID" && $(j '.calls[0].outcome') =~ ^(ok|invalid|error)$ && $(j '.calls[0].ms') -ge 0 ]] || fail "call recorded and attributed" "$BODY"
ok "call recorded: $(j '.calls[0].provider') $(j '.calls[0].model') $(j '.calls[0].outcome') $(j '.calls[0].ms')ms, attributed to the admin"
CURSOR=$(j .nextCursor)
if [[ $CURSOR != null ]]; then
  req GET "/admin/llm/calls?limit=1&cursor=$CURSOR" "" "$ADMIN"
  expect 200 "" "call log next page"
fi
req GET "/admin/llm/calls?cursor=garbage" "" "$ADMIN"
expect 400 VALIDATION_FAILED "bad cursor rejected"
req GET "/admin/llm/usage?days=7" "" "$ADMIN"
expect 200 "" "llm usage"
[[ $(j '.series | length') == 7 && $(j '.totals.calls') -ge 1 && $(j '[.byTask[] | select(.task=="vocabulary")] | length') -ge 1 ]] || fail "usage shape" "$BODY"
ok "usage: $(j .totals.calls) calls, $(j .totals.failures) failures, \$$(j .totals.costUsd) in 7 days"
req GET "/admin/llm/usage?days=500" "" "$ADMIN"
expect 400 VALIDATION_FAILED "days out of range rejected"
req GET "/admin/overview?days=14" "" "$ADMIN"
expect 200 "" "overview"
[[ $(j '.series | length') == 14 && $(j '.totals.users') -ge 2 && $(j '.today.signups') -ge 2 && $(j '.levels | length') == 5 && $(j '.streaks | length') == 5 ]] || fail "overview shape" "$BODY"
ok "overview: $(j .totals.users) users, $(j .today.signups) signups today, $(j .today.activeUsers) active today"
req GET /admin/llm/usage "" "$LEARNER"
expect 403 FORBIDDEN "learner can't read usage"

# Users
req GET "/admin/users?q=$(jq -rn --arg v "$LEARNER_EMAIL" '$v|@uri')" "" "$ADMIN"
expect 200 "" "search users"
LEARNER_ID=$(j '.users[0].id')
[[ $(j '.users | length') == 1 && $(j '.users[0].email') == "$LEARNER_EMAIL" && $(j '.users[0].roles | length') == 0 && $(j '.users[0].emailVerified') == true ]] || fail "search result" "$BODY"
ok "found the learner by email"
req GET "/admin/users?limit=2" "" "$ADMIN"
[[ $(j '.users | length') == 2 && $(j .nextCursor) != null ]] || fail "users page" "$BODY"
req GET "/admin/users?limit=2&cursor=$(j .nextCursor)" "" "$ADMIN"
expect 200 "" "users next page"
req GET "/admin/users/$LEARNER_ID" "" "$ADMIN"
expect 200 "" "user detail"
[[ $(j '.user.signInMethods[0]') == password && $(j .profile.chosenLevel) == B1 && $(j .stats.sessions) == 0 ]] || fail "detail shape" "$BODY"
req GET "/admin/users/00000000-0000-0000-0000-000000000000" "" "$ADMIN"
expect 404 NOT_FOUND "unknown user → 404"
req GET "/admin/users/not-a-uuid" "" "$ADMIN"
expect 404 NOT_FOUND "malformed id → 404"
req POST "/admin/users/$LEARNER_ID/verify-email" "{}" "$ADMIN"
expect 200 "" "verify email (idempotent)"

# Suspension
req POST "/admin/users/$LEARNER_ID/suspend" "{}" "$ADMIN"
expect 400 VALIDATION_FAILED "suspend needs a reason"
req POST "/admin/users/$LEARNER_ID/suspend" '{"reason":"smoke test"}' "$ADMIN"
expect 200 "" "suspend"
[[ $(j .user.suspended) == true ]] || fail "suspended flag" "$BODY"
req GET /me "" "$LEARNER"
expect 403 ACCOUNT_SUSPENDED "suspended user's next API call → ACCOUNT_SUSPENDED"
req POST /auth/login "{\"email\":\"$LEARNER_EMAIL\",\"password\":\"admin-pass-123\"}"
expect 403 ACCOUNT_SUSPENDED "suspended user can't sign in"
req POST "/admin/users/$ADMIN_ID/suspend" '{"reason":"oops"}' "$ADMIN"
expect 400 VALIDATION_FAILED "can't suspend yourself"
req POST "/admin/users/$LEARNER_ID/unsuspend" "{}" "$ADMIN"
expect 200 "" "unsuspend"
req POST /auth/login "{\"email\":\"$LEARNER_EMAIL\",\"password\":\"admin-pass-123\"}"
expect 200 "" "signs in again after unsuspend"
LEARNER=$(j .tokens.accessToken)
req GET /admin/users "" "$LEARNER"
expect 403 FORBIDDEN "learner can't list users"

# Audit log
req GET "/admin/audit?actorId=$ADMIN_ID" "" "$ADMIN"
expect 200 "" "audit log"
[[ $(j '[.entries[] | select(.action=="user.suspend" and .target.id=="'"$LEARNER_ID"'" and .reason=="smoke test")] | length') == 1 ]] || fail "suspend audited" "$BODY"
[[ $(j '.entries[0].action') == user.unsuspend && $(j '.entries[0].actor.email') == "$ADMIN_EMAIL" ]] || fail "newest first, actor email" "$BODY"
ok "admin actions are audit-logged, newest first"

# Delete
req DELETE "/admin/users/$LEARNER_ID" '{"reason":"smoke cleanup"}' "$ADMIN"
expect 204 "" "delete user"
req GET "/admin/users/$LEARNER_ID" "" "$ADMIN"
expect 404 NOT_FOUND "deleted user is gone"
req GET "/admin/audit?action=user.delete&limit=1" "" "$ADMIN"
[[ $(j '.entries[0].target.id') == "$LEARNER_ID" && $(j '.entries[0].meta.email') == "$LEARNER_EMAIL" ]] || fail "delete audited" "$BODY"
ok "delete audited with the email kept"

echo "All $pass checks passed."
