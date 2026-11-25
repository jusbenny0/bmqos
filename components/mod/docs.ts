import { esc } from "@/lib/stage";
import { md } from "@/lib/md";
import type { DocRow, Hit } from "@/lib/docs";

export interface DocFull { id: string; title: string; body: string; editable: boolean; versions: { at: string }[] }
export interface DocsData { list: DocRow[]; hits: Hit[] | null; doc: DocFull | null; old: { at: string; body: string } | null; writeOn: boolean }

const when = (t: number): string => new Date(t).toLocaleDateString("en-US", { day: "numeric", month: "numeric" });
const href = (o: { doc?: string; q?: string; src?: string; edit?: boolean; hist?: boolean; at?: string }): string =>
  "#docs" + Object.entries(o).filter(([, v]) => v).map(([k, v]) => `&${k}=${v === true ? "1" : encodeURIComponent(String(v))}`).join("");

export const docsHTML = (d: DocsData | null, q: Record<string, string>, compact: boolean): string => {
  const head = '<div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Docs · everything in one place</div><h1>What&apos;s where</h1></div></div>';
  if (!d) return `<div class="screen page">${head}<div class="hint" style="padding:20px 28px">Loading docs…</div></div>`;
  const srcs = [...new Set(d.list.map((x) => x.src))].sort();
  const rows: DocRow[] = d.hits ?? (q.src ? d.list.filter((x) => x.src === q.src) : d.list);
  const chips = `<div class="chips"><a class="chip2 ${q.src ? "" : "on"}" href="${href({ q: q.q })}">All</a>${srcs.map((s) => `<a class="chip2 ${q.src === s ? "on" : ""}" href="${href({ src: s })}">${esc(s)}</a>`).join("")}</div>`;
  const li = (r: DocRow & { snippet?: string }) => `<a class="drow ${d.doc?.id === r.id ? "on" : ""}" href="${href({ doc: r.id, q: q.q, src: q.src })}"><b>${esc(r.title)}</b><span class="mono">${esc(r.src)} · ${esc(r.path)} · ${when(r.mtime)}</span>${r.snippet ? `<i>${r.snippet.split(/([«»])/).map((p) => (p === "«" ? "<mark>" : p === "»" ? "</mark>" : esc(p))).join("")}</i>` : ""}</a>`;
  const list = `<aside class="dlist"><form class="dsearch" data-dsearch><input name="q" value="${esc(q.q ?? "")}" placeholder="Search all documents" aria-label="Search documents" autocomplete="off"></form>${chips}<div class="dcount mono">${rows.length}${d.hits ? " found" : " documents"}</div>${rows.slice(0, 200).map(li).join("") || '<div class="hint" style="padding:20px">Nothing found. Try a shorter word, diacritics don\'t matter.</div>'}</aside>`;
  const doc = d.doc;
  let view = '<div class="hint" style="padding:28px">Pick a document on the left.</div>';
  if (doc) {
    const tools = [d.writeOn && doc.editable ? `<a class="btn2" href="${href({ doc: doc.id, edit: !q.edit, q: q.q, src: q.src })}">${q.edit ? "Close edit" : "Edit"}</a>` : "", doc.versions.length ? `<a class="btn2" href="${href({ doc: doc.id, hist: !q.hist, q: q.q, src: q.src })}">History (${doc.versions.length})</a>` : ""].join("");
    const body = q.edit && d.writeOn && doc.editable
      ? `<textarea class="dedit" data-dbody aria-label="Document text">${esc(doc.body)}</textarea><button class="btn2 pri" data-dsave="${esc(doc.id)}">Save (previous version stays in history)</button>`
      : `<div class="md">${md(doc.body)}</div>`;
    const hist = q.hist ? `<div class="vers"><div class="lbl">Earlier versions</div>${doc.versions.map((v) => `<a class="mono ${d.old?.at === v.at ? "on" : ""}" href="${href({ doc: doc.id, hist: true, at: v.at })}">${esc(v.at.slice(0, 16).replace("T", " "))}</a>`).join("")}${d.old ? `<div class="md old">${md(d.old.body)}</div>` : ""}</div>` : "";
    view = `<article class="ddoc">${compact ? `<a class="mono back" href="${href({ q: q.q, src: q.src })}">← List</a>` : ""}<h2>${esc(doc.title)}</h2><div class="mono">${esc(doc.id)}</div><div class="dtools">${tools}</div>${body}${hist}</article>`;
  }
  return `<div class="screen page docs ${doc && compact ? "one" : ""}">${head}<div class="split">${compact && doc ? "" : list}${compact && !doc ? "" : `<section class="ddet">${view}</section>`}</div></div>`;
};
