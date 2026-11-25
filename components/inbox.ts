import { esc } from "@/lib/stage";
import { inline, md } from "@/lib/md";
import type { Attach, Card, Question } from "@/lib/inbox";
import { linkIssues, splitActions, type Action, type Do } from "@/lib/chatparse";

export interface Appr { run: string; title: string; state?: "once" | "deny" }
export interface ChatMsg { role: string; text: string; src?: string; images?: number; approvals?: Appr[]; err?: string; ask?: string }

const DOLBL: Record<Do, string> = { open: "Open", answer: "Reply to", approve: "Approve", reject: "Send back to work", create: "Create task", comment: "Comment on", update: "Update" };
const PRIO: Record<string, string> = { critical: "critical", high: "high", medium: "medium", low: "low" };
const actCard = (a: Action, key: string, st: string): string => {
  if (a.do === "create") return draftCard(a, key, st);
  const head = `${DOLBL[a.do]} ${a.id}`;
  const meta = a.do === "update" ? [a.agent && `To: ${a.agent}`, a.priority && `Priority: ${PRIO[a.priority] ?? a.priority}`, a.title && `Title: ${a.title}`].filter(Boolean).join(" · ") : "";
  const body = (meta ? `<span class="mono">${esc(meta)}</span>` : "") + (a.text ? `<div class="at">${esc(a.text)}</div>` : "");
  const btn = st === "ok" ? '<span class="mono ok">✓ done</span>'
    : `<div class="row"><button class="btn p" data-bact="${esc(key)}"${st === "busy" ? " disabled" : ""}>${st === "busy" ? "Running…" : "Run"}</button></div>${st === "err" ? '<span class="mono er">failed (unknown agent or write error)</span>' : ""}`;
  return `<div class="bact" data-do="${a.do}"><span class="mono">Assistant suggests</span><b>${esc(head)}</b>${body}${btn}</div>`;
};
/* task-draft card (design-spec-chat 4.3): draft / sending / sent / error */
const PDOT: Record<string, string> = { critical: "red", high: "amber", medium: "mute", low: "dim" };
const draftCard = (a: Action, key: string, st: string): string => {
  const ok = st.startsWith("ok"), id = st.slice(3), busy = st === "busy", bad = st === "err";
  const title = esc((a.title ?? "Untitled").slice(0, 120));
  const pr = a.priority ?? "medium";
  const stat = ok ? '<span class="dst ok">✓ Sent</span>' : busy ? '<span class="dst">Sending…</span>' : bad ? '<span class="dst er">● Failed</span>' : '<span class="dst wait">● Waiting on you</span>';
  const tag = '<span class="dtag">Task draft</span>';
  if (ok) return `<div class="bact draft ok" data-do="create"><div class="dh">${tag}${stat}</div><b class="dt sent">${title}</b><div class="dsent">Created${id ? ` as <a class="iss" href="#waiting&issue=${esc(id)}" data-issue="${esc(id)}">${esc(id)}</a>` : ""} · ${esc(a.agent ?? "CTO")} · ${esc(a.project || "No project")}</div></div>`;
  const meta = `<div class="dm"><span><i>Agent</i><b>${esc(a.agent ?? "CTO")}</b></span><span><i>Project</i><b>${esc(a.project || "No project")}</b></span><span><i>Priority</i><b><u class="pd ${PDOT[pr] ?? "mute"}"></u>${esc(PRIO[pr] ?? pr)}</b></span></div>`;
  const btns = `<div class="row"><button class="btn p" data-bact="${esc(key)}"${busy ? " disabled" : ""}>${busy ? "Sending…" : bad ? "Retry" : "Send"}</button>${busy ? "" : `<button class="btn" data-bedit="${esc(key)}">Edit</button>`}</div>`;
  return `<div class="bact draft${busy ? " run" : ""}${bad ? " bad" : ""}" data-do="create"><div class="dh">${tag}${stat}</div><b class="dt">${title}</b>${meta}${a.text ? `<div class="at clip">${esc(a.text)}</div>` : ""}${bad ? '<span class="er">Paperclip didn\'t respond. Nothing was created.</span>' : ""}${btns}</div>`;
};
export const apprCard = (p: Appr): string =>
  `<div class="bact appr"><span class="mono">Assistant wants permission</span><b>${esc(p.title)}</b>${p.state ? `<span class="mono ${p.state === "once" ? "ok" : "er"}">${p.state === "once" ? "✓ allowed once" : "denied"}</span>` : `<span class="row"><button class="btn p" data-appr="${esc(p.run)}" data-choice="once">Allow once</button><button class="btn ghost" data-appr="${esc(p.run)}" data-choice="deny">Deny</button></span>`}</div>`;

/* one chat bubble; the assistant's text goes through md, bmqos blocks turn into cards, ABC-123 into links; the owner's text stays plain */
export const bubble = (m: ChatMsg, i = 0, acts: Record<string, string> = {}): string => {
  const me = m.role === "user";
  const who = me ? "you" : m.src === "discord" ? "Assistant · Discord" : "Assistant";
  const inner = me
    ? `<p>${esc(m.text)}</p>${m.images ? `<span class="mono">+ ${m.images} img.</span>` : ""}`
    : splitActions(m.text).map((s) => (s.t === "text" ? linkIssues(md(s.v)) : actCard(s.a, `${i}:${s.n}`, acts[`${i}:${s.n}`] ?? ""))).join("") + (m.approvals ?? []).map(apprCard).join("")
      + (m.err ? `<div class="cerr" role="alert"><p>${esc(m.err)}</p>${m.ask ? `<button class="btn ghost" data-retry="${i}">Try again</button>` : ""}</div>` : "");
  return `<div class="cm ${me ? "me" : "he"}"><span class="mono">${who}</span><div class="bt md">${inner}</div><div class="evs"></div></div>`;
};
const STEPS = ["Waiting on you", "With {kdo}", "Assigned", "Done"];

const mediaOf = (a: Attach, playing: string): string => {
  const note = a.note ? `<div class="note">“${esc(a.note)}”</div>` : "";
  if (a.type === "video" && a.vid) {
    const thumb = playing === a.vid
      ? `<iframe src="https://www.youtube-nocookie.com/embed/${esc(a.vid)}?autoplay=1" title="${esc(a.title)}" allow="autoplay; encrypted-media" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`
      : `<button class="play" data-play="${esc(a.vid)}" aria-label="Play: ${esc(a.title)}"><img src="/api/thumb?v=${esc(a.vid)}" alt="" loading="lazy" onerror="this.remove()"><span>▶</span></button>`;
    return `<div class="vcard"><div class="vth">${thumb}</div><div class="vtx"><b>${esc(a.title)}</b><span class="mono">${esc(a.meta)}</span>${note}<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer" class="mono">YouTube ↗</a></div></div>`;
  }
  return `<a class="vcard lnk" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer"><div class="vtx"><b>${esc(a.title)}</b><span class="mono">${a.type === "image" ? "image" : "link"} ↗</span>${note}</div></a>`;
};

const optBtn = (c: Card, q: Question, o: Question["options"][number]): string =>
  `<button class="opt ${o.recommended ? "rec" : ""}" data-qa="${esc(q.id)}" data-qi="${esc(c.issue)}" data-v="${esc(`${o.key}) ${o.label}`)}"><span class="k">${esc(o.key)}</span><span><b>${esc(o.label)}</b>${o.consequence ? `<i>${inline(o.consequence)}</i>` : ""}</span>${o.recommended ? '<em class="mono">recommended</em>' : ""}</button>`;

const qHTML = (c: Card, q: Question, i: number, editing: string): string => {
  if (q.answer && editing !== q.id)
    return `<div class="q done"><div class="lbl">Question ${i + 1} of ${c.questions.length} <span class="tag l">${q.answer.sent ? "sent" : "draft saved"}</span></div><div class="md">${md(q.text)}</div><div class="ans">✓ ${esc(q.answer.value)} <button class="mono" data-qchange="${esc(q.id)}">Change</button></div></div>`;
  return `<div class="q" data-qid="${esc(q.id)}"><div class="lbl">Question ${i + 1} of ${c.questions.length} <span class="tag a">waiting</span></div><div class="md">${md(q.text)}</div>
 ${q.options.length ? `<div class="opts">${q.options.map((o) => optBtn(c, q, o)).join("")}</div>` : ""}
 <div class="free"><textarea rows="2" data-qfree="${esc(q.id)}" placeholder="${q.options.length ? "Or write your own answer…" : "Write an answer…"}" maxlength="2900"></textarea><button class="cta" data-qsend="${esc(q.id)}" data-qi="${esc(c.issue)}">Send</button></div></div>`;
};

export const cardHTML = (c: Card, playing: string, editing: string): string => {
  const o = c.original, n = c.questions.length, open = c.questions.filter((q) => !q.answer).length;
  const quote = o.messages.map((m) => `<blockquote><div class="md">${md(m.text)}</div><span class="mono">${esc([m.author, m.at, m.via].filter(Boolean).join(" · "))}</span></blockquote>`).join("");

  const atts = o.attachments.length ? `<div class="vids">${o.attachments.map((a) => mediaOf(a, playing)).join("")}</div>` : o.messages.length ? '<div class="hint">No attachment, just text.</div>' : "";
  const out = c.outcome;
  const result = `${out.lines.map((l) => `<div class="md ln">${md(l)}</div>`).join("")}${out.rows.length ? `<ul class="rows">${out.rows.map((r) => `<li><b>${esc(r[0])}</b><span>${esc(r[1])}</span></li>`).join("")}</ul>` : ""}
 ${out.media.length ? `<div class="imgs">${out.media.map((m) => `<a href="${esc(m[0])}" target="_blank" rel="noopener noreferrer"><img src="${esc(m[0])}" alt="${esc(m[1])}" loading="lazy" onerror="this.closest('a').remove()"></a>`).join("")}</div>` : ""}
 ${out.links.length ? `<div class="tiles">${out.links.map((l) => `<a class="tile" href="${esc(l[1])}" target="_blank" rel="noopener noreferrer">${esc(l[0])} ↗</a>`).join("")}</div>` : ""}`;
  const steps = STEPS.map((s, i) => `<li class="${i < c.next.stage ? "ok" : i === c.next.stage ? "now" : ""}">${esc(s.replace("{kdo}", c.next.owner))}</li>`).join("");
  return `<div class="card"><div class="lbl"><span>${esc(c.issue)}</span><span class="tag ${c.next.stage ? "l" : "a"}">${c.next.stage ? "handed off" : "waiting on you"}</span><span class="tag">${esc(c.kind)}</span></div>
 <h2>${esc(c.title)}</h2><div class="lead amber">${inline(c.lead)}</div>
 <nav class="parts"><a href="#" data-jump="p1">1 Brief</a><a href="#" data-jump="p2">2 Result</a><a href="#" data-jump="p3">3 Questions${open ? `<b>${open}</b>` : ""}</a><a href="#" data-jump="p4">4 What's next</a></nav>
 ${o.found ? `<section data-sec="p1"><div class="lbl">1 · What you sent / asked for <span class="tag l">your words, verbatim</span></div>${quote || '<div class="hint">The brief has no text.</div>'}${atts}</section>` : `<section data-sec="p1"><div class="lbl">1 · What this is about</div>${o.brief ? `<div class="md">${inline(o.brief)}</div>` : '<div class="hint">No description.</div>'}</section>`}
 <section data-sec="p2"><div class="lbl">2 · What the agents did with it</div>${result || '<div class="hint">No output yet.</div>'}</section>
 <section data-sec="p3"><div class="lbl">3 · What we're asking</div>${n ? c.questions.map((q, i) => qHTML(c, q, i, editing)).join("") : '<div class="hint">No question, just FYI.</div>'}</section>
 <section data-sec="p4"><div class="lbl">4 · What happens after you answer</div><div class="md ln">${inline(c.next.text)}</div><ol class="steps">${steps}</ol>${c.write ? "" : '<div class="hint">Writing to Paperclip is turned off: the answer is saved as a draft and won\'t be sent.</div>'}</section>
 ${n ? `<div class="qdock"><span class="mono">Answered ${n - open} of ${n}</span><span class="bars">${c.questions.map((q) => `<i class="${q.answer ? "on" : ""}"></i>`).join("")}</span></div>` : ""}
 </div>`;
};
