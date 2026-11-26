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

Override a built-in playbook or add your own without touching `engine/playbooks/`: send a (partial) definition with `PATCH /api/playbooks/<id>`, or drop `<id>.json` into `engine/data/playbooks/`. Details, the JSON shape and the API are in the [Playbooks guide](playbooks.md).

```bash
curl -s -X PATCH "http://127.0.0.1:3800/api/playbooks/api" \
  -H "Authorization: Bearer $CREW_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"tech_stack": ["Node 24 + TypeScript", "Fastify", "SQLite"]}'
```

---

## 3. How to Turn a Rough Idea into Tasks (Ideas)

Write a rough idea and let the team discuss it before any work starts.

1. Open **Ideas** in the panel and describe the idea, or call the MCP tool `discuss_idea` (`text`), or `POST /api/ideas` with `{"text": "..."}`.
2. The engine runs one short round: Designer, Builder and Security (and the Advisor, if you have one) each give an opinion and the main risks (Haiku). Then the CEO synthesises (Sonnet): a summary, at most 3 open questions with a recommended answer, and proposed tasks with size (S/M/L) and a token estimate.
3. Edit the prefilled answers if you disagree and press **Approve** (MCP `approve_idea`, API `POST /api/ideas/:id/approve` with optional `{"answers": [...]}`). The proposed tasks are created with status `todo`; your answers are added to each brief.

A discussion is capped at 60 000 tokens (`CREW_IDEA_CAP`). When the cap is reached the remaining roles are skipped and the summary is built from the opinions collected so far, without proposed tasks. Idea discussion never runs code and never creates tasks without your approval.

## 4. How to Connect Claude Desktop & Claude Code via MCP

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
| `discuss_idea` / `approve_idea` | Team discussion of a rough idea / create the proposed tasks |
