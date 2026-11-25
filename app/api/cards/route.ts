import { NextResponse } from "next/server";
import { MAX_OPEN, answered, create, fromLan, keyOk, openCount, parseNew } from "@/lib/cards";

export const dynamic = "force-dynamic";

// Hermes (not a browser): only from LAN and with the OS_CARDS_KEY; proxy.ts lets this route through without a session, the gate is here
const deny = (req: Request): NextResponse | null =>
  !fromLan(req) ? NextResponse.json({ error: "LAN only" }, { status: 403 }) : !keyOk(req) ? NextResponse.json({ error: "unauthorized" }, { status: 401 }) : null;

export async function POST(req: Request) {
  const d = deny(req);
  if (d) return d;
  if (Number(req.headers.get("content-length") ?? 0) > 4096) return NextResponse.json({ error: "too large" }, { status: 413 });
  if (openCount() >= MAX_OPEN) return NextResponse.json({ error: "too many unanswered cards" }, { status: 429 });
  const c = parseNew(await req.json().catch(() => null));
  if (!c) return NextResponse.json({ error: "invalid card (text, type, project, 1–3 choices)" }, { status: 400 });
  return NextResponse.json({ id: create(c) }, { status: 201 });
}

export async function GET(req: Request) {
  const d = deny(req);
  if (d) return d;
  const q = new URL(req.url).searchParams;
  if (q.get("answered") !== "1") return NextResponse.json({ error: "missing answered=1" }, { status: 400 });
  return NextResponse.json(answered(Number(q.get("after")) || 0), { headers: { "Cache-Control": "no-store" } });
}
