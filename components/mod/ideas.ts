import { esc } from "@/lib/stage";
import type { Idea } from "@/lib/crew";

/* Ideas: rough idea -> team discussion (engine) -> one-click approval -> tasks. Self-contained: fetches /api/crew/ideas itself. */
export const ideasHTML = (): string => `<div class="screen page crideas"><div class="col"><div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Company · Crew</div><h1>Ideas<span>Rough idea in, tasks out</span></h1></div></div>
 <div id="ideas-root"><p class="empty">Loading…</p></div></div></div>`;

const card = (i: Idea): string => {
  const sy = i.synthesis;
  const head = `<div class="cri-hd"><b>#${i.id}</b><span class="cri-st cri-${i.status}">${i.status === "discussing" ? "team is discussing…" : i.status}</span><span>${i.tokens} tokens</span></div><p class="cri-text">${esc(i.text)}</p>`;
  if (i.status === "discussing") return `<article class="cri">${head}</article>`;
  if (i.status === "failed" || !sy) return `<article class="cri">${head}<p class="empty">The discussion failed. Try again.</p></article>`;
  const ops = i.opinions.map((o) => `<li><b>${esc(o.role)}</b> ${esc(o.text)}</li>`).join("");
  const qs = sy.questions.map((q, n) => `<label class="cri-q"><span>${esc(q.q)}</span><input data-ans="${n}" ${i.status === "approved" ? "disabled" : ""} value="${esc(q.recommended)}" aria-label="${esc(q.q)}"></label>`).join("");
  const ts = sy.tasks.map((t) => `<li><b>${esc(t.title)}</b> <span class="cri-sz">${t.size} · ~${Math.round(t.tokens / 1000)}k tokens</span><br>${esc(t.brief)}</li>`).join("");
  const act = i.status === "approved" ? `<p class="cri-done">Approved: tasks ${i.task_ids.map((t) => `<a href="#crew-tasks&id=${t}">#${t}</a>`).join(", ")}</p>`
    : `<button class="btn pri" data-idea-approve="${i.id}"${sy.tasks.length ? "" : " disabled"}>Approve and create ${sy.tasks.length} task(s)</button>`;
  return `<article class="cri">${head}<p>${esc(sy.summary)}</p>${qs ? `<h3>Open questions (recommended answer prefilled)</h3>${qs}` : ""}${ts ? `<h3>Proposed tasks</h3><ul>${ts}</ul>` : ""}<details><summary>Team opinions</summary><ul>${ops}</ul></details>${act}</article>`;
};

export const mountIdeas = (root: HTMLElement): (() => void) => {
  const box = root.querySelector<HTMLElement>("#ideas-root");
  if (!box) return () => undefined;
  let alive = true, timer = 0, busy = false;
  const load = async (): Promise<void> => {
    if (busy) return;
    const r = await fetch("/api/crew/ideas", { cache: "no-store" }).catch(() => null);
    if (!alive) return;
    if (!r?.ok) { box.innerHTML = `<p class="empty">Crew is not available.</p>`; return; }
    const list = (await r.json()) as Idea[];
    box.innerHTML = `<form class="cri-form" data-idea-form><textarea name="text" rows="3" maxlength="4000" placeholder="Describe a rough idea…" aria-label="Idea"></textarea><button class="btn pri">Discuss with the team</button></form>${list.map(card).join("") || `<p class="empty">No ideas yet.</p>`}`;
    window.clearTimeout(timer);
    if (list.some((i) => i.status === "discussing")) timer = window.setTimeout(() => void load(), 4000);
  };
  const post = async (path: string, body: unknown): Promise<void> => {
    busy = true;
    await fetch(`/api/crew/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    busy = false;
    await load();
  };
  const onSubmit = (e: Event): void => {
    const f = (e.target as Element).closest<HTMLFormElement>("[data-idea-form]");
    if (!f) return;
    e.preventDefault();
    const text = (f.elements.namedItem("text") as HTMLTextAreaElement).value.trim();
    if (text) void post("ideas", { text });
  };
  const onClick = (e: Event): void => {
    const b = (e.target as Element).closest<HTMLElement>("[data-idea-approve]");
    if (!b) return;
    const answers = [...(b.closest(".cri")?.querySelectorAll<HTMLInputElement>("[data-ans]") ?? [])].map((x) => x.value);
    b.setAttribute("disabled", "");
    void post(`ideas/${b.dataset.ideaApprove}/approve`, { answers });
  };
  box.addEventListener("submit", onSubmit);
  box.addEventListener("click", onClick);
  void load();
  return () => { alive = false; window.clearTimeout(timer); box.removeEventListener("submit", onSubmit); box.removeEventListener("click", onClick); };
};
