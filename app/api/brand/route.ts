import { brandRoute, json, body } from "@/lib/brandapi";
import { createProject, listProjects } from "@/lib/brand";

export const dynamic = "force-dynamic";
export const GET = brandRoute(() => json(listProjects()));
export const POST = brandRoute(async (req) => { const b = await body(req); const p = createProject(b.name, b.kit); return json({ ...p, url: `/#brand&id=${p.id}` }, 201); });
