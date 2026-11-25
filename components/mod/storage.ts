import { esc } from "@/lib/stage";
import type { Machine, Pool } from "@/lib/storage";

export interface StorData { machines: Machine[]; pools: Pool[]; actions: { id: string; label: string }[]; actionsOn: boolean }
export type Tops = Record<string, { path: string; size: number }[] | null>;

const GB = 1024 ** 3;
const gb = (b: number): string => (b < GB ? `${Math.round(b / 1024 ** 2)} MB` : b >= 1000 * GB ? `${(b / 1024 ** 4).toFixed(1)} TB` : `${Math.round(b / GB)} GB`);
const pct = (d: { used: number; total: number }): number => (d.total ? Math.round((d.used / d.total) * 100) : 0);
const lvl = (p: number): "red" | "amber" | "ok" => (p >= 80 ? "red" : p >= 70 ? "amber" : "ok");
const LBL = { red: "ON FIRE", amber: "APPROACHING", ok: "" };
const worst = (m: Machine): number => Math.max(0, ...(m.m?.disks ?? []).map(pct));

/* "full in N days" estimate = linear projection from the 7-day trend */
const daysLeft = (m: Machine, mount: string): number | null => {
  const t = m.trend.filter((x) => x.mount === mount);
  if (t.length < 2) return null;
  const a = t[0], b = t[t.length - 1], dt = (b.at - a.at) / 86_400_000, rate = dt > 0 ? (b.pct - a.pct) / dt : 0;
  return rate > 0.05 ? Math.max(1, Math.round((100 - b.pct) / rate)) : null;
};

/* trend: full panel width, Y axis = min–max from the data, area under the line, "7 d ago / today" labels */
const spark = (m: Machine, mount: string): string => {
  const t = m.trend.filter((x) => x.mount === mount);
  if (t.length < 2) return '<div class="hint">Not enough measurements for a trend yet – appears after the first day of collection.</div>';
  const lo0 = Math.min(...t.map((p) => p.pct)), hi0 = Math.max(...t.map((p) => p.pct)), pad = Math.max(1, (hi0 - lo0) * 0.15);
  const lo = Math.max(0, lo0 - pad), hi = Math.min(100, hi0 + pad), x0 = t[0].at, span = Math.max(1, t[t.length - 1].at - x0);
  const y = (v: number): number => 4 + (1 - (v - lo) / Math.max(0.1, hi - lo)) * 72;
  const pts = t.map((p) => `${((p.at - x0) / span * 600).toFixed(1)},${y(p.pct).toFixed(1)}`);
  const last = t[t.length - 1].pct;
  return `<figure class="trend"><div class="plot"><svg viewBox="0 0 600 80" preserveAspectRatio="none" role="img" aria-label="7-day fill trend: from ${lo0.toFixed(0)} to ${hi0.toFixed(0)} %"><polygon points="0,80 ${pts.join(" ")} 600,80"/><polyline points="${pts.join(" ")}" fill="none" vector-effect="non-scaling-stroke"/></svg><span class="ym mono" style="top:0">${hi.toFixed(0)} %</span><span class="ym mono" style="bottom:0">${lo.toFixed(0)} %</span><i class="dot" style="top:${(y(last) / 80 * 100).toFixed(1)}%"></i></div><figcaption class="mono"><span>7 d ago</span><b>today · ${last.toFixed(0)} %</b></figcaption></figure>`;
};

const warn = (t: string): string => `<div class="warn"><svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1.5 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M8 6.5v3.5M8 11.6v.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg><span>${t}</span></div>`;

const bar = (p: number): string => `<span class="bar ${lvl(p)}"><i style="width:${Math.min(100, p)}%"></i><u></u></span>`;

export const burning = (ms: Machine[]): string => {
  const hot = ms.flatMap((m) => (m.m?.disks ?? []).filter((d) => pct(d) >= 80).map((d) => `${m.name} ${pct(d)} %`));
  return hot.length ? `<a class="fire" href="#servers"><b>● Needs attention · disk space</b><span>${esc(hot.join(" · "))}</span><span class="go">Servers →</span></a>` : "";
};

export const storageHTML = (s: StorData | null, sel: string | undefined, tops: Tops, compact: boolean, services = ""): string => {
  const head = (n: string) => `<div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Servers · disk space</div><h1>What's left${n}</h1></div></div>`;
  if (!s) return `<div class="screen page">${head("")}<div class="hint" style="padding:20px 28px">Loading machine status…</div></div>`;
  const ms = [...s.machines].sort((a, b) => worst(b) - worst(a));
  const cur = ms.find((m) => m.name === sel) ?? (compact ? undefined : ms[0]);
  const hot = ms.reduce((n, m) => n + (m.m?.disks ?? []).filter((d) => pct(d) >= 80).length, 0);
  const free = ms.reduce((n, m) => n + (m.m?.disks ?? []).reduce((x, d) => x + d.free, 0), 0);
  const soon = ms.flatMap((m) => (m.m?.disks ?? []).map((d) => ({ n: m.name, d: daysLeft(m, d.mount) }))).filter((x) => x.d !== null).sort((a, b) => (a.d ?? 0) - (b.d ?? 0))[0];
  const kpi = `<div class="skpi"><div><b class="${hot ? "red" : "lime"}">${hot}</b><span class="mono">Needs attention</span></div><div><b>${gb(free)}</b><span class="mono">Free space</span></div><div><b class="${soon ? "amber" : ""}">${soon ? `${soon.d} d` : "–"}</b><span class="mono">${soon ? `Full: ${esc(soon.n)}` : "Soonest full"}</span></div></div>`;
  const row = (m: Machine): string => {
    const w = worst(m), l = lvl(w);
    const tag = !m.ok ? '<span class="tag t-amber">NO DATA</span>' : l !== "ok" ? `<span class="tag t-${l}">${LBL[l]}</span>` : "";
    return `<a class="mrow ${cur?.name === m.name ? "on" : ""}" href="${compact && cur?.name === m.name ? "#servers" : `#servers&m=${encodeURIComponent(m.name)}`}"><div><b>${esc(m.name)}</b><span class="mono">${esc(m.m?.host ?? "")}</span>${tag}</div><strong class="${l}">${m.m ? `${w} %` : "–"}</strong><div class="bars">${(m.m?.disks ?? []).map((d) => `<div><span class="mono">${esc(d.mount)} ${pct(d)} %</span>${bar(pct(d))}</div>`).join("")}</div></a>`;
  };
  const rows = ms.map((m) => row(m) + (compact && cur?.name === m.name ? `<section class="sdet inl">${detail(m, s, tops)}</section>` : "")).join("");
  const list = `<aside class="slist">${kpi}${rows ? rows + (ms.some((m) => /media/i.test(m.name)) ? "" : `<div class="mrow"><div><b>Media</b><span class="mono">read-only</span><span class="tag t-amber">NO DATA</span></div><strong>–</strong><div class="bars">${warn("Media isn't reporting data yet. The OS doesn't run anything on it.")}</div></div>`) :  '<div class="hint" style="padding:20px">No machine is configured (OS_AGENTS).</div>'}${s.pools.length ? `<div class="lbl" style="padding:18px 20px 6px">Proxmox pools</div>${s.pools.map((p) => `<div class="pool"><b>${esc(p.name)}</b><span class="mono">${esc(p.type)} · ${gb(p.total - p.used)} free of ${gb(p.total)}</span>${bar(pct(p))}</div>`).join("")}` : ""}<p class="hint snote">Sorted by what fills up soonest. Pick a machine to see what's taking up space on disk.</p></aside>`;
  const det = cur ? detail(cur, s, tops) : '<div class="hint" style="padding:28px">Pick a machine.</div>';
  return `<div class="screen page stor">${head("")}<div class="split">${list}${compact ? "" : `<section class="sdet">${det}</section>`}</div>${services}</div>`;
};

const detail = (m: Machine, s: StorData, tops: Tops): string => {
  if (!m.m) return `<h2>${esc(m.name)}</h2>${warn("Machine isn't responding. Either the agent isn't running on it, or it's off. The OS doesn't fake anything.")}`;
  const disks = m.m.disks.map((d) => {
    const p = pct(d), l = lvl(p), dl = daysLeft(m, d.mount), key = `${m.name}|${d.mount}`, top = tops[key];
    return `<div class="disk"><div class="dh"><b class="mono">${esc(d.mount)}</b>${l !== "ok" ? `<span class="tag t-${l}">${LBL[l]}</span>` : ""}<span class="mono">${gb(d.used)} of ${gb(d.total)} · ${gb(d.free)} free</span></div>
<div class="dp"><strong class="${l}">${p} %</strong>${bar(p)}</div>
${dl ? `<div class="mono">At this rate, full in ~${dl} days</div>` : ""}${spark(m, d.mount)}
${top === undefined ? `<button class="btn2" data-top="${esc(key)}">What's taking up space</button>` : top === null ? warn("Can't check folders right now. The agent on the machine didn't respond, try again shortly.") : `<ul class="tops">${top.slice(0, 8).map((t) => `<li><span class="mono">${esc(t.path)}</span><b>${gb(t.size)}</b></li>`).join("")}</ul>`}</div>`;
  }).join("");
  const mem = m.m.mem.total ? `${Math.round((1 - m.m.mem.avail / m.m.mem.total) * 100)} % RAM` : "";
  const ro = /media/i.test(m.name);
  const acts = ro ? '<div class="mono">Read-only – the OS doesn\'t run anything on this machine.</div>' : s.actions.map((a) => `<div class="t3"><p class="hint">${esc(a.label)} deletes files on the machine and can't be undone. Type the machine name and enter the 2FA code.</p><div class="t3f"><input class="in" data-ttyped placeholder="${esc(m.name)}" aria-label="Type the machine name" autocomplete="off"><input class="in" data-tcode inputmode="numeric" maxlength="6" placeholder="2FA code" aria-label="2FA code" autocomplete="one-time-code"></div></div><button class="btn2" data-sact="${esc(a.id)}" data-host="${esc(m.name)}" disabled>${esc(a.label)}</button>`).join("") + (s.actionsOn ? "" : '<div class="hint">Actions are currently disabled, the button won\'t delete anything.</div>');
  return `<h2>${esc(m.name)}</h2><div class="mono">load ${m.m.load.map((x) => x.toFixed(2)).join(" ")} · ${mem} · up ${Math.floor(m.m.up / 86400)} d</div>${disks}<div class="lbl" style="margin:22px 0 8px">Actions</div>${acts}`;
};
