import { esc } from "@/lib/stage";
import type { Svc } from "@/lib/services";
import type { Finding } from "@/lib/watch";

/* Ops → Services, read-only. Data from GET /api/services; the view is a synchronous string, so the cache lives here
   and after loading only the #svc container is replaced (no touching os.tsx). */
export interface Live { dokploy: boolean; github: boolean; netmap: boolean; agents: Record<string, boolean> }
export interface Data { services: Svc[]; findings: Finding[]; live: Live }

const TTL = 30_000;
let data: Data | null = null, at = 0, busy = false, failed = false, okAt = 0;

const when = (iso: string | null): string => {
  const t = iso ? Date.parse(iso) : NaN;
  if (Number.isNaN(t)) return "–";
  const m = Math.max(0, Math.round((Date.now() - t) / 60_000));
  return m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};

const missing = (l: Live): string[][] => [
  ...(l.dokploy ? [] : [["DOKPLOY_URL, DOKPLOY_TOKEN", "version and deploy"]]),
  ...(l.github ? [] : [["GITHUB_TOKEN", "latest commit"]]),
  ...(l.netmap ? [] : [["OS_NETMAP_STATIC", "machine and address map"]]),
  ...(Object.values(l.agents).length && Object.values(l.agents).every(Boolean) ? [] : [["OS_AGENTS", "machine health"]]),
];
const missList = (m: string[][]): string => `<ul class="mono svm">${m.map(([k, d]) => `<li><b>${esc(k)}</b> – ${esc(d)}</li>`).join("")}</ul>`;

const rank = (s: Svc): number => (!s.up ? 0 : s.public ? 1 : 2);

const row = (s: Svc, i: number, gh: boolean): string => {
  const tag = s.up && s.certDays !== null && s.certDays < 14 ? `<span class="tag t-amber">CERTIFICATE ${s.certDays} d</span>` : "";
  const v = s.version ? `${esc(s.version.branch)}${s.version.commit ? ` · ${esc(s.version.commit.slice(0, 7))}` : gh ? " · commit not found" : ""}` : "–";
  const un = s.version && !s.version.commit && !gh ? ` <span class="tag">unverified</span>` : "";
  const dep = s.deploy ? `${esc(s.deploy.status)} · ${when(s.deploy.at)}` : "–";
  return `<div class="mrow svr" style="--i:${i}"><div><b>${esc(s.name)}</b><span class="mono">${esc(s.domain ?? s.addr ?? "") || "no address"}</span>${tag}</div><strong class="${s.up ? "lime" : "red"}">${s.up ? "OK" : "DOWN"}</strong>
<dl><div><dt class="mono">Version</dt><dd class="svv" title="${v}">${v}${un}</dd></div><div><dt class="mono">Health</dt><dd>${s.up ? (s.ms !== null ? `${s.ms} ms` : "running") : "not responding"}</dd></div><div><dt class="mono">Deploy</dt><dd>${dep}</dd></div><div><dt class="mono">Machine</dt><dd>${esc(s.machine)}</dd></div></dl></div>`;
};

const STYLE = `<style>.svr{align-items:start;position:relative;animation:svin .16s ease-out both;animation-delay:calc(var(--i,0)*25ms);transition:background .12s}.svr:hover{background:var(--line)}.svr:hover::before{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:var(--lime)}@keyframes svin{from{opacity:0;transform:translateY(6px)}}.svr strong{font-size:22px}.svr dl{grid-column:1/3;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px 16px}.svr dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.svr dt{color:var(--mute)}.svr dd.svv{white-space:normal;overflow-wrap:anywhere}.svr>div:first-child .mono{overflow-wrap:anywhere}
.svf{display:flex;gap:6px 14px;flex-wrap:wrap;padding:12px 28px;border-bottom:1px solid var(--line)}.svf .tag{white-space:nowrap}.svh{padding:14px 28px 6px}.svr+.svh{margin-top:8px}.svs,.sve,.svm{padding:20px 28px}.svm{list-style:none;margin:0}.svm li{margin-top:6px;color:var(--mute)}.svm b{color:var(--ink)}
.sve{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin:12px 0;background:rgba(209,54,31,.14);border-left:3px solid var(--red)}.sve b{color:var(--red)}.sve span{flex:1;min-width:0}.sve button{font:inherit;color:var(--ink);background:none;border:1px solid var(--line2);border-radius:8px;padding:6px 14px;cursor:pointer}.sve button:hover{background:var(--line)}
.svs i{display:block;height:72px;margin-bottom:8px;border-radius:8px;background:var(--line);animation:svp 1.2s ease-in-out infinite}@keyframes svp{50%{opacity:.5}}
.svN{display:flex;gap:12px;align-items:flex-start;margin:16px 28px;padding:14px 18px;border:1px solid rgba(201,138,26,.5);border-radius:12px;background:rgba(201,138,26,.07)}.svN .dot{margin-top:7px}.svN b,.svN span:not(.dot){display:block}.svN span:not(.dot){color:var(--mute)}.svE details{margin-top:12px;color:var(--mute)}.svE{border:0;max-width:none;margin:0;padding:20px 28px;border-radius:0}.svE .svm{padding:12px 0 0}
@media(max-width:700px){.svr dl{grid-template-columns:1fr 1fr}.svf,.svh,.svs,.sve,.svE{padding-left:16px;padding-right:16px}}
@media(prefers-reduced-motion:reduce){.svr,.svs i{animation:none}.svr{transition:none}}</style>`;

export const body = (d: Data | null): string => {
  const err = failed ? `<div class="sve"><b>● Error</b><span>${d ? `The registry could not refresh. Data from ${new Date(okAt).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}.` : "Could not load the service registry."}</span><button type="button" data-svretry>Retry</button></div>` : "";
  if (!d) return err || `<div class="svs">${"<i></i>".repeat(3)}</div>`;
  const miss = missing(d.live);
  const empty = !d.services.length
    ? `<div class="empty svE"><h2>The registry is still empty</h2><p>No service source is reporting in.${miss.length ? " Missing configuration:" : ""}</p>${miss.length ? `<details><summary>Details</summary>${missList(miss)}</details>` : ""}</div>` : "";
  const svcs = [...d.services].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const down = svcs.filter((s) => !s.up).length, pub = svcs.filter((s) => s.up && s.public).length;
  const kpi = `<div class="skpi"><div><b class="${down ? "red" : "lime"}">${down}</b><span class="mono">Down</span></div><div><b>${pub}</b><span class="mono">Public</span></div><div><b>${svcs.length - down - pub}</b><span class="mono">Internal</span></div></div>`;
  const fin = d.findings.length
    ? `<div class="svf">${d.findings.map((f) => `<a class="fire${f.severity === "hori" ? "" : " warn"}" ${f.href ? `href="${esc(f.href)}"` : ""} style="flex:1 1 100%"><b>● ${f.severity === "hori" ? "Needs attention" : "New"}${f.project ? ` · ${esc(f.project)}` : ""}</b><span>${esc(f.text)}</span></a>`).join("")}</div>`
    : svcs.length && d.live.github ? `<div class="fire ok"><b>● Watcher reports nothing</b><span>Nothing on fire, nothing new.</span></div>` : "";
  const nogh = false && svcs.length && !d?.live.github ? `<div class="svN" id="svc-notoken"><span class="dot a"></span><div><b>GitHub isn't connected.</b><span>Missing the GitHub key – changes and branches aren't verified.</span></div></div>` : "";
  const rest = miss.filter((m) => m[0] !== "GITHUB_TOKEN");
  const note = rest.length && svcs.length ? `<p class="hint snote">Some sources aren't connected (${rest.map((m) => esc(m[1])).join("; ")}), so this data may be missing.</p>` : "";
  const groups = ([[0, "Down"], [1, "Public"], [2, "Internal"]] as const).map(([r, t]) => {
    const g = svcs.filter((s) => rank(s) === r);
    return g.length ? `<div class="lbl svh">${t} · ${g.length}</div>${g.map((s, i) => row(s, Math.min(i, 8), d.live.github)).join("")}` : "";
  }).join("");
  return `${err}${nogh}${kpi}${fin}${empty}${groups}${note}`;
};

const load = (force = false): void => {
  if (typeof window === "undefined" || busy || (!force && Date.now() - at < TTL)) return;
  busy = true;
  void fetch("/api/services", { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<Data>) : null))
    .then((j) => { failed = !j; if (j) { data = j; okAt = Date.now(); } })
    .catch(() => { failed = true; })
    .finally(() => {
      busy = false; at = Date.now();
      const el = document.getElementById("svc");
      if (el) el.innerHTML = body(data);
    });
};

if (typeof document !== "undefined")
  document.addEventListener("click", (e) => {
    if (!(e.target instanceof Element) || !e.target.closest("[data-svretry]")) return;
    failed = false; at = 0;
    const el = document.getElementById("svc");
    if (el) el.innerHTML = body(data);
    load(true);
  });

export const servicesHTML = (): string => {
  load();
  return `<div class="screen page stor">${STYLE}<div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Ops · service registry</div><h1>What's running</h1></div></div><div id="svc">${body(data)}</div></div>`;
};
