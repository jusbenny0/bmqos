#!/usr/bin/env bash
# Smoke test: a CEO chat request creates a task on the board. Usage: CREW_URL=http://127.0.0.1:3800 CREW_PASSWORD=… scripts/chat-smoke.sh
set -euo pipefail
URL=${CREW_URL:-http://127.0.0.1:3800}; J=$(mktemp)
curl -fs -c "$J" -X POST "$URL/api/login" -H 'content-type: application/json' -d "{\"password\":\"$CREW_PASSWORD\"}" >/dev/null
before=$(curl -fs -b "$J" "$URL/api/tasks" | jq length)
curl -fs -m 600 -b "$J" -X POST "$URL/api/ceo/chat" -H 'content-type: application/json' -d '{"text":"Create a task \"Smoke test\" and delegate it to the Builder."}' >/dev/null
after=$(curl -fs -b "$J" "$URL/api/tasks" | jq length)
[ "$after" -gt "$before" ] && echo "OK: tasks $before -> $after" || { echo "FAIL: no task created"; exit 1; }
