# AGENTS.md — BMQOS Agent Guidelines

> **Quick setup directive:**
> Tell your agent: `install github.com/jusbenny0/bmqos`

This document defines repository guidelines, operational workflows, architectural structure, and safety guardrails for AI coding agents (such as Claude Code, OpenAI Codex/Operator, Cursor, Gemini CLI, etc.) working on the BMQOS codebase.

---

## 1. Project Overview

**BMQOS** is an open-source control panel and executive interface for operating a company powered by AI agents. It provides a real-time dashboard, unified inbox, agent task orchestration, approval cards for sensitive actions, audit logging, and service telemetry.

- **Technology Stack:** Next.js 16 (App Router, Server Actions, React 19), TypeScript, SQLite (via `better-sqlite3` compatible layer), vanilla CSS variables and modules.
- **Desktop Companion:** Native Linux desktop wrapper built with Tauri 2 (Rust) located in `desktop/`.
- **Integrations:** Hermes Agent API server (assistant chat: sessions + SSE), Crew API (agent workforce orchestrator), Paperclip (issue tracker), Dokploy, Proxmox VE.
- **Demo Mode:** BMQOS automatically operates in zero-dependency Demo Mode when backend integration credentials (`HERMES_API_URL`, `CREW_API_URL`, `PAPERCLIP_API_URL`) are omitted.

---

## 2. Repository Structure

```
bmqos/
├── app/                  # Next.js App Router (pages, layouts, styles, and /api routes)
│   ├── api/              # REST & SSE API endpoints (cards, chat, crew, tasks, etc.)
│   ├── login/            # Authentication view and form handlers
│   ├── os.css            # Main OS design system styling
│   └── shell.css         # Desktop shell layout styling
├── components/           # UI components (desktop views, modals, chat, inbox, charts)
├── lib/                  # Backend business logic, storage, integrations, and services
│   ├── auth.ts           # Authentication logic and session verification
│   ├── db.ts             # SQLite database layer and schema migrations
│   ├── hermes.ts         # Agent chat and streaming integration
│   ├── inbox.ts          # Inbox items, alerts, and redaction/scrubbing utilities
│   └── services.ts       # Service status polling and health telemetry
├── desktop/              # Tauri 2 native desktop app (Rust + Webview)
├── public/               # Static assets, web push service worker, fonts, icons
├── scripts/              # Utility CLI scripts (e.g., hash.mjs for password hashing)
├── tests/                # Test suites executed with Node.js built-in test runner (*.test.mts)
├── .env.example          # Annotated environment configuration template
├── docker-compose.yml    # Single-command Docker Compose stack
├── Dockerfile            # Multi-stage production container build (standalone Next.js)
├── package.json          # Node dependencies and scripts
└── tsconfig.json         # TypeScript configuration
```

---

### Bundled agent engine

`engine/` is a separate Next.js app (own `package.json`, port 3800) that runs the agent team behind the Crew API. It is excluded from the panel's `tsconfig.json` and Docker build. Verify it on its own: `cd engine && npm ci && npx tsc --noEmit && npm run build && npm run test:mcp`. Local all-in-one start: `npm run engine:install && npm run start:all`. Agents need the `claude` CLI logged in on the machine.

## 3. Agent Setup & Installation Workflow

When tasked with installing or setting up BMQOS, you can use the automated agent setup script or follow manual steps.

### Automated Setup (Recommended)
AI agents can run the built-in setup script directly:
```bash
npm run setup -- --yes --mode=local
# or for VPS/home server deployment:
# npm run setup -- --yes --mode=server
```
See [docs/setup.md](docs/setup.md) for full argument reference.

### Manual Setup Step-by-Step

### Step 1: Clone Repository
```bash
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos
```

### Step 2: Install Dependencies
```bash
npm ci
```
*Requirement: Node.js 24.*

### Step 3: Configure Environment
1. Copy the example environment template:
   ```bash
   cp .env.example .env
   ```
   *Authentication is optional.* By default BMQOS runs WITHOUT a login. Ask the user whether the instance will be reachable from the internet; only then do steps 2–4 and set `OS_AUTH=password`.
2. Generate a secure session secret (at least 32 characters) and assign it to `OS_SESSION_SECRET`:
   ```bash
   openssl rand -hex 32
   ```
3. Generate a password hash for the administrator account using the built-in hash utility:
   ```bash
   npm run hash -- 'your-secure-password'
   ```
   *Example output:*
   `scrypt:3ca0e03e9b3860bbab7ec6cc8144752b:7e8dc191541d1173c30686234a7d8a56dbd9bbfaa0d758b5ece95728e2a0cc06`
4. Set the generated hash as `OS_PASSWORD_HASH` and verify `OS_USER` in `.env`:
   ```bash
   OS_USER=admin
   OS_PASSWORD_HASH=scrypt:...
   OS_SESSION_SECRET=...
   ```
*Demo mode note:* Leave `HERMES_API_URL`, `CREW_API_URL`, and `PAPERCLIP_API_URL` empty to run in zero-dependency Demo Mode with mock data.

### Step 4: Run Application
Choose one of the following run methods:

- **Local Development Mode:**
  ```bash
  npm run dev
  ```
  Starts local dev server at `http://localhost:3000`.

- **Production Standalone Build:**
  ```bash
  npm run build
  npm start
  ```

- **Docker Compose:**
  ```bash
  docker compose up -d
  ```

---

## 4. Verification & Health Checks

Verify application integrity using these specific check commands:

| Check | Command | Expected Output / Criteria |
| :--- | :--- | :--- |
| **Typecheck** | `npm run typecheck` | Exits with code `0`, no TypeScript errors. |
| **Test Suite** | `npm test` | All tests pass (89+ tests passing, 0 failing). |
| **Login Endpoint** | `curl -i http://localhost:3000/login` | `HTTP/1.1 200 OK`, HTML document returned. |
| **Root Redirect** | `curl -i http://localhost:3000/` | `HTTP/1.1 307 Temporary Redirect` to `/login`. |
| **API Security** | `curl -i http://localhost:3000/api/cards` | `HTTP/1.1 401 Unauthorized` without session cookie. |

---

## 5. Development Conventions

- **TypeScript:** Strict type checking. Always run `npm run typecheck` to validate changes.
- **Testing:** Uses Node.js native test runner (`node:test` and `node:assert/strict`). Test files are located in `tests/` and named `*.test.mts`.
- **Styling:** CSS variables and plain CSS files (`app/os.css`, `app/shell.css`). Avoid adding external CSS utility frameworks unless requested.
- **State & Storage:** Persistent state goes into SQLite (`OS_DB`, default `data/os.db`). Never commit SQLite database files.
- **Security & Redaction:** Sensitive variables (passwords, tokens, cookies) must be scrubbed before displaying or logging (`lib/redact.ts`, `lib/inbox.ts:scrub`).

---

## 6. Agent Boundaries & Guardrails (Do's and Don'ts)

### What Agents MUST DO:
- Always run `npm run typecheck` and `npm test` before committing any changes.
- Keep modifications minimal, surgical, and scoped directly to the user's task.
- Verify real commands in `package.json` before suggesting or running build steps.
- Respect existing code formatting and architectural patterns.

### What Agents MUST NEVER DO:
- **NEVER commit `.env`, secrets, or private keys:** Do not add `.env` or files containing tokens, hashes, or passwords to git.
- **NEVER push to remote branches directly:** Do not run `git push origin <branch>` without explicit approval.
- **NEVER publish packages or releases:** Do not run `npm publish` or publish Docker images to external registries.
- **NEVER modify `LICENSE`:** The project license is MIT and must remain intact.
- **NEVER execute destructive commands:** Do not execute `rm -rf /`, destroy production databases, kill unrelated system processes, or modify files outside the repository.
- **NEVER touch source code when tasked with documentation-only assignments.**
