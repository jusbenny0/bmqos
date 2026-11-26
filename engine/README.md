# Crew Engine

Crew Engine is an autonomous multi-agent software runtime and orchestration platform. It runs a team of AI agents using persistent CLI sessions (such as Claude Code and Gemini CLI), structured role specializations, non-LLM verification gates, and an integrated organizational knowledge base.

By pairing prompt-cached persistent sessions with strict role boundaries and deterministic validation gates, Crew Engine keeps token spend per task low and measurable (per-task budgets, cheap models for review, no-LLM gates before any reviewer runs).

---

## Architecture & Pipeline

Crew Engine coordinates a specialized team of AI agents through an automated lifecycle pipeline:

```
[ Human / Admin ]
       │
       ▼
   ┌───────┐
   │  CEO  │ ── Planning & Task Breakdown
   └───┬───┘
       │
       ▼
 ┌───────────┐      delegates
 │ Task Queue├──────────────────────┐
 └─────┬─────┘                      │
       │                            │
       ▼                            ▼
┌──────────────┐             ┌──────────────┐
│Junior Builder│             │Senior Builder│
│(Gemini / agy)│             │ (Claude Code)│
└──────┬───────┘             └──────┬───────┘
       │                            │
       └─────────────┬──────────────┘
                     ▼
       ┌───────────────────────────┐
       │ Automated Verification    │
       │ • Git clean check         │
       │ • Type check (tsc)        │
       │ • Build check (npm build) │
       │ • Secret & audit scanner  │
       └─────────────┬─────────────┘
                     ▼
       ┌───────────────────────────┐
       │ Review Gate (Reviewer)    │ ◄─── Lightweight model diff review
       └─────────────┬─────────────┘
                     │ (if approved)
                     ▼
       ┌───────────────────────────┐
       │ Specialized Gates         │
       │ • Security (if flagged)   │
       │ • Visual (UI screenshots) │
       │ • QA (user flow checks)   │
       └─────────────┬─────────────┘
                     │
       ┌─────────────┴─────────────┐
       ▼                           ▼
   [ DONE ]                   [ BLOCKED ] (escalates to human if loops exceed limit)
```

### 1. CEO (Planner)
- Runs in a clean environment with access strictly scoped to the orchestration API.
- Converts high-level user goals into structured tasks with defined scopes, size budgets (`S`, `M`, `L`), and required safety gates (`needs_qa`, `needs_visual`, `needs_security`).
- Delegates tasks directly to the best-suited agent.

### 2. Builders (Execution)
- **Junior Builder (`agy` / Gemini)**: Cost-optimized execution engine for routine and mechanical tasks (documentation, test scaffolding, copy changes, boilerplate generation).
- **Senior Builders (Claude Code)**: Handles architecture, core feature engineering, complex refactoring, and tricky debugging.
- Every builder operates within an isolated git checkout / worktree to prevent conflicts.

### 3. Automated Verification Gate & Security Scan
Before any task reaches a human or LLM reviewer, automated local gates execute without consuming LLM tokens:
- **Cleanliness:** Verifies that all working changes are committed to git.
- **Type Safety:** Executes TypeScript validation (`tsc --noEmit`).
- **Build Verification:** Executes full application build (`npm run build`).
- **Security & Secret Scanner:** Inspects git diffs against known credential patterns and triggers dependency audits (`npm audit`) when dependencies change. Any finding automatically activates the security review gate.

### 4. Review & Specialized Quality Gates
- **Reviewer:** Lightweight model reviewing git diffs directly against task brief acceptance criteria. Outputs explicit verdicts (`APPROVED` / `RETURN`).
- **Security Gate:** Activated for changes touching auth, payments, public endpoints, file uploads, or environment configurations.
- **Visual Inspection Gate:** Captures headless browser screenshots across desktop (1440px) and mobile (390px) viewports to verify UI styling and prevent regressions.
- **QA Gate:** Validates user interaction flows on frontend deliverables.

### 5. Evidence for reviewers
After the gate passes, the runtime collects evidence so reviewers judge a running commit instead of the builder's claims (disable with `CREW_EVIDENCE=0`):
- the build log and the list of changed files (`data/evidence/task-<id>/`),
- a live `next start` preview of exactly this commit on `127.0.0.1:46xx` (stopped when the task is done or blocked, max 90 min),
- HTTP status of the changed pages and headless Chrome screenshots at 1440 and 390 px.

### 6. Self-improving team (retrospectives)
Every run on a task ends with one line `RETRO: missing: …; learned: …`. After every 5 retrospectives one cheap Haiku call rates them (`useful` / `dup` / `noise`) and applies the useful ones:
- a behaviour rule goes into that role's prompt (section *Lessons*, newest 12 kept),
- a team-wide fact goes to `brain/team/lessons.md`,
- a missing tool, access or secret goes to `brain/team/missing.md` - that file is your to-do list as the owner.

Lessons that would weaken the process (skip checks, raise limits, push to main) are rejected. Overview: `GET /api/retro`, judge now: `POST /api/retro`, disable: `CREW_RETRO=0`.

### 7. Resolution & Escalation
- Tasks that pass all gates are automatically marked as `done`.
- Tasks that fail automated checks or exceed retry thresholds are transitioned to `blocked` for operator intervention.

---

## Cost Optimization: Keeping Token Expenses Low

Traditional autonomous agent loops frequently exceed several million tokens per task by repeatedly passing complete repository histories, large prompt templates, and full execution traces into frontier models. Crew Engine achieves extreme cost efficiency through six core strategies:

1. **Role-Based Model Routing:**
   - Mechanical and repetitive tasks are dispatched to low-cost models (e.g., Gemini Flash via junior builder).
   - Code reviews and QA checks use high-speed, lightweight models.
   - High-capability models (e.g., Sonnet) are reserved exclusively for complex implementation and visual design tasks.

2. **Persistent CLI Sessions & Prompt Caching:**
   - Instead of spinning up cold agent processes for every prompt, long-lived sessions preserve tool context and leverage native prompt caching across rounds.

3. **Context Compaction & Session Resets:**
   - Sessions are compacted proactively when context utilization reaches 45%–60%.
   - Rather than paying compounding re-read costs on oversized sessions, long-running agent sessions are cleanly reset when exceeding token thresholds (e.g., 60,000 tokens for CEO; 80,000 for reviewers) with state restored via compact database digests.

4. **Strict Turn Budgets:**
   - Every role operates under an enforced maximum turn ceiling per run (e.g., 10 turns for CEO, 15 for Reviewer, 40 for Builders).

5. **Non-LLM Automated Gates:**
   - Syntax validation, typechecking, production builds, and regex-based secret scans run locally as native shell commands. If code fails to build or has uncommitted files, it is returned immediately before invoking any LLM reviewer.

6. **Measured, not guessed:**
   - Every message stores input/output/cache tokens and cost; `GET /api/usage?range=7d` breaks spend down by employee and by task, so you can see which role or task drives the bill.

---

## Getting Started

### Prerequisites
- Node.js 20 or higher
- npm 10 or higher
- Git

### Installation

1. Clone the repository and install dependencies:
   ```bash
   git clone <repository-url>
   cd engine
   npm install
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration settings
   ```

3. One-Click Local Start (Engine + Panel + Browser):
   ```bash
   npm run start:all
   # or using the CLI:
   ./scripts/bmqos start
   ```
   This automatically starts both Engine (port 3800) and Panel (port 3000, if detected), and opens your browser.

4. Run individual development server:
   ```bash
   npm run dev
   ```
   The engine dashboard and API will be accessible at `http://localhost:3800`.

5. Build and run in production:
   ```bash
   npm run build
   npm run start
   ```

---

## One-Click Desktop Launchers

BMQOS includes ready-to-use desktop launchers with official icons for Linux, macOS, and Windows:
- **Linux (`.desktop`)**: Run `./launchers/install-desktop.sh` to install BMQOS into your desktop applications menu and create desktop shortcuts.
- **macOS (`.command`)**: Double-click `bmqos.command` in Finder to launch all services and open your browser.
- **Windows (`.bat`)**: Double-click `bmqos.bat` in Windows Explorer.

For complete installation steps and customization options, see [Desktop Launchers Guide](file:///docs/launchers.md).

---

## Running with Docker

You can run Crew Engine using Docker and Docker Compose.

### Quick Start with Docker Compose

1. Prepare your environment file:
   ```bash
   cp .env.example .env
   ```

2. Start the container:
   ```bash
   docker compose up -d
   ```

3. Check logs:
   ```bash
   docker compose logs -f
   ```

4. Stop the container:
   ```bash
   docker compose down
   ```

Data is stored persistently in the `./data` directory on the host, mounted to `/app/data` inside the container.

---

## Configuration

All configuration is managed via environment variables. See [`.env.example`](.env.example) for a complete list with descriptions and default values.

Key variables:
- `PORT`: HTTP port for web server and API (default: `3800`).
- `CREW_API_TOKEN`: Bearer token for external REST API authentication.
- `CREW_TOKEN`: Shared token for internal agent callbacks.
- `CREW_PASSWORD`: Password for dashboard web UI access.
- `CREW_SESSION_SECRET`: Secret key used for signing session cookies.
- `CREW_URL`: Base URL of the engine instance.
- `CREW_CAP_S` / `CREW_CAP_M`: Token budget limits per task size.
- `CREW_RETRO=0`: turn off retrospectives / self-improvement (`CREW_RETRO_BATCH`, `CREW_RETRO_MODEL`).
- `CREW_EVIDENCE=0`: turn off reviewer evidence (`CREW_EVIDENCE_DIR`, `CREW_EVIDENCE_PORT_BASE`, `CREW_CHROME`).

---

## API & Documentation

- [API Specification](file:///docs/api.md): Complete REST API reference, data types, authentication mechanisms, and sample payloads.
- [Desktop Launchers Guide](file:///docs/launchers.md): Installation and configuration for Linux (.desktop), macOS (.command), and Windows (.bat) launchers.
- [UI & Design Specification](file:///docs/DESIGN.md): Visual design language, badge states, color palette, and layout principles.

---

## MCP server (talk to your company from Claude)

A stdio MCP server (`mcp/server.mts`, official `@modelcontextprotocol/sdk`) wraps the Crew HTTP API. Tools: `give_task`, `list_tasks`, `task_status`, `approve` (status -> done), `answer` (message an agent; without `employee_id` it goes to the CEO), `team_status`, `spend_summary`.

Env: `CREW_URL` (default `http://localhost:3800`), `CREW_API_TOKEN` (Bearer, see `docs/api.md`).

```bash
CREW_URL=http://localhost:3800 CREW_API_TOKEN=... npm run mcp
npm run test:mcp   # runs the server against a mock API and calls every tool
```

Claude Code:

```bash
claude mcp add crew -e CREW_URL=http://localhost:3800 -e CREW_API_TOKEN=... -- /path/to/repo/node_modules/.bin/tsx /path/to/repo/mcp/server.mts
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "crew": {
      "command": "/path/to/repo/node_modules/.bin/tsx",
      "args": ["/path/to/repo/mcp/server.mts"],
      "env": { "CREW_URL": "http://localhost:3800", "CREW_API_TOKEN": "..." }
    }
  }
}
```

## License

This project is licensed under the MIT License.


## Evals

Each role can have an exam file in `evals/<role>.json` (input + expected verdict checked by code, or a rule checked by a cheap LLM judge). Run `npm run eval`. Lessons learned from retrospectives enter a role prompt only if its eval pass rate does not drop (`CREW_EVAL_GATE=0` disables). See `evals/README.md`.

## Context compaction

Agent sessions are compacted (summarised, not dropped) once the context passes `CREW_COMPACT_AT_TOKENS` (default 500,000). The same value is passed to Claude Code as `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, so auto-compact inside a long run fires at the same size.
