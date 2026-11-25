import { scrub } from "./inbox";

/* Assistant API client. Key and URL only live server-side; the client only gets the translated output (no tool args, no Discord session id). */
export const SESSION = process.env.HERMES_SESSION || "bmqos-owner";
export const RUN = /^run_[0-9a-f]{32}$/;
export type Src = "discord" | "bmqos";
export interface Msg { role: "user" | "assistant"; text: string; at: string; src: Src }
export type Ev = { delta: string } | { tool: { name: string; state: "run" | "done" | "error" } } | { approval: { run: string; title: string; command: string; choices: ["once", "deny"] } } | { done: true } | { error: string };

const base = (): string => (process.env.HERMES_API_URL ?? "").replace(/\/$/, "");
export const live = (): boolean => !!process.env.HERMES_API_KEY && !!base();
export const call = (path: string, init: RequestInit = {}, ms = 10_000): Promise<Response> =>
  fetch(`${base()}${path}`, { ...init, headers: { Authorization: `Bearer ${process.env.HERMES_API_KEY}`, "Content-Type": "application/json", ...init.headers }, signal: init.signal ?? AbortSignal.timeout(ms) });

/* Persistent session for the owner: stable id, 409 = already exists. */
export const ensureSession = async (): Promise<void> => {
  const r = await call("/api/sessions", { method: "POST", body: JSON.stringify({ id: SESSION, source: "api_server", title: "BMQOS Owner" }) });
  if (!r.ok && r.status !== 409) throw new Error(`Hermes session ${r.status}`);
};

const iso = (t: unknown): string => {
  const n = typeof t === "number" ? t : Date.parse(String(t));
  const ms = typeof t === "number" ? (n < 1e12 ? n * 1000 : n) : n;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : "";
};
const textOf = (c: unknown): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p) => (p && typeof p === "object" && "text" in p ? String((p as { text: unknown }).text) : "")).join(" ") : "";

export const messagesOf = async (id: string, src: Src, limit = 40): Promise<Msg[]> => {
  const r = await call(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`);
  if (!r.ok) return [];
  const j = (await r.json()) as { data?: { role?: string; content?: unknown; timestamp?: unknown }[] };
  const out: Msg[] = (j.data ?? []).flatMap((m) => {
    const text = scrub(textOf(m.content).trim());
    return (m.role === "user" || m.role === "assistant") && text ? [{ role: m.role, text, at: iso(m.timestamp), src }] : [];
  });
  return out.sort((x, y) => x.at.localeCompare(y.at)); // order doesn't depend on which end the API truncates from
};

/* Owner's last Discord session, read-only. The session id never reaches the client. */
export const discordMessages = async (limit = 40): Promise<Msg[]> => {
  const r = await call("/api/sessions?source=discord&limit=1");
  if (!r.ok) return [];
  const id = ((await r.json()) as { data?: { id?: string }[] }).data?.[0]?.id;
  return id ? messagesOf(id, "discord", limit) : [];
};

export const merge = (a: Msg[], b: Msg[]): Msg[] => [...a, ...b].sort((x, y) => x.at.localeCompare(y.at));

/* "Meanwhile on Discord" block = Discord messages newer than the last BMQOS message, newest wins when trimmed. */
export const sinceBlock = (discord: Msg[], bmqos: Msg[], max = 3000): string => {
  const last = bmqos.at(-1)?.at ?? "";
  const lines = discord.filter((m) => m.at > last).map((m) => `${m.role === "user" ? "Discord" : "Hermes"}: ${m.text.replace(/\s+/g, " ")}`);
  return lines.join("\n").slice(-max);
};

/* Hermes SSE (`event:` + `data:` JSON) → our events. Unknown events are discarded. */
export async function* frames(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
  const rd = body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const event = /^event: *(.+)$/m.exec(p)?.[1] ?? "";
      const raw = /^data: *(.*)$/m.exec(p)?.[1];
      if (!raw) continue;
      try { yield { event, data: JSON.parse(raw) as Record<string, unknown> }; } catch { /* corrupted frame */ }
    }
  }
}

const s = (v: unknown): string => (typeof v === "string" ? v : "");
/* Clear error message: hitting Claude's rate limit ≠ the Assistant being down */
export const failMsg = (raw: string): string =>
  /429|rate.?limit|usage limit|overloaded|529/i.test(raw) ? "Hit Claude's rate limit – the Assistant can't respond right now. Try again in a few minutes." : "The Assistant didn't respond. Try again.";
export const toEv = (event: string, d: Record<string, unknown>): Ev | null => {
  switch (event) {
    case "assistant.delta": return s(d.delta) ? { delta: scrub(s(d.delta)) } : null;
    case "tool.started": return { tool: { name: scrub(s(d.tool_name)).slice(0, 40), state: "run" } };
    case "tool.completed": return { tool: { name: scrub(s(d.tool_name)).slice(0, 40), state: "done" } };
    case "tool.failed": return { tool: { name: scrub(s(d.tool_name)).slice(0, 40), state: "error" } };
    case "approval.request": return RUN.test(s(d.run_id)) ? { approval: { run: s(d.run_id), title: scrub(s(d.description)).slice(0, 200) || "The Assistant is asking to approve a risky step", command: cmd(scrub(s(d.command))), choices: ["once", "deny"] } } : null;
    case "error": case "run.failed": return { error: failMsg(JSON.stringify(d)) };
    case "done": return { done: true };
    default: return null;
  }
};

/* Run id that we sent to the client for approval (valid 10 min); the approval route rejects foreign ids. */
const cmd = (c: string): string => (c.length > 500 ? `${c.slice(0, 500)}… (truncated, ${c.length} chars)` : c);
export const TTL = 10 * 60_000;
export interface Pend { title: string; command: string; at: number }
export const pending = new Map<string, Pend>();
export const pendingList = (): { run: string; title: string; command: string }[] => {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > TTL) pending.delete(k);
  return [...pending].map(([run, v]) => ({ run, title: v.title, command: v.command }));
};
/* One turn at a time (the Assistant session isn't locked): `id` is the owner token, only it may release. */
export const turn: { id: symbol | null } = { id: null };
