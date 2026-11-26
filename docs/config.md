# Configuration Reference

BMQOS is configured using environment variables loaded from `.env` in the repository root. This document provides a complete reference for all supported configuration options.

---

## 1. Authentication & Session

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `OS_AUTH` | Authentication mode. Empty or omitted = **no login** (default, recommended on localhost or private mesh VPNs). Set to `password` to enable password authentication. Setting `OS_PASSWORD_HASH` also activates password login. | `""` (no auth) | `password` |
| `OS_SETUP_TOKEN` | Optional setup verification token required to access the onboarding setup wizard on public instances. | `""` | `<setup-token>` |
| `OS_USER` | Administrator username for web login. | `admin` | `admin` |
| `OS_PASSWORD_HASH` | Salted scrypt password hash generated with `npm run hash -- 'password'`. | `""` | `scrypt:<salt>:<hash>` |
| `OS_SESSION_SECRET` | Secret key used to sign session cookies (minimum 32 characters required). Generate with `openssl rand -hex 32`. | `""` | `<32-character-random-secret>` |
| `OS_TOTP_SECRET` | Base32 TOTP secret key for Two-Factor Authentication. Used to verify step-up codes for Tier 2/3 sensitive actions. | `""` | `<base32-totp-secret>` |
| `OS_TOTP_SECRET_FILE` | Path to a file containing the TOTP secret on the filesystem (created with strict `0600` permissions). | `""` | `/path/to/totp.key` |

---

## 2. Server & Runtime

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `PORT` | TCP port the Next.js HTTP server listens on. | `3000` | `3000` |
| `HOSTNAME` | Network interface to bind. Use `127.0.0.1` for local safety, or `0.0.0.0` for all interfaces. | `127.0.0.1` | `127.0.0.1` |
| `OS_ORIGIN` | Public canonical origin URL of the instance without trailing slash. Required for CSRF validation and secure session cookies behind reverse proxies. | `""` | `https://example.com` |
| `OS_DEMO` | Demo mode override. `1` forces demo mode; `0` forces live mode; unset automatically enables demo mode if backend URLs are missing. | Unset | `1` |
| `OS_CONTROL` | Master switch for executing agent actions and state mutations. When `0`, mutations are recorded as drafts only. | `0` | `1` |

---

## 3. Database & Storage

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `OS_DB` | Path to the SQLite database file storing drafts, sessions, 2FA enrollment, audit logs, and chat records. | `data/os.db` | `data/os.db` |
| `OS_DATA_DIR` | Base directory for file storage and audit log persistence. | `./data` | `./data` |
| `OS_HUBS_DIR` | Directory path containing markdown project hub files for reading status sections. | `""` | `/path/to/hubs` |
| `OS_ACTIONS` | Enable actions storage or maintenance routines (e.g. storage tidy). | `""` | `1` |
| `OS_AGENTS` | Path or identifier for storing agent configurations. | `""` | `agents.json` |

---

## 4. Assistant Chat (Hermes Agent API)

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `HERMES_API_URL` | Base URL of a [Hermes Agent](https://github.com/NousResearch/hermes-agent) API server (sessions + SSE stream). The panel calls `/api/sessions/...`. If omitted, chat runs in demo mode. | `""` | `http://localhost:8642` |
| `HERMES_API_KEY` | Bearer authentication key for the chat endpoint. | `""` | `<your-api-key>` |
| `HERMES_SYSTEM` | Custom system prompt override for the chat agent. Occurrences of `{{STAV}}` are replaced with live company state. | `""` | `You are the executive assistant...` |

---

## 5. Agent Workforce & Task API

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `CREW_API_URL` | Base URL of the workforce orchestrator service providing team telemetry, tasks, and the Brain knowledge base. | `""` (Demo mode) | `https://crew.example.com` |
| `CREW_API_TOKEN` | Authentication token for workforce API requests. Sent in the `Authorization: Bearer <token>` header. | `""` | `<your-token>` |

See [crew.md](crew.md) for full workforce module details.

---

## 6. Issue Tracker Integration

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `PAPERCLIP_API_URL` | Base API endpoint for issue tracking. | `""` (Demo mode) | `https://issues.example.com/api` |
| `PAPERCLIP_API_TOKEN` | Bearer token for authenticating with the issue tracker API. Server-only; never sent to the browser. | `""` | `<your-token>` |
| `PAPERCLIP_COMPANY_ID` | Company identifier registered within the issue tracker. | `""` | `<company-id>` |
| `PAPERCLIP_ISSUE_URL` | Base web URL for opening issues in the browser (issue key is appended). | `""` | `https://issues.example.com` |
| `PAPERCLIP_WRITE` | Enable writing issue updates back to the issue tracker (`1` = write live, `0` = save draft locally). | `0` | `1` |

---

## 7. Social Module Proxy

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `SOCIAL_API_URL` | Base URL for the social media management service proxying `/api/social/*`. | `""` | `https://social.example.com` |
| `DRAFTS_API_TOKEN` | Server-side bearer token for accessing social post drafts. | `""` | `<your-token>` |

---

## 8. Webhook & LAN Security (Approval Cards)

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `OS_CARDS_KEY` | Shared secret key (minimum 16 chars) for authenticating incoming approval card webhooks (`POST /api/cards`). Must match the agent's Authorization header. | `""` | `<shared-secret-key>` |

---

## 9. GitHub Integration

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `GITHUB_TOKEN` | Personal Access Token with read permissions for Contents, Pull Requests, and Metadata. | `""` | `<your-github-token>` |
| `GITHUB_API_URL` | GitHub API endpoint. | `https://api.github.com` | `https://api.github.com` |
| `OS_ALLOWED_REPOS` | Comma-separated list of allowed repository slugs. | `""` | `owner/repo1,owner/repo2` |
| `GITHUB_MERGE` | Enable merging pull requests directly from BMQOS (`1` = allow merge, `0` = record intention). | `0` | `1` |
| `GH_TTL_MS` | Cache TTL in milliseconds for GitHub API responses. | `60000` | `30000` |
| `OS_JUDGE_AGENT_ID` | Automated reviewer agent ID for checking merge approvals. | `""` | `12` |

---

## 10. Web Push Notifications

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `VAPID_PUBLIC` | VAPID public key for web push subscriptions. Generate via `node -e "console.log(require('web-push').generateVAPIDKeys())"`. | `""` | `<vapid-public-key>` |
| `VAPID_PRIVATE` | VAPID private key for signing web push payloads. | `""` | `<vapid-private-key>` |
| `VAPID_SUBJECT` | Contact URI or mailto email for the VAPID payload. | `""` | `mailto:admin@example.com` |

---

## 11. Voice Input (Speech-to-Text)

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `STT_URL` | URL of local speech-to-text service. | `""` | `https://stt.example.com` |
| `ANTHROPIC_API_KEY` | Anthropic API key used for structuring and cleaning voice transcripts. | `""` | `<your-api-key>` |
| `ANTHROPIC_BASE_URL` | Optional custom Anthropic API base URL. | `""` | `https://api.anthropic.com` |
| `VOICE_MODEL` | Model for transcript cleanup. | `claude-3-5-haiku-20241022` | `claude-3-5-haiku-20241022` |

---

## 12. Infrastructure Telemetry

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `DOKPLOY_URL` | Deployment service API base URL for deployment monitoring. | `""` | `https://deploy.example.com` |
| `DOKPLOY_TOKEN` | Deployment service authentication token. | `""` | `<your-token>` |
| `OS_DOKPLOY_MACHINE`| Target deployment machine or cluster ID. | `""` | `node-1` |
| `OS_DOKPLOY_TARGET` | Target application or deployment identifier. | `""` | `app-main` |
| `OS_PREVIEW_HOST` | Base domain for dynamic preview environments. | `""` | `preview.example.com` |
| `PVE_API_URL` | Infrastructure API endpoint for VM/node telemetry. | `""` | `https://infra.example.com/api` |
| `PVE_NODE` | Target infrastructure node name. | `""` | `node-01` |
| `PVE_TOKEN` | Infrastructure API token. | `""` | `<token-id>` |
| `OS_SERVERS` | Monitored server list (JSON array or comma-separated list). | `""` | `[{"name":"node1","ip":"192.0.2.1"}]` |
| `OS_NETMAP_STATIC` | Static network topology definition in JSON format. | `""` | `{"nodes":[],"links":[]}` |
| `OS_SVC_TTL_MS` | Service health polling cache TTL in milliseconds. | `60000` | `30000` |
| `OS_USD_PER_MTOK` | Estimated LLM token cost in USD per 1M tokens for spend calculations. | `""` | `15.00` |

---

## 13. Documentation Indexing

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `OS_DOC_ROOTS` | Semicolon-delimited `label|path` list of directories allowed for documentation browsing. | `""` | `Manual|/docs;Wiki|/wiki` |
| `OS_DOCS_WRITE` | Allow editing documentation markdown files through the UI (`1` = allow, `0` = read-only). | `0` | `1` |
| `OS_DOCS_ISSUES` | Enable creating issues from documentation view. | `0` | `1` |

---

## 14. Projects Definition

| Variable | Description | Default | Example |
| :--- | :--- | :--- | :--- |
| `OS_PROJECTS` | JSON array of active company products. Matches tasks by regex and links to live URLs. Format: `[{"n":"Name","re":"regex","url":"https://..."}]`. | Demo projects | `[{"n":"Store","re":"store|shop","url":"https://store.example.com"}]` |
