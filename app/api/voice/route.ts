import { NextResponse } from "next/server";
import { guarded } from "@/lib/guard";
import { MAX_AUDIO, tidy, transcribe } from "@/lib/voice";

export const dynamic = "force-dynamic";

// audio (webm/opus, max ~2 min) → transcript → draft task. Nothing is sent elsewhere or stored; audio is GC'd after the response.
export async function POST(req: Request) {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (!len || len > MAX_AUDIO) return NextResponse.json({ error: "recording is empty or too long" }, { status: 413 });
  const audio = await req.arrayBuffer();
  if (audio.byteLength > MAX_AUDIO) return NextResponse.json({ error: "recording is too long" }, { status: 413 });
  try {
    return await guarded(req, "voice.draft", `${audio.byteLength} B`, {}, {}, async () => {
      const text = await transcribe(audio);
      return text ? await tidy(text) : null;
    }).then((r) => (r instanceof NextResponse ? r : r ? NextResponse.json(r, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "didn't hear anything" }, { status: 422 })));
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message.slice(0, 80) : "error" }, { status: 502 });
  }
}
