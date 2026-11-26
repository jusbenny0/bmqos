# Technical Reference Manual

Complete reference for environment configuration, REST/SSE APIs, and command-line interfaces across BMQOS and the Crew Agent Engine.

---

## 1. Environment Variables

### BMQOS Control Panel (`.env`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | number | `3000` | HTTP listening port for Next.js. |
| `HOSTNAME` | string | `127.0.0.1` | Network interface to bind. Use `127.0.0.1` for safe local access, `0.0.0.0` for container/adapter exposure. |
| `OS_AUTH` | string | `""` | Authentication mode. Empty = open access (recommended on localhost/VPN). Set to `password` to enforce web login. |
| `OS_USER` | string | `admin` | Administrator username for web login. |
| `OS_PASSWORD_HASH` | string | `""` | Salted scrypt password hash generated with `npm run hash -- '<password>'`. |
| `OS_SESSION_SECRET` | string | `""` | Secret key (min 32 chars) for signing session cookies. |
| `OS_TOTP_SECRET` | string | `""` | Base32 TOTP secret key for step-up two-factor authentication on Tier 2/3 sensitive actions. |
| `OS_CONTROL` | string | `0` | Live mutation toggle. `0` = safe mode (actions degrade to drafts). `1` = allow real-world state mutations. |
| `OS_DB` | string | `data/os.db` | File path to the SQLite persistent database. |
| `CREW_API_URL` | string | `""` | Base URL of the Crew Agent Engine (e.g., `http://127.0.0.1:3800`). Empty enables Demo Mode. |
| `CREW_API_TOKEN` | string | `""` | Bearer token passed in `Authorization: Bearer <token>` to the Crew API. |
| `HERMES_API_URL` | string | `""` | Base URL of the assistant chat API server. |
| `PAPERCLIP_API_URL`| string | `""` | Base URL of the Paperclip issue tracker integration. |
| `OS_DOCS_WRITE` | string | `0` | Enable direct browser editing of indexed markdown documentation files. |

---

### Crew Agent Engine (`engine/.env`)

| Variable | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `PORT` | number | `3800` | HTTP listening port for the engine server. |
| `CREW_URL` | string | `http://127.0.0.1:3800` | Canonical base URL used for agent callbacks and MCP connection. |
| `CREW_PASSWORD` | string | `""` | Password for web access to the engine dashboard UI. |
| `CREW_API_TOKEN` | string | `""` | Secret token for external Bearer authentication (`Authorization: Bearer <token>`). |
| `CREW_TOKEN` | string | `""` | Shared callback secret passed by agents in `X-Crew-Token`. |
| `CREW_BASE_BRANCH` | string | `main` | Git branch builders branch from and open PRs against. |
| `CREW_MAX_TURNS` | number | `25` | Maximum tool execution turns allowed per agent run. |
| `CREW_CEO_CWD` | string | `/tmp/crew-ceo` | Working directory where the CEO planning agent operates. |
| `CREW_CONTEXT_WINDOW` | number | `200000` | Token context ceiling for Claude models. |
| `CREW_AGY_CONTEXT_WINDOW` | number | `1000000`| Token context ceiling for Gemini models via `agy`. |
| `CREW_CEO_RESET_TOKENS` | number | `60000` | Context token count at which CEO resets its session and re-reads DB digest. |
| `CREW_CAP_S` | number | `300000` | Token budget cap for Small (S) size tasks. |
| `CREW_CAP_M` | number | `800000` | Token budget cap for Medium (M) size tasks. |
| `CREW_MAX_RETURNS` | number | `2` | Maximum times a gate can return a task to a builder before requiring human intervention. |
| `CREW_RETRO` | string | `1` | Enable continuous retro learning loop (`1` = on, `0` = off). |
| `CREW_RETRO_BATCH` | number | `5` | Batch size before triggering judge to process pending retro lines. |
| `CREW_RETRO_MODEL` | string | `haiku` | Model used to evaluate and synthesize retro learnings. |
| `CREW_EVIDENCE` | string | `1` | Enable automated preview and screenshot verification (`1` = on, `0` = off). |
| `CREW_EVIDENCE_PORT_BASE` | number | `4600` | Starting port for spinning up isolated worktree preview instances. |
| `CREW_CHROME` | string | `""` | Explicit path to Chromium binary (defaults to Playwright cache in `~/.cache/ms-playwright`). |
| `CREW_ROLES_FILE` | string | `""` | Path to JSON file defining custom workforce roles. |
| `CREW_ROLES_JSON` | string | `""` | Inline JSON string of workforce role definitions. |
| `CREW_MOCK` | string | `0` | Force mock mode even if `claude` CLI is available. |

---

## 2. API Reference

All requests to API endpoints require appropriate authentication (`Authorization: Bearer <CREW_API_TOKEN>`, `X-Crew-Token: <CREW_TOKEN>`, or session cookie).

### Engine API Endpoints (`port 3800`)

#### Workforce & Agents
- **`GET /api/team`**
  - Returns active team members, assigned tasks, current status (`idle`, `busy`, `error`), and daily token spend.
- **`GET /api/team/:id/transcript`**
  - Fetches execution transcript for employee `:id` (supports `?after=<id>&limit=<n>`).
- **`POST /api/team/:id/message`**
  - Dispatches interactive instructions to employee `:id` (`{"text": "...", "taskId": 42}`).
- **`PATCH /api/employees/:id`**
  - Updates employee configuration (system prompt, model, role, working directory).

#### Tasks & Delegation
- **`GET /api/tasks`**
  - Lists all tasks in reverse chronological order.
- **`POST /api/tasks`**
  - Creates a new task (`{"title": "...", "brief": "...", "needs_qa": 0, "needs_visual": 0, "needs_security": 0, "token_cap": 300000}`).
- **`GET /api/tasks/:id`**
  - Returns task details, event timeline, transcript messages, and cumulative token spend.
- **`PATCH /api/tasks/:id`**
  - Updates task state (`{"status": "review", "pr_url": "...", "handoff_note": "..."}`).
- **`POST /api/delegate`**
  - Hands off a task to an agent and triggers execution (`{"to": "Junior", "taskId": 42, "text": "..."}`).

#### Knowledge Base (Brain)
- **`GET /api/brain/search?q=<query>`**
  - Full-text search across decisions, notes, and architecture docs.
- **`GET /api/brain/node/:id`**
  - Retrieves markdown content and outgoing links for a specific node.
- **`POST /api/brain/decision`**
  - Records an architectural or team decision into `brain/decisions/`.
- **`GET /api/brain/graph`**
  - Returns nodes and edges representing the knowledge base graph.

#### Analytics, Retros & Advisors
- **`GET /api/usage?range=24h`**
  - Returns aggregated token consumption and USD spend by employee, by task, and time series.
- **`GET /api/providers`**
  - Returns detection status of CLI subscriptions, API keys, and local LLMs.
- **`GET /api/retro`**
  - Returns latest 100 retro learnings and verdict statistics.
- **`POST /api/retro`**
  - Triggers immediate evaluation of pending retro submissions.
- **`POST /api/advisors/:slug/ask`**
  - Queries an air-gapped advisor mentor backed by `data/advisors/:slug/kb/`.
- **`GET /api/playbooks`**, **`PATCH /api/playbooks`** (`{"default": "<id>"|null}`)
  - Lists playbooks / sets the default. See the [Playbooks guide](playbooks.md).
- **`GET /api/playbooks/:id`**, **`PATCH /api/playbooks/:id`**
  - Returns a playbook plus its `brief` text / saves a partial override (`{"reset": true}` removes it).

---

### Control Panel API Endpoints (`port 3000`)

- **`GET /api/cards`** — List active action approval cards.
- **`POST /api/cards/:id`** — Approve, reject, or answer a decision card.
- **`GET /api/audit`** — Stream immutable audit log with cryptographic hash chaining.
- **`POST /api/chat`** — Send message to assistant chat server (Hermes Agent).
- **`GET /api/services`** — Health telemetry for monitored servers and infrastructure.
- **`GET /api/metrics`** — Aggregated system resource and operational metrics.

---

## 3. CLI & Utility Reference

### Root NPM Scripts

```bash
# Automated setup wizard (interactive or headless)
npm run setup -- --yes --mode=local

# Generate a secure scrypt password hash
npm run hash -- 'your-secure-password'

# Start local Next.js development server
npm run dev

# Compile production standalone build
npm run build

# Start production server
npm start

# Run full TypeScript validation
npm run typecheck

# Run unit and integration test suite
npm test

# Install engine dependencies
npm run engine:install

# Start both panel and engine with a shared token
npm run start:all
```

---

### Engine NPM Scripts (`engine/`)

```bash
# Start standalone engine dev server on port 3800
npm run dev

# Verify MCP server standalone
npm run test:mcp

# Run retro judging test
npm run test:retro

# Run persona parser validation
npm run test:persona

# Run advisor test suite
npm run test:advisors
```
