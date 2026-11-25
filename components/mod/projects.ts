import { esc } from "@/lib/stage";
import type { ProjectView } from "@/lib/services";
import type { Venture } from "@/lib/types";

export interface ProjData { list: ProjectView[]; one: ProjectView | null; err: boolean }
type Sem = "l" | "a" | "r" | "g";
const SEM: Record<Sem, string> = { l: "Running", a: "Needs you", r: "Down", g: "Not deployed" };
const DOT: Record<Sem, string> = { l: "", a: "a", r: "r", g: "g" };
const ENV_N = { prod: "Production", test: "Test", preview: "Preview" } as const;
const KINDS = ["prod", "test", "preview"] as const;

const dot = (c: string): string => `<span class="dot ${c}"></span>`;
const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "numeric" }) : "unknown");
const venture = (v: Venture[], p: ProjectView): Venture | undefined => v.find((x) => x.n === p.name);
const envs = (p: ProjectView) => Object.values(p.envs).filter((e): e is NonNullable<typeof e> => !!e);

/* status light = environment health (Dokploy) + number of items needing the owner; no environment = not deployed */
export const semOf = (p: ProjectView, you: number): Sem => {
  const e = envs(p);
  return e.some((x) => x.health === "down") ? "r" : you ? "a" : e.length ? "l" : "g";
};
const chip = (s: Sem): string => `<span class="pj-sem ${s}">${dot(DOT[s])}${SEM[s]}</span>`;

const card = (p: ProjectView, v: Venture | undefined, i: number): string => {
  const you = v?.you ?? 0, s = semOf(p, you);
  return `<a class="pj-card${you ? " big" : ""}" href="#project&id=${esc(p.id)}" style="--i:${Math.min(i, 5)}"><div class="ph">${esc(p.name)}${chip(s)}</div><p>${esc(v?.now || "No status note yet.")}</p>${you ? `<div class="me">${you} ${you === 1 ? "item needs you" : "items need you"}</div>` : ""}</a>`;
};
const skel = (n: number, big: boolean): string => Array.from({ length: n }, () => `<div class="pj-card${big ? " big" : ""}"><div class="pj-sk" style="height:22px;width:50%"></div><div class="pj-sk" style="height:16px;width:85%;margin-top:14px"></div></div>`).join("");

export const projectsHTML = (d: ProjData | null, ventures: Venture[]): string => {
  const head = (s: string): string => `<h1>Projects<span>${s}</span></h1>`;
  if (!d) return `<div class="screen page"><div class="col">${head("Loading project status…")}<div class="pj-grid big">${skel(2, true)}</div><div class="pj-grid">${skel(6, false)}</div></div></div>`;
  if (d.err) return `<div class="screen page"><div class="col">${head("Couldn't load project status.")}<div class="pj-empty">Try again shortly.</div></div></div>`;
  const need = d.list.filter((p) => venture(ventures, p)?.you), rest = d.list.filter((p) => !venture(ventures, p)?.you);
  const notoken = d.list.length > 0 && !d.list.some((p) => p.live);
  const lead = need.length ? `${need.length} ${need.length === 1 ? "project needs" : "projects need"} you${rest.length ? ", others are running" : ""}.` : "Nothing needs you.";
  const notice = false && notoken ? `<div class="pj-notice"><span class="dot a"></span><div class="tx"><b>GitHub isn't connected.</b><span>Missing GitHub key – changes and branches aren't verified.</span></div></div>` : "";
  const sec = (t: string, l: ProjectView[], big: boolean, o: number): string => l.length ? `<div class="pj-sec"><h3>${t}<span class="mono">${l.length}</span></h3><div class="pj-grid${big ? " big" : ""}">${l.map((p, i) => card(p, venture(ventures, p), i + o)).join("")}</div></div>` : "";
  return `<div class="screen page"><div class="col">${head(lead)}${notice}${sec("Needs you", need, true, 0)}${sec("Others", rest, false, need.length)}</div></div>`;
};

/* ---------- project page ---------- */
type E = NonNullable<ProjectView["envs"][keyof ProjectView["envs"]]>;
const envCard = (p: ProjectView, k: (typeof KINDS)[number], e: E | undefined, i: number): string => {
  const st = `style="--i:${i}"`;
  if (!e) return `<div class="pj-env none" ${st}><div class="eh">${dot("g")}${ENV_N[k]}</div><div class="vv">Not deployed yet</div><div class="vs">${k === "prod" ? "Production address isn't set." : "Address isn't set."}</div></div>`;
  const bad = e.health === "down", unk = e.health === "unknown";
  const hl = bad ? ["e", "r", "Not responding"] : unk ? ["n", "g", "Status unknown"] : ["", "", `Responding${e.ms != null ? ` · ${e.ms} ms` : ""}`];
  const note = k === "test" && "ahead" in e && e.ahead != null ? (e.ahead ? `Ahead by <b>${e.ahead} ${e.ahead === 1 ? "change" : "changes"}</b> over Production.` : "Same version as Production.")
    : k === "preview" ? "LAN only." : k === "prod" ? "Live site customers see." : "";
  const open = e.url && /^https?:\/\//i.test(e.url) ? `<a class="btn sm" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">Open</a>` : "";
  return `<div class="pj-env${bad ? " bad" : ""}" ${st}><div class="eh">${dot(bad ? "r" : unk ? "g" : "")}${ENV_N[k]}</div><div class="ad">${esc(e.url.replace(/^https?:\/\//, ""))}</div>
 <dl class="fc"><dt>Branch</dt><dd class="mo${e.branch ? "" : " un"}">${esc(e.branch ?? "unknown")}</dd><dt>Commit</dt><dd class="mo${e.commit ? "" : " un"}">${e.commit ? esc(e.commit) : `<span class="tag">unverified</span>`}</dd><dt>Deployed</dt><dd>${esc(when(e.at))}</dd></dl>
 <div class="hl ${hl[0]}">${dot(hl[1])}${hl[2]}</div>${note ? `<div class="vs">${note}</div>` : ""}<div class="acts">${open}</div></div>`;
};

/* Release to production only works when test responds, GitHub knows the change count, and test is ahead (E1: ahead === null = unverified) */
export const canRelease = (p: ProjectView): boolean => p.envs.test?.health === "ok" && p.ahead != null && p.ahead > 0 && !!p.envs.test.commits?.length;
const relBtn = (p: ProjectView, primary: boolean): string =>
  `<button class="btn sm${primary ? " p" : ""}${canRelease(p) ? "" : " off"}" ${canRelease(p) ? `data-release="${esc(p.id)}"` : 'disabled aria-disabled="true"'}>Release to production</button>`;

const strip = (p: ProjectView): string => {
  const t = p.envs.test, a = p.ahead;
  if (!t) return `<div class="pj-strip idle"><div class="tx">Nothing to release.<span>The project doesn't have a test environment yet.</span></div></div>`;
  if (!p.live || a == null) return `<div class="pj-strip warn"><div class="tx">I don't know the change count yet.<span>Missing GitHub key (read-only) or the environments couldn't be compared. Without it I can't show what a release would change, so releasing is disabled.</span></div><button class="btn" data-hermes>Ask Assistant</button></div>`;
  if (t.health !== "ok") return `<div class="pj-strip warn"><div class="tx">Test isn't responding, release is disabled.<span>Releasing is possible once test responds again.</span></div><button class="btn" data-hermes>Ask Assistant</button></div>`;
  if (!a) return `<div class="pj-strip idle"><div class="tx">The live site is on the same version as test.<span>Nothing to release.</span></div></div>`;
  return `<div class="pj-strip"><div class="tx">Test is ${a} ${a === 1 ? "change" : "changes"} ahead of the live site.<span>Once you confirm with 2FA, Assistant will merge, deploy and verify. BMQOS never merges anything on its own.</span></div>${relBtn(p, true)}</div>`;
};

const empty = (t: string, amb = false): string => `<div class="pj-empty${amb ? " amb" : ""}">${t}</div>`;
const sh = (t: string, n?: number): string => `<h3>${t}${n == null ? "" : `<span class="mono">${n}</span>`}</h3>`;
const ago = (iso: string): string => { const h = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 36e5)); return h < 1 ? "just now" : h < 24 ? `${h} h` : `${Math.round(h / 24)} d`; };

export const projectHTML = (d: ProjData | null, ventures: Venture[], id: string): string => {
  const crumb = (n: string): string => `<div class="pj-crumb"><a href="#projects">Projects</a><i aria-hidden="true">›</i>${esc(n)}</div>`;
  const p = d?.one;
  if (!d) return `<div class="screen page"><div class="col wide">${crumb("…")}<h1>Loading<span>project environments…</span></h1><div class="pj-sk" style="height:84px;margin-top:22px;border-radius:14px"></div></div></div>`;
  if (!p) return `<div class="screen page"><div class="col wide">${crumb("Not found")}<h1>Project not found<span>${d.err ? "Couldn't load the data." : `Project "${esc(id)}" doesn't exist.`}</span></h1><p class="pj-empty"><a href="#projects">Back to projects</a></p></div></div>`;
  const v = venture(ventures, p), me = p.tasks.filter((t) => t.waitsHuman), run = p.tasks.filter((t) => !t.waitsHuman && t.running);
  const li = (t: typeof me[number]): string => `<a class="pj-li" href="#waiting"><div class="tx"><div class="tt">${esc(t.title)}</div><div class="ss">${esc(t.identifier)} · ${esc(ago(t.at))}</div></div><i class="go" aria-hidden="true">›</i></a>`;
  const runs = (t: typeof run[number]): string => `<div class="pj-li"><div class="tx"><div class="tt">${esc(t.title)}</div><div class="ss">${esc(t.agent ?? "agent")} · ${esc(t.identifier)}</div></div></div>`;
  const pr = (r: NonNullable<ProjectView["prs"]>[number]): string => `<a class="pj-li" href="${/^https?:\/\//i.test(r.url) ? esc(r.url) : "#"}" target="_blank" rel="noopener noreferrer"><div class="tx"><div class="tt">${esc(r.title)}</div><div class="ss">PR #${r.n} · ${esc(r.head)} → ${esc(r.base)}${r.draft ? " · draft" : ""}</div></div><i class="go" aria-hidden="true">›</i></a>`;
  const prs = !p.live ? empty("Open changes: unverified.", true) : p.prs?.length ? p.prs.map(pr).join("") : empty("No open changes.");
  return `<div class="screen page"><div class="col wide">${crumb(p.name)}<h1>${esc(p.name)}<span>${esc(v?.now || "No status note yet.")}</span></h1>${strip(p)}
 <div class="pj-sec"><h3>Environments</h3><div class="pj-envs">${KINDS.map((k, i) => envCard(p, k, p.envs[k], i)).join("")}</div></div>
 <div class="pj-two"><div><div class="pj-sec">${sh("Needs you", me.length)}<div class="pj-list">${me.length ? me.map(li).join("") : empty("Nothing is waiting.")}</div></div>
 <div class="pj-sec">${sh("Running now", run.length)}<div class="pj-list">${run.length ? run.map(runs).join("") : empty("Nothing is running.")}</div></div></div>
 <div><div class="pj-sec">${sh("Open changes", p.prs?.length ?? 0)}<div class="pj-list">${prs}</div></div></div></div></div></div>`;
};
