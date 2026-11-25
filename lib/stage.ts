import type { Agent, Project } from "./types";

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

const seeded = (seed: number) => {
  let s = seed | 0;
  return (): number => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Dot { x: number; y: number; st: "a" | "o" | "d" }

/** Stage: contour lines, ring of agents, cloud of tasks by project. decor = no names and numbers (login page). */
export function stageSvg(P: Project[], A: Agent[], waitCount: number, compact: boolean, decor = false): string {
  const rng = seeded(7);
  const gauss = (): number => (rng() + rng() + rng() + rng() - 2) / 2;
  const R = compact ? 352 : 340, NR = compact ? 40 : 24, N = Math.max(A.length, 1);
  let s = "";
  for (let k = 0; k < 13; k++) {
    const r0 = 92 + k * 14.5, ph = k * 0.7;
    let d = "";
    for (let i = 0; i <= 72; i++) {
      const t = (i / 72) * Math.PI * 2;
      const r = r0 + (5 + k * 0.55) * Math.sin(3 * t + ph) + (3 + k * 0.3) * Math.sin(5 * t - ph * 1.7) + 2 * Math.sin(9 * t + k);
      d += `${i ? "L" : "M"}${(400 + r * Math.cos(t)).toFixed(1)} ${(400 + r * Math.sin(t)).toFixed(1)}`;
    }
    s += `<path d="${d}Z" fill="none" stroke="#282828" stroke-opacity="${(0.34 - k * 0.02).toFixed(3)}" stroke-width="1"/>`;
  }
  s += `<circle cx="400" cy="400" r="${R}" fill="none" stroke="#282828" stroke-opacity=".1"/>`;
  for (let i = 0; i < 120; i++) {
    const t = (i / 120) * Math.PI * 2, l = i % 10 ? 4 : 9, r1 = R - NR - 8, r2 = r1 - l;
    s += `<line x1="${(400 + r1 * Math.cos(t)).toFixed(1)}" y1="${(400 + r1 * Math.sin(t)).toFixed(1)}" x2="${(400 + r2 * Math.cos(t)).toFixed(1)}" y2="${(400 + r2 * Math.sin(t)).toFixed(1)}" stroke="#282828" stroke-opacity=".16"/>`;
  }
  const isl = new Map<string, { x: number; y: number; dots: Dot[] }>();
  P.forEach((p, i) => {
    const t = -Math.PI / 2 + 0.35 + (i / P.length) * Math.PI * 2, r = i % 2 ? 196 : 152;
    isl.set(p.id, { x: 400 + r * Math.cos(t), y: 400 + r * Math.sin(t), dots: [] });
  });
  let pts = "", youL = "";
  for (const p of P) {
    const o = isl.get(p.id);
    if (!o) continue;
    const done = Math.min(Math.round(p.tot * 0.8), 28), tot = p.you + p.open + done;
    for (let i = 0; i < tot; i++) {
      const x = o.x + gauss() * 32, y = o.y + gauss() * 32;
      const st = i < p.you ? "a" : i < p.you + p.open ? "o" : "d";
      const col = st === "a" ? "#b8790f" : st === "o" ? "#e0531f" : "#8d8a81";
      o.dots.push({ x, y, st });
      pts += `<circle class="pt${st !== "d" && i % 3 === 0 ? " breathe" : ""}" data-p="${esc(p.id)}" data-st="${st}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${st === "a" ? 4.2 : st === "o" ? 3 : 1.7}" fill="${col}" opacity="${st === "d" ? 0.5 : st === "o" ? 0.95 : 1}" style="animation-delay:${(rng() * 3).toFixed(2)}s"/>`;
      if (st === "a") {
        pts += `<circle class="pt" data-p="${esc(p.id)}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="none" stroke="#b8790f" stroke-opacity=".5"/>`;
        youL += `<path d="M${x.toFixed(1)} ${y.toFixed(1)} Q ${(x * 0.5 + 200).toFixed(1)} ${(y * 0.5 + 200).toFixed(1)} 400 400" fill="none" stroke="#b8790f" stroke-opacity=".28"/>`;
      }
    }
  }
  let lab = "";
  if (!decor) {
    for (const p of P) {
      const o = isl.get(p.id);
      if (!o) continue;
      const ly = o.y + (compact ? 50 : 40);
      lab += `<g class="island-l" data-p="${esc(p.id)}"><text x="${o.x.toFixed(0)}" y="${ly.toFixed(0)}" text-anchor="middle" class="nm">${esc(compact ? p.short : p.n)}</text>${compact ? "" : `<text x="${o.x.toFixed(0)}" y="${(ly + 13).toFixed(0)}" text-anchor="middle" fill="#8d8a81">${p.open + p.you} open${p.you ? ` · <tspan fill="#b8790f">${p.you} you</tspan>` : ""}</text>`}</g>`;
    }
  }
  let ag = "", links = "";
  A.forEach((a, i) => {
    const t = -Math.PI / 2 + (i / N) * Math.PI * 2, x = 400 + R * Math.cos(t), y = 400 + R * Math.sin(t);
    const o = isl.get(a.pr);
    const open = o?.dots.filter((d) => d.st === "o") ?? [];
    const d = open[i % 3] ?? open[0];
    if (!decor && a.st === "running" && d)
      links += `<path class="link flow" d="M${x.toFixed(1)} ${y.toFixed(1)} Q ${(400 + (x - 400) * 0.25).toFixed(1)} ${(400 + (y - 400) * 0.25).toFixed(1)} ${d.x.toFixed(1)} ${d.y.toFixed(1)}"/>`;
    const state = decor ? "" : a.st;
    ag += `<g class="agent ${state}" ${decor ? "" : `data-a="${esc(a.id)}" data-x="${x.toFixed(1)}" data-y="${y.toFixed(1)}" role="button" tabindex="0" aria-label="${esc(a.n)}"`} style="animation-delay:${i * 45 + 200}ms"><circle cx="${x}" cy="${y}" r="${NR + (compact ? 8 : 6)}" fill="transparent"/><circle class="bg" cx="${x}" cy="${y}" r="${NR}"/>${state === "running" ? `<circle class="spin" cx="${x}" cy="${y}" r="${NR + 4}"/>` : ""}${decor ? "" : `<text x="${x}" y="${y}">${esc(a.s)}</text>`}</g>`;
  });
  const core = decor
    ? ""
    : `<g class="core" data-go="waiting" role="button" tabindex="0" aria-label="Needs you: ${waitCount}"><circle cx="400" cy="400" r="74" fill="#0a0a0a" stroke="#b8790f" stroke-opacity=".55"/><circle cx="400" cy="400" r="74" fill="none" stroke="#b8790f" stroke-opacity=".25" class="pt breathe"/><text class="n" x="400" y="${compact ? 402 : 404}" dy=".1em" style="font-size:${compact ? 78 : 84}px">${waitCount}</text><text class="s" x="400" y="${compact ? 452 : 446}">needs you</text></g>`;
  return `<svg viewBox="0 0 800 800" class="${compact ? "compact" : ""}">${s}${youL}${pts}<g id="hovl"></g>${links}${lab}${ag}${core}</svg>`;
}
