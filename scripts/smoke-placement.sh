#!/usr/bin/env bash
# End-to-end smoke test for F1 placement (public, before signup).
#
#   scripts/smoke-placement.sh <api-base-url>
#
# Needs the API, a seeded database (`yarn db:seed`) and, for a scored result,
# the LLM service. Without the LLM service, scoring falls back to the
# self-rating (`scored: false`); the script reports which one happened.
# Requires curl and jq.
set -euo pipefail

BASE=${1:?api base url}
pass=0
ok() { pass=$((pass + 1)); printf '  ✓ %s\n' "$1"; }
fail() { printf '  ✗ %s\n    %s\n' "$1" "$2" >&2; exit 1; }
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

echo "Placement smoke test against $BASE"

req POST /placement/attempts '{"spokenLanguage":"xx","targetLanguage":"de","selfRatedLevel":"B1"}'
expect 400 VALIDATION_FAILED "unsupported spoken language rejected"

req POST /placement/attempts '{"spokenLanguage":"en","targetLanguage":"de","selfRatedLevel":"B1"}'
expect 201 "" "attempt created"
ID=$(jq -r '.attempt.id' <<<"$BODY")
TEXT=$(jq -r '.attempt.prompt.text' <<<"$BODY")
[[ -n $TEXT && $TEXT != null ]] || fail "prompt text" "$BODY"
ok "prompt: $TEXT"

req POST "/placement/attempts/$ID/submit" '{"transcript":"","skipped":false}'
expect 400 VALIDATION_FAILED "empty transcript without skip rejected"

req POST "/placement/attempts/$ID/submit" '{"transcript":"Ich wohne seit zwei Jahren in Berlin, aber früher habe ich in einer Kleinstadt gewohnt.","skipped":false}'
expect 200 "" "transcript submitted"
FIRST=$BODY
SCORED=$(jq -r '.result.scored' <<<"$BODY")
LEVEL=$(jq -r '.result.suggestedLevel' <<<"$BODY")
[[ $(jq -r '.result.assessmentId' <<<"$BODY") == "$ID" ]] || fail "assessmentId = attempt id" "$BODY"
[[ $LEVEL =~ ^(A1|A2|B1|B2|C1)$ ]] || fail "suggested level" "$BODY"
[[ $LEVEL != C1 ]] || fail "level capped one above the B1 prompt" "$BODY"
ok "result: level=$LEVEL scored=$SCORED reason=$(jq -r '.result.reason' <<<"$BODY")"

req POST "/placement/attempts/$ID/submit" '{"transcript":"anything else","skipped":false}'
expect 200 "" "second submit returns the stored result"
[[ "$(jq -c '.result' <<<"$BODY")" == "$(jq -c '.result' <<<"$FIRST")" ]] || fail "stored result unchanged" "$BODY"

req POST /placement/attempts '{"spokenLanguage":"tr","targetLanguage":"de","selfRatedLevel":null}'
expect 201 "" "attempt without self-rating (treated as A1)"
SKIP_ID=$(jq -r '.attempt.id' <<<"$BODY")
req POST "/placement/attempts/$SKIP_ID/submit" '{"skipped":true}'
expect 200 "" "skip"
[[ $(jq -r '.result.scored' <<<"$BODY") == false && $(jq -r '.result.suggestedLevel' <<<"$BODY") == A1 && $(jq -r '.result.reason' <<<"$BODY") == null ]] \
  || fail "skip falls back to A1, unscored" "$BODY"
ok "skip → A1, scored=false, reason=null"

req POST /placement/attempts/00000000-0000-4000-8000-000000000000/submit '{"skipped":true}'
expect 404 NOT_FOUND "unknown attempt"

req POST /placement/attempts/not-a-uuid/submit '{"skipped":true}'
expect 404 NOT_FOUND "malformed attempt id"

echo "All $pass checks passed (first result scored=$SCORED)."
