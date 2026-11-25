// server fetches and caches YouTube thumbnails; the client never calls a third party before clicking play
import { sessionOf } from "@/lib/sessions";

const cache = new Map<string, { at: number; buf: ArrayBuffer }>();

export async function GET(req: Request) {
  if (!sessionOf(req)) return new Response(null, { status: 401 });
  const v = new URL(req.url).searchParams.get("v") ?? "";
  if (!/^[\w-]{11}$/.test(v)) return new Response(null, { status: 400 });
  let hit = cache.get(v);
  if (!hit || Date.now() - hit.at > 86_400_000) {
    const r = await fetch(`https://i.ytimg.com/vi/${v}/hqdefault.jpg`, { signal: AbortSignal.timeout(8000) }).catch(() => null);
    if (!r?.ok) return new Response(null, { status: 404 });
    hit = { at: Date.now(), buf: await r.arrayBuffer() };
    cache.set(v, hit);
  }
  return new Response(hit.buf, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
