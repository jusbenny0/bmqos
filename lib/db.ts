import "server-only";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite OS: answer drafts, sessions, 2FA, audit_log (write-only, via lib/audit) and chat history (Paperclip remains the sole source of truth for tasks)
let db: DatabaseSync | null = null;
export const sql = (): DatabaseSync => {
  if (db) return db;
  const file = process.env.OS_DB ?? "data/os.db";
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;"); // several processes (tests, workers) may share the file
  db.exec(`CREATE TABLE IF NOT EXISTS answers (issue TEXT, qid TEXT, value TEXT, at TEXT, sent INTEGER, PRIMARY KEY (issue, qid));
CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, text TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS session (id TEXT PRIMARY KEY, created INTEGER, last_seen INTEGER, expires INTEGER, ip TEXT, ua TEXT, stepup_until INTEGER DEFAULT 0, fails INTEGER DEFAULT 0, revoked INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS totp (id INTEGER PRIMARY KEY CHECK (id = 1), confirmed INTEGER, last_step INTEGER, backup TEXT);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL, actor TEXT NOT NULL, session TEXT, ip TEXT, ua TEXT, action TEXT NOT NULL, tier INTEGER NOT NULL, target TEXT NOT NULL, params TEXT, status TEXT NOT NULL, stepup TEXT, result TEXT, ref INTEGER, prev TEXT NOT NULL, hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, type TEXT NOT NULL, project TEXT NOT NULL, options TEXT NOT NULL, created TEXT NOT NULL, choice INTEGER, answered TEXT);
CREATE TABLE IF NOT EXISTS mine (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, project TEXT NOT NULL, created TEXT NOT NULL, done TEXT, handed TEXT);
CREATE TABLE IF NOT EXISTS snooze (item TEXT PRIMARY KEY, until INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is write-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is write-only'); END;
CREATE TABLE IF NOT EXISTS nonce (id TEXT PRIMARY KEY, at INTEGER, key TEXT);
CREATE TABLE IF NOT EXISTS push_sub (endpoint TEXT PRIMARY KEY, sub TEXT, ua TEXT, at TEXT);
CREATE TABLE IF NOT EXISTS push_pref (cat TEXT PRIMARY KEY, mode TEXT);
CREATE TABLE IF NOT EXISTS push_snooze (endpoint TEXT PRIMARY KEY, until INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS push_seen (id TEXT PRIMARY KEY, at TEXT);
CREATE TABLE IF NOT EXISTS brand_project (id TEXT PRIMARY KEY, name TEXT NOT NULL, kit TEXT NOT NULL, kit_rev INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, updated TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS brand_asset (id INTEGER PRIMARY KEY AUTOINCREMENT, project TEXT NOT NULL REFERENCES brand_project(id) ON DELETE CASCADE, gen INTEGER NOT NULL, parent_id INTEGER, format TEXT NOT NULL, w INTEGER NOT NULL, h INTEGER NOT NULL, brief TEXT NOT NULL, html TEXT NOT NULL, png_path TEXT, bytes INTEGER, kit_rev INTEGER NOT NULL, starred INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, error TEXT, created TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS brand_asset_p ON brand_asset(project, gen);
CREATE TABLE IF NOT EXISTS morning (day TEXT PRIMARY KEY, body TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0);`);
  return db;
};
