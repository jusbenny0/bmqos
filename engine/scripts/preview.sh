#!/usr/bin/env bash
# Restart the live preview (after merge): build + next start, detached from the session.
set -e
cd "$(dirname "$0")/.."
PORT=${PORT:-3800}
pid=$(ss -ltnp 2>/dev/null | grep ":$PORT " | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
[ -n "$pid" ] && kill "$pid" && sleep 1
npm run build >/tmp/crew-build.log 2>&1 || { tail -30 /tmp/crew-build.log; exit 1; }
setsid nohup npm run start -- -p "$PORT" >/tmp/crew-$PORT.log 2>&1 < /dev/null &
sleep 4
curl -s -o /dev/null -w "$PORT -> %{http_code}\n" "${CREW_URL:-http://127.0.0.1:$PORT}/login"
