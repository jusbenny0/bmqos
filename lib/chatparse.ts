/** Pure chat-client logic: SSE server events, ```bmqos action blocks and clickable tasks. No DOM, tested standalone. */
export interface ChatEvent { delta?: string; tool?: { name: string; state: string }; approval?: { run: string; title: string; choices: string[] }; done?: boolean; error?: string }

/** Takes the buffered text so far, returns finished events plus the unfinished remainder. Bad JSON is skipped. */
export function parseSse(buf: string): { events: ChatEvent[]; rest: string } {
  const parts = buf.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: ChatEvent[] = [];
  for (const p of parts) {
    const line = p.split("\n").find((l) => l.startsWith("data:"));
    if (!line) continue;
    try { events.push(JSON.parse(line.slice(5).trim()) as ChatEvent); } catch { /* corrupted frame */ }
  }
  return { events, rest };
}

export const DO = ["open", "answer", "approve", "reject", "create", "comment", "update"] as const;
export type Do = (typeof DO)[number];
export interface Action { do: Do; id: string; text: string; title?: string; qid?: string; agent?: string; project?: string; priority?: string }
export type Seg = { t: "text"; v: string } | { t: "act"; a: Action; n: number };

const ID = /^[A-Z]{2,8}-\d+$/;
const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Validates one block. Outside the allowlist, bad id, or missing text = null (renders as plain text). */
export function toAction(raw: string): Action | null {
  let j: Record<string, unknown> | null;
  try { j = JSON.parse(raw) as Record<string, unknown> | null; } catch { return null; }
  if (!j || typeof j !== "object" || !(DO as readonly unknown[]).includes(j.do)) return null;
  const d = j.do as Do, id = str(j.id, 20), text = str(j.text, 3900).trim();
  if (d !== "create" && !ID.test(id)) return null;
  if ((d === "answer" || d === "create" || d === "comment") && !text) return null;
  const a: Action = { do: d, id: d === "create" ? "" : id, text };
  for (const k of ["qid", "agent", "project", "priority"] as const) { const v = str(j[k], 120); if (v) a[k] = v; }
  const title = str(j.title, 80).trim();
  if (title) a.title = title;
  if (d === "update" && !a.agent && !a.priority && !a.title) return null; // an update with no change makes no sense
  if (d === "create") a.title = title || text.split("\n")[0].slice(0, 80); // missing title = first line of the text
  return a;
}

/** Splits reply text into text and action cards; n = action order in the message (stable state key). An unfinished block during streaming stays as text. */
export function splitActions(text: string): Seg[] {
  const out: Seg[] = [];
  const re = /```bmqos[ \t]*\n?([\s\S]*?)```/g;
  let last = 0, n = 0, m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const a = toAction(m[1].trim());
    if (!a) continue;
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: "act", a, n: n++ });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

/** ABC-123 in rendered HTML → link; tags, <a> and <code> are skipped, attributes and existing links stay intact. */
export const linkIssues = (html: string): string =>
  html.replace(/(<a\b[\s\S]*?<\/a>|<code\b[\s\S]*?<\/code>|<[^>]+>)|\b[A-Z]{2,8}-\d{1,6}\b/g, (m, tag: string | undefined) => (tag ? tag : `<a href="#" class="iss" data-issue="${m}">${m}</a>`));
