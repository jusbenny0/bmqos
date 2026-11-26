import { brandRoute, json, body } from "@/lib/brandapi";
import { deleteProject, getProject, patchProject } from "@/lib/brand";

type C = { params: Promise<{ id: string }> };
export const dynamic = "force-dynamic";
export const GET = brandRoute<C>(async (_r, c) => { const p = getProject((await c.params).id); return p ? json(p) : json({ error: "not found" }, 404); });
export const PATCH = brandRoute<C>(async (req, c) => json(patchProject((await c.params).id, await body(req))));
export const DELETE = brandRoute<C>(async (_r, c) => { deleteProject((await c.params).id); return json({ ok: true }); });
