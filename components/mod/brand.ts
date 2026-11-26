import { esc } from "@/lib/stage";
import { contrast, grade, FORMATS, type BrandFormat, type BrandKit } from "@/lib/brandkit";
import { FONTS } from "@/lib/brandfonts";
import type { Asset, Project } from "@/lib/brand";

/* Brand: projects with a brand kit, generated images (HTML -> PNG on the server), gallery, ZIP export. Self-contained: fetches /api/brand itself. */
export const LABEL = "Brand";
export const brandHTML = (): string => `<div class="screen page brand"><div class="col"><div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Projects · ${LABEL}</div><h1>${LABEL}<span>Logo, colors and tone in one kit. Images for every format.</span></h1></div></div>
 <div id="brand-root"><p class="empty">Loading…</p></div></div></div>`;

type Detail = Asset & { html?: string };
const api = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const r = await fetch(url, { cache: "no-store", ...init });
  const j = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Error ${r.status}`);
  return j as T;
};
const ago = (iso: string): string => { const d = Math.max(0, Date.now() - Date.parse(iso)) / 3_600_000; return d < 1 ? "just now" : d < 24 ? `${Math.floor(d)} h ago` : `${Math.floor(d / 24)} d ago`; };
const swatches = (k: BrandKit): string => `<span class="br-sw">${[k.colors.bg, k.colors.ink, k.colors.accent, k.colors.accent2 ?? k.colors.muted, k.colors.muted].map((c) => `<i style="background:${esc(c)}"></i>`).join("")}</span>`;
const logoUrl = (p: Project, f?: string): string => (f ? `/api/brand/${p.id}/files?f=${encodeURIComponent(f)}` : "");
const ROLES = ["bg", "ink", "accent", "accent2", "muted"] as const;
const TAGS = ["Direct", "Warm", "Technical", "Playful", "Premium", "Calm", "Bold"];

export const mountBrand = (root: HTMLElement): (() => void) => {
  const found = root.querySelector<HTMLElement>("#brand-root");
  if (!found) return () => undefined;
  const box: HTMLElement = found;
  let alive = true, timer = 0, save = 0;
  const hash = (): { id?: string; v?: string; sort?: string } => Object.fromEntries(location.hash.replace(/^#brand&?/, "").split("&").filter(Boolean).map((x) => x.split("=").map(decodeURIComponent) as [string, string]));
  const go = (q: string): void => { location.hash = `brand${q ? "&" + q : ""}`; };
  const err = (m: string, retry: () => void): void => { box.innerHTML = `<p class="br-err">${esc(m)} <button class="chip" id="br-retry">Retry</button></p>`; box.querySelector("#br-retry")?.addEventListener("click", retry); };
  const demoTag = (on: boolean): string => (on ? `<span class="br-demo" title="No Claude call: images use the reference templates filled with your kit">Demo: template only</span>` : "");
  const tabs = (p: Project, on: string): string => `<nav class="br-tabs">${demoTag(p.template_only)}<a href="#brand">All projects</a><b>${esc(p.name)}</b>${[["", "Gallery"], ["new", "Generate"], ["kit", "Kit"], ["export", "Export"]].map(([v, n]) => `<a class="${on === v ? "on" : ""}" href="#brand&id=${p.id}${v ? "&v=" + v : ""}">${n}</a>`).join("")}</nav>`;

  async function list(): Promise<void> {
    let ps: Project[];
    try { ps = await api<Project[]>("/api/brand"); } catch (e) { return err((e as Error).message, () => void route()); }
    const by = hash().sort === "name" ? [...ps].sort((a, b) => a.name.localeCompare(b.name)) : ps;
    const sel = by[0];
    const rows = by.map((p) => `<a class="br-row" href="#brand&id=${p.id}${p.kit.logo.primary || p.kit.logo.mark ? "" : "&v=kit"}" data-p="${p.id}">${swatches(p.kit)}<span class="br-nm"><b>${esc(p.name)}</b><small>${p.assets} images · edited ${ago(p.updated)}</small></span>${p.kit.logo.primary || p.kit.logo.mark ? `<img class="br-lg" alt="" src="${logoUrl(p, p.kit.logo.mark ?? p.kit.logo.primary)}">` : ""}</a>`).join("");
    const form = `<form class="br-new" id="br-new"><input name="name" maxlength="60" placeholder="Project name" aria-label="Project name" required><input name="url" placeholder="Site URL (optional, fills the name)" aria-label="Site URL"><button class="btn2 pri" type="submit">New project</button></form>`;
    box.innerHTML = `<div class="br-bar">${demoTag(!!ps[0]?.template_only)}<span class="br-sort">Sort <a class="${hash().sort ? "" : "on"}" href="#brand">recent</a> <a class="${hash().sort ? "on" : ""}" href="#brand&sort=name">name</a></span></div>${form}
      <div class="br-split"><div class="br-list">${rows || `<p class="empty">No brand projects yet. Name one above, add logo and colors, then generate images.</p>`}</div><aside class="br-side">${sel?.last_asset ? `<img alt="" src="/api/brand/${sel.id}/assets/${sel.last_asset}.png">` : ""}</aside></div>`;
    box.querySelector<HTMLFormElement>("#br-new")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = new FormData(ev.currentTarget as HTMLFormElement);
      let name = String(f.get("name")).trim();
      try { if (!name && f.get("url")) name = new URL(String(f.get("url"))).hostname.replace(/^www\./, ""); } catch { /* not a URL */ }
      try { const p = await api<Project>("/api/brand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); go(`id=${p.id}&v=kit`); } catch (e) { alert((e as Error).message); }
    });
  }

  async function kit(p: Project): Promise<void> {
    const k = structuredClone(p.kit);
    const prev = (): string => `<div class="br-prevbox"><div class="br-prev" style="background:${esc(k.colors.bg)};color:${esc(k.colors.ink)};font-family:'${esc(k.fonts.body.family)}',sans-serif">
      ${k.logo.mark ?? k.logo.primary ? `<img alt="" src="${logoUrl(p, k.logo.mark ?? k.logo.primary)}" style="height:64px;position:absolute;left:72px;top:72px">` : ""}
      <div style="position:absolute;left:72px;bottom:72px;right:72px"><div style="width:120px;height:6px;background:${esc(k.colors.accent)};margin-bottom:28px"></div><div style="font:700 104px/1.02 '${esc(k.fonts.display.family)}',sans-serif;letter-spacing:-.02em">Your headline here</div><div style="font-size:32px;margin-top:24px;color:${esc(k.colors.muted)}">${esc(k.voice.samples[0] ?? "A short supporting line")}</div></div></div></div>`;
    const colorRow = (r: (typeof ROLES)[number]): string => {
      const v = k.colors[r] ?? "#000000";
      const ratio = contrast(v, k.colors.bg), g = r === "bg" ? "" : grade(ratio);
      return `<label class="br-col"><span>${r}</span><input type="color" data-c="${r}" value="${esc(v)}" aria-label="${r} color"><input data-ch="${r}" value="${esc(k.colors[r] ?? "")}" maxlength="7" aria-label="${r} hex"><em class="br-g ${g === "fails" ? "red" : ""}">${g ? `${ratio.toFixed(1)}:1 ${g}` : ""}</em></label>`;
    };
    const up = (kind: string, label: string, cur?: string): string => `<label class="br-up"><span>${label}${cur ? " · set" : ""}</span><input type="file" data-up="${kind}" accept="${kind.startsWith("font") ? ".woff2" : "image/*"}" aria-label="${label}"></label>`;
    const fontSel = (r: "display" | "body"): string => `<label><span>${r}</span><input data-f="${r}" list="br-fonts" value="${esc(k.fonts[r].family)}" autocomplete="off" placeholder="Search fonts"></label>`;
    box.innerHTML = `${tabs(p, "kit")}<div class="br-kit"><div class="br-form">
      <details open><summary>Logo</summary>${up("logo-primary", "Primary", k.logo.primary)}${up("logo-mark", "Mark (square)", k.logo.mark)}${up("logo-mono", "Mono / negative", k.logo.mono)}<p class="hint">SVG or PNG, max 1 MB. Without a mark the primary logo is used.</p></details>
      <details open><summary>Colors</summary>${ROLES.map(colorRow).join("")}<p class="hint">Text may only use colors marked “AA text”.</p></details>
      <details><summary>Fonts</summary><datalist id="br-fonts">${FONTS.map((f) => `<option value="${esc(f)}">`).join("")}</datalist>${fontSel("display")}${fontSel("body")}${up("font-display", "Display WOFF2", k.fonts.display.file)}${up("font-body", "Body WOFF2", k.fonts.body.file)}</details>
      <details><summary>Voice</summary><div class="br-tags">${TAGS.map((t) => `<button class="chip${k.voice.tags.includes(t) ? " on" : ""}" data-tag="${t}">${t}</button>`).join("")}</div>
        <label><span>Never say (one per line)</span><textarea data-v="never" rows="3">${esc(k.voice.never.join("\n"))}</textarea></label><label><span>Sample sentences (1–3 lines)</span><textarea data-v="samples" rows="3">${esc(k.voice.samples.join("\n"))}</textarea></label></details>
      <details><summary>Examples</summary>${up("example", "Add reference image", k.examples.length ? "x" : undefined)}<p class="hint">${k.examples.length} of 6 stored.</p></details>
      <p class="br-saved" id="br-saved">Saved</p></div><aside class="br-prevcol"><div class="lbl">Preview</div><div id="br-pv">${prev()}</div></aside></div>`;
    const saved = box.querySelector<HTMLElement>("#br-saved")!;
    const push = (): void => { clearTimeout(save); saved.textContent = "Saving…"; save = window.setTimeout(async () => {
      try { await api(`/api/brand/${p.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kit: k }) }); saved.textContent = "Saved"; } catch (e) { saved.textContent = (e as Error).message; }
    }, 800); box.querySelector("#br-pv")!.innerHTML = prev(); };
    box.oninput = (ev) => {
      const t = ev.target as HTMLInputElement;
      if (t.dataset.c) { k.colors[t.dataset.c as (typeof ROLES)[number]] = t.value; (box.querySelector<HTMLInputElement>(`[data-ch="${t.dataset.c}"]`)!).value = t.value; push(); }
      else if (t.dataset.ch && /^#[0-9a-f]{6}$/.test(t.value)) { k.colors[t.dataset.ch as (typeof ROLES)[number]] = t.value; push(); }
      else if (t.dataset.v) { k.voice[t.dataset.v as "never" | "samples"] = t.value.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, t.dataset.v === "samples" ? 3 : 20); push(); }
    };
    box.onchange = async (ev) => {
      const t = ev.target as HTMLInputElement | HTMLSelectElement;
      if (t instanceof HTMLInputElement && t.dataset.f) { if (FONTS.includes(t.value)) { k.fonts[t.dataset.f as "display" | "body"] = { family: t.value }; push(); } else t.value = k.fonts[t.dataset.f as "display" | "body"].family; }
      if (t instanceof HTMLInputElement && t.dataset.up && t.files?.[0]) {
        const f = new FormData(); f.set("kind", t.dataset.up); f.set("file", t.files[0]);
        try { await api(`/api/brand/${p.id}/files`, { method: "POST", body: f }); await route(); } catch (e) { saved.textContent = (e as Error).message; }
      }
    };
    box.onclick = (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-tag]");
      if (!t) return;
      const n = t.dataset.tag!;
      k.voice.tags = k.voice.tags.includes(n) ? k.voice.tags.filter((x) => x !== n) : [...k.voice.tags, n].slice(0, 3);
      box.querySelectorAll<HTMLElement>("[data-tag]").forEach((b) => b.classList.toggle("on", k.voice.tags.includes(b.dataset.tag!)));
      push();
    };
  }

  const tile = (a: Asset, sel: boolean): string => `<figure class="br-tile${a.status === "failed" ? " fail" : ""}${sel ? " sel" : ""}" data-a="${a.id}">
    <div class="br-img" style="aspect-ratio:${a.w}/${a.h}">${a.png_url ? `<img alt="${esc(a.brief.headline)}" src="${a.png_url}">` : `<span class="br-st">${a.status === "failed" ? esc(a.error ?? "failed") : a.status === "queued" ? "Queued" : a.status === "designing" ? "Designing…" : "Rendering…"}</span>`}</div>
    <figcaption><span>${FORMATS[a.format].label} · v${a.id}${a.parent_id ? ` ← v${a.parent_id}` : ""}${a.kit_changed ? " · kit changed" : ""}</span><span class="br-act">
      <button class="chip${a.starred ? " on" : ""}" data-star="${a.id}" aria-pressed="${a.starred}">Star</button><button class="chip" data-vary="${a.id}">Vary</button>${a.png_url ? `<a class="chip" href="${a.png_url}" download>PNG</a>` : `<button class="chip" data-retry="${a.id}">Retry render</button>`}<button class="chip" data-del="${a.id}">Delete</button></span></figcaption></figure>`;

  async function gallery(p: Project, only?: number): Promise<void> {
    const h = hash();
    const fmt = (h as Record<string, string>).f ?? "", starred = (h as Record<string, string>).s === "1";
    let as: Asset[];
    try { as = await api<Asset[]>(`/api/brand/${p.id}/assets?${new URLSearchParams({ ...(fmt ? { format: fmt } : {}), ...(starred ? { starred: "1" } : {}) })}`); } catch (e) { return err((e as Error).message, () => void route()); }
    const gens = [...new Set(as.map((a) => a.gen))];
    const body = gens.map((g) => { const m = as.filter((a) => a.gen === g); return `<section class="br-gen"><h3>Generation ${g}<small>${esc(m[0].brief.headline)} · ${ago(m[0].created)}</small></h3><div class="br-grid">${m.map((a) => tile(a, a.id === only)).join("")}</div></section>`; }).join("");
    const filt = `<div class="br-filter">${["", ...Object.keys(FORMATS)].map((f) => `<a class="chip${fmt === f ? " on" : ""}" href="#brand&id=${p.id}${f ? "&f=" + f : ""}">${f ? FORMATS[f as BrandFormat].label : "All"}</a>`).join("")}<a class="chip${starred ? " on" : ""}" href="#brand&id=${p.id}&s=${starred ? 0 : 1}">Starred</a></div>`;
    box.innerHTML = `${tabs(p, "")}${filt}${body || `<p class="empty">No images yet. <a href="#brand&id=${p.id}&v=new">Generate the first ones.</a></p>`}<aside class="br-detail" id="br-detail" hidden></aside>`;
    if (as.some((a) => !["done", "failed"].includes(a.status))) timer = window.setTimeout(() => alive && void gallery(p, only), 1500);
  }

  async function detail(p: Project, id: number): Promise<void> {
    const d = box.querySelector<HTMLElement>("#br-detail")!;
    const a = await api<Detail>(`/api/brand/${p.id}/assets/${id}`);
    d.hidden = false;
    d.innerHTML = `<button class="chip" data-close>Close</button><h3>v${a.id}${a.parent_id ? ` ← v${a.parent_id}` : ""}</h3><p class="hint">${FORMATS[a.format].label} · ${a.w}×${a.h} · kit rev ${a.kit_rev}${a.kit_changed ? " (kit changed)" : ""} · ${ago(a.created)}</p>
      <div class="br-dimg">${a.png_url ? `<img alt="" src="${a.png_url}">` : ""}</div>
      <form id="br-edit"><label><span>Headline</span><input name="headline" value="${esc(a.brief.headline)}"></label><label><span>Sub</span><input name="sub" value="${esc(a.brief.sub ?? "")}"></label>${FORMATS[a.format].max.cta ? `<label><span>CTA</span><input name="cta" value="${esc(a.brief.cta ?? "")}"></label>` : ""}<button class="btn2" type="submit">Re-render text</button></form>
      <details><summary>HTML source</summary><pre>${esc(a.html ?? "")}</pre></details>`;
    d.querySelector("[data-close]")?.addEventListener("click", () => (d.hidden = true));
    d.querySelector<HTMLFormElement>("#br-edit")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      try { await api(`/api/brand/${p.id}/assets/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief: Object.fromEntries(new FormData(ev.currentTarget as HTMLFormElement)) }) }); await gallery(p, id); await detail(p, id); } catch (e) { alert((e as Error).message); }
    });
  }

  function generator(p: Project): void {
    let fmt: BrandFormat = "post", n = 3;
    const noKit = !p.kit.logo.primary && !p.kit.logo.mark;
    const draw = (): string => `${tabs(p, "new")}${noKit ? `<p class="br-err">Add logo and colors first. <a href="#brand&id=${p.id}&v=kit">Open the kit</a></p>` : ""}
      <div class="br-gen-top"><span class="br-seg">${(Object.keys(FORMATS) as BrandFormat[]).map((f) => `<button class="chip${f === fmt ? " on" : ""}" data-fmt="${f}">${FORMATS[f].label}</button>`).join("")}</span><span class="br-seg">${[1, 3, 6].map((c) => `<button class="chip${c === n ? " on" : ""}" data-n="${c}">${c}</button>`).join("")}</span></div>
      <form class="br-brief" id="br-brief"><label><span>What is this image for?</span><textarea name="note" rows="2"></textarea></label><label><span>Headline</span><input name="headline" required maxlength="${FORMATS[fmt].max.headline}"></label><label><span>Sub</span><input name="sub" maxlength="${FORMATS[fmt].max.sub}"></label>${FORMATS[fmt].max.cta ? `<label><span>CTA</span><input name="cta" maxlength="${FORMATS[fmt].max.cta}"></label>` : ""}
      <p class="hint">Limits for ${fmt}: headline ${FORMATS[fmt].max.headline}, sub ${FORMATS[fmt].max.sub}${FORMATS[fmt].max.cta ? `, CTA ${FORMATS[fmt].max.cta}` : ""} characters.</p><button class="btn2 pri" type="submit"${noKit ? " disabled" : ""}>Generate</button></form><div id="br-out"></div>`;
    const paint = (): void => { box.innerHTML = draw(); };
    paint();
    box.onclick = (ev) => {
      const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-fmt],[data-n]");
      if (!t) return;
      if (t.dataset.fmt) fmt = t.dataset.fmt as BrandFormat; else n = Number(t.dataset.n);
      paint();
    };
    box.onsubmit = async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target as HTMLFormElement));
      const out = box.querySelector<HTMLElement>("#br-out")!;
      try {
        const g = await api<{ gen: number; assets: Asset[] }>(`/api/brand/${p.id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: fmt, n, brief: f }) });
        const poll = async (): Promise<void> => {
          const as = await api<Asset[]>(`/api/brand/${p.id}/assets?gen=${g.gen}`);
          if (!alive) return;
          out.innerHTML = `<div class="br-grid">${as.map((a) => tile(a, false)).join("")}</div>`;
          if (as.some((a) => !["done", "failed"].includes(a.status))) timer = window.setTimeout(() => void poll(), 1500);
        };
        out.innerHTML = `<div class="br-grid">${g.assets.map((a) => tile(a, false)).join("")}</div>`;
        await poll();
      } catch (e) { out.innerHTML = `<p class="br-err">${esc((e as Error).message)}</p>`; }
    };
  }

  async function exporter(p: Project): Promise<void> {
    const as = (await api<Asset[]>(`/api/brand/${p.id}/assets`)).filter((a) => a.status === "done");
    box.innerHTML = `${tabs(p, "export")}<form class="br-brief" id="br-exp"><label><span>Which images</span><select name="which"><option value="starred">All starred</option><option value="all">All</option></select></label>
      <label class="br-ck"><input type="checkbox" name="html"> + HTML sources</label><label class="br-ck"><input type="checkbox" name="kit"> + kit.json</label><p class="hint" id="br-size"></p><a class="btn2 pri" id="br-dl" href="#">Download ZIP</a></form>`;
    const form = box.querySelector<HTMLFormElement>("#br-exp")!;
    const upd = (): void => {
      const f = new FormData(form), pick = as.filter((a) => f.get("which") === "all" || a.starred);
      box.querySelector("#br-size")!.textContent = `${pick.length} images · ~${Math.round(pick.reduce((s, a) => s + (a.bytes ?? 0), 0) / 1024)} KB`;
      box.querySelector<HTMLAnchorElement>("#br-dl")!.href = `/api/brand/${p.id}/export.zip?assets=${pick.map((a) => a.id).join(",") || "0"}${f.get("html") ? "&html=1" : ""}${f.get("kit") ? "&kit=1" : ""}`;
    };
    form.addEventListener("change", upd); upd();
  }

  async function route(): Promise<void> {
    clearTimeout(timer);
    box.oninput = box.onchange = box.onclick = box.onsubmit = null;
    const { id, v } = hash();
    if (!id) return list();
    let p: Project;
    try { p = await api<Project>(`/api/brand/${id}`); } catch (e) { return err((e as Error).message, () => void route()); }
    if (!alive) return;
    if (v === "kit") return kit(p);
    if (v === "new") return generator(p);
    if (v === "export") return exporter(p);
    await gallery(p);
  }

  const onClick = async (ev: MouseEvent): Promise<void> => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-star],[data-vary],[data-del],[data-retry],[data-a]");
    const id = hash().id;
    if (!t || !id) return;
    const aid = Number(t.dataset.star ?? t.dataset.vary ?? t.dataset.del ?? t.dataset.retry ?? t.dataset.a);
    const patch = (b: object): Promise<unknown> => api(`/api/brand/${id}/assets/${aid}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    try {
      if (t.dataset.star) { await patch({ starred: !t.classList.contains("on") }); await route(); }
      else if (t.dataset.retry) { await patch({ retry: true }); await route(); }
      else if (t.dataset.vary) {
        const a = await api<Detail>(`/api/brand/${id}/assets/${aid}`);
        await api(`/api/brand/${id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ format: a.format, n: 3, parent: aid, brief: { ...a.brief, note: window.prompt("Instruction for the variations (optional), e.g. more minimal", "") ?? "" } }) });
        await route();
      } else if (t.dataset.del) {
        if (t.textContent !== "Really delete?") { t.textContent = "Really delete?"; setTimeout(() => { if (t.isConnected) t.textContent = "Delete"; }, 4000); return; }
        await api(`/api/brand/${id}/assets/${aid}`, { method: "DELETE" }); await route();
      } else if (t.dataset.a && !(ev.target as HTMLElement).closest("button,a")) await detail((await api<Project>(`/api/brand/${id}`)), aid);
    } catch (e) { alert((e as Error).message); }
  };
  box.addEventListener("click", (e) => void onClick(e));
  void route();
  return () => { alive = false; clearTimeout(timer); clearTimeout(save); };
};
