"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Act, Hit, Kind } from "@/lib/search";
import "./cmdk.css";

const LBL: Record<Kind, string> = { section: "Section", act: "Action", task: "Tasks", agent: "Agents", project: "Projects", service: "Services", pr: "Pull requests" };
interface Rec { t: string; s: string; h?: string; ext?: string }
const recent = (): Rec[] => { try { return JSON.parse(localStorage.getItem("bmq:recent") ?? "[]") as Rec[]; } catch { return []; } };
const HINT = ["pause Engineer 2", "new task …", "ask assistant …", "redeploy website", "restart paperclip"];

/* ⌘K / Ctrl+K / button on mobile. Searches via /api/search; actions only call module APIs (proposal, confirmation, audit are handled there). */
export function CmdK({ standalone = false }: { standalone?: boolean }) {
  const [on, setOpen] = useState(false);
  const open = standalone || on;
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [sure, setSure] = useState("");
  const [rec, setRec] = useState<Rec[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);

  const close = useCallback(() => { if (!standalone) setOpen(false); setQ(""); setHits([]); setMsg(""); setSure(""); }, [standalone]);

  useEffect(() => {
    if (standalone) return;
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") close();
    };
    const openIt = (e: Event) => { const d = (e as CustomEvent<string | undefined>).detail; if (d) setQ(d); setOpen(true); };
    addEventListener("keydown", key);
    addEventListener("bmq:cmdk", openIt);
    return () => { removeEventListener("keydown", key); removeEventListener("bmq:cmdk", openIt); };
  }, [close, standalone]);

  useEffect(() => { if (open) { input.current?.focus(); setRec(recent()); } }, [open]);

  useEffect(() => {
    if (!open || !q.trim()) { setHits([]); setLoading(false); return; }
    const my = ++seq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`).catch(() => null);
      if (my !== seq.current) return;
      const j = res?.ok ? ((await res.json().catch(() => null)) as { hits: Hit[] } | null) : null;
      setHits(j?.hits ?? []); setSel(0); setSure(""); setLoading(false);
      if (!j) setMsg("Search isn't working right now – try again");
    }, 150);
    return () => clearTimeout(t);
  }, [q, open]);

  /* the standalone /palette route navigates into the shell (/#target), the overlay just changes the hash */
  const go = (h: string) => { if (standalone) location.href = `/#${h.replace(/^#/, "")}`; else location.hash = h; };

  const run = async (a: Act, id: string) => {
    if (a.sure && sure !== id) { setSure(id); return; }
    setMsg("Running…");
    const res = await fetch(a.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a.body) }).catch(() => null);
    if (!res?.ok) {
      const e = res ? ((await res.json().catch(() => null)) as { error?: string } | null)?.error : null;
      setMsg(res?.status === 404 ? "This module isn't deployed yet" : `Failed${e ? `: ${e}` : ""}`);
      setSure("");
      return;
    }
    setMsg(a.ok);
    if (a.go) go(a.go);
    setTimeout(close, 700);
  };

  const pick = (h: Hit | undefined) => {
    if (!h) return;
    if (h.act) return void run(h.act, h.id);
    localStorage.setItem("bmq:recent", JSON.stringify([{ t: h.t, s: h.s, h: h.h, ext: h.ext }, ...recent().filter((r) => r.t !== h.t)].slice(0, 5)));
    if (h.ext) window.open(h.ext, "_blank", "noopener");
    else if (h.h) go(h.h);
    close();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(hits[sel]); }
  };

  return (
    <>
      {open && (
        <div className="ck-back" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="ck" role="dialog" aria-modal="true" aria-label="Command bar">
            <div className="ck-in">
              <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setMsg(""); }} onKeyDown={onKey} placeholder="Search or type a command" aria-label="Search" autoComplete="off" spellCheck={false} />
              <button className="ck-x" onClick={close} aria-label="Close">Esc</button>
            </div>
            <div className="ck-list" role="listbox">
              {!q.trim() && <div className="ck-empty">Try: {HINT.map((h) => <button key={h} onClick={() => { setQ(h); input.current?.focus(); }}>{h}</button>)}</div>}
              {!q.trim() && rec.length > 0 && <div className="ck-grp">Recent</div>}
              {!q.trim() && rec.map((r) => (
                <button key={r.t} className="ck-row" onClick={() => { if (r.ext) window.open(r.ext, "_blank", "noopener"); else if (r.h) go(r.h); close(); }}>
                  <span className="ck-t">{r.t}</span><span className="ck-s">{r.s}</span>
                </button>
              ))}
              {q.trim() && !hits.length && !loading && <div className="ck-empty">Nothing found.</div>}
              {hits.map((h, i) => (
                <div key={`${h.k}${h.id}`}>
                  {(i === 0 || hits[i - 1].k !== h.k) && <div className="ck-grp">{LBL[h.k]}</div>}
                  <button role="option" aria-selected={i === sel} className={`ck-row${i === sel ? " on" : ""}${h.act ? " act" : ""}`} onMouseMove={() => setSel(i)} onClick={() => pick(h)}>
                    <span className="ck-t">{h.t}</span>
                    <span className="ck-s">{sure === h.id ? "Confirm: press Enter again" : h.s}</span>
                  </button>
                </div>
              ))}
            </div>
            <div className="ck-foot" role="status">{msg || (loading ? "Searching…" : "↑↓ select · Enter open · Esc close")}</div>
          </div>
        </div>
      )}
    </>
  );
}
