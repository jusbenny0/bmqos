import { esc } from "./stage";

/* Safe minimal markdown for text from Paperclip: everything escaped, no HTML from source.
   Links /<PREFIX>/issues/X point to a card in BMQOS, others only http(s); other schemes are dropped. */
const link = (t: string, u: string): string => {
  const url = u.replace(/&amp;/g, "&");
  const i = /^(?:https?:\/\/[^/\s]+)?\/[A-Za-z0-9_-]+\/issues\/([A-Z]{2,6}-\d{1,6})(?:[/?#].*)?$/.exec(url);
  if (i) return `<a href="#waiting&amp;issue=${i[1]}">${t}</a>`;
  return /^https?:\/\//.test(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${t}</a>` : t;
};
/* [[id]] or [[id|label]]: internal link to a Brain node (Crew). src already went through esc(), text is safe. */
const wiki = (id: string, label?: string): string => `<a href="#crew-brain&amp;node=${id}" class="wiki">${label ?? id}</a>`;

export const inline = (src: string): string => esc(src)
  .replace(/!\[([^\]]*)\]\([^)]*\)/g, '<span class="mono">[image: $1]</span>')
  .replace(/`([^`]+)`/g, "<code>$1</code>")
  .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, id: string, label?: string) => wiki(id, label))
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, t: string, u: string) => link(t, u))
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a: string, b: string) => `<strong>${a ?? b}</strong>`)
  .replace(/(^|[\s(])\*([^*\s][^*]*)\*(?=[\s).,;:]|$)/g, "$1<em>$2</em>");

export const md = (src: string): string => {
  let code = false, list = "";
  const close = (): string => { const c = list ? `</${list}>` : ""; list = ""; return c; };
  const out = src.split("\n").map((l) => {
    if (l.startsWith("```")) { code = !code; return code ? `${close()}<pre>` : "</pre>"; }
    if (code) return `${esc(l)}\n`;
    const li = /^\s*(?:([-*+])|\d+[.)])\s+(.*)/.exec(l);
    if (li) { const k = li[1] ? "ul" : "ol"; const o = list === k ? "" : close() + `<${k}>`; list = k; return `${o}<li>${inline(li[2])}</li>`; }
    const h = /^(#{1,4})\s+(.*)/.exec(l);
    if (h) return `${close()}<h${h[1].length + 2}>${inline(h[2])}</h${h[1].length + 2}>`;
    const q = /^>\s?(.*)/.exec(l);
    if (q) return `${close()}<p class="qt">${inline(q[1])}</p>`;
    return l.trim() ? `${close()}<p>${inline(l)}</p>` : close();
  }).join("");
  return out + (code ? "</pre>" : "") + close();
};
