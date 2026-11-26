// Brand: pure helpers (kit types, validation, contrast, HTML check, safe paths). No I/O, so they are testable on their own.
export type FontRef = { family: string; file?: string };
export type BrandKit = {
  logo: { primary?: string; mark?: string; mono?: string };
  colors: { bg: string; ink: string; accent: string; accent2?: string; muted: string };
  fonts: { display: FontRef; body: FontRef };
  voice: { tags: string[]; never: string[]; samples: string[] };
  examples: string[];
};
export type BrandFormat = "post" | "story" | "og" | "banner";
export type Brief = { headline: string; sub?: string; cta?: string; note?: string };

export const FORMATS: Record<BrandFormat, { w: number; h: number; label: string; max: { headline: number; sub: number; cta: number } }> = {
  post: { w: 1080, h: 1080, label: "Post 1:1", max: { headline: 60, sub: 120, cta: 20 } },
  story: { w: 1080, h: 1920, label: "Story 9:16", max: { headline: 50, sub: 90, cta: 16 } },
  og: { w: 1200, h: 630, label: "OG 1.91:1", max: { headline: 70, sub: 110, cta: 0 } },
  banner: { w: 1500, h: 500, label: "Banner", max: { headline: 50, sub: 80, cta: 0 } },
};
export const isFormat = (s: unknown): s is BrandFormat => typeof s === "string" && s in FORMATS;


export const HEX = /^#[0-9a-f]{6}$/;
export const slug = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

const chan = (v: number): number => (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const lum = (h: string): number => 0.2126 * chan(parseInt(h.slice(1, 3), 16)) + 0.7152 * chan(parseInt(h.slice(3, 5), 16)) + 0.0722 * chan(parseInt(h.slice(5, 7), 16));
export const contrast = (a: string, b: string): number => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
export const grade = (r: number): "AA text" | "graphic only" | "fails" => (r >= 4.5 ? "AA text" : r >= 3 ? "graphic only" : "fails");

export const EMPTY_KIT: BrandKit = {
  logo: {},
  colors: { bg: "#0a0a0a", ink: "#f2efe8", accent: "#e0531f", muted: "#b0ada4" },
  fonts: { display: { family: "Bricolage Grotesque" }, body: { family: "Inter" } },
  voice: { tags: [], never: [], samples: [] },
  examples: [],
};

const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== "string" || v.length > max) throw new Error(`${what}: text up to ${max} characters`);
  return v;
};
const list = (v: unknown, n: number, max: number, what: string): string[] => {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > n) throw new Error(`${what}: up to ${n} items`);
  return v.map((x) => str(x, max, what));
};
const rel = (v: unknown, what: string): string | undefined => {
  if (v === undefined || v === "") return undefined;
  const s = str(v, 200, what);
  if (s.includes("..") || s.startsWith("/") || s.includes("\\")) throw new Error(`${what}: invalid path`);
  return s;
};
const font = (v: unknown, dflt: FontRef, what: string): FontRef => {
  if (v === undefined) return dflt;
  const o = v as Partial<FontRef>;
  return { family: str(o.family, 60, what).replace(/[^\w ,-]/g, ""), file: rel(o.file, what) };
};

// Merges a partial kit over the defaults and validates it; throws Error with a human message.
export function validateKit(x: unknown, base: BrandKit = EMPTY_KIT): BrandKit {
  const o = (x ?? {}) as Partial<BrandKit>;
  const c = { ...base.colors, ...(o.colors ?? {}) };
  for (const k of ["bg", "ink", "accent", "muted"] as const) if (!HEX.test(c[k])) throw new Error(`colors.${k}: hex like #aabbcc`);
  if (c.accent2 !== undefined && !HEX.test(c.accent2)) throw new Error("colors.accent2: hex like #aabbcc");
  const v = { ...base.voice, ...(o.voice ?? {}) };
  return {
    logo: { primary: rel(o.logo?.primary ?? base.logo.primary, "logo"), mark: rel(o.logo?.mark ?? base.logo.mark, "logo"), mono: rel(o.logo?.mono ?? base.logo.mono, "logo") },
    colors: c,
    fonts: { display: font(o.fonts?.display, base.fonts.display, "fonts"), body: font(o.fonts?.body, base.fonts.body, "fonts") },
    voice: { tags: list(v.tags, 3, 20, "voice.tags"), never: list(v.never, 20, 60, "voice.never"), samples: list(v.samples, 3, 200, "voice.samples") },
    examples: list(o.examples ?? base.examples, 6, 200, "examples"),
  };
}

export function validateBrief(f: BrandFormat, x: unknown): Brief {
  const o = (x ?? {}) as Partial<Brief>;
  const m = FORMATS[f].max;
  const headline = str(o.headline, 90, "headline").trim();
  if (!headline) throw new Error("headline: required");
  const sub = o.sub === undefined ? "" : str(o.sub, 180, "sub");
  const cta = o.cta === undefined ? "" : str(o.cta, 24, "cta");
  if (headline.length > m.headline) throw new Error(`headline: max ${m.headline} characters for ${f}`);
  if (sub.length > m.sub) throw new Error(`sub: max ${m.sub} characters for ${f}`);
  if (cta.length > m.cta) throw new Error(m.cta ? `cta: max ${m.cta} characters for ${f}` : `${f} has no CTA`);
  return { headline, sub, cta, note: o.note === undefined ? "" : str(o.note, 300, "note") };
}

// Output of Claude and uploaded SVGs: no scripts, handlers, frames, external loads. Returns the first violation or null.
const BAD: [RegExp, string][] = [
  [/<script\b/i, "script"], [/<iframe\b/i, "iframe"], [/<(?:object|embed|foreignObject)\b/i, "embedded content"], [/<link\b/i, "link"], [/@import/i, "@import"],
  [/\son[a-z]+\s*=/i, "event handler"], [/javascript:/i, "javascript: URL"],
  [/(?:\bsrc|\bhref|xlink:href)\s*=\s*["']?\s*(?:https?:)?\/\//i, "external URL"], [/url\(\s*["']?\s*(?:https?:)?\/\//i, "external url()"],
];
export const htmlViolation = (html: string): string | null => BAD.find(([re]) => re.test(html))?.[1] ?? null;

// Editable text slots: <el data-slot="headline">…</el>
export function setSlots(html: string, b: Pick<Brief, "headline" | "sub" | "cta">): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
  let out = html;
  for (const k of ["headline", "sub", "cta"] as const) {
    if (b[k] === undefined) continue;
    out = out.replace(new RegExp(`(<([a-z0-9]+)\\b[^>]*\\bdata-slot="${k}"[^>]*>)[\\s\\S]*?(</\\2>)`, "i"), (_m, open: string, _t: string, close: string) => open + esc(b[k] as string) + close);
  }
  return out;
}
