import { NextResponse } from "next/server";
import { createRelease, releaseCommits } from "@/lib/cards";
import { sameOrigin } from "@/lib/origin";
import { sessionOf } from "@/lib/sessions";
import { getProject } from "@/lib/services";

export const dynamic = "force-dynamic";

// "Release to production": only opens the owner's Public card. Takes only {project} (slug); the server reads the project and commits, the client body is ignored for commits. The actual merge is done by Assistant.
export async function POST(req: Request) {
  if (!sameOrigin(req) || !sessionOf(req)) return NextResponse.json({ error: "no valid session" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { project?: unknown } | null;
  const id = b?.project;
  if (typeof id !== "string" || !id.trim() || id.length > 40) return NextResponse.json({ error: "invalid project" }, { status: 400 });
  const p = await getProject(id.trim());
  if (!p) return NextResponse.json({ error: "project doesn't exist" }, { status: 404 });
  const commits = releaseCommits(p);
  if (!commits) return NextResponse.json({ error: "test isn't ahead of production" }, { status: 400 });
  const card = createRelease(p.name, commits);
  return card === null ? NextResponse.json({ error: "a release card is already open" }, { status: 409 }) : NextResponse.json({ id: card }, { status: 201 });
}
