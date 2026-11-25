import fs from "node:fs";
import path from "node:path";

// Brain = markdown files in the brain directory. Node id = path without .md, links [[id]].
export const BRAIN_DIR = path.resolve(process.env.CREW_BRAIN_DIR ?? path.join(process.cwd(), "brain"));
export type BrainNode = { id: string; title: string; body: string; links: string[] };

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md") ? [path.join(dir, e.name)] : []);
}

function parse(id: string, raw: string): BrainNode {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const body = m ? raw.slice(m[0].length) : raw;
  const title = m?.[1].match(/^title:\s*(.+)$/m)?.[1].trim() ?? body.match(/^#\s+(.+)$/m)?.[1] ?? id;
  const links = [...new Set([...body.matchAll(/\[\[([^\]|#]+)/g)].map((x) => x[1].trim()))];
  return { id, title, body, links };
}

export function allNodes(): BrainNode[] {
  if (!fs.existsSync(BRAIN_DIR)) return [];
  return walk(BRAIN_DIR).map((f) =>
    parse(path.relative(BRAIN_DIR, f).slice(0, -3).split(path.sep).join("/"), fs.readFileSync(f, "utf8")));
}

export function getNode(id: string): BrainNode | null {
  if (!/^[\w\-./]+$/.test(id) || id.split("/").includes("..")) return null;
  const f = path.join(BRAIN_DIR, `${id}.md`);
  return fs.existsSync(f) ? parse(id, fs.readFileSync(f, "utf8")) : null;
}

export function search(q: string, limit = 20) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return allNodes().flatMap((n) => {
    const t = n.title.toLowerCase(), b = n.body.toLowerCase();
    const score = terms.reduce((s, w) => s + (t.includes(w) ? 3 : 0) + (b.includes(w) ? 1 : 0), 0);
    if (!score) return [];
    const i = Math.max(0, b.indexOf(terms.find((w) => b.includes(w)) ?? ""));
    const snippet = n.body.slice(Math.max(0, i - 60), i + 140).replace(/\s+/g, " ").trim();
    return [{ id: n.id, title: n.title, snippet, score }];
  }).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function addDecision(title: string, text: string): BrainNode {
  const date = new Date().toISOString().slice(0, 10);
  const slug = title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "decision";
  let id = `decisions/${date}-${slug}`;
  for (let n = 2; fs.existsSync(path.join(BRAIN_DIR, `${id}.md`)); n++) id = `decisions/${date}-${slug}-${n}`;
  fs.mkdirSync(path.join(BRAIN_DIR, "decisions"), { recursive: true });
  fs.writeFileSync(path.join(BRAIN_DIR, `${id}.md`), `---\ntitle: ${title.replace(/\n/g, " ")}\n---\n${text}\n`);
  return getNode(id)!;
}

// Graph for visualization: group = root folder of the node.
export function graph(): { nodes: { id: string; title: string; group: string }[]; links: { source: string; target: string }[] } {
  const nodes = allNodes();
  const ids = new Set(nodes.map((n) => n.id));
  const links = nodes.flatMap((n) => n.links.filter((l) => ids.has(l)).map((l) => ({ source: n.id, target: l })));
  return {
    nodes: nodes.map((n) => ({ id: n.id, title: n.title, group: n.id.includes("/") ? n.id.split("/")[0] : "index" })),
    links,
  };
}
