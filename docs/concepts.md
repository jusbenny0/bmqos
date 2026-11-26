# Core Concepts

BMQOS is built around a coherent mental model of how an autonomous, AI-driven organization operates. This document explains the primary concepts and mechanisms that make the system scalable, safe, and self-improving.

---

## 1. Company Architecture

In BMQOS, a **Company** consists of two complementary layers:

```
+-------------------------------------------------------------+
|               BMQOS Executive Control Panel                 |
|   - Real-time command dashboard      - Unified inbox        |
|   - Multi-tier approval cards        - Spend & token stats  |
|   - Security guard & audit trail     - Telemetry & machines |
+-------------------------------------------------------------+
                              |
                     REST / SSE / MCP
                              |
+-------------------------------------------------------------+
|                     Crew Agent Engine                       |
|   - CEO planner                      - Isolated worktrees   |
|   - Builder & Junior agents          - Quality gates        |
|   - Continuous retro loop            - Company Brain (KB)   |
+-------------------------------------------------------------+
```

1. **The Executive Panel (`app/`):** The operator's command cockpit. It surfaces pending approvals, incoming agent proposals, audit trails, and spend telemetry. It runs in a fail-closed posture: dangerous operations degrade to drafts unless explicitly unlocked.
2. **The Workforce Engine (`engine/`):** The operational engine. It manages agent lifecycles, assigns tasks, spawns isolated Git worktrees, runs quality gates, and captures build evidence.

---

## 2. Roles

Every AI agent in the workforce has a defined role, system prompt, context cap, and engine runtime:

| Role | Default Model & Engine | Responsibilities & Scope |
| :--- | :--- | :--- |
| **`ceo`** | `sonnet` (Claude CLI) | High-level planning. Breaks epics into tasks, assigns token budgets, and delegates to builders. Operates outside codebases in `CREW_CEO_CWD`. |
| **`builder`** | `sonnet` (Claude CLI) | Senior software engineer. Operates in an isolated Git worktree. Creates branches (`agent/<topic>`), implements features, runs tests, commits, pushes, and opens PRs. |
| **`junior`** | `gemini-3.8-flash-medium` (`agy`) | Cost-efficient junior builder. Handles mechanical tasks: typo fixes, text updates, renames, boilerplate scaffolding, and test fixtures. |
| **`designer`** | `sonnet` (Claude CLI) | Proposes CSS tokens, component architecture, and UI styling before backend implementation. |
| **`reviewer`** | `haiku` (Claude CLI) | First quality gate. Fast and strict. Reviews Git diffs and handoff notes against the task brief. Delivers `VERDICT: APPROVED` or `VERDICT: RETURN`. |
| **`security`** | `haiku` (Claude CLI) | Specialized gate for tasks flagged `needs_security=1` (touching auth, secrets, payments, or dependencies). Audits against a security checklist. |
| **`visual`** | `sonnet` (Claude CLI) | UI critic for tasks with `needs_visual=1`. Inspects headless Chromium screenshots at 1440px and 390px widths, comparing UI changes to style rules. |
| **`qa`** | `haiku` (Claude CLI) | Functional verification for UI tasks (`needs_qa=1`). Verifies end-to-end user journeys, empty states, and error handling. |

---

## 3. Quality Gates

Rather than blindly trusting an agent's code, BMQOS enforces a rigorous pipeline of **Quality Gates**:

```
[ Builder / Junior ]
         │
         ▼  (git push + PR)
  [ Reviewer Gate ] ──────> RETURN ───> [ Builder fixes defect ]
         │ (APPROVED)
   ┌─────┴──────────────────┐
   ▼                        ▼
[ Security Gate ]      [ Visual & QA Gates ]
(if needs_security=1)   (if needs_visual=1 / needs_qa=1)
   │                        │
   └────────────┬───────────┘
                ▼
       [ Task Complete: DONE ]
```

- **Objective Criteria:** Reviewers evaluate code against the task's stated Acceptance Criteria and Git diff—not personal preference or style bikeshedding.
- **Return Loop:** If a gate finds real defects, it responds with `VERDICT: RETURN` and a concrete explanation. The engine returns the task to the builder (capped by `CREW_MAX_RETURNS` to prevent infinite loops).
- **Final Approval:** Only when all required gates pass with `VERDICT: APPROVED` does the task graduate to `done`.

---

## 4. Retrospectives (Self-Improvement Loop)

BMQOS agents continuously learn from their successes and failures.

At the conclusion of every execution turn, each agent outputs a single mandatory retro line:
```
RETRO: missing: <tool, secret, or context that was missing; or -> ; learned: <actionable rule for next time; or ->
```

### How Lessons are Processed:
1. **Automated Batch Judging:** The engine aggregates retro submissions into batches (configured by `CREW_RETRO_BATCH`, default 5). A lightweight model (`CREW_RETRO_MODEL`, default Haiku) evaluates submissions for novelty and utility.
2. **System Prompt Updates:** Approved lessons are automatically appended to that role's system prompt (up to 12 active lessons; oldest roll off).
3. **Brain Integration:**
   - **`brain/team/lessons.md`:** General engineering lessons shared across the entire team.
   - **`brain/team/missing.md`:** Tooling gaps, missing credentials, or environment issues that require human operator action.
4. **Noise Rejection:** Lessons that attempt to weaken security (e.g., "skip tests", "push to main directly", "bypass review") are rejected by the judge.

---

## 5. Evidence Verification

Claims made by agents in text can be inaccurate. BMQOS addresses this through automated **Evidence Verification** (`CREW_EVIDENCE=1`):

- **Isolated Server Preview:** The engine boots the changed worktree using `next start` on a dedicated port (`CREW_EVIDENCE_PORT_BASE`, default 4600).
- **Automated Screenshots:** Headless Chromium captures full-page desktop (1440x900) and mobile (390x844) screenshots of all affected routes.
- **HTTP Status Check:** Every changed route is pinged to confirm it responds with `HTTP 200` without runtime exceptions.
- **Reviewer Feed:** Gates inspect the captured screenshots, build logs, and live preview URL directly when deciding their verdict.

---

## 6. Personas

Agents can adopt distinct **Personas** to modulate their working style, communication tone, and focus areas without altering their core technical role.

- **Preset Archetypes:** Located in `engine/personas/*.json`:
  - `careful-senior`: Thorough, defensive, double-checks edge cases and security.
  - `fast-pragmatist`: Moves quickly, implements minimal surgical changes, avoids over-engineering.
  - `strict-reviewer`: Uncompromising standards, catches regressions, demands test coverage.
  - `friendly-explainer`: Clear communication, documents rationale, provides concise progress notes.
- **Composition:** A persona defines `tone`, `values` (guiding principles), and `avoid` (anti-patterns). The engine injects these parameters at the top of the agent's system prompt.

---

## 7. Advisors

An **Advisor** is an expert role operating outside the standard development pipeline. It answers strategic, architectural, or domain questions using the company's private reference materials:

- **Knowledge Directory:** Operates out of `data/advisors/<slug>/kb/` using markdown and text files.
- **Index-Driven Retrieval:** Uses `kb/INDEX.md` (handcrafted or auto-generated) to navigate relevant documents.
- **Air-Gapped Safety:** Advisors execute with read-only tools (`Read`, `Glob`, `Grep`) inside their knowledge folder. They have **no shell access**, **no file-write permissions**, and **no outbound internet access**.
- **Query Endpoint:** Queried via `POST /api/advisors/<slug>/ask` with `{"question": "..."}`.

---

## 8. Providers & Engines

BMQOS supports a pluggable, multi-model substrate:

```
[ BMQOS Engine ]
       │
       ├── CLI Subscriptions: Claude Code CLI, agy (Gemini CLI), codex
       ├── Direct API Keys: Anthropic, OpenAI, Google Gemini, OpenRouter
       ├── Local Models: Ollama (localhost:11434), LM Studio (localhost:1234)
       └── Fallback: Deterministic Mock Mode (zero dependencies)
```

- **Auto-Detection:** The engine's `detect()` utility checks available tools, environment keys, and local ports within 3 seconds.
- **Graceful Fallback:** If no live CLI or API key is available, the engine defaults to `mock` mode so all UI flows, task lifecycles, and API endpoints remain fully functional during development and testing.

---

## 9. Playbooks (Planned Concept)

> [!NOTE]
> **Playbooks** represent the planned standard operating procedure (SOP) engine scheduled for milestone **B1**.

While individual tasks coordinate ad-hoc work, **Playbooks** will provide reusable, multi-step orchestration workflows:
- **Defined Sequences:** Multi-stage recipes (e.g., *New Microservice Scaffolding*, *Security Patch Release*, *Full-App Dependency Upgrade*).
- **Automated Handoffs:** Declarative dependencies between planning, design, implementation, and multi-stage verification.
- **Execution Policies:** Role constraints, timeout rules, and required gate profiles pre-packaged into executable templates.
