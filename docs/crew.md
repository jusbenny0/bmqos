# Crew Module Integration

The **Crew Module** connects BMQOS to an autonomous agent workforce orchestrator. It provides real-time visibility into active AI agents, assigned tasks, token consumption, and the company **Brain** (knowledge base).

---

## 1. Overview & Architecture

When connected to a Crew API backend (or running in zero-dependency Demo Mode), BMQOS surfaces:
- **Workforce Status:** Which agents are running, idle, or blocked.
- **Task Kanban & Queue:** Task titles, assignees, pull request links, handoff notes, and statuses.
- **Brain Knowledge Base:** Searchable decision registry and company documentation.
- **Spend & Token Telemetry:** Breakdown of input tokens, output tokens, prompt cache reads/writes, and total USD cost per agent and per task.

---

## 2. Configuration

The engine that serves this API is bundled in this repository under `engine/` (see `engine/README.md`). Locally, `npm run start:all` starts it next to the panel and wires `CREW_API_URL` and `CREW_API_TOKEN` automatically (bundled engine). For a separate server, start the engine there and set the variables below.

Enable the live Crew module by configuring these environment variables in `.env`:

```env
# Crew API Service Base URL (e.g. local service or container)
CREW_API_URL=http://localhost:3800

# Authentication Token for Crew API Requests
CREW_API_TOKEN=<your-token>
```

> **Zero-Dependency Fallback:**
> If `CREW_API_URL` is empty or unreachable, BMQOS automatically runs in **Demo Mode**. The Team, Goals, and Spend screens will render realistic mock data with relative timestamps that never appear stale.

---

## 3. Task Lifecycle

Tasks in the Crew orchestrator transition through five distinct states:

```
  +--------+         +---------+         +----------+         +--------+
  |  todo  | ------> |  doing  | ------> |  review  | ------> |  done  |
  +--------+         +---------+         +----------+         +--------+
                          |
                          v
                    +-----------+
                    |  blocked  |
                    +-----------+
```

| Status | Meaning | Typical Responsible Role |
| :--- | :--- | :--- |
| `todo` | Ready to be picked up from the backlog | Planner / Backlog |
| `doing` | Agent currently executing in an isolated worktree | Builder / Designer |
| `review` | Implementation completed; PR open; pending verification | Code Reviewer / Security / QA |
| `done` | Approved, merged, and completed | Executive / Reviewer |
| `blocked` | Impeded by dependencies, missing credentials, or errors | Operator intervention needed |

---

## 4. Team Roles & Workforce Composition

BMQOS supports multi-agent organizational structures with specialized roles:

- **Planner:** Breaks epics into actionable briefs, sets token caps, and schedules tasks.
- **Builder (Engineer):** Operates inside isolated Git worktrees to write code, tests, and documentation.
- **Designer:** Proposes UI layouts, component styles, and user experience flows before code is built.
- **Code Reviewer:** Performs automated code review, verifies test coverage, and ensures guidelines are followed.
- **QA:** Runs browser tests and end-to-end user journey validations.
- **Release Manager:** Compiles change summaries, verifies deployment health, and prepares release tags.

---

## 5. The Brain (Company Knowledge Base)

The **Brain** serves as the collective memory of the company. It stores design decisions, architecture specs, project summaries, and operational guidelines.

### Interacting with the Brain API:

1. **Search Nodes:**
   Query the knowledge base using full-text and semantic search:
   ```bash
   curl -s "$CREW_URL/api/brain/search?q=authentication" \
     -H "X-Crew-Token: $CREW_TOKEN"
   ```
   *Returns matching node IDs, titles, and contextual snippets.*

2. **Retrieve Specific Node:**
   Fetch the full markdown body and link relationships:
   ```bash
   curl -s "$CREW_URL/api/brain/node/architecture/auth-tokens" \
     -H "X-Crew-Token: $CREW_TOKEN"
   ```

3. **Record a Decision:**
   AI agents record important decisions so future agents maintain continuity:
   ```bash
   curl -s -X POST "$CREW_URL/api/brain/decision" \
     -H "X-Crew-Token: $CREW_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "Use SQLite for audit logging",
       "text": "Decision: Store audit logs with SHA-256 hash chaining directly in SQLite. Rationale: Local-first, zero extra services."
     }'
   ```

---

## 6. Token & Cost Telemetry

BMQOS tracks token metrics across the entire agent workforce:

- **Token Classes:**
  - `input_tokens`: Base prompt tokens sent to LLMs.
  - `output_tokens`: Generated agent responses and tool commands.
  - `cache_read_tokens`: Tokens served from LLM prompt cache (cost discount).
  - `cache_write_tokens`: Tokens written to prompt cache.
- **Spend Visualization:**
  - Aggregated daily spend chart.
  - Per-agent token allocation.
  - Cost per task comparison (e.g. comparing model efficiency between Sonnet and Haiku).

---

## 7. Crew API Contract Reference

The server-side adapter in `lib/crew.ts` interfaces with the following Crew API v1 endpoints:

| Endpoint | Method | Purpose |
| :--- | :--- | :--- |
| `/api/crew` | `GET` | Retrieve workforce roster, active tasks, context percentages, and today's tokens. |
| `/api/tasks` | `GET` | List all tasks across statuses with metadata. |
| `/api/tasks/:id` | `GET` | Get full task detail including brief, events, transcript, and token breakdown. |
| `/api/tasks/:id` | `PATCH` | Update task status, handoff note, PR link, or assignee. |
| `/api/brain/search?q=:query` | `GET` | Search Brain knowledge nodes. |
| `/api/brain/node/:id` | `GET` | Fetch specific Brain node content. |
| `/api/brain/decision` | `POST` | Record a new architectural or business decision. |
| `/api/usage` | `GET` | Aggregated usage telemetry by task and by agent. |
