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

echo "All $pass checks passed."
