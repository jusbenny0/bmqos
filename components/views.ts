import { tok } from "@/lib/format";
import { chart } from "./chart";
import { esc, stageSvg } from "@/lib/stage";
import type { Card } from "@/lib/inbox";
import type { Agent, FeedRow, Snapshot, Wait } from "@/lib/types";
import { cardHTML } from "./inbox";
import { inline as mdi } from "@/lib/md";
import { fires } from "@/lib/fires";
import { home } from "./home";
import { ico, rail, secOf, soon, subtabs, tabbar, where } from "./shell";
import { storageHTML, burning, type StorData, type Tops } from "./mod/storage";
import { servicesHTML } from "./mod/services";
import { settingsHTML, type PushState } from "./settings";
import { docsHTML, type DocsData } from "./mod/docs";
import { projectsHTML, projectHTML, type ProjData } from "./mod/projects";
import { itemsHTML, TAB_OF, type ItemsData, type TaskUi } from "./mod/items";
import { crewTeamHTML, crewMemberSheet, crewTasksHTML, crewTaskSheet, crewUsageHTML, crewBrainHTML, crewNodeSheet, type CrewTeamUi, type CrewTasksUi, type CrewUsageUi, type CrewTxUi, type CrewSendSt } from "./mod/crew";
import type { TaskDetail as CrewTaskDetail, BrainNode, BrainHit } from "@/lib/crew";

export interface Extra { card: Card | null; playing: string; editing: string; live: boolean; soc: number; post: boolean; stor: StorData | null; tops: Tops; docs: DocsData | null; proj: ProjData | null; ix: ItemsData | null; push: PushState | null; tk: TaskUi;
  crewTeam: CrewTeamUi | null; crewTx: CrewTxUi; crewSend: Record<string, CrewSendSt>; crewTasks: CrewTasksUi | null; crewTaskDetail: CrewTaskDetail | null; crewTaskErr: boolean; crewUsage: CrewUsageUi; crewBrainHits: BrainHit[] | null; crewNode: BrainNode | null; crewNodeErr: boolean;
  herm: boolean }

export interface Route { s: string; q: Record<string, string> }
export const ST: Record<string, string> = { running: "running", idle: "idle", paused: "paused", error: "error" };
const STc: Record<string, string> = { running: "lime", error: "red" };
const tagSt = (s: string): [string, string] =>
  s === "in_review" ? ["in review", "a"] : s === "blocked" ? ["needs you", "a"] : ["running", "l"];
const HINT = "Nothing is waiting on you. Agents are working on their own.";

export const parseRoute = (hash: string): Route => {
  const h = hash.replace(/^#/, "").split("&");
  return { s: h[0] || "overview", q: Object.fromEntries(h.slice(1).map((x) => x.split("=").map(decodeURIComponent) as [string, string])) };
};

const lookup = (d: Snapshot) => ({
  ag: (id: string): Agent | undefined => d.agents.find((a) => a.id === id),
  pr: (id: string): string => d.projects.find((p) => p.id === id)?.n ?? "Other",
});

const wl = (d: Snapshot, sel: string): string => {
  const { ag } = lookup(d);
  if (!d.wait.length) return `<div class="hint" style="padding:18px 0">${HINT}</div>`;
  return `<ul class="wl">${d.wait.map((w) => {
    const [, tc] = tagSt(w.st);
    return `<li><button class="${w.id === sel ? "on" : ""}" data-issue="${esc(w.id)}"><span class="t">${esc(w.t)}</span><span class="age">${esc(w.age)}</span><span class="m"><span>${esc(w.id)}</span><span class="tag ${tc}">${esc(w.kind)}</span><span>${esc(ag(w.ag)?.n ?? "")}</span></span></button></li>`;
  }).join("")}</ul>`;
};

const feedLi = (f: FeedRow, i: number): string =>
  `<li class="${i === 0 ? "new" : ""}" data-agent="${esc(f.aid)}"><span class="tm">${f.t}</span><span class="who">${esc(f.a)} <span>${esc(f.i)}</span></span><span class="res ${f.s === "ok" ? "ok" : f.s === "er" ? "er" : ""}">${f.s === "run" ? "● " : ""}${f.r} · ${f.d} · ${f.k}</span></li>`;

const overview = (d: Snapshot, compact: boolean, hot = ""): string => {
  const c = { running: 0, idle: 0, paused: 0, error: 0 };
  d.agents.forEach((a) => c[a.st]++);
  const top = [...d.projects].sort((a, b) => b.open + b.you - (a.open + a.you)).slice(0, 4);
  const mx = Math.max(1, ...top.map((p) => p.open + p.you));
  const hot2 = fires(d);
  const fire = hot2.length
    ? `<a class="fire" href="#${esc(hot2[0].go)}"><b>● Needs attention · ${hot2.length}</b><span>${esc(hot2[0].t)} · ${esc(hot2[0].why)}</span><span class="go">${esc(hot2[0].b)} →</span></a>`
    : `<div class="fire ok"><b>● All clear</b><span>No server or agent is in error.</span></div>`;
  return `<div class="screen ovw">${hot}${fire}<div class="ov">
 <aside class="col l"><div class="sec"><div class="lbl"><span class="amber">●</span> Needs you</div><div class="hint" style="margin-top:6px">Just your decision or a merge, nothing else needed here.</div>${wl(d, "")}</div>
 <div class="sec grow"><div class="lbl">Projects · open tasks</div>${top.map((p) => `<div class="agrow" style="grid-template-columns:1fr 70px 24px"><span style="color:var(--ink)">${esc(p.n)}</span><span class="mini"><i style="width:${((p.open + p.you) / mx) * 100}%"></i></span><span style="text-align:right;color:var(--mute)">${p.open + p.you}</span></div>`).join("")}</div></aside>
 <div class="stage-w col"><div class="stage" id="stage"><i class="br-c a"></i><i class="br-c b"></i><i class="br-c c"></i><i class="br-c d"></i>
  <div class="hud tl">Overview · ${esc(d.date)} ${esc(d.clock)}</div>
  <div class="hud bl"><span class="lime">●</span> ${c.running} running<div class="row" style="margin:0">○ ${c.idle} idle</div><div class="row" style="margin:0;color:var(--dim)">◌ ${c.paused} paused</div><div class="row red" style="margin:0">● ${c.error} error</div></div>
  <div class="hud tr">Circle = agents in work order<br>Cloud = tasks by project</div><div class="hud br"><span class="amber">●</span> needs you<br><span class="lime">●</span> open<br>● done</div>
  <div class="tip"></div>${stageSvg(d.projects, d.agents, d.wait.length, compact)}</div></div>
 <aside class="col r"><div class="sec"><div class="lbl">Agent monitor</div><div class="talk" style="margin-top:12px"><span class="lbl" style="font-size:15px;color:var(--dim)">Handing off right now</span>${d.talk.length ? d.talk.map((t) => `<div><b>${esc(t[0])}</b>→<em>${esc(t[1])}</em><span>${esc(t[2])}</span></div>`).join("") : '<div style="color:var(--dim)">Nothing yet.</div>'}</div></div>
 <div class="sec"><div class="lbl">Tokens today</div><div class="tok"><span class="big" style="font-size:54px">${tokBig(d.tokToday)}</span><span class="mono" style="text-align:right">${esc(d.usd)} per API pricing<br><span style="color:var(--dim)">flat rate · actually $0</span></span></div><div class="bar"><i style="width:${Math.min(d.tokAvgPct, 100)}%"></i></div><div class="mono" style="margin-top:6px;color:var(--dim)">${d.tokAvgPct ? `${d.tokAvgPct} % of the previous days' average` : "no comparison yet"}</div></div>
 <div class="sec grow"><div class="lbl">Latest runs <span class="sp"></span><span class="lime">live</span></div><ul class="feed">${d.feed.map(feedLi).join("")}</ul></div></aside></div></div>`;
};
const tokBig = (t: string): string => {
  const [n, u] = t.split(" ");
  return u ? `${esc(n)}<small style="font-size:20px;letter-spacing:0;margin-left:4px;color:var(--mute);font-stretch:100%;font-weight:500">${esc(u)}</small>` : esc(n);
};

const STAV: [string, string][] = [["todo", "To do"], ["in_progress", "In progress"], ["in_review", "In review"], ["blocked", "Blocked"], ["done", "Done"], ["cancelled", "Cancelled"]];
const issueControls = (d: Snapshot, w: Wait): string => `<div class="ctl"><div class="lbl">Controls</div>
 <div class="ctlrow"><label><span class="lbl">Status</span><select data-set="status" data-id="${esc(w.id)}" data-prev="${esc(w.st)}">${STAV.map(([v, l]) => `<option value="${v}"${v === w.st ? " selected" : ""}>${l}</option>`).join("")}</select></label>
 <label><span class="lbl">Reassign to</span><select data-set="assign" data-id="${esc(w.id)}" data-prev="${esc(w.ag)}">${w.ag ? "" : '<option value="" selected disabled>— nobody —</option>'}${d.agents.map((a) => `<option value="${esc(a.id)}"${a.id === w.ag ? " selected" : ""}>${esc(a.n)}</option>`).join("")}</select></label></div>
 <label><span class="lbl">Reply to the agent</span><textarea data-reply="${esc(w.id)}" rows="3" placeholder="Write a reply – it's sent as a comment on the task" maxlength="3900"></textarea></label>
 <button class="cta" data-send="${esc(w.id)}">Send reply</button></div>`;

const issueHTML = (d: Snapshot, w: Wait, inline: boolean): string => {
  const { ag, pr } = lookup(d);
  const [tx, tc] = tagSt(w.st);
  return `<div class="lbl"><span>${esc(w.id)}</span><span class="tag ${tc}">${tx}</span><span class="tag">${esc(w.kind)}</span></div>
 <h2>${esc(w.t)}</h2>
 <div class="why"><div class="lbl" style="margin-bottom:6px">What it needs from you</div><div class="hint">${mdi(w.why)}</div></div>
 <div class="kv"><div><span class="lbl">Project</span><b>${esc(pr(w.pr))}</b></div><div><span class="lbl">Handled by</span><b>${esc(ag(w.ag)?.n ?? "—")}</b></div><div><span class="lbl">Waiting</span><b class="amber">${esc(w.age)}</b></div><div><span class="lbl">Runs / tokens</span><b>${w.runs} · ${esc(w.tok)}</b></div></div>
 <div><div class="lbl" style="margin-bottom:6px">Latest activity</div><ul class="tl">${w.cm.map((c) => `<li><span class="mono">${c[0]}</span><p><span>${esc(c[1])}</span> ${mdi(c[2])}</p></li>`).join("") || '<li><p>No comments yet.</p></li>'}</ul></div>
${d.control ? issueControls(d, w) : ""}
`;
};

const waiting = (d: Snapshot, sel: string | undefined, compact: boolean, ex: Extra): string => {
  const w = d.wait.find((x) => x.id === sel) ?? d.wait[0];
  const skel = `<div class="card skel" aria-busy="true"><div class="lbl">${esc(w?.id ?? "")}</div><h2>${esc(w?.t ?? "")}</h2><div class="sk"></div><div class="sk"></div><div class="sk s"></div></div>`;
  return `<div class="screen page wp"><div class="listc"><div class="pagehead" style="flex-direction:column;align-items:flex-start;gap:8px"><h1>Needs you</h1><div class="hint">${d.wait.length ? `${d.wait.length} items. Oldest has been waiting ${esc(d.waitOldest)}.` : HINT}</div></div><div style="overflow:hidden">${wl(d, compact && !sel ? "" : w?.id ?? "")}</div></div><div class="detail" id="det">${ex.card && ex.card.issue === (sel ?? w?.id) ? cardHTML(ex.card, ex.playing, ex.editing) : w ? skel : `<div class="hint">${HINT}</div>`}</div></div>`;
};

const runs = (d: Snapshot, compact: boolean): string => {
  const W = compact ? 360 : 728;
  const mx = Math.max(1, ...d.days.map((x) => x.v)), n = d.days.length, slot = W / n, bw = Math.min(38, slot - 8);
  const bars = d.days.map((x, i) => {
    const h = (x.v / mx) * 100, t = i === n - 1;
    return `<g><rect x="${(i * slot + (slot - bw) / 2).toFixed(1)}" y="${130 - h}" width="${bw.toFixed(1)}" height="${h}" fill="${t ? "#e0531f" : "#282828"}" opacity="${t ? 1 : 0.62}"/><text x="${(i * slot + slot / 2).toFixed(1)}" y="${(124 - h).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono" font-size="15" fill="#282828">${esc(tok(x.v))}</text><text x="${(i * slot + slot / 2).toFixed(1)}" y="146" text-anchor="middle" font-family="JetBrains Mono" font-size="15" fill="#6b665d">${esc(x.lbl)}</text></g>`;
  }).join("");
  const rows = d.feed.map((f) => `<tr data-agent="${esc(f.aid)}"><td class="w">${f.t}</td><td class="w">${esc(f.a)}<span class="sub">${esc(f.i)}</span></td><td>${esc(f.i)}</td><td class="${f.s === "er" ? "red" : "lime"}">${f.s === "run" ? "● " : ""}${f.r}</td><td>${f.d}</td><td>${f.k}</td></tr>`).join("");
  const top = d.agents.filter((a) => a.tokN > 0).sort((a, b) => b.tokN - a.tokN).slice(0, 9);
  const tm = Math.max(1, ...top.map((a) => a.tokN));
  return `<div class="screen runs"><div style="min-height:0;overflow:hidden;display:flex;flex-direction:column"><div class="pagehead" style="padding-bottom:16px"><div><div class="lbl" style="margin-bottom:10px">Runs and costs · available days</div><h1>What it burned through</h1></div></div>
 <div class="kpis"><div class="kpi"><div class="lbl">Runs today</div><div class="big">${d.kpi.runs}</div><div class="hint">${d.kpi.running} of those running right now</div></div><div class="kpi"><div class="lbl">Success rate</div><div class="big">${d.kpi.okPct}<small>%</small></div><div class="hint">${d.kpi.failed} runs ended in error</div></div><div class="kpi"><div class="lbl">Tokens today</div><div class="big">${tokBig(d.tokToday)}</div><div class="hint">${esc(d.usd)} per API pricing</div></div><div class="kpi"><div class="lbl">Avg run length</div><div class="big">${d.kpi.avg}</div><div class="hint">longest ${d.kpi.longest}</div></div></div>
 <div class="chart"><div class="lbl">Tokens by day <span class="sp"></span>today through ${esc(d.clock)}</div><svg viewBox="0 0 ${W} 150">${bars}</svg>${d.days.length < 7 ? `<div class="hint" style="margin-top:6px">The Paperclip API only returns the last ${d.days.length} days of runs – the app can't see older history. Columns use the same scale.</div>` : ""}</div>
 ${chart({ id: "tok", title: "Tokens · sampled every 5 min", unit: "tok", kind: "bar", series: [{ key: "agents:tokens", label: "Tokens" }], height: 110 })}
 <div class="tblw" style="overflow:hidden;min-height:0"><table class="tbl"><thead><tr><th>Time</th><th>Agent</th><th>Task</th><th>Status</th><th>Length</th><th>Tokens</th></tr></thead><tbody>${rows}</tbody></table></div></div>
 <aside class="col r"><div class="sec"><div class="lbl">By agent today</div></div><div style="margin-top:-18px">${top.map((a) => `<div class="agrow" data-agent="${esc(a.id)}" style="grid-template-columns:1fr 70px 52px"><span style="color:var(--ink)">${esc(a.n)}</span><span class="mini"><i style="width:${(a.tokN / tm) * 100}%"></i></span><span style="text-align:right;color:var(--mute)">${esc(a.tok)}</span></div>`).join("") || '<div class="hint" style="padding:18px 28px">Nothing has run today yet.</div>'}</div>
 <div class="sec" style="margin-top:14px;border-top:1px solid var(--line)"><div class="lbl">Latest comments</div><div class="talk" style="line-height:1.5">${d.comments.map((c) => `<div><b>${c.t}</b><em>${esc(c.a)}</em><span>${esc(c.text)}</span></div>`).join("") || '<div style="color:var(--dim)">Nothing yet.</div>'}</div></div><div class="sec" style="border-top:0"><div class="lbl"><span class="red">●</span> Errors today</div><div class="talk">${d.errors.map((e) => `<div><b style="color:var(--red)">${e.t}</b><em>${esc(e.a)}</em><span>${esc(e.i)}</span></div><div style="color:var(--dim);margin-bottom:8px">${esc(e.msg)}</div>`).join("") || '<div style="color:var(--dim)">No errors today.</div>'}</div></div></aside></div>`;
};

const agentSheet = (d: Snapshot, id: string): string => {
  const a = d.agents.find((x) => x.id === id);
  if (!a) return "";
  const mx = Math.max(1, ...a.spark), mine = d.feed.filter((f) => f.aid === a.id).slice(0, 3);
  const v = (l: string, x: string, cls = ""): string => `<div><span class="lbl">${l}</span><b style="font-weight:500;display:block;margin-top:4px" class="${cls}">${x}</b></div>`;
  return `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="${esc(a.n)}"><div class="hd"><span class="lbl">Agent</span><button class="x" data-close>Close ✕</button></div><div class="bd">
 <div style="display:flex;gap:18px;align-items:center"><div class="ava ${a.st}">${esc(a.s)}</div><div><h2 style="font-size:30px;font-weight:600;font-stretch:90%;letter-spacing:-.02em;line-height:1">${esc(a.n)}</h2><div class="mono" style="margin-top:6px">${esc(a.role)}</div></div></div>
 <div class="two">${v("Status", `● ${ST[a.st]}`, STc[a.st] ?? "")}${v("Last heartbeat", esc(a.hb))}${v("Doing now", a.cur ? `${esc(a.cur)} · ${esc(lookup(d).pr(a.pr))}` : "nothing, waiting for a task")}${v("Engine", esc(a.adapter))}</div>
 ${a.err ? `<div class="why" style="border-color:var(--red)"><div class="lbl red" style="margin-bottom:6px">Last error</div><div class="mono" style="color:var(--ink);text-transform:none;letter-spacing:0;font-size:15px">${esc(a.err)}</div></div>` : ""}
${d.control ? `<div class="ctl"><div class="lbl">Controls</div><div class="ctlrow">${a.st === "paused" ? `<button class="cta" data-act="agent" data-id="${esc(a.id)}" data-v="resume" data-undo="pause" data-msg="Waking up ${esc(a.n)}">Resume agent</button>` : `<button class="cta ghost" data-act="agent" data-id="${esc(a.id)}" data-v="pause" data-undo="resume" data-msg="Pausing ${esc(a.n)}">Pause</button>`}<button class="cta ghost" data-act="agent" data-id="${esc(a.id)}" data-v="wakeup" data-msg="Waking up ${esc(a.n)}">Wake up now</button></div></div>` : ""}
 <div><div class="lbl" style="margin-bottom:10px">Tokens · available days <span class="sp"></span><span style="color:var(--ink)">today ${esc(a.tok)}</span></div><div class="spark">${a.spark.map((x, i) => `<i class="${i === a.spark.length - 1 ? "t" : ""}" style="height:${Math.max((x / mx) * 100, 3)}%;animation-delay:${i * 40}ms"></i>`).join("")}</div></div>
 <div class="two"><div><span class="lbl">Runs today</span><div class="big" style="font-size:40px;margin-top:8px">${a.runs}</div></div><div><span class="lbl">Success rate</span><div class="big" style="font-size:40px;margin-top:8px">${a.runs ? a.ok : "—"}<small style="font-size:16px;color:var(--mute)">${a.runs ? "%" : ""}</small></div></div></div>
 <div><div class="lbl" style="margin-bottom:4px">Latest runs</div><ul class="feed" style="margin:0 -24px">${mine.map((f) => `<li><span class="tm">${f.t}</span><span class="who">${esc(f.i)}</span><span class="res ${f.s === "ok" ? "ok" : f.s === "er" ? "er" : ""}">${f.r} · ${f.d}</span></li>`).join("") || '<li><span class="who">Nothing has run today yet.</span></li>'}</ul></div>
 </div></aside>`;
};

const issueSheet = (d: Snapshot, id: string, ex: Extra): string => {
  const w = d.wait.find((x) => x.id === id);
  return w ? `<div class="scrim" data-close></div><aside class="sheet" role="dialog" aria-label="${esc(w.id)}"><div class="hd"><span class="lbl">Task</span><button class="x" data-close>Close ✕</button></div><div class="bd" style="gap:18px">${ex.card?.issue === id ? cardHTML(ex.card, ex.playing, ex.editing) : issueHTML(d, w, false)}</div></aside>` : "";
};

const servers = (d: Snapshot): string => {
  const up = d.servers.filter((x) => x.up).length;
  const rows = d.servers.map((x) => `<div class="srv ${x.up ? "" : "off"}"><span class="sd ${x.up ? "on" : "off"}"></span><b>${esc(x.n)}</b><span class="tag">${esc(x.where)}</span><span class="mono">${esc(x.target)}</span><span class="mono st">${x.up ? `up · ${x.ms} ms` : "unreachable"}</span><span class="mono ck">checked ${esc(x.at)}</span></div>`).join("");
  return `<div class="screen page srvp"><div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Machines · what's running where</div><h1>What's on</h1></div><div class="hint" style="max-width:340px;text-align:right">${up} of ${d.servers.length} is responding. Ports checked every 15 s.</div></div><div class="chts">${chart({ id: "pve-cpu", title: "Proxmox · CPU and RAM", unit: "%", series: [{ key: "pve:cpu", label: "CPU" }, { key: "pve:ram", label: "RAM" }] })}${chart({ id: "pve-net", title: "Proxmox · network", unit: "B/s", series: [{ key: "pve:netin", label: "Inbound" }, { key: "pve:netout", label: "Outbound" }] })}</div><div class="srvl">${rows || '<div class="hint" style="padding:20px 28px">No machines are configured.</div>'}</div></div>`;
};

const ops = (): string => servicesHTML();

/* Hermes as a side panel: a drawer opened from anywhere by a button or shortcut H,
   not the main surface. #clog is filled by os.tsx, sending uses data-chat / data-chatsend; behaviour unchanged. */
const SUG = ["What's waiting on me?", "What's running?", "System status", "What's new?"];
export const sugHtml = `<div class="hc-sug">${SUG.map((x) => `<button class="chip" data-sug="${esc(x)}">${esc(x)}</button>`).join("")}</div>`;
const hermPanel = (r: Route, live: boolean, open: boolean): string => {
  const from = secOf(r.s) ? where(r.s) + (r.q.issue ? ` · ${r.q.issue}` : "") : "";
  const ctx = from ? `<div class="hc-ctx"><span class="pill" title="Seeing this screen">${esc(from)}</span></div>` : "";
  return `<aside class="herm-drawer${open ? " open" : ""}" aria-hidden="${open ? "false" : "true"}" aria-label="Assistant"><div class="hc"><div class="hc-main"><header class="hc-head"><h1>Assistant</h1><span class="hc-st${live ? "" : " off"}"><i class="dot${live ? "" : " a"}"></i>${live ? "Online" : "Demo mode"}</span>${ctx}<button class="x herm-x" data-herm="close" aria-label="Close the assistant">Close ✕</button></header>
 ${live ? "" : '<div class="hc-bar">Demo mode: the assistant isn\'t connected, replies are just a preview.</div>'}
 <div class="hc-log clog" id="clog" role="log" aria-live="polite"></div>
 <div class="hc-dock"><div class="cimgs" id="cimgs"></div><input type="file" id="cfile" accept="image/*" multiple hidden><div class="hc-comp ask"><button data-attach aria-label="Attach an image">${ico("plus", 20)}</button><textarea rows="1" data-chat placeholder="Message the assistant…" aria-label="Message for the assistant" maxlength="3900"></textarea><button class="hc-mic" data-rec aria-label="Hold and speak" title="Hold and speak">${ico("mic", 20)}</button><button class="hc-send" data-chatsend aria-label="Send">${ico("send", 20)}</button></div><p class="hc-keys">Enter sends · Shift+Enter new line · H closes</p></div></div></div></aside>`;
};

/** Screen frame (top bar, rail, bottom bar); body is inserted in between – an HTML string, or a React component (Social). */
export const chrome = (d: Snapshot, r: Route, compact: boolean, stale: string | null, ex: Extra): { head: string; foot: string; ov: string; herm: string } => {
  const crewMember = r.s === "crew-team" && r.q.id ? ex.crewTeam?.list?.find((m) => String(m.id) === r.q.id) : undefined;
  const ov = r.q.agent ? agentSheet(d, r.q.agent)
    : r.s === "crew-team" && r.q.id ? crewMemberSheet(crewMember, ex.crewTx)
    : r.s === "crew-tasks" && r.q.id ? crewTaskSheet(ex.crewTaskDetail, ex.crewTaskErr, r.q.id)
    : r.s === "crew-brain" && r.q.node ? crewNodeSheet(ex.crewNode, ex.crewNodeErr, r.q.node)
    : r.q.issue && (r.s !== "waiting" || compact) ? issueSheet(d, r.q.issue, ex) : "";
  const find = `<button class="find" data-cmdk aria-label="Search or run a command">${ico("search", 18)}<span class="ft">Search or create a task</span><kbd>⌘K</kbd></button>`;
  const hermBtn = `<button class="herm-open" data-herm="open" aria-label="Open the assistant">${ico("chat", 18)}<span class="ft">Assistant</span><kbd>H</kbd></button>`;
  const top = `<header class="top"><a class="logo" href="#overview">BMQ<i>OS</i></a>${find}${hermBtn}<details class="me${r.s === "settings" ? " cur" : ""}"><summary><span>Me</span><b>M</b></summary><div class="mm"><span class="acc-l">Color</span><div class="acc">${[["zelena", "#059669", "Green"], ["mono", "#18181b", "No color"], ["modra", "#2563eb", "Blue"], ["indigo", "#4f46e5", "Indigo"], ["oranzova", "#ea580c", "Orange"]].map(([k, c, l]) => `<button data-acc="${k}" style="background:${c}" title="${l}" aria-label="${l}"></button>`).join("")}</div><nav class="mm-more" aria-label="More"><a href="#projects">Projects</a><a href="#ops">Services</a><a href="#servers">Machines</a></nav><a href="#settings">Notifications</a><form method="post" action="/api/logout"><button>Log out</button></form></div></details></header>`;
  const n = ex.ix?.n ?? d.wait.length + ex.soc, counts = { waiting: n };
  // Desktop: only the left panel (logo, search, sections, Hermes, account) – no extra top bar; mobile: top bar + bottom tabs
  const me = `<details class="me${r.s === "settings" ? " cur" : ""}"><summary><span>Me</span><b>M</b></summary><div class="mm"><span class="acc-l">Color</span><div class="acc">${[["zelena", "#059669", "Green"], ["mono", "#18181b", "No color"], ["modra", "#2563eb", "Blue"], ["indigo", "#4f46e5", "Indigo"], ["oranzova", "#ea580c", "Orange"]].map(([k, c, l]) => `<button data-acc="${k}" style="background:${c}" title="${l}" aria-label="${l}"></button>`).join("")}</div><a href="#settings">Notifications</a><form method="post" action="/api/logout"><button>Log out</button></form></div></details>`;
  return { head: `${top}${rail(n, r.s, stale, `<a class="logo" href="#overview">BMQ<i>OS</i></a>${find}`, `${hermBtn}${me}`)}${subtabs(r.s, counts)}`, foot: tabbar(n, r.s), ov, herm: hermPanel(r, ex.live, ex.herm) };
};

export const shell = (d: Snapshot, r: Route, compact: boolean, stale: string | null, ex: Extra): string => {
  const hot = ex.stor ? burning(ex.stor.machines) : "";
  const body = r.s === "waiting" && r.q.issue ? waiting(d, r.q.issue, compact, ex) : TAB_OF[r.s] ? itemsHTML(ex.ix, r.s, r.q.item, compact, d, ex.tk) : r.s === "runs" ? runs(d, compact) : r.s === "servers" ? storageHTML(ex.stor, r.q.m, ex.tops, compact, servers(d)) : r.s === "docs" ? docsHTML(ex.docs, r.q, compact) : r.s === "settings" ? settingsHTML(ex.push) : r.s === "agents" ? overview(d, compact, hot) : r.s === "projects" ? projectsHTML(ex.proj, d.ventures) : r.s === "project" ? projectHTML(ex.proj, d.ventures, r.q.id ?? "") : r.s === "ops" ? ops()
    : r.s === "crew-team" ? crewTeamHTML(ex.crewTeam)
    : r.s === "crew-tasks" ? crewTasksHTML(ex.crewTasks, ex.crewTeam?.list ?? null, r.q.agent ?? "", compact)
    : r.s === "crew-usage" ? crewUsageHTML(ex.crewUsage, r.q.range === "7d" ? "7d" : "24h", compact)
    : r.s === "crew-brain" ? crewBrainHTML(r.q.q ?? "", ex.crewBrainHits)
    : home(d, ex.post ? ex.soc : 0, hot, ex.ix);
  const c = chrome(d, r, compact, stale, ex);
  return `<div class="app${ex.herm ? " herm-on" : ""}">${c.head}${body}${c.foot}</div>${c.ov}${hermPanel(r, ex.live, ex.herm)}`;
};
