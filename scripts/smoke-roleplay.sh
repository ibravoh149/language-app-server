#!/usr/bin/env bash
# End-to-end smoke test for F2 roleplay.
#
#   scripts/smoke-roleplay.sh <api-base-url> <api-log-file>
#
# Needs the API in development (codes are read from its log), a seeded database
# (`yarn db:seed`) and the LLM service. Creates a throwaway verified user.
# Checks shapes and rules, not the tutor's German; use eval scripts for quality.
# Requires curl and jq.
set -euo pipefail

BASE=${1:?api base url}
LOG=${2:?api log file}
EMAIL="roleplay+$(date +%s)$RANDOM@example.com"
pass=0
ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n    %s\n' "$1" "$2" >&2; exit 1; }
req() { # req METHOD PATH [JSON] [TOKEN]
  local args=(-s -m 180 -o /tmp/smoke_body -w '%{http_code}' -X "$1" "$BASE$2" -H 'Content-Type: application/json')
  [[ -n ${3:-} ]] && args+=(-d "$3")
  [[ -n ${4:-} ]] && args+=(-H "Authorization: Bearer $4")
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

PROFILE='{"interfaceLanguage":"en","spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B1","suggestedLevel":"B1","chosenLevel":"B1","dailyMinutes":15,"reminderEnabled":false,"reminderTime":"19:00","voiceId":"mara","voiceSpeed":1}'
echo "Roleplay smoke test against $BASE"

req POST /auth/signup "{\"name\":\"Rolly\",\"email\":\"$EMAIL\",\"password\":\"roleplay-pass-1\",\"profile\":$PROFILE}"
ACCESS=$(j .tokens.accessToken)
req GET /scenarios "" "$ACCESS"
expect 403 EMAIL_NOT_VERIFIED "unverified users can't use roleplay"
req POST /auth/email/verify "{\"code\":\"$(code_for "$EMAIL")\"}" "$ACCESS"
expect 200 "" "verified"

req GET /scenarios "" "$ACCESS"
expect 200 "" "list scenarios"
[[ $(j '.scenarios|length') -ge 4 && $(j '.scenarios[0].level') == A2 && $(j '.scenarios[0].timesPracticed') == 0 ]] || fail "scenario list shape" "$BODY"
ok "$(j '.scenarios|length') scenarios, sorted by level, no history yet"

req GET /scenarios/doctor "" "$ACCESS"
expect 200 "" "scenario by slug"
[[ $(j '.scenario.goals|length') -ge 1 && $(j '.scenario.words[0].de') != null && $(j '.scenario.aiPersona') == null ]] || fail "detail shape (persona must stay server-side)" "$BODY"
ok "detail has goals/words; aiPersona not exposed"

req GET /scenarios/nope "" "$ACCESS"
expect 404 NOT_FOUND "unknown scenario"

req POST /sessions '{"scenarioId":"doctor"}' "$ACCESS"
expect 201 "" "start session"
SID=$(j .session.id)
[[ $(j .opening.role) == ai && -n $(j .opening.text) ]] || fail "opening line" "$BODY"
ok "opening: $(j .opening.text)"

req POST /sessions/$SID/turns '{"text":""}' "$ACCESS"
expect 400 VALIDATION_FAILED "empty turn rejected"

req POST /sessions/$SID/turns '{"text":"Ich habe seit gestern Kopfschmerzen.","inputMode":"voice"}' "$ACCESS"
expect 200 "" "turn 1 (correct German)"
[[ $(j .userTurn.role) == user && $(j .reply.role) == ai && -n $(j .reply.text) ]] || fail "turn shape" "$BODY"
ok "reply: $(j .reply.text) | understood=$(j .understood) corrections=$(j '.corrections|length')"
[[ $(j .streak.current) == 1 && $(j .streak.extendedToday) == true ]] || [[ $(j .understood) == false ]] || fail "streak extended" "$BODY"
ok "streak: current=$(j .streak.current) extendedToday=$(j .streak.extendedToday)"

req POST /sessions/$SID/turns '{"text":"Ich habe gestern zum Arzt gegeht und ich habe Fieber gehabt.","inputMode":"voice"}' "$ACCESS"
expect 200 "" "turn 2 (with a mistake)"
ok "reply: $(j .reply.text) | corrections: $(j '[.corrections[] | "\(.original) → \(.corrected) (\(.ruleName))"] | join("; ")')"
[[ $(j .streak.extendedToday) == false ]] || fail "streak extends once per day" "$BODY"
ok "streak doesn't extend twice in a day"

req GET /sessions/$SID "" "$ACCESS"
expect 200 "" "resume session"
[[ $(j '.turns|length') -eq 5 ]] || fail "5 turns (opening + 2×2)" "$BODY"
ok "transcript has $(j '.turns|length') turns"

req GET /sessions/$SID/corrections "" "$ACCESS"
expect 200 "" "session corrections"

OTHER="other+$(date +%s)$RANDOM@example.com"
req POST /auth/signup "{\"name\":\"Other\",\"email\":\"$OTHER\",\"password\":\"other-pass-123\"}"
OTHER_ACCESS=$(j .tokens.accessToken)
curl -s -o /dev/null -X POST "$BASE/auth/email/verify" -H 'Content-Type: application/json' -H "Authorization: Bearer $OTHER_ACCESS" -d "{\"code\":\"$(code_for "$OTHER")\"}"
req GET /sessions/$SID "" "$OTHER_ACCESS"
expect 404 NOT_FOUND "someone else's session reads as not found"

req POST /sessions/$SID/end "" "$ACCESS"
expect 200 "" "end session"
[[ $(j .summary.turnCount) == 2 ]] || fail "summary" "$BODY"
ok "summary: $(j -c .summary)"
req POST /sessions/$SID/end "" "$ACCESS"
expect 200 "" "ending again is idempotent"

req POST /sessions/$SID/turns '{"text":"Hallo"}' "$ACCESS"
expect 409 SESSION_ENDED "turn after end rejected"

req GET /me/progress "" "$ACCESS"
expect 200 "" "progress"
[[ $(j .sessionsCompleted) == 1 ]] || fail "progress counts" "$BODY"
ok "progress: $(j -c '{streak, spokenTurnsToday, sessionsCompleted, secondsPracticedToday}')"
TODAY=$(date -u +%F)
[[ $(j '.week|length') == 7 && $(j '.week[6].date') == "$TODAY" && $(j '.week[6].turns') == 2 && $(j '.secondsPracticedToday') -gt 0 && $(j '.secondsPracticedToday') == $(j '.week[6].secondsPracticed') ]] \
  || fail "week: 7 days ending today, today's turns and practice time" "$BODY"
ok "week: 7 days, today = $(j '.week[6].turns') turns, $(j .secondsPracticedToday)s practised"

req GET /scenarios "" "$ACCESS"
[[ $(j '[.scenarios[] | select(.slug=="doctor")][0].timesPracticed') == 1 ]] || fail "timesPracticed" "$BODY"
ok "doctor now practised once"

echo "All $pass checks passed."
