#!/usr/bin/env bash
# Placement scoring quality check (BACKLOG B-LLM-2): runs fixed transcripts against
# fixed prompts and compares the level with what a teacher would give.
#
#   scripts/eval-placement.sh <api-base-url> [api-log-file]
#   EVAL_DELAY=3 scripts/eval-placement.sh …   # seconds between cases, to stay under hosted rate limits
#
# Run it against whichever model TASK_ROUTING sends placement_scoring to (local Ollama
# or DeepSeek) to compare models. Dev only: it pins each attempt's prompt directly in
# the Compose database. Requires curl, jq and the running dev stack.
# Add cases at the bottom; keep the known-hard ones even when they fail.
set -uo pipefail

BASE=${1:?api base url}
LOG=${2:-}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
Q() { (cd "$ROOT" && docker compose -p languageapp-backend exec -T postgres psql -U languageapp -tAc "$1"); }
total=0; good=0
DELAY=${EVAL_DELAY:-0}
TASKS="placement_scoring"
LOG_START=$( [[ -n ${LOG:-} && -f ${LOG:-} ]] && wc -l <"$LOG" || echo 0)

# Which model actually answered? A rate-limited hosted provider falls back to the local
# model, which would silently mix models in one run. Counted from the API log.
providers_report() {
  [[ -n ${LOG:-} && -f $LOG ]] || { echo "(pass the API log file to see which model answered)"; return; }
  local counts
  counts=$(sed -E $'s/\x1b\\[[0-9;]*m//g' "$LOG" | awk -v from="$LOG_START" 'NR > from && /LlmClient/ && /task=('"$TASKS"')/ { for (i = 1; i <= NF; i++) if ($i ~ /^provider=/) { sub("provider=", "", $i); n[$i]++ } } END { for (p in n) printf "%s=%d ", p, n[p] }')
  echo "Answered by: ${counts:-nothing logged}"
  if [[ $(wc -w <<<"$counts") -gt 1 ]]; then
    echo "⚠ MIXED RUN: more than one model answered (rate-limit fallback?). Results are not valid for one model; rerun with a larger EVAL_DELAY."
  fi
}

# case <english prompt> <german transcript> <expected level> <label>
case_() {
  sleep "$DELAY"
  local pid id out
  pid=$(Q "select id from placement_prompts where text = \$\$$1\$\$ and spoken_language='en' limit 1")
  [[ -n $pid ]] || { echo "  ? prompt not found: $1"; return; }
  id=$(curl -s -X POST "$BASE/placement/attempts" -H 'Content-Type: application/json' \
    -d '{"spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B2"}' | jq -r .attempt.id)
  Q "update placement_attempts set prompt_id='$pid' where id='$id'" >/dev/null
  out=$(curl -s -m 120 -X POST "$BASE/placement/attempts/$id/submit" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg t "$2" '{transcript:$t}')")
  total=$((total + 1))
  local level scored reason
  level=$(jq -r .result.suggestedLevel <<<"$out"); scored=$(jq -r .result.scored <<<"$out"); reason=$(jq -r .result.reason <<<"$out")
  if [[ $level == "$3" && $scored == true ]]; then good=$((good + 1)); mark="✓"; else mark="✗"; fi
  printf '  %s %-34s got %s (want %s, scored=%s) — %s\n' "$mark" "$4" "$level" "$3" "$scored" "$reason"
}

COFFEE="I would like a coffee and a glass of water, please."
STATION="Where is the nearest train station?"
NAME="My name is Alex."
WEEKEND="Last weekend I visited a friend and we cooked dinner together."

echo "Placement eval against $BASE"
# Garbled speech recognition (real transcripts from the 2026-10-18 phone test)
case_ "$COFFEE"  "Ich möchte ein Koffi. und eine Flascha-Wasserbetei." A1 "garbled order"
case_ "$COFFEE"  "Ich muss dir ein Kaffee. Ich habe die Fähung auf den Flaschenwasser an den Fählchen." A1 "garbled, meaning lost"
case_ "$STATION" "Wo ist der Nähe ab der Bahnhof?" A1 "garbled question"
case_ "$COFFEE"  "Ich möchte einen Kaffee bitte" A1 "half the sentence"
# Correct answers, including other valid wordings
case_ "$COFFEE"  "Ich hätte gern einen Kaffee und ein Glas Wasser, bitte." A2 "correct (reference)"
case_ "$COFFEE"  "Ich möchte einen Kaffee und ein Glas Wasser bitte" A2 "correct, other wording"
case_ "$STATION" "Wo ist der nächste Bahnhof?" A2 "correct question"
case_ "$NAME"    "Ich heiße Alex" A1 "A1 correct"
case_ "$WEEKEND" "Letztes Wochenende habe ich einen Freund besucht und wir haben zusammen gekocht." B1 "B1 correct"
# Error severity (known hard for small models)
case_ "$COFFEE"  "Ich möchte eine Kaffee und ein Glas Wasser bitte" A2 "minor: article"
case_ "$STATION" "Wo ist die nächste Bahnhof?" A2 "minor: gender"
case_ "$WEEKEND" "Letztes Wochenende ich habe einen Freund besucht und wir haben zusammen gekocht." A2 "major: verb not second"

echo "$good/$total as expected."
providers_report
