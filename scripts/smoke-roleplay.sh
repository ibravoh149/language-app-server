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
[[ $(j '.actions|type') == array && $(j '.goalsAchieved|type') == array ]] || fail "v3 actions + goalsAchieved present" "$BODY"
ok "v3 fields: actions=$(j -c '[.actions[].type]') goalsAchieved=$(j -c .goalsAchieved)"
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

# Idempotency (v3.1): a retry with the same clientTurnId replays the stored response.
KEY=$(uuidgen | tr 'A-Z' 'a-z')
llm_calls() { sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | grep -c "task=roleplay_turn" || true; }
req POST /sessions/$SID/turns "{\"text\":\"Ich habe auch Fieber.\",\"inputMode\":\"voice\",\"clientTurnId\":\"$KEY\"}" "$ACCESS"
expect 200 "" "turn with an idempotency key"
FIRST_TURN=$(j .userTurn.id); FIRST_BODY=$(jq -cS . <<<"$BODY"); CALLS=$(llm_calls)
req POST /sessions/$SID/turns "{\"text\":\"Ich habe auch Fieber.\",\"inputMode\":\"voice\",\"clientTurnId\":\"$KEY\"}" "$ACCESS"
expect 200 "" "retry with the same key"
[[ "$(jq -cS . <<<"$BODY")" == "$FIRST_BODY" ]] || fail "retry replays the identical response" "$BODY"
[[ $(llm_calls) == "$CALLS" ]] || fail "retry makes no LLM call" "calls $CALLS → $(llm_calls)"
ok "retry replayed the same turn ($FIRST_TURN) without an LLM call"
req POST /sessions/$SID/turns "{\"text\":\"Etwas anderes.\",\"clientTurnId\":\"$KEY\"}" "$ACCESS"
expect 409 IDEMPOTENCY_KEY_REUSED "same key with different text is refused"
req POST /sessions/$SID/turns '{"text":"Hallo","clientTurnId":"not-a-uuid"}' "$ACCESS"
expect 400 VALIDATION_FAILED "malformed key rejected"
RACE=$(uuidgen | tr 'A-Z' 'a-z')
for n in 1 2; do curl -s -m 180 -o /tmp/smoke_race_$n -X POST "$BASE/sessions/$SID/turns" -H 'Content-Type: application/json' -H "Authorization: Bearer $ACCESS" -d "{\"text\":\"Mir ist auch schlecht.\",\"clientTurnId\":\"$RACE\"}" & done; wait
[[ $(jq -r .userTurn.id /tmp/smoke_race_1) == $(jq -r .userTurn.id /tmp/smoke_race_2) && $(jq -r .userTurn.id /tmp/smoke_race_1) != null ]] \
  || fail "two simultaneous copies end up as one turn" "$(cat /tmp/smoke_race_1) | $(cat /tmp/smoke_race_2)"
ok "two simultaneous copies became one turn"
req GET /sessions/$SID "" "$ACCESS"
[[ $(j '.turns|length') -eq 9 ]] || fail "transcript: opening + 4 learner turns + 4 replies, no duplicates" "$(j '.turns|length') turns"
ok "no duplicate turns stored ($(j '.turns|length') turns)"

OTHER="other+$(date +%s)$RANDOM@example.com"
req POST /auth/signup "{\"name\":\"Other\",\"email\":\"$OTHER\",\"password\":\"other-pass-123\"}"
OTHER_ACCESS=$(j .tokens.accessToken)
curl -s -o /dev/null -X POST "$BASE/auth/email/verify" -H 'Content-Type: application/json' -H "Authorization: Bearer $OTHER_ACCESS" -d "{\"code\":\"$(code_for "$OTHER")\"}"
req GET /sessions/$SID "" "$OTHER_ACCESS"
expect 404 NOT_FOUND "someone else's session reads as not found"

req POST /sessions/$SID/end "" "$ACCESS"
expect 200 "" "end session"
[[ $(j .summary.turnCount) == 4 ]] || fail "summary" "$BODY"
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
[[ $(j '.week|length') == 7 && $(j '.week[6].date') == "$TODAY" && $(j '.week[6].turns') == 4 && $(j '.secondsPracticedToday') -gt 0 && $(j '.secondsPracticedToday') == $(j '.week[6].secondsPracticed') ]] \
  || fail "week: 7 days ending today, today's turns and practice time" "$BODY"
ok "week: 7 days, today = $(j '.week[6].turns') turns, $(j .secondsPracticedToday)s practised"

req GET /scenarios "" "$ACCESS"
[[ $(j '[.scenarios[] | select(.slug=="doctor")][0].timesPracticed') == 1 ]] || fail "timesPracticed" "$BODY"
ok "doctor now practised once"

# My Words (v3)
req POST /me/words '{"lemma":"die Kaution"}' "$ACCESS"
expect 201 "" "save a word manually"
WID=$(j .word.id)
[[ $(j .word.lemma) == Kaution && $(j .word.article) == die && $(j .word.saved) == true && -n $(j .word.meaning) ]] || fail "word details from dictionary" "$BODY"
ok "word: $(j .word.article) $(j .word.lemma) ($(j .word.plural)) = $(j .word.meaning) — $(j .word.example)"
req POST /me/words '{"lemma":"Kaution"}' "$ACCESS"
expect 200 "" "saving again is idempotent (and served from the cache)"
req GET /me/words "" "$ACCESS"
expect 200 "" "list My Words"
[[ $(j '[.words[] | select(.lemma=="Kaution")] | length') == 1 ]] || fail "listed once" "$BODY"
req DELETE /me/words/$WID "" "$ACCESS"
expect 204 "" "remove a word"
req DELETE /me/words/$WID "" "$ACCESS"
expect 404 NOT_FOUND "removing again → not found"
req POST /me/words '{"lemma":""}' "$ACCESS"
expect 400 VALIDATION_FAILED "empty word rejected"

# Tap-a-word lookup (v3.2): never saves; inflected forms resolve to the lemma
req GET "/me/words/lookup?q=Kaution" "" "$ACCESS"
expect 200 "" "look up a word"
[[ $(j .word.lemma) == Kaution && $(j .word.saved) == false ]] || fail "lookup doesn't save" "$BODY"
req GET /me/words "" "$ACCESS"
[[ $(j '[.words[] | select(.lemma=="Kaution")] | length') == 0 ]] || fail "lookup left My Words alone" "$BODY"
ok "lookup left My Words alone"
req POST /me/words '{"lemma":"Kaution"}' "$ACCESS"
SAVED_ID=$(j .word.id)
req GET "/me/words/lookup?q=Kaution" "" "$ACCESS"
[[ $(j .word.saved) == true && $(j .word.id) == "$SAVED_ID" ]] || fail "saved word shows its user_words id" "$BODY"
ok "a saved word shows saved=true and its My Words id"
req GET "/me/words/lookup?q=Schmerzen&context=$(printf "Ich%%20habe%%20starke%%20Schmerzen.%%20%.0s" $(seq 1 30))" "" "$ACCESS"
expect 200 "" "look up an inflected form with context"
LEMMA=$(j .word.lemma); FIRST_ID=$(j .word.id)
ok "Schmerzen → $(j .word.article) $LEMMA = $(j .word.meaning)"
req GET "/me/words/lookup?q=Schmerzen" "" "$ACCESS"
[[ $(j .word.id) == "$FIRST_ID" ]] || fail "second lookup hits the cache" "$BODY"
ok "second lookup of the inflected form hits the cache"
req GET "/me/words/lookup?q=hatte" "" "$ACCESS"
expect 200 "" "look up a conjugated verb"
ok "hatte → $(j .word.lemma) = $(j .word.meaning)"
if [[ $(j .word.lemma) != hatte ]]; then
  req GET "/me/words/lookup?q=hatte" "" "$ACCESS"
  n=$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | grep -c 'from "hatte"' || true)
  [[ $n -le 1 ]] || fail "alias cache" "expected at most 1 dictionary call for \"hatte\", saw $n"
  ok "\"hatte\" is now an alias: the repeat cost no LLM call"
fi
req GET "/me/words/lookup?q=" "" "$ACCESS"
expect 400 VALIDATION_FAILED "empty lookup rejected"
req GET "/me/words/lookup?q=$(printf 'a%.0s' $(seq 1 61))" "" "$ACCESS"
expect 400 VALIDATION_FAILED "over-long lookup rejected"

echo "All $pass checks passed."
