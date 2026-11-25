import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { sessionOf } from "@/lib/sessions";
import * as crew from "@/lib/crew";

export const dynamic = "force-dynamic";

/* Server-side proxy to the Crew API: /api/crew/team · team/:id/transcript?after= · team/:id/message (POST) · tasks · tasks/:id ·
   usage?range= · chat (POST, CEO assignment) · brain/search?q= · brain/node/:id (id can contain /) · brain/graph.
   Requires a logged-in session; the Crew token stays on the server. Hermes chat stays at /api/chat, this is only chat with the Crew CEO. */
const out = (e: unknown): NextResponse => {
  const s = e instanceof crew.CrewError ? e.status : 502;
  return NextResponse.json({ error: s === 404 ? "not found" : "Crew unavailable" }, { status: s });
};
const num = (v: string | null | undefined): number | null => (v && /^\d{1,9}$/.test(v) ? Number(v) : null);

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { path } = await ctx.params;
  const q = new URL(req.url).searchParams;
  const id = num(path[1]);
  try {
    let data: unknown;
    if (path.length === 1 && path[0] === "team") data = await crew.team();
    else if (path.length === 1 && path[0] === "tasks") data = await crew.tasks();
    else if (path.length === 2 && path[0] === "tasks" && id !== null) data = await crew.task(id);
    else if (path.length === 1 && path[0] === "usage") {
      const r = q.get("range") ?? "24h";
      if (r !== "24h" && r !== "7d") return NextResponse.json({ error: "range" }, { status: 400 });
      data = await crew.usage(r);
    } else if (path.length === 3 && path[0] === "team" && path[2] === "transcript" && id !== null) data = await crew.transcript(id, num(q.get("after")) ?? 0);
    else if (path.length === 3 && path[0] === "team" && path[2] === "instructions" && id !== null) data = await crew.instructions(id);
    else if (path[0] === "brain" && path[1] === "search") data = await crew.brainSearch(q.get("q") ?? "");
    else if (path[0] === "brain" && path[1] === "node" && path.length > 2) data = await crew.brainNode(path.slice(2).join("/"));
    else if (path.length === 2 && path[0] === "brain" && path[1] === "graph") data = await crew.brainGraph();
    else return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return out(e); }
}

// message to an employee / CEO assignment: session + CSRF + audit via guarded (chat.send action)
export async function POST(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const id = num(path[1]);
  const b = (await req.json().catch(() => ({}))) as { text?: unknown; taskId?: unknown };
  const text = typeof b.text === "string" ? b.text.trim() : "";
  if (!text || text.length > 8000) return NextResponse.json({ error: "text" }, { status: 400 });
  try {
    if (path.length === 1 && path[0] === "chat") {
      const r = await guarded(req, "chat.send", "crew/chat", {}, {}, () => crew.chat(text));
      return r instanceof NextResponse ? r : NextResponse.json(r);
    }
    if (path.length === 3 && path[0] === "team" && path[2] === "message" && id !== null) {
      const taskId = typeof b.taskId === "number" ? b.taskId : undefined;
      const r = await guarded(req, "chat.send", `team/${id}`, {}, { taskId }, () => crew.message(id, text, taskId));
      return r instanceof NextResponse ? r : NextResponse.json(r);
    }
    return NextResponse.json({ error: "not found" }, { status: 404 });
  } catch (e) { return out(e); }
}
