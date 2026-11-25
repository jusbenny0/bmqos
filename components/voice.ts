import { esc } from "@/lib/stage";

/* "Say it": hold the button, speak, release → /api/voice → editable preview. Sending only by tapping. */
interface Opt { agents: { id: string; name: string }[]; projects: { id: string; name: string }[] }
interface Draft { text: string; title: string; description: string; project: string; level: string }
export interface VoiceDeps {
  task: (body: { title: string; assigneeAgentId: string; projectId: string; priority: string; zadani: string }, done: () => void) => void;
  chat: (text: string) => void;
}
const MAX_MS = 120_000;
const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const bindVoice = (d: VoiceDeps): (() => void) => {
  let rec: MediaRecorder | null = null, t0 = 0, tick = 0, stop = 0, cancel = false;
  const host = document.createElement("div");
  host.className = "vo-host";
  document.body.appendChild(host);
  const show = (h: string): void => { host.innerHTML = h; };
  const bar = (msg: string, cls = ""): void => show(`<div class="vo-bar ${cls}" role="status"><i class="vo-dot"></i><span>${esc(msg)}</span></div>`);

  const preview = (v: Draft, o: Opt | null): void => {
    const cto = o?.agents.find((a) => /^cto$/i.test(a.name)) ?? o?.agents[0];
    const pr = o?.projects.find((p) => norm(p.name) === norm(v.project))?.id ?? o?.projects[0]?.id ?? "";
    show(`<div class="vo-back"><form class="vo-sheet" role="dialog" aria-modal="true" aria-label="Voice input preview">
<label>Transcript<textarea name="text" rows="3">${esc(v.text)}</textarea></label>
<label>Title<input name="title" maxlength="200" value="${esc(v.title)}"></label>
<label>Description<textarea name="description" rows="5">${esc(v.description)}</textarea></label>
<div class="vo-row"><label>Project<select name="project">${(o?.projects ?? []).map((p) => `<option value="${esc(p.id)}"${p.id === pr ? " selected" : ""}>${esc(p.name)}</option>`).join("")}</select></label>
<label>Level<select name="level">${["S", "M", "L"].map((l) => `<option${l === v.level ? " selected" : ""}>${l}</option>`).join("")}</select></label></div>
<div class="vo-act"><button type="button" class="btn ghost" data-vo="x">Discard</button><button type="button" class="btn ghost" data-vo="chat">Just tell the Assistant</button><button type="button" class="btn p" data-vo="send"${cto && pr ? "" : " disabled"}>Send to the company</button></div></form></div>`);
    const f = host.querySelector("form") as HTMLFormElement;
    const val = (n: string): string => (f.elements.namedItem(n) as HTMLInputElement).value;
    f.addEventListener("click", (e) => {
      const a = (e.target as HTMLElement).closest<HTMLElement>("[data-vo]")?.dataset.vo;
      if (a === "x") show("");
      else if (a === "chat" && val("text").trim()) { show(""); d.chat(val("text").trim()); }
      else if (a === "send" && cto && val("title").trim()) { (e.target as HTMLElement).closest("button")!.disabled = true; d.task({ title: val("title").trim(), assigneeAgentId: cto.id, projectId: val("project"), priority: "medium", zadani: `Level: ${val("level")}.\n\n${val("description").trim()}\n\n---\nVoice input (transcript): ${val("text").trim()}` }, () => show("")); }
    });
  };

  const upload = async (blob: Blob): Promise<void> => {
    bar("Transcribing…", "busy");
    const r = await fetch("/api/voice", { method: "POST", headers: { "Content-Type": blob.type || "audio/webm" }, body: blob }).catch(() => null);
    const j = (r ? await r.json().catch(() => ({})) : {}) as Draft & { error?: string };
    if (!r?.ok) { bar(j.error ?? "Transcription failed, try again", "err"); setTimeout(() => show(""), 2800); return; }
    const o = await fetch("/api/tasks", { cache: "no-store" }).then((x) => (x.ok ? (x.json() as Promise<Opt>) : null)).catch(() => null); // agents and projects for the preview
    preview(j, o && o.agents ? o : null);
  };

  const finish = (): void => { clearInterval(tick); clearTimeout(stop); if (rec && rec.state !== "inactive") rec.stop(); };
  const start = async (): Promise<void> => {
    if (rec) return;
    cancel = false;
    let st: MediaStream;
    try { st = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch { bar("Microphone not allowed", "err"); setTimeout(() => show(""), 2800); return; }
    if (cancel) { st.getTracks().forEach((x) => x.stop()); return; } // the finger lifted before the microphone was granted
    const chunks: Blob[] = [];
    const r = new MediaRecorder(st);
    rec = r; t0 = Date.now();
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = () => {
      st.getTracks().forEach((x) => x.stop());
      rec = null;
      if (Date.now() - t0 < 700) { bar("Hold the button and speak"); setTimeout(() => show(""), 1800); return; }
      void upload(new Blob(chunks, { type: r.mimeType }));
    };
    r.start();
    const paint = (): void => { const s = Math.floor((Date.now() - t0) / 1000); bar(`Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} · release to send`, "rec"); };
    paint(); tick = window.setInterval(paint, 500); stop = window.setTimeout(finish, MAX_MS);
  };

  const down = (e: PointerEvent): void => { if ((e.target as HTMLElement).closest("[data-rec]")) { e.preventDefault(); void start(); } };
  const up = (): void => { cancel = true; finish(); };
  const ctx = (e: Event): void => { if ((e.target as HTMLElement).closest?.("[data-rec]")) e.preventDefault(); };
  document.addEventListener("pointerdown", down); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up); document.addEventListener("contextmenu", ctx);
  return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); document.removeEventListener("contextmenu", ctx); finish(); host.remove(); };
};
