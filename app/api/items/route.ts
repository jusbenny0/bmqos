import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { addMine, doneMine, filter, handoff, items, mineById, snooze, TABS, TYPES, type Tab } from "@/lib/items";
import { sessionOf } from "@/lib/sessions";

export const dynamic = "force-dynamic";

const ID = /^(paperclip:[A-Z]{2,6}-\d{1,6}|social:[\w-]{1,64}|card:\d{1,9}|mine:\d{1,9}|pr:[\w./#-]{1,80}|watch:[\w./:-]{1,80})$/;
const json = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function GET(req: Request) {
  if (!sessionOf(req)) return json("unauthorized", 401);
  const q = new URL(req.url).searchParams;
  const tab = q.get("tab") ?? "";
  if (tab && !TABS.includes(tab as Tab)) return json("invalid tab", 400);
  const type = q.get("type") ?? "";
  if (type && !TYPES.includes(type)) return json("invalid type", 400);
  const xs = filter(await items(), { tab: (tab || undefined) as Tab | undefined, project: q.get("project") || undefined, type: type || undefined, q: q.get("q")?.slice(0, 80) || undefined });
  return NextResponse.json({ items: xs }, { headers: { "Cache-Control": "no-store" } });
}

type Body = { op?: string; text?: string; project?: string; id?: string; until?: number };

// writes (Mine, snooze, hand off to Hermes): session + CSRF + audit via guarded
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const run = (action: string, target: string, params: object, fn: () => Promise<unknown>) => guarded(req, action, target, {}, params, fn);
  if (b.op === "add") {
    if (typeof b.text !== "string" || !b.text.trim() || b.text.length > 300 || (b.project !== undefined && (typeof b.project !== "string" || b.project.length > 40))) return json("invalid text", 400);
    let id = 0;
    const r = await run("item.write", "mine:new", { op: "add", project: b.project }, async () => { id = addMine(b.text as string, b.project?.trim() || undefined); });
    return r instanceof NextResponse ? r : NextResponse.json({ ok: true, id: `mine:${id}` }, { status: 201 });
  }
  if (b.op === "snooze") {
    const until = b.until;
    if (typeof b.id !== "string" || !ID.test(b.id) || typeof until !== "number" || !Number.isFinite(until) || until <= Date.now() || until > Date.now() + 366 * 864e5) return json("invalid snooze", 400);
    const id = b.id;
    const r = await run("item.write", id, { op: "snooze", until }, async () => snooze(id, until));
    return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
  }
  if (b.op === "done" || b.op === "handoff") {
    const n = /^mine:(\d{1,9})$/.exec(b.id ?? "")?.[1];
    if (!n || !mineById(Number(n))) return json("task not found", 404);
    const num = Number(n);
    if (b.op === "done") {
      const r = await run("item.write", `mine:${num}`, { op: "done" }, async () => { if (!doneMine(num)) throw new Error("already done"); });
      return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
    }
    let issue = "";
    const r = await run("item.handoff", `mine:${num}`, { op: "handoff" }, async () => { issue = await handoff(num); });
    return r instanceof NextResponse ? r : NextResponse.json({ ok: true, issue });
  }
  return json("invalid action", 400);
}
