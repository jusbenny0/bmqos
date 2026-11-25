#!/usr/bin/env bash
# Quick task detail test: BASE=http://127.0.0.1:3800 CREW_PASSWORD=… CREW_TOKEN=… scripts/test-task-detail.sh
set -e
B=${BASE:-${CREW_URL:-http://127.0.0.1:3800}}; J='content-type: application/json'; C=$(mktemp)
curl -sf -c "$C" -H "$J" -d "{\"password\":\"$CREW_PASSWORD\"}" $B/api/login >/dev/null
id=$(curl -sf -H "x-crew-token: $CREW_TOKEN" -H "$J" -d '{"title":"task detail test","brief":"test brief"}' $B/api/tasks | jq .id)
curl -sf -b "$C" -X PATCH -H "$J" -d '{"pr_url":"https://github.com/o/r/pull/14"}' $B/api/tasks/$id >/dev/null
curl -sf -b "$C" $B/api/tasks/$id | jq -e '(.tokens.input|type)=="number" and .brief=="test brief" and (.pr_url|endswith("/pull/14"))' >/dev/null
echo "OK detail #$id: tokens objekt, brief, pr_url"; rm -f "$C"
