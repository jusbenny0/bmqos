# Claude Desktop as the company control panel

The engine ships an MCP server (`engine/mcp/server.mts`) with two transports:

| Transport | Use when | Start |
| :--- | :--- | :--- |
| stdio | Claude runs on the engine machine | spawned by the client |
| Streamable HTTP (`/mcp`) | Claude Desktop on another PC, engine in the LAN | `cd engine && CREW_API_TOKEN=… npm run mcp:http` (port `CREW_MCP_PORT`, default 3801) |

HTTP requires `Authorization: Bearer $CREW_API_TOKEN`; without it the server answers `401` (and refuses to start with an empty token). It is stateless and binds `0.0.0.0` (override with `CREW_MCP_HOST`). Keep it on a trusted LAN or behind a TLS reverse proxy — the token is the only protection.

## Install

**1. Extension (.mcpb, one step).** `cd engine && npm run mcp:pack` builds `crew-engine.mcpb`. Double-click it in Claude Desktop and fill in the engine URL and `CREW_API_TOKEN`.

**2. `claude_desktop_config.json`** (stdio, needs Node and the repo checked out):

```json
{ "mcpServers": { "crew": {
  "command": "npx", "args": ["tsx", "/path/to/bmqos/engine/mcp/server.mts"],
  "env": { "CREW_URL": "http://192.168.1.10:3800", "CREW_API_TOKEN": "…" }
} } }
```

**3. Claude Code, remote HTTP:**

```bash
claude mcp add --transport http crew http://192.168.1.10:3801/mcp --header "Authorization: Bearer $CREW_API_TOKEN"
```

## Tools

`give_task`, `list_tasks`, `task_status`, `approve`, `return_task` (back to owner with feedback), `retry_task`, `answer`, `team_status`, `blocked_overview` (what is stuck and why), `spend_summary`, `list_providers`, `list_evals`, `run_evals` (costs model calls), `retro_summary`, `set_compact_tokens` (read-only: shows `CREW_COMPACT_AT_TOKENS`; the engine has no API to change it).

Outputs are compact JSON capped at ~6000 characters. Ideas (#59) and Brand (E2) hooks are not included yet.

## Verify

`cd engine && npm run test:mcp` → `mcp ok` (covers every tool, HTTP 401 without a token, tool list with one).
