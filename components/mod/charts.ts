import { esc } from "@/lib/stage";
import { tok } from "@/lib/format";
import type { Usage } from "@/lib/crew";

/* Shared spend charts (Home and the Spend page): HTML bars with rounding and tooltips, donut via conic-gradient */
export const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const usd = (n: number): string => `$${n < 10 ? n.toFixed(2) : n.toFixed(1)}`;
const nice = (v: number): number => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; };
const when = (t: string, hourly: boolean): Date => new Date(t.replace(" ", "T") + (hourly ? "Z" : ""));

export const barChart = (series: Usage["series"], hourly = false): string => {
  if (!series.length) return '<div class="hint">No data yet.</div>';
  const byCost = series.some((p) => p.cost_usd > 0), val = (p: Usage["series"][number]): number => (byCost ? p.cost_usd : p.tokens);
  const fmt = (v: number): string => (byCost ? usd(v) : tok(v)), mx = nice(Math.max(...series.map(val)) * 1.05);
  const grid = [1, 0.5, 0].map((f) => `<i style="bottom:${f * 100}%"><span>${f ? fmt(mx * f) : ""}</span></i>`).join("");
  const n = series.length;
  const cols = series.map((p, i) => {
    const d = when(p.t, hourly), last = i === n - 1, v = val(p);
    const lbl = hourly ? (last ? "now" : `${String(d.getHours()).padStart(2, "0")}h`) : last ? "Today" : DAY[d.getDay()];
    const full = hourly ? `${String(d.getHours()).padStart(2, "0")}:00` : `${DAY[d.getDay()]} ${d.getDate()}. ${d.getMonth() + 1}.`;
    const showX = !hourly || i % 4 === 0 || last;
    return `<div class="bc-col${last ? " now" : ""}" tabindex="0"><div class="bc-bar" style="height:${v ? Math.max(2, (v / mx) * 100).toFixed(1) : 0}%">${last && v ? `<span class="bc-v">${fmt(v)}</span>` : ""}<span class="bc-tip"><em>${full}</em><b>${fmt(v)}</b>${byCost ? `<span>${tok(p.tokens)} tokens</span>` : ""}</span></div><span class="bc-x">${showX ? lbl : ""}</span></div>`;
  }).join("");
  return `<div class="bc${hourly ? " h" : ""}" role="img" aria-label="Spend over time"><div class="bc-grid">${grid}</div><div class="bc-cols">${cols}</div></div>`;
};

export interface Slice { label: string; value: number; color: string; href?: string }
export const donut = (xs: Slice[], center: string, sub: string): string => {
  const items = xs.filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (!items.length) return '<div class="hint">No data yet.</div>';
  const tot = items.reduce((t, s) => t + s.value, 0);
  let acc = 0;
  const stops = items.map((s) => { const a = (acc / tot) * 360; acc += s.value; return `${s.color} ${a.toFixed(2)}deg ${((acc / tot) * 360).toFixed(2)}deg`; }).join(",");
  return `<div class="dn"><div class="dn-w"><div class="dn-ring" style="background:conic-gradient(${stops})"></div><div class="dn-c"><b>${center}</b><span>${esc(sub)}</span></div></div>
<div class="dn-l">${items.map((s) => `<a class="dn-i" href="${s.href ?? "#crew-usage"}"><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${usd(s.value)}</b><em>${Math.round((s.value / tot) * 100)} %</em></a>`).join("")}</div></div>`;
};
