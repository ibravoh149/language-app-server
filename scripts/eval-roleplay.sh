#!/usr/bin/env bash
# Roleplay tutor quality check (BACKLOG B-LLM-2): fixed learner lines with the
# expected "understood" flag and whether a correction is expected.
#
#   scripts/eval-roleplay.sh <api-base-url> <api-log-file>
#
# Run against whichever model TASK_ROUTING sends roleplay_turn to, to compare
# models. Each case starts a fresh session (scripted opening + one learner turn).
# Creates a throwaway verified user. Requires curl, jq and the dev stack.
set -uo pipefail

BASE=${1:?api base url}
LOG=${2:?api log file}
EMAIL="eval-rp+$(date +%s)$RANDOM@example.com"
total=0; good=0

post() { curl -s -m 180 -X POST "$BASE$1" -H 'Content-Type: application/json' ${3:+-H "Authorization: Bearer $3"} -d "$2"; }
code_for() {
  for _ in $(seq 1 20); do
    c=$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | grep -F "verify code for $1:" | tail -1 | grep -oE '[0-9]{6}$')
    [[ -n $c ]] && { echo "$c"; return; }
    sleep 0.25
  done
}

PROFILE='{"interfaceLanguage":"en","spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B1","suggestedLevel":"B1","chosenLevel":"B1","dailyMinutes":15,"reminderEnabled":false,"reminderTime":"19:00","voiceId":"mara","voiceSpeed":1}'
TOKEN=$(post /auth/signup "{\"name\":\"Eval\",\"email\":\"$EMAIL\",\"password\":\"eval-pass-123\",\"profile\":$PROFILE}" | jq -r .tokens.accessToken)
post /auth/email/verify "{\"code\":\"$(code_for "$EMAIL")\"}" "$TOKEN" >/dev/null

# case_ <scenario> <learner text> <expected understood true|false> <expect correction yes|no> <label>
case_() {
  local sid out understood n mark
  sid=$(post /sessions "{\"scenarioId\":\"$1\"}" "$TOKEN" | jq -r .session.id)
  out=$(post "/sessions/$sid/turns" "$(jq -nc --arg t "$2" '{text:$t,inputMode:"voice"}')" "$TOKEN")
  understood=$(jq -r .understood <<<"$out"); n=$(jq -r '.corrections|length' <<<"$out")
  total=$((total + 1))
  if [[ $understood == "$3" ]] && { [[ $4 == yes && $n -gt 0 ]] || [[ $4 == no && $n -eq 0 ]]; }; then good=$((good + 1)); mark="✓"; else mark="✗"; fi
  printf '  %s %-30s understood=%s corrections=%s  reply: %s\n' "$mark" "$5" "$understood" "$n" "$(jq -r '.reply.text // .error.code' <<<"$out")"
  [[ $n -gt 0 ]] && jq -r '.corrections[] | "      → \(.original) ⇒ \(.corrected) [\(.ruleName)]"' <<<"$out"
  post "/sessions/$sid/end" '{}' "$TOKEN" >/dev/null
}

echo "Roleplay eval against $BASE"
case_ doctor "Ich habe seit gestern Kopfschmerzen."                 true  no  "correct symptom"
case_ doctor "Ich habe Fieber gehabt."                              true  no  "correct (no false fix)"
case_ doctor "Ich habe gestern zum Arzt gegeht."                    true  yes "Perfekt with sein"
case_ cafe   "Ich hätte gern einen Kaffee und ein Stück Kuchen, bitte." true no "correct order"
case_ cafe   "Ich möchte ein Kaffee."                               true  yes "accusative article"
case_ cafe   "Das habe ich nicht bestellt, ich wollte einen Tee."   true  no  "correct complaint"
case_ train  "Eine Fahrkarte nach Hamburg, bitte."                  true  no  "correct ticket"
case_ train  "Ich will fahren nach Hamburg heute."                  true  yes "word order"
case_ flat   "Wie hoch ist die Miete?"                              true  no  "correct question"
case_ flat   "Banane Fenster blau gestern Tisch."                   false no  "nonsense"

echo "$good/$total as expected."
