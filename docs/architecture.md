# System Architecture & Design

**BMQOS** is structured as a local-first, server-driven control panel built for high resilience, privacy, and operator oversight of autonomous AI workforces.

---

## 1. Architectural Principles

1. **Local-First & Zero-Telemetry:** All state, chat history, and audit trails reside locally in a single SQLite database (`data/os.db`). No telemetry or analytics are phoned home.
2. **Fail-Closed Security Barrier:** Any mutation or execution route passes through a single security guard (`lib/guard.ts`). Without explicit opt-in flags, actions degrade safely to drafts.
3. **Modular Integration Adapters:** External backends (agent chat APIs, workforce orchestrators, issue trackers, deployment platforms, infrastructure providers) are loosely coupled adapters. If any integration is offline or credentials are missing, BMQOS falls back to simulated demo mode without failing.
4. **Server-Rendered Simplicity:** Leverages Next.js 16 App Router with React 19 Server Components and vanilla CSS variables. Server secrets and tokens never touch the browser client.

---

## 2. High-Level Component Architecture

```
+-------------------------------------------------------------------------------+
|                                CLIENT SURFACES                                |
|   +------------------------------------+  +-------------------------------+   |
|   |         Web Browser UI             |  |      Tauri 2 Native Shell     |   |
|   |   (React 19, CSS Variables)        |  |     (Linux Desktop Wrapper)   |   |
|   +------------------------------------+  +-------------------------------+   |
+-------------------------------------------------------------------------------+
                                        |  HTTP / SSE
                                        v
+-------------------------------------------------------------------------------+
|                            NEXT.JS APP ROUTER CORE                            |
|                                                                               |
|   +-----------------------------------------------------------------------+   |
|   |                       Security Guard (`lib/guard.ts`)                 |   |
|   |   - CSRF & Same-Origin Check         - Three-Tier Action Gating       |   |
|   |   - LAN & Cloudflare Detection       - Step-Up TOTP Verification      |   |
|   |   - Timing-Safe Webhook Auth         - Sensitive Keyword Escalation   |   |
|   +-----------------------------------------------------------------------+   |
|                                       |                                       |
|   +-----------------------------------------------------------------------+   |
|   |                         Server Business Logic                         |   |
|   |   - `lib/cards.ts`    Approval card lifecycles & questions            |   |
|   |   - `lib/inbox.ts`    Unified inbox scrubbing & redaction             |   |
|   |   - `lib/demo.ts`     Zero-dependency mock data generator             |   |
|   |   - `lib/audit.ts`    Tamper-evident SHA-256 hash-chained audit log   |   |
|   |   - `lib/auth.ts`     scrypt hashing & signed cookie sessions         |   |
|   +-----------------------------------------------------------------------+   |
|                                       |                                       |
|   +-----------------------------------------------------------------------+   |
|   |                         SQLite Database Layer                         |   |
|   |   (Sessions, Drafts, Audit Logs, TOTP Secrets, Cards, Chat History)   |   |
|   +-----------------------------------------------------------------------+   |
+-------------------------------------------------------------------------------+
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                             INTEGRATION ADAPTERS                              |
|   +------------------+  +------------------+  +---------------------------+   |
|   | Agent Chat / LLM |  |  Workforce API   |  |       Issue Tracker       |   |
|   | (Streaming LLM)  |  | (Tasks & Brain)  |  |      (Task Tracking)      |   |
|   +------------------+  +------------------+  +---------------------------+   |
|   +------------------+  +------------------+  +---------------------------+   |
|   |   GitHub API     |  |  Deployment Svc  |  |      Infrastructure       |   |
|   |  (PRs & Merges)  |  |  (Deployments)   |  |      (Node Metrics)       |   |
|   +------------------+  +------------------+  +---------------------------+   |
+-------------------------------------------------------------------------------+
```

---

## 3. Security Guard & Action Tiers

Every state-changing API request (`/api/act`, `/api/cards/[id]`, `/api/merge`, etc.) is processed by `guarded()` in `lib/guard.ts`.

### Action Tiers:
| Tier | Classification | Requirements | Examples |
| :---: | :--- | :--- | :--- |
| **Tier 1** | **Reversible** | Active session, Same-origin check | Sending chat messages, creating drafts, acknowledging routine cards |
| **Tier 2** | **Risky** | Active session + Step-up 2FA (valid within 10-minute window) | Sensitive cards (finance/keys), code merges (`merge.pr`), editing docs |
| **Tier 3** | **Irreversible** | Active session + Immediate TOTP code + Target string confirmation | Storage tidy, deleting persistent agent data |

### Fail-Closed Execution:
If the corresponding environment variable (e.g., `OS_CONTROL=1`, `GITHUB_MERGE=1`) is disabled or unset, the action is **never executed**. Instead:
1. An intent record is appended to the audit log.
2. The payload is saved locally as a draft in SQLite.
3. The server responds with `403 Forbidden` (`{ draft: true }`).

---

## 4. Approval Cards Workflow

Approval Cards are the primary mechanism through which AI agents seek operator consent for sensitive decisions:

```
[ AI Agent ] 
     |
     |  1. POST /api/cards (LAN IP + Bearer OS_CARDS_KEY)
     v
[ BMQOS Server ]
     |
     |  2. Validate LAN origin & timing-safe key
     |  3. Scan text for sensitive keywords (e.g. token, payment, deploy)
     |     -> If matched, escalate card type to SENSITIVE (Tier 2)
     v
[ SQLite os.db ]
     |
     |  4. Card stored in pending state
     v
[ Operator Dashboard ]
     |
     |  5. Operator views card with 1-3 choices
     |  6. Operator clicks choice
     |     -> If Sensitive: prompts for TOTP 2FA code
     v
[ BMQOS Server ]
     |
     |  7. Guard validates session & 2FA step-up
     |  8. Records answer in SQLite and appends to audit log
     v
[ AI Agent ]
     |
     |  9. Polls GET /api/cards?answered=1 with Bearer OS_CARDS_KEY
     v
[ Executes Approved Action ]
```

---

## 5. Zero-Dependency Demo Mode

BMQOS was built so developers and agents can evaluate the full system immediately:

- **Activation:** Automatically enabled when backend credentials (e.g. issue tracker or workforce API) are not defined, or forced on with `OS_DEMO=1`.
- **Realistic Time Offsets:** Demo dates and timestamps are calculated dynamically relative to the current moment (`Date.now()`), ensuring charts, task cards, and agent heartbeats never appear expired or stale.
- **Customizable:** When configuring your company via the setup wizard, the demo engine reflects the configured company name and custom agent roles.

---

## 6. Audit Logging & Hash Chaining

The audit log (`lib/audit.ts`) records every administrative and agent event:
- **Timestamp & Actor:** Exact UTC timestamp, username, IP, and user-agent.
- **Target & Parameters:** Action identifier, target resource, and scrubbed parameters.
- **SHA-256 Hash Chaining:** Each log entry incorporates the hash of the preceding entry:
  $$\text{hash}_n = \text{SHA256}(\text{hash}_{n-1} + \text{entry}_n)$$
- This structure provides tamper evidence against database manipulation.
