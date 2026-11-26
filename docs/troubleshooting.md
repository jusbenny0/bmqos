# Troubleshooting Guide

Common issues, diagnostics, and step-by-step solutions for running BMQOS and the Crew Agent Engine.

---

## 1. Port Conflicts

### Symptom: `EADDRINUSE: address already in use :::3000` or `:::3800`

BMQOS uses the following default ports:
- **Port 3000:** BMQOS Control Panel
- **Port 3800:** Crew Agent Engine
- **Port 4600+:** Evidence preview servers (`CREW_EVIDENCE_PORT_BASE`)

### Diagnostic:
Check what process is holding the port:
```bash
lsof -i :3000
# or
ss -tulpn | grep 3000
```

### Resolution:
- Terminate the conflicting process:
  ```bash
  kill -9 <PID>
  ```
- Or override the port in your environment:
  ```bash
  # In .env for the panel:
  PORT=3005

  # In engine/.env for the engine:
  PORT=3805
  CREW_URL=http://127.0.0.1:3805
  ```

---

## 2. Claude CLI Login & Mock Fallback

### Symptom: Agents give canned mock responses or log `claude not logged in`

When `claude` is missing from `PATH` or not authenticated, the engine automatically falls back to **mock mode** so workflows continue safely without failing.

### Diagnostic:
Verify your CLI authentication status:
```bash
which claude
claude auth status
```

### Resolution:
1. Ensure the Claude Code CLI is installed globally:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```
2. Log in interactively:
   ```bash
   claude login
   ```
3. Verify that `~/.claude/.credentials.json` exists and is readable.

---

## 3. Playwright / Headless Chromium Missing

### Symptom: Visual review logs `no chromium found, skipping evidence`

The evidence subsystem captures 1440px and 390px screenshots using headless Chromium. If Chromium is not found, visual evidence is skipped gracefully without halting the pipeline.

### Resolution:
Install Playwright Chromium in the user cache:
```bash
npx playwright install chromium
```
Or point `CREW_CHROME` directly to your system's Chromium / Chrome binary:
```env
# In engine/.env:
CREW_CHROME=/usr/bin/chromium-browser
```

---

## 4. SQLite Database Locks & Permissions

### Symptom: `SqliteError: database is locked` or `EACCES: permission denied`

SQLite uses WAL (Write-Ahead Logging) mode for concurrent access, but file permission mismatches or stale processes can cause locks.

### Diagnostic:
Check ownership and lock files:
```bash
ls -la data/
# Look for os.db, os.db-wal, os.db-shm
```

### Resolution:
1. Ensure the running user has read/write permissions to the `data/` and `engine/data/` directories:
   ```bash
   chmod -R u+rwX data/ engine/data/
   ```
2. If stale processes hold locks, kill them and remove `-wal` / `-shm` temporary files:
   ```bash
   rm -f data/os.db-wal data/os.db-shm engine/data/crew.db-wal engine/data/crew.db-shm
   ```

---

## 5. Token Budgets & Context Window Ceilings

### Symptom: Task stops with `token cap reached` or agent seems confused

Tasks have strict token budgets based on size:
- **Small (S):** 300,000 tokens (`CREW_CAP_S`)
- **Medium (M):** 800,000 tokens (`CREW_CAP_M`)
- **CEO Reset:** Resets after 60,000 tokens (`CREW_CEO_RESET_TOKENS`) to prevent context bloat.

### Resolution:
- For larger tasks, adjust the task size or increase the budget in `engine/.env`:
  ```env
  CREW_CAP_S=500000
  CREW_CAP_M=1200000
  ```
- Or update the individual task via API:
  ```bash
  curl -s -X PATCH "http://127.0.0.1:3800/api/tasks/42" \
    -H "Authorization: Bearer $CREW_API_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"token_cap": 600000}'
  ```

---

## 6. Actions Degrade to Drafts (Safe Mode)

### Symptom: Approved cards do not execute real-world changes

BMQOS features a fail-closed execution guard (`lib/guard.ts`). By default, `OS_CONTROL=0`, meaning actions are safely recorded as drafts.

### Resolution:
To permit live mutations (code merges, infrastructure commands):
Set `OS_CONTROL=1` in `.env`:
```env
OS_CONTROL=1
```
Restart the panel. Sensitive actions will now execute when approved with required 2FA / TOTP credentials.
