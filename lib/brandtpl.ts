import { FORMATS, type BrandFormat, type BrandKit, type Brief } from "./brandkit";

// Reference templates (one per format, 3 compositions). Fallback in demo mode and the example in the Claude prompt.
// {{logo_mark}} / {{logo_primary}} are replaced with data: URIs at render time. Text elements carry data-slot for re-editing.
const e = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

// hard-edged generative pattern, no gradients: rows of squares and circles in accent / muted
function pattern(w: number, h: number, kit: BrandKit, seed: number): string {
  const n = 6, cw = w / n, ch = h / n;
  let s = "";
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const k = (x * 7 + y * 13 + seed * 5) % 5;
    const c = k === 0 ? kit.colors.accent : k === 1 ? (kit.colors.accent2 ?? kit.colors.muted) : "none";
    if (c === "none") continue;
    s += k % 2 ? `<circle cx="${x * cw + cw / 2}" cy="${y * ch + ch / 2}" r="${Math.min(cw, ch) / 3}" fill="${c}"/>` : `<rect x="${x * cw + cw / 6}" y="${y * ch + ch / 6}" width="${cw * 0.66}" height="${ch * 0.66}" fill="${c}"/>`;
  }
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block">${s}</svg>`;
}

export function refTemplate(f: BrandFormat, kit: BrandKit, b: Brief, variant = 0): string {
  const { w, h } = FORMATS[f];
  const c = kit.colors, D = `'${kit.fonts.display.family}',sans-serif`, B = `'${kit.fonts.body.family}',sans-serif`;
  const v = ((variant % 3) + 3) % 3;
  const left = v !== 1;
  const sub = b.sub ? `<p data-slot="sub" class="sub">${e(b.sub)}</p>` : "";
  const cta = b.cta ? `<span data-slot="cta" class="cta">${e(b.cta)}</span>` : "";
  const head = (cls: string) => `<h1 data-slot="headline" class="${cls}">${e(b.headline)}</h1>`;
  const base = `*{box-sizing:border-box;margin:0}body{width:${w}px;height:${h}px;overflow:hidden;background:${c.bg};color:${c.ink};font-family:${B};position:relative}
h1{font-family:${D};font-weight:700;line-height:1.02;letter-spacing:-.02em;text-wrap:balance}.sub{color:${c.muted};line-height:1.3}.cta{border-bottom:3px solid ${c.accent};padding-bottom:4px;font-weight:600}img{display:block}`;
  const body = (css: string, inner: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${base}${css}</style></head><body>${inner}</body></html>`;
  if (f === "post") {
    const pat = v === 2 ? "" : `<div style="position:absolute;${left ? "right" : "left"}:72px;top:72px;opacity:1">${pattern(360, 360, kit, 1 + v)}</div>`;
    return body(`.mark{position:absolute;${left ? "left" : "right"}:72px;top:72px;height:64px}.t{position:absolute;left:72px;right:72px;bottom:72px;${left ? "" : "text-align:right;"}}
.bar{width:120px;height:6px;background:${c.accent};margin-bottom:28px;${left ? "" : "margin-left:auto;"}}h1{font-size:${v === 2 ? 120 : 104}px}.sub{font-size:32px;margin-top:24px}.cta{display:inline-block;margin-top:32px;font-size:28px}`,
      `${pat}<img class="mark" alt="" src="{{logo_mark}}" style="${v === 1 ? "left:72px;right:auto" : ""}"><div class="t"><div class="bar"></div>${head("")}${sub}${cta}</div>`);
  }
  if (f === "story") {
    return body(`.mark{position:absolute;left:72px;top:250px;height:72px}.t{position:absolute;left:72px;right:72px;top:${v === 2 ? 700 : 730}px}h1{font-size:120px}.sub{font-size:40px;margin-top:32px}
.blk{position:absolute;left:0;right:0;bottom:0;height:300px;overflow:hidden;${v === 2 ? `background:${c.accent}` : ""}}.cta{position:absolute;left:72px;bottom:340px;background:${c.accent};color:${c.bg};padding:22px 40px;border-radius:2px;font-size:34px;font-weight:700;border:0}`,
      `<img class="mark" alt="" src="{{logo_mark}}"><div class="t">${head("")}${sub}</div><div class="blk">${v === 2 ? "" : pattern(1080, 300, kit, v)}</div>${cta}`);
  }
  if (f === "og") {
    return body(`.l{position:absolute;${left ? "left" : "right"}:64px;top:64px;width:700px}h1{font-size:72px}.sub{font-size:28px;margin-top:20px}
.r{position:absolute;${left ? "right" : "left"}:0;top:0;width:320px;height:630px;background:${c.accent};display:flex;align-items:center;justify-content:center}.r img{width:180px;height:180px;object-fit:contain}`,
      `<div class="l">${head("")}${sub}</div><div class="r"><img alt="" src="{{logo_mark}}"></div>`);
  }
  return body(`.lg{position:absolute;left:64px;top:0;bottom:0;display:flex;align-items:center}.lg img{height:72px}.t{position:absolute;left:${left ? 360 : 64}px;top:0;bottom:0;width:760px;display:flex;flex-direction:column;justify-content:center;}
h1{font-size:64px}.sub{font-size:26px;margin-top:16px}.p{position:absolute;right:0;top:0;width:${left ? 280 : 0}px;height:500px;overflow:hidden}`,
    `${v === 1 ? "" : `<div class="lg"><img alt="" src="{{logo_primary}}"></div>`}<div class="t">${head("")}${sub}</div><div class="p">${left ? pattern(280, 500, kit, v) : ""}</div>`);
}
