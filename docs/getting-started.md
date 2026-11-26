# Getting Started with BMQOS (5-Minute Quickstart)

Welcome to **BMQOS** — the executive operating system and control room for running a company powered by autonomous AI agents.

This guide takes you from zero to a running BMQOS dashboard and agent workforce engine in under 5 minutes.

---

## Prerequisites

Before starting, ensure your system has:
- **Node.js:** Node.js 22.x or 24.x LTS (`node -v` should report v22 or v24).
- **Git:** Git 2.30+ (`git --version`).
- **Claude Code CLI (Optional):** Needed for live agent execution (`claude --version`). If not installed or logged in, the engine automatically runs in simulated **mock mode** so you can test all workflows without credentials.

---

## Fast Track: 3 Steps to Launch

### Step 1: Clone the Repository

```bash
git clone https://github.com/jusbenny0/bmqos.git
cd bmqos
```

### Step 2: Run Automated Setup

Run the built-in non-interactive setup wizard to configure the local environment:

```bash
npm run setup -- --yes --mode=local
```

This automated command:
1. Installs root dependencies.
2. Initializes the local SQLite database (`data/os.db`).
3. Generates the default `.env` configured for safe local access (`127.0.0.1:3000` with no login required on localhost).

### Step 3: Start the Control Panel & Engine

To start both the BMQOS executive dashboard (port 3000) and the bundled AI agent engine (port 3800) together:

```bash
# 1. Install engine dependencies
npm run engine:install

# 2. Start panel and engine with a shared token
npm run start:all
```

Open your browser to:
👉 **`http://localhost:3000`**

---

## Alternative Setup Paths

### Instant Evaluation (Zero-Dependency Demo Mode)

If you only want to explore the UI immediately with simulated agent activity and telemetry:

```bash
npm ci
npm run dev
```

Visit `http://localhost:3000`. When backend credentials (`CREW_API_URL`, `HERMES_API_URL`) are omitted, BMQOS automatically populates realistic mock data for active agents, token metrics, kanban tasks, and approval cards.

### Docker Compose

Run the standalone containerized stack:

```bash
docker compose up -d
```

Access the dashboard at `http://localhost:3000`. Persistent database storage is preserved in Docker volume `bmqos-data`.

---

## Verification & Health Check

Confirm application integrity with these checks:

| Check | Command | Expected Result |
| :--- | :--- | :--- |
| **HTTP Response** | `curl -I http://127.0.0.1:3000/` | `HTTP/1.1 200 OK` (or `307` redirect to login if auth is on) |
| **Type Integrity** | `npm run typecheck` | Exits `0` with no TypeScript errors |
| **Test Suite** | `npm test` | All 110+ unit tests pass |
| **Engine Tests** | `cd engine && npm test:mcp` | Reports `mcp ok` |

---

## Next Steps

Now that your instance is up and running:
- Read [Core Concepts](concepts.md) to understand Company, Roles, Gates, and the Self-Improvement Loop.
- Explore [How-To Guides](how-to.md) to configure custom roles, playbooks, or Claude MCP integration.
- Consult the [Configuration & API Reference](reference.md) for full environment variable and endpoint specifications.
- See [Troubleshooting](troubleshooting.md) if you encounter port conflicts or permission issues.
