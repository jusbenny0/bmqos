import { esc } from "@/lib/stage";
import { tok } from "@/lib/format";

/* OS chart component (custom SVG): line / area / bars, tooltip with a hairline crosshair,
   24h / 7d / 30d range switch. Pulls data from /api/metrics. Usage in a view:
     chart({ id: "cpu", title: "CPU", series: [{ key: "pve:cpu", label: "CPU" }], unit: "%" })
   then call mountCharts(root) once after rendering the HTML. */
export type Unit = "%" | "tok" | "usd" | "B/s" | "ms" | "";
export interface ChartCfg {
  id: string; title: string; unit?: Unit; kind?: "line" | "area" | "bar"; range?: "24h" | "7d" | "30d"; height?: number;
  series: { key: string; label: string; color?: string }[];
}
interface Pt { t: number; v: number }
const COLORS = ["#e0531f", "#b8790f", "#2f6fb3", "#7a5cc4"];
const RANGES = ["24h", "7d", "30d"] as const;
const TZ = "Europe/Prague";
const seen = new Map<string, Pt[][]>(); // last data, so an OS re-render doesn't flash an empty chart

export const chart = (c: ChartCfg): string =>
  `<div class="cht" data-chart="${esc(c.id)}" data-cfg="${esc(JSON.stringify(c))}"><div class="cht-h"><span class="lbl">${esc(c.title)}</span><span class="sp"></span><span class="cht-now mono"></span><div class="cht-r" role="group" aria-label="Range">${RANGES.map((r) => `<button type="button" data-r="${r}" aria-pressed="${r === (c.range ?? "24h")}">${r}</button>`).join("")}</div></div><div class="cht-b" style="height:${c.height ?? 150}px"></div>${c.series.length > 1 ? `<div class="cht-l mono">${c.series.map((s, i) => `<span><i style="background:${s.color ?? COLORS[i % 4]}"></i>${esc(s.label)}</span>`).join("")}</div>` : ""}</div>`;

export const fmt = (v: number, u: Unit = ""): string => {
  if (u === "%") return `${v.toFixed(v < 10 ? 1 : 0).replace(".", ",")} %`;
  if (u === "tok") return tok(Math.round(v));
  if (u === "usd") return `$${v.toFixed(v < 10 ? 2 : 0).replace(".", ",")}`;
  if (u === "ms") return `${Math.round(v)} ms`;
  if (u === "B/s") return v >= 1e6 ? `${(v / 1e6).toFixed(1).replace(".", ",")} MB/s` : `${Math.round(v / 1e3)} kB/s`;
  return String(Math.round(v * 10) / 10).replace(".", ",");
};
const when = (t: number, r: string): string =>
  new Date(t).toLocaleString("cs-CZ", r === "24h" ? { hour: "2-digit", minute: "2-digit", timeZone: TZ } : { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const tick = (t: number, r: string): string =>
  new Date(t).toLocaleString("cs-CZ", r === "24h" ? { hour: "2-digit", minute: "2-digit", timeZone: TZ } : { day: "numeric", month: "numeric", timeZone: TZ });

const nice = (mx: number): number => {
  const p = 10 ** Math.floor(Math.log10(mx || 1)), n = mx / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

/* pure function: data → SVG (drawn to the container's width) */
export const chartSvg = (c: ChartCfg, data: Pt[][], range: string, W: number, H: number): { svg: string; x: (t: number) => number } => {
  const L = 8, R = 8, T = 8, B = 20, pw = W - L - R, ph = H - T - B;
  const all = data.flat(), t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  const top = c.unit === "%" ? 100 : nice(Math.max(...all.map((p) => p.v)) * 1.05);
  const x = (t: number): number => L + (t1 === t0 ? pw / 2 : ((t - t0) / (t1 - t0)) * pw), y = (v: number): number => T + ph - (Math.min(v, top) / top) * ph;
  const grid = [0, 0.5, 1].map((f) => `<line x1="${L}" x2="${W - R}" y1="${y(top * f)}" y2="${y(top * f)}" stroke="rgba(29,28,36,.1)" stroke-dasharray="${f ? "2 4" : "0"}"/><text x="${L}" y="${y(top * f) - 4}" class="cht-t">${f ? fmt(top * f, c.unit) : ""}</text>`).join("");
  const xt = [0, 0.5, 1].map((f, i) => `<text x="${L + pw * f}" y="${H - 5}" text-anchor="${i === 0 ? "start" : i === 2 ? "end" : "middle"}" class="cht-t">${tick(t0 + (t1 - t0) * f, range)}</text>`).join("");
  const bw = Math.max(1, Math.min(14, (pw / Math.max(1, data[0]?.length ?? 1)) * 0.7));
  const marks = data.map((d, i) => {
    if (!d.length) return "";
    const col = c.series[i]?.color ?? COLORS[i % 4];
    if (c.kind === "bar") return d.map((p) => `<rect x="${(x(p.t) - bw / 2).toFixed(1)}" y="${y(p.v).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, T + ph - y(p.v)).toFixed(1)}" fill="${col}" rx="1"/>`).join("");
    const line = d.map((p, j) => `${j ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
    const area = c.kind === "area" || (!c.kind && data.length === 1) ? `<path d="${line}L${x(d[d.length - 1].t).toFixed(1)} ${T + ph}L${x(d[0].t).toFixed(1)} ${T + ph}Z" fill="${col}" opacity=".12"/>` : "";
    return `${area}<path d="${line}" fill="none" stroke="${col}" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/>`;
  }).join("");
  return { svg: `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(c.title)}">${grid}${xt}${marks}<g class="cht-x" style="display:none"><line y1="${T}" y2="${T + ph}" stroke="rgba(29,28,36,.4)"/></g></svg>`, x };
};

/* hydration: loads data, draws, wires up the tooltip and range switch; returns a cleanup fn */
export const mountCharts = (root: HTMLElement): (() => void) => {
  const offs: (() => void)[] = [];
  root.querySelectorAll<HTMLElement>("[data-chart]").forEach((el) => {
    const c = JSON.parse(el.dataset.cfg ?? "{}") as ChartCfg, box = el.querySelector<HTMLElement>(".cht-b"), now = el.querySelector<HTMLElement>(".cht-now");
    if (!box || !now) return;
    let range = c.range ?? "24h", data: Pt[][] = seen.get(`${c.id}|${c.range ?? "24h"}`) ?? [], geo: ReturnType<typeof chartSvg> | null = null, alive = true;
    const draw = (): void => {
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      if (!data.some((d) => d.length > 1)) { box.innerHTML = `<div class="hint cht-e">${data.some((d) => d.length) ? "Only one sample so far – the chart will start once there's more." : "No data yet."}</div>`; now.textContent = ""; geo = null; return; }
      geo = chartSvg(c, data, range, W, H);
      box.innerHTML = geo.svg + '<div class="cht-tip"></div>';
      const d0 = data.find((d) => d.length) ?? [];
      now.textContent = fmt(d0[d0.length - 1].v, c.unit);
    };
    const load = async (): Promise<void> => {
      const j = (await fetch(`/api/metrics?series=${c.series.map((s) => encodeURIComponent(s.key)).join(",")}&range=${range}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)) as Record<string, Pt[]> | null;
      if (!alive) return;
      data = c.series.map((s) => j?.[s.key] ?? []);
      seen.set(`${c.id}|${range}`, data);
      draw();
    };
    const onClick = (e: Event): void => {
      const b = (e.target as Element).closest<HTMLButtonElement>("[data-r]");
      if (!b || b.dataset.r === range) return;
      range = b.dataset.r as typeof range;
      el.querySelectorAll("[data-r]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      void load();
    };
    const onMove = (e: PointerEvent): void => {
      const tip = box.querySelector<HTMLElement>(".cht-tip"), line = box.querySelector<SVGLineElement>(".cht-x line"), d0 = data.find((d) => d.length);
      if (!geo || !tip || !line || !d0) return;
      const rect = box.getBoundingClientRect(), px = e.clientX - rect.left;
      const k = d0.reduce((a, p, i) => (Math.abs(geo!.x(p.t) - px) < Math.abs(geo!.x(d0[a].t) - px) ? i : a), 0), sx = geo.x(d0[k].t);
      (line.parentElement as unknown as HTMLElement).style.display = "";
      line.setAttribute("x1", String(sx));
      line.setAttribute("x2", String(sx));
      tip.innerHTML = `<span class="mono">${when(d0[k].t, range)}</span>${data.map((d, i) => { const p = d.reduce((a, b) => (Math.abs(b.t - d0[k].t) < Math.abs(a.t - d0[k].t) ? b : a), d[0]); return p ? `<b>${c.series.length > 1 ? `<i style="background:${c.series[i].color ?? COLORS[i % 4]}"></i>${esc(c.series[i].label)} ` : ""}${fmt(p.v, c.unit)}</b>` : ""; }).join("")}`;
      tip.classList.add("show");
      tip.style.left = `${Math.min(Math.max(sx - tip.offsetWidth / 2, 0), rect.width - tip.offsetWidth)}px`;
    };
    const onLeave = (): void => {
      box.querySelector(".cht-tip")?.classList.remove("show");
      const g = box.querySelector<SVGGElement>(".cht-x");
      if (g) g.style.display = "none";
    };
    el.addEventListener("click", onClick);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerleave", onLeave);
    const ro = new ResizeObserver(draw);
    ro.observe(box);
    const refresh = setInterval(() => void load(), 60_000);
    draw();
    void load();
    offs.push(() => { alive = false; ro.disconnect(); clearInterval(refresh); el.removeEventListener("click", onClick); });
  });
  return () => offs.forEach((f) => f());
};
