# Frequently Asked Questions (FAQ)

Answers to common questions regarding BMQOS architecture, operations, costs, and security.

---

## General & Concepts

### What is BMQOS?
BMQOS is an open-source executive operating system and control panel designed for running a company powered by autonomous AI agents. It provides a human-in-the-loop dashboard, unified inbox, multi-tier approval cards, spend telemetry, and an autonomous workforce engine.

### How does Demo Mode work?
BMQOS is designed for instant zero-dependency evaluation. When backend integration credentials (`CREW_API_URL`, `HERMES_API_URL`, `PAPERCLIP_API_URL`) are omitted from `.env`, the system automatically runs in **Demo Mode**. It simulates realistic agent tasks, token spend curves, and system telemetry with dynamic timestamps that never look stale.

### Can I run BMQOS on a VPS or only on localhost?
BMQOS can run on both. For security, BMQOS binds to `127.0.0.1` by default. When deploying to a VPS or homelab:
1. **Recommended:** Connect via an encrypted mesh VPN like **Tailscale** (`tailscale up`) to access port 3000 privately.
2. **Reverse Proxy:** Use Caddy or Nginx with SSL proxying to `127.0.0.1:3000`.
3. **Cloudflare Tunnel:** Route domain traffic directly to `localhost:3000`.
Always set `OS_AUTH=password` if the web interface is accessible outside localhost.

---

## Workforce & Architecture

### How do agents avoid stepping on each other's code?
Every builder agent operates in an **isolated Git worktree** (separate filesystem checkout). When an agent starts a task, it checks out a dedicated branch (`agent/<topic>`) from `origin/main`. Other agents working simultaneously in other worktrees never experience file collisions or uncommitted state conflicts.

### What is the difference between BMQOS and the Crew Engine?
- **BMQOS (`app/`):** The operator's executive cockpit (Next.js 16, port 3000). Handles approvals, chats with assistants, audit logs, and monitors spend.
- **Crew Engine (`engine/`):** The workforce orchestration server (Next.js, port 3800). Manages the CEO planner, builder worktrees, quality gates, and automated evidence checks.

### Which LLMs and engines can I use?
BMQOS supports a multi-model substrate:
- **Anthropic Claude:** Via the Claude Code CLI (`sonnet` for builders, `haiku` for cheap fast reviewers).
- **Google Gemini:** Via the Antigravity CLI (`agy`) with `gemini-3.8-flash-medium` for junior builders.
- **Direct API Keys:** Anthropic, OpenAI, Google Gemini, OpenRouter.
- **Local Models:** Ollama (`localhost:11434`) and LM Studio (`localhost:1234`).
- **Deterministic Mock:** Automatic zero-cost fallback when no CLI or key is available.

---

## Costs & Token Management

### How much does it cost to operate?
Costs depend entirely on your task volume and model selection:
- **Planning & Building:** Uses Sonnet for deep reasoning on complex implementation.
- **Scaffolding & Boilerplate:** Uses Gemini 3.8 Flash via `agy` or Haiku for cost efficiency.
- **Quality Gates:** Uses Haiku for rapid checklist audits.
- **Budget Caps:** Each task is protected by hard token caps: Small (`CREW_CAP_S`, default 300k tokens) and Medium (`CREW_CAP_M`, default 800k tokens).
- **Prompt Caching:** Full support for Anthropic prompt caching reduces repeated system prompt costs by up to 90%.

---

## Security & Privacy

### How are sensitive actions protected?
BMQOS uses a **defense-in-depth, fail-closed** model:
- **Tier 1 (Reversible):** Routine cards, drafts, chat queries.
- **Tier 2 (Risky):** Code merges, deployments, and sensitive keyword cards require step-up 2FA (TOTP) verification.
- **Tier 3 (Irreversible):** Storage purge or dangerous operations require fresh TOTP re-authentication and explicit confirmation.
- **Safe Mode:** Unless `OS_CONTROL=1` is set, all actions degrade safely to drafts.

### Are secrets scrubbed from logs?
Yes. BMQOS automatically scrubs passwords, API keys, bearer tokens, and session cookies (`lib/redact.ts`) before recording events to the SQLite database or rendering them in the web UI.
