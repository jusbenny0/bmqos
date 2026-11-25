import { NextResponse } from "next/server";
import { docsWriteOn, listDocs, readDoc, reindexNow, saveDoc, searchDocs, versionBody } from "@/lib/docs";
import { guarded } from "@/lib/guard";
import { sameOrigin } from "@/lib/origin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams, id = q.get("id"), at = q.get("at"), s = q.get("q");
  if (id && at) return NextResponse.json({ body: versionBody(id, at) });
  if (id) { const d = readDoc(id); return d ? NextResponse.json(d) : NextResponse.json({ error: "not found" }, { status: 404 }); }
  if (s) return NextResponse.json({ hits: await searchDocs(s) });
  return NextResponse.json({ docs: await listDocs(q.get("src") ?? undefined), writeOn: docsWriteOn() });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "foreign origin" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { action?: string; id?: string; body?: string };
  try {
    if (b.action === "reindex") return NextResponse.json({ ok: true, ...(await reindexNow()) });
    if (b.action === "save" && b.id && typeof b.body === "string") {
      const { id, body } = b;
      const r = await guarded(req, "docs.edit", id, {}, { len: body.length }, async () => saveDoc(id, body));
      return r instanceof NextResponse ? r : NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  } catch (e) { console.error("docs", e); return NextResponse.json({ error: "action failed, try again" }, { status: 409 }); }
}
