import { sql } from "@/lib/db";
import { guarded } from "@/lib/guard";
import { sessionOf } from "@/lib/sessions";
import { snapshot } from "@/lib/paperclip";
import { machinesNow } from "@/lib/storage";
import { apps } from "@/lib/dokploy";
import { options } from "@/lib/tasks";
import { hermesContext } from "@/lib/context";
import { sameOrigin } from "@/lib/origin";
import { SESSION, call, discordMessages, ensureSession, failMsg, frames, live, merge, messagesOf, pending, pendingList, sinceBlock, toEv, turn, type Ev } from "@/lib/hermes";

export const dynamic = "force-dynamic";
const enc = new TextEncoder();
const sse = (o: Ev): Uint8Array => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
const IMG = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/;
const IMG_MAX = 4 * 1024 * 1024;
const BODY_MAX = 14 * 1024 * 1024;
const MAGIC = [/^iVBORw0KGgo/, /^\/9j\//, /^R0lGOD/, /^UklGR/]; // png, jpeg, gif, webp (base64 start)
const hitsAt: number[] = [];
const limited = (): boolean => {
  const now = Date.now();
  while (hitsAt.length && now - hitsAt[0] > 60_000) hitsAt.shift();
  if (hitsAt.length >= 20) return true;
  hitsAt.push(now);
  return false;
};

export async function GET(req: Request) {
  if (!sessionOf(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!live()) {
    const rows = sql().prepare("SELECT role, text, at FROM chat ORDER BY id DESC LIMIT 60").all().reverse().map((r) => ({ ...r, src: "bmqos" }));
    return Response.json({ live: false, messages: rows });
  }
  try {
    const [d, b] = await Promise.all([discordMessages(), messagesOf(SESSION, "bmqos", 60).catch(() => [])]);
    return Response.json({ live: true, messages: merge(d, b).slice(-80), approvals: pendingList() });
  } catch {
    return Response.json({ live: true, messages: [] });
  }
}

interface In { text?: string; view?: string; issue?: string; images?: { name?: string; dataUrl?: string }[] }
// POST: owner's message → Assistant session stream; mock when there's no key. The key never reaches the client.
export async function POST(req: Request) {
  if (!sameOrigin(req) || !sessionOf(req)) return Response.json({ error: "unauthorized" }, { status: 403 });
  if (Number(req.headers.get("content-length") ?? 0) > BODY_MAX) return Response.json({ error: "body too large" }, { status: 413 });
  if (limited()) return Response.json({ error: "too many messages, wait a bit" }, { status: 429 });
  const { text = "", view = "", issue = "", images = [] } = (await req.json().catch(() => ({}))) as In;
  if (!text.trim() || text.length > 4000) return Response.json({ error: "invalid message" }, { status: 400 });
  if (!Array.isArray(images) || images.length > 3 || images.some((i) => typeof i?.dataUrl !== "string" || !IMG.test(i.dataUrl) || i.dataUrl.length > IMG_MAX * 1.4 || !MAGIC.some((m) => m.test(i.dataUrl!.slice(i.dataUrl!.indexOf(",") + 1))))) return Response.json({ error: "invalid attachment (max 3 images, 4 MB)" }, { status: 400 });
  return guarded(req, "chat.send", "hermes", {}, { len: text.length, images: images.length }, async () => {
    if (turn.id) return Response.json({ error: "Assistant is still answering" }, { status: 409 }); // set synchronously in stream(): no await in between
    return stream(text.trim(), String(view).slice(0, 30), String(issue).slice(0, 40), images.map((i) => String(i.dataUrl)));
  });
}

const mock = async (ctl: { enqueue(e: Uint8Array): void }, text: string): Promise<void> => {
  const db = sql(), at = (): string => new Date().toISOString();
  db.prepare("INSERT INTO chat (role, text, at) VALUES ('user', ?, ?)").run(text, at());
  const m = "Assistant isn't connected right now (missing HERMES_API_KEY or HERMES_API_URL), so this is demo mode. The message is saved in history.";
  for (const w of m.split(" ")) { ctl.enqueue(sse({ delta: `${w} ` })); await new Promise((r) => setTimeout(r, 40)); }
  db.prepare("INSERT INTO chat (role, text, at) VALUES ('assistant', ?, ?)").run(m, at());
};

const stream = (text: string, view: string, issue: string, images: string[]): Response => {
  const me = Symbol("turn");
  turn.id = me;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 300_000);
  const body = new ReadableStream<Uint8Array>({
    cancel() { ac.abort(); }, // client left: cancel upstream, the lock is released in finally
    async start(c) {
      const ctl = { enqueue: (e: Uint8Array): void => { try { c.enqueue(e); } catch { /* client disconnected */ } } };
      try {
        if (!live()) { await mock(ctl, text); ctl.enqueue(sse({ done: true })); }
        else {
          await ensureSession();
          const [d, b, a] = await Promise.all([discordMessages().catch(() => []), messagesOf(SESSION, "bmqos", 1).catch(() => []), Promise.race([apps(), new Promise<null>((r) => setTimeout(() => r(null), 4000))]).catch(() => null)]);
          const deploy = (a ?? []).slice(0, 15).map((x) => `${x.name} (${x.project}): ${x.status}`).join("; ");
          const projects = (await options().catch(() => null))?.projects.map((p) => p.name);
          const instructions = hermesContext(await snapshot(), await machinesNow().catch(() => []), view, issue, { deploy, discord: sinceBlock(d, b), projects });
          const message = images.length ? [{ type: "text", text }, ...images.map((url) => ({ type: "image_url", image_url: { url } }))] : text;
          const res = await call(`/api/sessions/${SESSION}/chat/stream`, { method: "POST", headers: { "X-Hermes-Session-Key": SESSION }, body: JSON.stringify({ message, instructions }), signal: ac.signal });
          if (!res.ok || !res.body) throw new Error(`Hermes ${res.status}`);
          let ended = false;
          for await (const f of frames(res.body)) {
            const ev = toEv(f.event, f.data);
            if (!ev) continue;
            if ("approval" in ev) pending.set(ev.approval.run, { title: ev.approval.title, command: ev.approval.command, at: Date.now() });
            ctl.enqueue(sse(ev));
            if ("done" in ev || "error" in ev) { ended = true; break; }
          }
          if (!ended) throw new Error("stream ended without a terminator");
        }
      } catch (e) {
        ctl.enqueue(sse({ error: failMsg(String(e)) }));
      } finally {
        clearTimeout(timer);
        if (turn.id === me) turn.id = null;
      }
      try { c.close(); } catch { /* already closed */ }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" } });
};
