// Real test: npx tsx scripts/runtime-test.mts  (sends 2 messages to Haiku, checks resume + usage)
import { db } from "../lib/db";
import { send } from "../lib/runtime";

const id = db().prepare("INSERT INTO employees (name, role, model, cwd) VALUES ('test-haiku','tester','haiku','/tmp')").run().lastInsertRowid as number;
const a = await send(id, "Remember the number 42. Reply only 'ok'.");
console.log("1:", a.reply, a.usage, a.costUsd, a.sessionId);
const b = await send(id, "What number did I tell you? Number only.");
console.log("2:", b.reply, b.usage, b.costUsd, b.sessionId);
console.log(db().prepare("SELECT status, context_pct FROM employees WHERE id=?").get(id));
db().prepare("DELETE FROM messages WHERE employee_id=?").run(id);
db().prepare("DELETE FROM employees WHERE id=?").run(id);
