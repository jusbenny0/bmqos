# How-To Guides

This guide provides practical, step-by-step instructions for extending, customizing, and integrating BMQOS.

---

## 1. How to Create a Custom Agent Role

BMQOS ships with a default team (`ceo`, `builder`, `junior`, `reviewer`, etc.), but you can define custom roles tailored to your stack and workflows.

### Method A: Declarative Configuration (`roles.json`)

1. **Create a roles definition file** (e.g., `data/roles.json`):

   ```json
   [
     {
       "name": "CEO",
       "role": "ceo",
       "model": "sonnet",
       "engine": "claude",
       "prompt": "You are the CEO and planner. You break requests into tasks and delegate them to builders."
     },
     {
       "name": "Frontend Specialist",
       "role": "builder",
       "model": "sonnet",
       "engine": "claude",
       "persona": {
         "name": "UI Architect",
         "tone": "detail-oriented, accessible, design-conscious",
         "values": ["semantic HTML", "responsive CSS", "WCAG compliance"],
         "avoid": ["inline styles", "unnecessary heavy dependencies"]
       },
       "prompt": "You are a senior frontend engineer. Focus on building clean, accessible React components."
     },
     {
       "name": "Junior Scaffolder",
       "role": "junior",
       "model": "gemini-3.8-flash-medium",
       "engine": "agy",
       "prompt": "You are the Junior builder. Handle test scaffolding, documentation updates, and mechanical refactors."
     },
     {
       "name": "Code Reviewer",
       "role": "reviewer",
       "model": "haiku",
       "engine": "claude",
       "prompt": "You are the strict reviewer. Check the diff against the brief. End with VERDICT: APPROVED or VERDICT: RETURN."
     }
   ]
   ```

2. **Point your engine configuration to the file** in `engine/.env`:
   ```env
   CREW_ROLES_FILE=data/roles.json
   ```

3. **Restart the engine**:
   The engine reads the JSON array upon startup. Role definitions are seeded idempotently without overwriting active session histories.

---

### Method B: Update an Active Employee via API

You can reconfigure an existing employee dynamically at runtime:

```bash
curl -s -X PATCH "http://127.0.0.1:3800/api/employees/3" \
  -H "Authorization: Bearer $CREW_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Lead Optimizer",
    "role": "builder",
    "model": "sonnet",
    "system_prompt": "You specialize in query performance and bundle-size reduction."
  }'
```

---

## 2. How to Author a Custom Playbook (SOP Workflow)

> [!NOTE]
> The automated playbook execution engine is scheduled for milestone **B1**. Today, operators define standard operating procedures (SOPs) as structured task templates dispatched through the task queue.

### Defining an SOP Workflow Template

To create a reproducible procedure for common tasks (e.g., *Feature Implementation with Visual & Security Gates*):

1. **Document the SOP structure** in your company Brain (`brain/playbooks/feature-workflow.md`):

   ```markdown
   # Playbook: New Feature Workflow

   ## 1. Specification (CEO)
   - Define user story and acceptance criteria.
   - Set token cap (S: 300k, M: 800k).
   - Determine required gates (`needs_security`, `needs_visual`, `needs_qa`).

   ## 2. Implementation (Builder)
   - Work in isolated branch: `git checkout -b agent/<feature-name> origin/main`.
   - Write unit tests alongside implementation.
   - Run typecheck and tests: `npm run typecheck && npm test`.
   - Commit, push, and create PR: `gh pr create --base main`.

   ## 3. Verification Pipeline (Gates)
   - Gate 1: Code Review (`reviewer`) -> verifies logic and diff.
   - Gate 2: Security Review (`security`) -> checks auth, inputs, secrets.
   - Gate 3: Visual Review (`visual`) -> inspects 1440px and 390px screenshots.
   - Gate 4: QA (`qa`) -> confirms end-to-end journey.
   ```

2. **Dispatch the Task via API**:
   Submit the playbook-defined task directly to the engine:

   ```bash
   curl -s -X POST "http://127.0.0.1:3800/api/tasks" \
     -H "Authorization: Bearer $CREW_API_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{
       "title": "Implement Webhook Verification",
       "brief": "Follow Playbook: Feature Workflow.\nAcceptance: HMAC signature check, tests passing.\nScope: app/api/webhooks/ only.\nSize: S",
       "needs_security": 1,
       "needs_visual": 0,
       "needs_qa": 0,
       "token_cap": 300000
     }'
   ```

---

## 3. How to Connect Claude Desktop & Claude Code via MCP

The engine includes a bundled Model Context Protocol (MCP) server located at `engine/mcp/server.mts`. This lets Claude Desktop or Claude Code query team status, view tasks, inspect token spend, and interact with the Brain directly from your conversational assistant.

### Step 1: Verify MCP Server Functionality

Test the server standalone using the built-in test harness:

```bash
cd engine
npm run test:mcp
```
*Expected output: `mcp ok`*

---

### Step 2: Configure Claude Desktop

Add BMQOS to your Claude Desktop configuration file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

Add the following entry under `mcpServers`:

```json
{
  "mcpServers": {
    "bmqos-crew": {
      "command": "npx",
      "args": [
        "-y",
        "tsx",
        "/absolute/path/to/bmqos/engine/mcp/server.mts"
      ],
      "env": {
        "CREW_URL": "http://127.0.0.1:3800",
        "CREW_API_TOKEN": "your-crew-api-token"
      }
    }
  }
}
```

*Replace `/absolute/path/to/bmqos` with your actual repository path.*

---

### Step 3: Available MCP Tools

Once connected, Claude has access to the following tools:

| MCP Tool | Description |
| :--- | :--- |
| `crew_team` | Get active workforce status, assignees, and token usage |
| `crew_tasks` | List recent tasks, statuses (`todo`, `doing`, `review`, `done`), and PR links |
| `crew_task_detail` | View full task brief, event timeline, and token metrics |
| `crew_create_task` | Create and dispatch a new task to the workforce |
| `crew_brain_search` | Search decisions, specs, and knowledge base markdown files |
| `crew_usage` | Fetch spend and token analytics across agents and tasks |
