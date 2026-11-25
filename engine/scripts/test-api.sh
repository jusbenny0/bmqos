#!/usr/bin/env bash
# API contract test: BASE=http://127.0.0.1:3800 CREW_API_TOKEN=… scripts/test-api.sh
set -e
B=${BASE:-${CREW_URL:-http://127.0.0.1:3800}}; A="authorization: Bearer $CREW_API_TOKEN"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
for p in /api/team /api/team/1/transcript /api/tasks /api/tasks/1 "/api/usage?range=7d" /api/brain/search?q=x /api/brain/node/1; do
  [ "$(code $B$p)" = 401 ] || { echo "FAIL 401 without token: $p"; exit 1; }
  [ "$(code -H 'authorization: Bearer wrong' $B$p)" = 401 ] || { echo "FAIL 401 wrong token: $p"; exit 1; }
done
[ "$(code -X POST -d '{}' $B/api/chat)" = 401 ] || { echo "FAIL 401 chat"; exit 1; }
[ "$(code -X POST -d '{}' $B/api/team/1/message)" = 401 ] || { echo "FAIL 401 message"; exit 1; }
curl -sf -H "$A" $B/api/team | jq -e 'type=="array" and length>0' >/dev/null
curl -sf -H "$A" "$B/api/team/1/transcript?after=0" | jq -e '(.messages|type)=="array" and (.last_id|type)=="number"' >/dev/null
[ "$(code -H "$A" $B/api/team/99999/transcript)" = 404 ] || { echo "FAIL transcript 404"; exit 1; }
curl -sf -H "$A" $B/api/tasks | jq -e 'type=="array"' >/dev/null
[ "$(code -H "$A" $B/api/tasks/99999)" = 404 ] || { echo "FAIL task 404"; exit 1; }
curl -sf -H "$A" "$B/api/usage?range=24h" | jq -e '.byEmployee and .byTask' >/dev/null
[ "$(code -H "$A" "$B/api/usage?range=1y")" = 400 ] || { echo "FAIL usage 400"; exit 1; }
[ "$(code -H "$A" "$B/api/brain/search?q=x")" = 501 ] || { echo "FAIL brain 501"; exit 1; }
[ "$(code -H "$A" -X POST -d '{}' $B/api/chat)" = 400 ] || { echo "FAIL chat 400"; exit 1; }
echo "OK API kontrakt"
