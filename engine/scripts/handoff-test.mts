// Handoff test: npx tsx scripts/handoff-test.mts (2x Haiku, no PR -> handoff_note)
import { db } from "../lib/db";
import { send } from "../lib/runtime";
const d = db();
const b = d.prepare("INSERT INTO employees (name, role, model, cwd) VALUES ('t-build','builder','haiku','/tmp')").run().lastInsertRowid as number;
d.prepare("INSERT INTO employees (name, role, model, cwd) VALUES ('t-rev','reviewer','haiku','/tmp')").run();
const t = d.prepare("INSERT INTO tasks (title, brief, handoff_note) VALUES ('test','Say hello','done: greeting')").run().lastInsertRowid as number;
await send(b, "Reply only 'ok'.", t);
for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 3000)); const s = (d.prepare("SELECT status FROM tasks WHERE id=?").get(t) as { status: string }).status; if (s === "done" || s === "blocked") break; }
console.log(d.prepare("SELECT status FROM tasks WHERE id=?").get(t), d.prepare("SELECT kind,text FROM events WHERE task_id=?").all(t));
