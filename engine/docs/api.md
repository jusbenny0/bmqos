# Crew Engine API Specification (v1 Contract)

The Crew Engine API provides endpoints for orchestrating AI agent workflows, managing tasks, querying execution transcripts, tracking token metrics, and accessing the persistent knowledge base (Brain).

---

## Authentication

All requests to `/api/*` endpoints require authentication. The engine supports three authentication methods:

### 1. External Bearer Token
- Header: `Authorization: Bearer <CREW_API_TOKEN>`
- Validated in constant time against the `CREW_API_TOKEN` environment variable.
- Required for external integrations and automated scripts.
- If `CREW_API_TOKEN` is unset or empty, Bearer authentication is disabled (fails closed).

### 2. Internal Agent Callback Header
- Header: `x-crew-token: <CREW_TOKEN>`
- Validated against the `CREW_TOKEN` environment variable.
- Supported on agent-facing endpoints:
  - `/api/delegate`
  - `/api/tasks` and `/api/tasks/:id`
  - `/api/brain/*`

### 3. Session Cookie
- Used by the web dashboard after authentication via `/login`.

Unauthenticated requests to API endpoints return `401 Unauthorized`:
```json
{
  "error": "unauthorized"
}
```

---

## Common Data Types

```ts
export type TaskStatus = "todo" | "doing" | "review" | "done" | "blocked";

export type Employee = {
  id: number;
  name: string;
  role: "ceo" | "builder" | "junior" | "designer" | "reviewer" | "visual" | "qa" | "security";
  model: "sonnet" | "haiku";
  system_prompt: string;
  cwd: string;
  session_id: string | null;
  status: "idle" | "busy" | "error";
  context_pct: number;
  engine: "claude" | "agy";
  engine_model: string | null;
  created_at: string;
};

export type TeamMember = Employee & {
  task_id: number | null;
  task_title: string | null;
  task_status: TaskStatus | null;
  last_step: string | null;
  tokens_today: number;
  last_message: string | null;
  last_message_at: string | null;
};

export type Task = {
  id: number;
  title: string;
  brief: string;
  owner_id: number | null;
  reviewer_id: number | null;
  status: TaskStatus;
  handoff_note: string;
  pr_url: string | null;
  token_cap: number | null;
  needs_qa: number;
  needs_visual: number;
  needs_security: number;
  created_at: string;
  updated_at: string;
};

export type TaskEvent = {
  id: number;
  task_id: number;
  kind: "created" | "delegated" | "status" | "scan" | "gate" | "verdict" | "returned" | "returned_visual" | "blocked" | "error";
  text: string;
  created_at: string;
};

export type TranscriptMessage = {
  id: number;
  role: "user" | "assistant" | "system";
  content: string;
  task_id: number | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  cost_usd: number;
  created_at: string;
};

export type Tokens = {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
};

export type UsageRow = {
  id: number;
  label: string;
  messages: number;
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
  tokens: number;
};

export type SendResult = {
  reply: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  costUsd: number;
  sessionId: string;
};
```

---

## Endpoint Reference

### Team & Employees

#### `GET /api/team`
Returns the team roster with active task information, recent actions, and token counts.
- **Response:** `200 OK` — `TeamMember[]`

#### `PATCH /api/employees/:id`
Updates configuration for an employee (system prompt, working directory, role, model).
- **Request Body:**
  ```json
  {
    "name": "Builder A",
    "role": "builder",
    "model": "sonnet",
    "system_prompt": "Custom system prompt...",
    "cwd": "/path/to/worktree"
  }
  ```
- **Response:** `200 OK` — `Employee`

#### `GET /api/team/:id/transcript`
Fetches conversation transcripts for an employee in ascending order.
- **Query Parameters:**
  - `after` (optional, integer): Message ID to paginate after.
  - `limit` (optional, integer, default: 200, max: 500): Number of messages.
- **Response:** `200 OK`
  ```json
  {
    "messages": [ /* TranscriptMessage[] */ ],
    "last_id": 1234
  }
  ```

#### `POST /api/team/:id/message`
Dispatches an interactive message to a specific agent and waits for execution to complete.
- **Request Body:**
  ```json
  {
    "text": "Please run the test suite and report results.",
    "taskId": 42
  }
  ```
- **Response:** `200 OK` — `SendResult`

---

### Tasks & Delegation

#### `GET /api/tasks`
Lists all tasks ordered by ID descending.
- **Response:** `200 OK` — `Task[]`

#### `POST /api/tasks`
Creates a new task.
- **Request Body:**
  ```json
  {
    "title": "Implement feature X",
    "brief": "Goal: Implement feature X with tests.\nAcceptance: tsc OK, npm test passes.\nScope: src/ only.\nSize: S",
    "needs_qa": 0,
    "needs_visual": 0,
    "needs_security": 0,
    "owner_id": null,
    "token_cap": 300000
  }
  ```
- **Response:** `201 Created` — `Task`

#### `GET /api/tasks/:id`
Retrieves task details including timeline events, transcript messages, and cumulative token consumption.
- **Response:** `200 OK`
  ```json
  {
    "id": 42,
    "title": "Implement feature X",
    "brief": "...",
    "status": "doing",
    "owner_id": 2,
    "reviewer_id": null,
    "handoff_note": "",
    "pr_url": null,
    "token_cap": 300000,
    "needs_qa": 0,
    "needs_visual": 0,
    "needs_security": 0,
    "created_at": "2026-11-25 18:00:00",
    "updated_at": "2026-11-25 18:05:00",
    "events": [ /* TaskEvent[] */ ],
    "messages": [ /* TranscriptMessage[] */ ],
    "tokens": {
      "input": 12000,
      "output": 1500,
      "cache_read": 35000,
      "cache_write": 2500,
      "cost_usd": 0.045
    }
  }
  ```

#### `PATCH /api/tasks/:id`
Updates task fields (status, owner, reviewer, PR URL, handoff note).
- **Request Body:**
  ```json
  {
    "status": "review",
    "handoff_note": "Implementation completed in branch agent/feature-x. All tests pass.",
    "pr_url": "https://github.com/example/repo/pull/1"
  }
  ```
- **Response:** `200 OK` — Updated task object.

#### `POST /api/delegate`
Delegates a task to an employee and initiates autonomous execution.
- **Request Body:**
  ```json
  {
    "to": "Junior Builder",
    "taskId": 42,
    "text": "Detailed task instructions..."
  }
  ```
- **Response:** `202 Accepted`
  ```json
  {
    "accepted": true,
    "employeeId": 3
  }
  ```

---

### Usage & Metrics

#### `GET /api/usage`
Retrieves aggregated token metrics and cost analytics.
- **Query Parameters:**
  - `range` (`24h` | `7d`, default: `24h`): Time aggregation window.
- **Response:** `200 OK`
  ```json
  {
    "byEmployee": [ /* UsageRow[] */ ],
    "byTask": [ /* UsageRow[] */ ],
    "total": {
      "messages": 142,
      "input": 250000,
      "output": 35000,
      "cache_read": 1800000,
      "cache_write": 120000,
      "cost_usd": 4.12,
      "tokens": 405000
    },
    "series": [
      { "t": "2026-11-25 12:00:00", "tokens": 15000, "cost_usd": 0.15 }
    ]
  }
  ```

---

### CEO Chat

#### `POST /api/chat`
Sends a directive directly to the CEO planning agent.
- **Request Body:**
  ```json
  {
    "text": "Break down the roadmap for the new payment gateway integration."
  }
  ```
- **Response:** `200 OK` — `SendResult`

---

### Knowledge Base (Brain)

The engine includes a markdown-based knowledge base located in `brain/` (`decisions/`, `projects/`, etc.).

#### `GET /api/brain/search?q=<query>`
Full-text search across knowledge base markdown files.
- **Response:** `200 OK`
  ```json
  {
    "results": [
      {
        "id": "decisions/2026-11-25-architecture",
        "title": "Architecture Overview",
        "snippet": "...",
        "score": 4
      }
    ]
  }
  ```

#### `GET /api/brain/node/:id`
Retrieves the body and outgoing links for a specific knowledge base node.
- **Response:** `200 OK`
  ```json
  {
    "id": "decisions/2026-11-25-architecture",
    "title": "Architecture Overview",
    "body": "# Architecture Overview\n...",
    "links": ["projects/core"]
  }
  ```

#### `POST /api/brain/decision`
Records an architectural or project decision into the knowledge base.
- **Request Body:**
  ```json
  {
    "title": "Adopt SQLite WAL Mode",
    "text": "Decided to run SQLite in WAL mode for better concurrency and read performance."
  }
  ```
- **Response:** `201 Created`
  ```json
  {
    "id": "decisions/2026-11-25-adopt-sqlite-wal-mode",
    "title": "Adopt SQLite WAL Mode",
    "body": "Decided to run SQLite in WAL mode...",
    "links": []
  }
  ```

#### `GET /api/brain/graph`
Returns nodes and edges representing the entire knowledge base graph for visualization.
- **Response:** `200 OK`
  ```json
  {
    "nodes": [
      { "id": "decisions/2026-11-25-architecture", "title": "Architecture Overview", "group": "decisions" }
    ],
    "links": [
      { "source": "decisions/2026-11-25-architecture", "target": "projects/core" }
    ]
  }
  ```

---

## Error Format

All error responses adhere to the standard JSON structure:
```json
{
  "error": "Descriptive error message"
}
```

Standard HTTP status codes:
- `400 Bad Request`: Missing required parameters or invalid values.
- `401 Unauthorized`: Missing or invalid authentication token.
- `404 Not Found`: Target entity or route does not exist.
- `500 Internal Server Error`: Unexpected server exception.
