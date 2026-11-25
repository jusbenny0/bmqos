"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushQueue, type Job } from "@/lib/tedqueue";
import type { Ted as Data, TedProject, TedWait } from "@/lib/ted";

const KEY = "ted-cache", SNZ = "ted-snooze", QUE = "ted-queue";
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(localStorage.getItem(k) ?? "") as T; } catch { return d; } };
const save = (k: string, v: unknown) => localStorage.setItem(k, JSON.stringify(v));
const hm = (t: number) => new Date(t).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" });
const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 6e4));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
const nextMorning = () => { const d = new Date(); d.setHours(8, 0, 0, 0); if (d.getTime() < Date.now() + 36e5) d.setDate(d.getDate() + 1); return d.getTime(); };
const I = ({ d }: { d: string }) => <svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>;
/* status sentence from the hub: strip the leading "11/18 CTO:", keep just the part before " · " */
const sentence = (s: string) => { const i = s.indexOf(": "); return (i > 0 && i < 45 ? s.slice(i + 2) : s).split(" · ")[0]; };
const OUT = "M7 17L17 7M9 7h8v8";

type Snz = Record<string, { until: number; label: string }>;
type Mode = "ok" | "offline" | "error";

export function Ted() {
  const [d, setD] = useState<Data | null>(null);
  const [at, setAt] = useState(0);
  const [mode, setMode] = useState<Mode>("ok");
  const [spin, setSpin] = useState(false);
  const [snz, setSnz] = useState<Snz>({});
  const [open, setOpen] = useState("");
  const [gone, setGone] = useState<string[]>([]);
  const [bad, setBad] = useState<Record<string, string>>({});
  const [, tick] = useState(0);
  const busy = useRef(false);

  const fetchNow = useCallback(async () => {
    setSpin(true);
    try {
      const r = await fetch("/api/ted", { cache: "no-store" });
      if (r.status === 401) { location.href = "/login"; return; }
      if (!r.ok) throw new Error("ted");
      const j = (await r.json()) as Data;
      setD(j); setAt(Date.now()); setMode("ok"); save(KEY, { j, at: Date.now() });
    } catch {
      setMode(navigator.onLine ? "error" : "offline");
    } finally { setSpin(false); }
  }, []);

  const answer = useCallback(async (job: Job): Promise<boolean> => {
    const r = await fetch(`/api/cards/${job.id.replace("card:", "")}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ choice: Number(job.value) }) }).catch(() => null);
    if (r?.ok || r?.status === 409) return true;
    const j = (r ? await r.json().catch(() => ({})) : {}) as { need?: string };
    setBad((b) => ({ ...b, [job.id]: j.need ? "This needs a verification code, open it in BMQOS." : "Couldn't send, try again." }));
    setGone((g) => g.filter((x) => x !== job.id));
    return false;
  }, []);

  const flush = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    const q = load<Job[]>(QUE, []);
    await flushQueue(q, answer, () => navigator.onLine, (id) => save(QUE, load<Job[]>(QUE, []).filter((x) => x.id !== id)));
    busy.current = false;
    if (q.length) void fetchNow();
  }, [answer, fetchNow]);

  useEffect(() => {
    const c = load<{ j: Data; at: number } | null>(KEY, null);
    if (c) { setD(c.j); setAt(c.at); }
    setSnz(load<Snz>(SNZ, {}));
    void fetchNow().then(flush);
    const on = () => { setMode("ok"); void flush().then(fetchNow); }, off = () => setMode("offline");
    const vis = () => { if (!document.hidden) void fetchNow(); };
    addEventListener("online", on); addEventListener("offline", off); document.addEventListener("visibilitychange", vis);
    const t = setInterval(() => { tick((n) => n + 1); if (!document.hidden) void fetchNow(); }, 6e4);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); document.removeEventListener("visibilitychange", vis); clearInterval(t); };
  }, [fetchNow, flush]);

  const decide = (w: TedWait, a: { id: string; label: string }) => {
    setBad((b) => ({ ...b, [w.id]: "" }));
    setGone((g) => [...g, w.id]);
    const job = { id: w.id, value: a.id, label: a.label };
    if (!navigator.onLine) { save(QUE, [...load<Job[]>(QUE, []), job]); return; }
    void answer(job).then((ok) => { if (ok) setTimeout(fetchNow, 300); });
  };
  const park = (w: TedWait, until: number, label: string) => {
    const n = { ...snz, [w.id]: { until, label } };
    setSnz(n); save(SNZ, n); setOpen("");
  };
  const unpark = (id: string) => { const n = { ...snz }; delete n[id]; setSnz(n); save(SNZ, n); };

  const now = Date.now();
  const queued = load<Job[]>(QUE, []).map((j) => j.id);
  const waiting = (d?.waiting ?? []).filter((w) => !gone.includes(w.id) && !queued.includes(w.id));
  const shown = waiting.filter((w) => !(snz[w.id] && snz[w.id].until > now));
  const parked = waiting.filter((w) => snz[w.id] && snz[w.id].until > now);
  const waitProj = new Set((d?.waiting ?? []).map((w) => w.project));
  const projs = [...(d?.projects ?? [])].sort((a, b) => Number(waitProj.has(b.name)) - Number(waitProj.has(a.name)) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  const more = Math.max(0, (d?.waitingTotal ?? 0) - (d?.waiting.length ?? 0));
  const empty = d && !projs.some((p) => p.open || p.stav) && !shown.length;
  const dot = mode !== "ok" ? "a" : "";
  const sync = !d ? "loading" : mode === "offline" ? `offline · as of ${hm(at)}` : ago(new Date(at).toISOString());

  return (
    <div className="tedpwa"><div className="tapp">
      <header className="ttop">
        <h1>Now</h1>
        <div className="sync"><span className={`dot ${dot} ${mode === "ok" && d ? "pl" : ""}`} /><span>{sync}</span></div>
        <button className={`refresh ${spin ? "spin" : ""}`} aria-label="Refresh" onClick={() => void fetchNow()}><I d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5" /></button>
      </header>
      {mode === "offline" && <div className="off" style={{ display: "flex" }} role="status"><I d="M3 3l18 18M8.5 8.8A9 9 0 0 0 3 11M16 11.5A5 5 0 0 0 12.7 10M12 19h.01M5.5 14.5A9 9 0 0 1 9 12.4" /><div><b>You're offline.</b> Showing the last state from {hm(at)}. Yes / No will send once you're back online.</div></div>}
      {mode === "error" && <div className="off err" style={{ display: "flex" }} role="status"><div><b>Couldn't load.</b> Showing the last state. <button className="btn txt" onClick={() => void fetchNow()}>Try again</button></div></div>}
      {!d && <div className="sk" style={{ display: "block" }}><i style={{ height: 20, width: 120 }} /><i style={{ height: 116 }} /><i style={{ height: 20, width: 90, marginTop: 26 }} /><i style={{ height: 150 }} /><i style={{ height: 150 }} /></div>}
      {d && empty && <div className="empty"><strong>Nothing running.</strong>No project has an open task. Once agents start something, you'll see it here.</div>}
      {d && !empty && (
        <div className="cols real">
          <main>
            {shown.length > 0 ? <h2>Needs you <span className="n">{shown.length + more}</span></h2> : <div className="done"><I d="M5 12.5l4.5 4.5L19 7.5" />Nothing is waiting for you. Agents are working on their own.</div>}
            <div className="wait">
              {shown.map((w) => (
                <article className={`w ${gone.includes(w.id) ? "gone" : ""}`} key={w.id}>
                  <div className="t">{w.text}</div>
                  <div className="m"><b>{w.project}</b>{w.q ? ` · ${w.q}` : ""} · {ago(w.at)}</div>
                  {bad[w.id] && <div className="m" style={{ color: "var(--red)" }}>{bad[w.id]}</div>}
                  <div className="acts">
                    {w.actions.map((a, i) => <button key={a.id} className={`btn ${i === 0 ? "pri" : ""}`} onClick={() => decide(w, a)}>{a.label}</button>)}
                    {w.href && <a className="btn txt" href={w.href} target="_blank" rel="noopener noreferrer">Open</a>}
                    <button className="btn ic" aria-label="Snooze" onClick={() => setOpen(open === w.id ? "" : w.id)}><I d="M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9v4l2.5 2M5 4l-2 2M19 4l2 2" /></button>
                  </div>
                  <div className={`snz ${open === w.id ? "on" : ""}`}>
                    <button onClick={() => park(w, Date.now() + 36e5, `in an hour (${hm(Date.now() + 36e5)})`)}>In an hour <span>{hm(Date.now() + 36e5)}</span></button>
                    <button onClick={() => park(w, nextMorning(), `${new Date(nextMorning()).getDate() === new Date().getDate() ? "today" : "tomorrow"} (8:00)`)}>Tomorrow morning <span>8:00</span></button>
                  </div>
                </article>
              ))}
              {parked.map((w) => (
                <div className="sn" key={w.id}><I d="M12 5a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 9v4l2.5 2" />Snoozed {snz[w.id].label}<button onClick={() => unpark(w.id)}>Unsnooze</button></div>
              ))}
            </div>
            {more > 0 && <a className="btn txt" href="/#waiting">{more} more in BMQOS</a>}
            <h2>Running</h2>
            <div className="proj">
              {projs.map((p) => <Proj key={p.name} p={p} wait={waitProj.has(p.name)} />)}
            </div>
          </main>
          <aside><h2>Previews</h2><div className="prev">
            {d.previews.map((v) => (
              <a className="pv" key={v.url} href={v.url} target="_blank" rel="noopener noreferrer"><b>{v.name} <I d={OUT} /></b><span>{new URL(v.url).host}</span></a>
            ))}
          </div></aside>
        </div>
      )}
    </div></div>
  );
}

function Proj({ p, wait }: { p: TedProject; wait: boolean }) {
  const total = p.open + p.done, run = p.running.length > 0;
  const seg = Math.min(total, 14), doneSeg = total ? Math.round((p.done / total) * seg) : 0;
  const state = run ? "pl" : wait ? "a" : "g";
  return (
    <a className="p" href="/#projects">
      <div className="h"><span className={`dot ${state}`} /><strong>{p.name}</strong><span className="ago">{ago(p.updatedAt)}</span></div>
      <div className="s">{sentence(p.stav) || (run ? "Agents are working." : "Nothing running.")}</div>
      {run && <div className="who">{p.running.join(" · ")}</div>}
      {total > 0 && (
        <div className="pr">
          <div className="bar">{Array.from({ length: seg }, (_, i) => <i key={i} className={i < doneSeg ? "d" : i === doneSeg && run ? "c" : ""} />)}</div>
          <div className="l"><span><b>{p.done}</b> of {total} done</span><span>{p.open ? `${p.open} left` : "all done"}</span></div>
        </div>
      )}
    </a>
  );
}
