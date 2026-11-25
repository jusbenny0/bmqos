import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { sessionOf } from "@/lib/sessions";
import { parseAction, upstream } from "@/lib/social";

export const dynamic = "force-dynamic";

const STATUSES = ["pending", "snoozed", "approved", "posting", "posted", "failed", "rejected"];
const ID = /^[\w-]{1,64}$/;
type Ctx = { params: Promise<{ path: string[] }> };

const json = (error: string, status: number) => NextResponse.json({ error }, { status });

const relay = async (p: string, init?: RequestInit): Promise<Response> => {
  if (!process.env.SOCIAL_API_URL || !process.env.DRAFTS_API_TOKEN) return json("social-manager isn't configured", 503);
  try {
    const r = await upstream(p, init);
    return new NextResponse(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return json("social-manager isn't responding", 502);
  }
};

export async function GET(req: Request, { params }: Ctx) {
  if (!sessionOf(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = (await params).path.join("/");
  const off = !process.env.SOCIAL_API_URL || !process.env.DRAFTS_API_TOKEN; // module not configured: empty, not an error
  if (p === "status") return off ? NextResponse.json({ configured: false, posting: { enabled: false } }) : relay("/api/status");
  if (p === "drafts" && off) return NextResponse.json([]);
  if (p === "drafts") {
    const status = new URL(req.url).searchParams.get("status") ?? "pending";
    return STATUSES.includes(status) ? relay(`/api/drafts?status=${status}`) : json("invalid status", 400);
  }
  return json("nenalezeno", 404);
}

async function write(req: Request, { params }: Ctx, method: "PATCH" | "POST") {
  const seg = (await params).path;
  const bulk = method === "POST" && seg.length === 2 && seg[0] === "drafts" && seg[1] === "bulk";
  const one = method === "PATCH" && seg.length === 2 && seg[0] === "drafts" && ID.test(seg[1]) && seg[1] !== "bulk";
  if (!bulk && !one) return json("nenalezeno", 404);
  const raw = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const body = parseAction(raw);
  if (!body) return json("invalid action", 400);
  let out: object = body;
  if (bulk) {
    const ids = raw?.ids;
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || !ids.every((i) => typeof i === "string" && ID.test(i))) return json("invalid IDs", 400);
    out = { ...body, ids };
  }
  const target = bulk ? `bulk:${(out as { ids: string[] }).ids.length}` : seg[1];
  const r = await guarded(req, "social.write", target, {}, { method, ...body, ...(bulk ? { ids: (out as { ids: string[] }).ids } : {}) }, () => relay(`/api/drafts/${bulk ? "bulk" : seg[1]}`, { method, body: JSON.stringify(out) }));
  return r;
}

export const PATCH = (req: Request, ctx: Ctx) => write(req, ctx, "PATCH");
export const POST = (req: Request, ctx: Ctx) => write(req, ctx, "POST");
