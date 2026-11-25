import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { loadTeam } from "@/lib/config";

const g = globalThis as unknown as { __crewDb?: Database.Database };

function open(): Database.Database {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(path.join(dir, "crew.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      model TEXT NOT NULL,
      system_prompt TEXT NOT NULL DEFAULT '',
      cwd TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','busy','error')),
      context_pct REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      brief TEXT NOT NULL DEFAULT '',
      owner_id INTEGER REFERENCES employees(id),
      reviewer_id INTEGER REFERENCES employees(id),
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','review','done','blocked')),
      handoff_note TEXT NOT NULL DEFAULT '',
      pr_url TEXT,
      token_cap INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      task_id INTEGER REFERENCES tasks(id),
      role TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
      content TEXT NOT NULL,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id INTEGER NOT NULL REFERENCES tasks(id),
      kind TEXT NOT NULL,
      text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_messages_employee ON messages(employee_id);
    CREATE INDEX IF NOT EXISTS idx_messages_task ON messages(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
  `);
  // Migrations for existing DBs (ADD COLUMN guarded by a PRAGMA check; CREATE TABLE IF NOT EXISTS adds nothing to existing tables).
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols("tasks").includes("needs_qa")) db.exec("ALTER TABLE tasks ADD COLUMN needs_qa INTEGER NOT NULL DEFAULT 0");
  if (!cols("tasks").includes("needs_visual")) db.exec("ALTER TABLE tasks ADD COLUMN needs_visual INTEGER NOT NULL DEFAULT 0");
  // needs_security: set by the CEO for auth/secrets/payments/public endpoints/uploads/dependencies/infra tasks;
  // the automatic no-LLM scan in lib/runtime can also set it.
  if (!cols("tasks").includes("needs_security")) db.exec("ALTER TABLE tasks ADD COLUMN needs_security INTEGER NOT NULL DEFAULT 0");
  // session_task_id = task the current session_id belongs to; switching tasks starts a fresh session.
  if (!cols("employees").includes("session_task_id")) db.exec("ALTER TABLE employees ADD COLUMN session_task_id INTEGER");
  // engine/engine_model: the junior role can run on another CLI (agy) instead of claude.
  if (!cols("employees").includes("engine")) db.exec("ALTER TABLE employees ADD COLUMN engine TEXT NOT NULL DEFAULT 'claude'");
  if (!cols("employees").includes("engine_model")) db.exec("ALTER TABLE employees ADD COLUMN engine_model TEXT");
  // Seed the team from config (default team or CREW_ROLES_FILE/CREW_ROLES_JSON). Idempotent by name:
  // existing employees (session_id, cwd) are never overwritten, only missing ones are added.
  const ins = db.prepare("INSERT INTO employees (name, role, model, system_prompt, cwd, engine, engine_model) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const has = db.prepare("SELECT 1 FROM employees WHERE name = ?");
  for (const r of loadTeam()) {
    if (!has.get(r.name)) ins.run(r.name, r.role, r.model, r.prompt, r.cwd ?? "", r.engine, r.engine_model ?? null);
  }
  return db;
}

export function db(): Database.Database {
  return (g.__crewDb ??= open());
}

export type Employee = {
  id: number; name: string; role: string; model: string;
  system_prompt: string; cwd: string; session_id: string | null; session_task_id: number | null;
  status: "idle" | "busy" | "error"; context_pct: number; created_at: string;
  engine: "claude" | "agy" | "mock"; engine_model: string | null;
};
export type Task = {
  id: number; title: string; brief: string; owner_id: number | null; reviewer_id: number | null;
  status: "todo" | "doing" | "review" | "done" | "blocked"; handoff_note: string;
  pr_url: string | null; token_cap: number | null; needs_qa: number; needs_visual: number; needs_security: number;
  created_at: string; updated_at: string;
};
