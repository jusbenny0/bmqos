"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/* Social module. Data flows through the server OS (/api/social/*); the client never sees the social-manager token. */

interface ReplyTo { authorName: string; authorHandle: string; text: string; imageUrls?: string[] }
interface Draft {
  id: string; kind: "post" | "reply"; text: string; replyTo: ReplyTo | null; replyToUrl: string | null; why: string; batch: string;
  status: string; rejectReason: string | null; tweetUrl: string | null; dryRun: boolean; error: string | null; retryAt: number | null;
  createdAt: number; decidedAt: number | null; postedAt: number | null;
}
interface Slot { time: string; state: string; sent?: number }
interface Status { session: { ok: boolean; handle?: string; checkedAt?: number; lastPostAt?: number }; slots: Slot[]; nextAllowedAt?: number | null; todayCount: number; dailyCap: number; posting: boolean }
/* social-manager returns a newer shape: slots = { nextAllowedAt, waitSec }, posting = { enabled, live }. The old shape (array of slots, boolean) still works. */
function normStatus(r: any): Status | null {
  if (!r || typeof r !== "object") return null;
  const sl = r.slots;
  const p = r.posting;
  const next = sl && !Array.isArray(sl) ? (sl.nextAllowedAt ? new Date(sl.nextAllowedAt).getTime() : null) : undefined;
  return {
    session: r.session && typeof r.session === "object" ? r.session : { ok: false },
    slots: Array.isArray(sl) ? sl : [],
    nextAllowedAt: next,
    todayCount: Number(r.todayCount) || 0,
    dailyCap: Number(r.dailyCap) || 0,
    posting: typeof p === "boolean" ? p : !!(p && p.enabled && p.live),
  };
}
type Body = { action: "approve" | "edit" | "reject" | "snooze"; text?: string; reason?: string; until?: number };
type Tab = "queue" | "hist" | "plan";

const HIST = ["posted", "approved", "failed", "rejected", "posting"];
const REASONS = ["Off topic", "Too salesy", "Wrong tone", "Facts don't match", "Too generic"];
const SNOOZE: [string, () => number][] = [
  ["In 3 hours", () => Date.now() + 3 * 3600_000],
  ["Tomorrow morning (8:00)", () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return +d; }],
  ["In a week", () => Date.now() + 7 * 86400_000],
];
const SLOT: Record<string, [string, string]> = { done: ["done", ""], skipped: ["skip", "nothing approved, skipped"], next: ["next", ""], wait: ["", ""] };

const age = (t: number): string => {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
const when = (t: number): string => new Date(t).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
const initials = (n: string): string => n.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

// `need` = 403 with a 2FA requirement (the caller opens the dialog and repeats the action after verification)
async function api<T>(path: string, method = "GET", body?: object): Promise<{ ok: boolean; data: T | null; need?: string }> {
  const res = await fetch(`/api/social/${path}`, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" }).catch(() => null);
  if (res?.status === 401) { location.href = "/login"; }
  const need = res?.status === 403 ? ((await res.clone().json().catch(() => ({}))) as { need?: string }).need : undefined;
  return { ok: !!res?.ok, data: res?.ok ? ((await res.json().catch(() => null)) as T) : null, need: need === "stepup" || need === "enroll" ? need : undefined };
}

const askStepUp = (need: string, retry: () => void): void => { window.dispatchEvent(new CustomEvent("os-stepup", { detail: { need, retry } })); };

const Check = () => <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m3 8.5 3.2 3L13 4.5" /></svg>;
const Clock = () => <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.3 1.4" /></svg>;

function SnoozeMenu({ onPick, icon }: { onPick: (until: number) => void; icon?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="so-popw">
      <button className={`so-btn${icon ? " so-ic" : ""}`} aria-label="Snooze" aria-expanded={open} onClick={() => setOpen(!open)}><Clock />{!icon && <span>Snooze ▾</span>}</button>
      {open && <div className="so-pop" role="menu">{SNOOZE.map(([l, f]) => <button key={l} role="menuitem" onClick={() => { setOpen(false); onPick(f()); }}>{l}</button>)}</div>}
    </span>
  );
}

function RejectPicker({ onSubmit, onCancel }: { onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [sel, setSel] = useState<string | null>(null);
  const [own, setOwn] = useState(false), [text, setText] = useState("");
  const reason = own ? text.trim() : sel;
  return (
    <>
      <div className="lbl" style={{ width: "100%" }}>Why are you rejecting this? It helps us write better next time.</div>
      {REASONS.map((r) => <button key={r} className={`so-chip${!own && sel === r ? " on" : ""}`} onClick={() => { setOwn(false); setSel(r); }}>{r}</button>)}
      <button className={`so-chip${own ? " on" : ""}`} onClick={() => setOwn(true)}>Write your own…</button>
      {own && <input className="so-in" autoFocus maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reason" aria-label="Rejection reason" />}
      <div className="so-rjb"><button className="so-btn rd" disabled={!reason} onClick={() => reason && onSubmit(reason)}>Reject</button><button className="so-btn" onClick={onCancel}>Back</button></div>
    </>
  );
}

interface CardProps {
  d: Draft; sel: boolean; mode: "view" | "edit" | "reject";
  onSel: () => void; onMode: (m: "view" | "edit" | "reject") => void;
  onAct: (b: Body, label: string, extra?: Body) => void;
}

function Card({ d, sel, mode, onSel, onMode, onAct }: CardProps) {
  const [txt, setTxt] = useState(d.text);
  const rt = d.replyTo;
  const len = txt.length;
  return (
    <article className={`so-card${sel ? " sel" : ""}`}>
      <header>
        <button className={`so-cb${sel ? " on" : ""}`} aria-label="Select" aria-pressed={sel} onClick={onSel}>{sel && <Check />}</button>
        <span className="tag">{d.kind === "post" ? "New post" : "Reply"}</span>
        <span className="mono">{d.batch && <span className="so-hm">{d.batch} · </span>}{age(d.createdAt)}</span>
        <span className="sp" />
        {d.replyToUrl && <a className="so-lnk" href={d.replyToUrl} target="_blank" rel="noreferrer">Open on X ↗</a>}
      </header>
      {rt && (
        <div className="so-th">
          <div className="so-tl"><span className="so-av">{initials(rt.authorName)}</span></div>
          <div className="so-xq">
            <div className="so-xa"><b>{rt.authorName}</b><span>@{rt.authorHandle}</span></div>
            <p>{rt.text}</p>
            {rt.imageUrls?.[0] && <img src={rt.imageUrls[0]} alt="" referrerPolicy="no-referrer" loading="lazy" />}
          </div>
        </div>
      )}
      <div className={`so-th${rt ? "" : " first"}`}>
        <div className="so-tl"><span className="so-av me">A</span></div>
        <div className="so-mine">
          <div className="so-xa"><b>Account owner</b><span>@yourhandle · {d.kind === "post" ? "new post" : "reply"}</span></div>
          {mode === "edit" ? (
            <>
              <textarea rows={3} value={txt} onChange={(e) => setTxt(e.target.value)} aria-label="Text" autoFocus />
              <div className="mono so-cnt"><span className={len > 280 ? "red" : ""}>{len} / 280</span><span className="lime">also saved to learn your voice</span></div>
            </>
          ) : (
            <><p>{d.text}</p><div className="mono so-cnt"><span>{d.text.length} / 280</span></div></>
          )}
        </div>
      </div>
      {d.why && <p className="hint so-why">Why: {d.why}</p>}
      {mode === "edit" ? (
        <footer>
          <button className="so-cta" disabled={!txt.trim() || len > 280} onClick={() => onAct({ action: "edit", text: txt }, "Approved", { action: "approve" })}>Save and approve <Check /></button>
          <button className="so-btn" disabled={!txt.trim() || len > 280 || txt === d.text} onClick={() => onAct({ action: "edit", text: txt }, "Saved")}>Just save</button>
          <button className="so-btn" onClick={() => { setTxt(d.text); onMode("view"); }}>Cancel</button>
        </footer>
      ) : mode === "reject" ? (
        <footer className="rj"><RejectPicker onCancel={() => onMode("view")} onSubmit={(reason) => onAct({ action: "reject", reason }, "Rejected")} /></footer>
      ) : (
        <footer>
          <button className="so-cta" onClick={() => onAct({ action: "approve" }, "Approved")}>Approve <Check /></button>
          <button className="so-btn" onClick={() => onMode("edit")}>Edit</button>
          <SnoozeMenu onPick={(until) => onAct({ action: "snooze", until }, "Snoozed")} />
          <span className="sp" />
          <button className="so-btn rd" onClick={() => onMode("reject")}>Reject</button>
        </footer>
      )}
    </article>
  );
}

function History({ items }: { items: Draft[] }) {
  if (!items.length) return <p className="hint">Nothing sent yet.</p>;
  return (
    <ul className="so-hl">
      {items.map((h) => {
        const dry = h.status === "approved" && h.dryRun;
        const [label, cls] = h.status === "posted" ? ["Sent", "l"] : dry ? ["Trial", "a"] : h.status === "failed" ? ["Error", "r"] : h.status === "rejected" ? ["Rejected", ""] : h.status === "posting" ? ["Sending", "a"] : ["Approved", ""];
        const note = h.status === "failed" ? `${h.error ?? "Error"}${h.retryAt ? ` · retries at ${when(h.retryAt)}` : ""}` : h.status === "rejected" ? h.rejectReason : dry ? "nothing was sent to X" : null;
        return (
          <li key={h.id}>
            <span className="mono tm">{when(h.postedAt ?? h.decidedAt ?? h.createdAt)}</span>
            <div>
              <div className="mono hh"><span className="tag">{h.kind === "post" ? "Post" : "Reply"}</span>{h.replyTo && `@${h.replyTo.authorHandle}`}{h.status === "posted" && h.tweetUrl && <a className="so-lnk" href={h.tweetUrl} target="_blank" rel="noreferrer">On X ↗</a>}</div>
              <p>{h.text}</p>
              {note && <span className={`mono nt${h.status === "failed" ? " red" : ""}`}>{note}</span>}
            </div>
            <span className={`tag ${cls}`}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Plan({ st }: { st: Status | null }) {
  if (!st) return <div className="so-sec"><p className="hint">Couldn't load status.</p></div>;
  const s = st.session;
  return (
    <>
      <div className="so-sec">
        <div className="lbl">Sending plan</div>
        <p className="hint" style={{ margin: "6px 0 14px" }}>Sent after every two replies, every 2 hours, never right after approval.</p>
        {st.slots.length === 0 && <p className="mono so-cap"><span>Next send</span><b>{st.nextAllowedAt && st.nextAllowedAt > Date.now() ? new Date(st.nextAllowedAt).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" }) : "as soon as it's approved"}</b></p>}
        <ol className="so-slots">
          {st.slots.map((x) => {
            const [c, empty] = SLOT[x.state] ?? ["", ""];
            return <li key={x.time} className={c}><i /><span className="mono">{x.time}</span><span>{empty || (x.state === "done" ? `${x.sent ?? 0} replies sent` : x.state === "next" ? "next slot" : "waiting")}</span></li>;
          })}
        </ol>
        <div className="mono so-cap"><span>Sent today</span><b>{st.todayCount} of {st.dailyCap}</b></div>
        <div className="bar"><i style={{ width: `${Math.min(100, (st.todayCount / (st.dailyCap || 1)) * 100)}%`, animation: "none" }} /></div>
      </div>
      <div className="so-sec">
        <div className="lbl">Signed in to X</div>
        <div className="so-x"><span className={`dot${s.ok ? "" : " bad"}`} /><div>
          {s.ok ? <b>@{s.handle ?? "yourhandle"} · valid</b> : <b className="red">Login expired – needs renewal</b>}
          <span className="mono">{s.checkedAt ? `checked ${age(s.checkedAt)} ago` : ""}{s.lastPostAt ? ` · last sent ${when(s.lastPostAt)}` : ""}</span>
        </div></div>
        {!s.ok && <p className="hint" style={{ marginTop: 10 }}>Queue is paused until the login is renewed.</p>}
      </div>
      <div className="so-sec">
        <div className="lbl">Live posting to X</div>
        <div className="so-swr">
          <span className={`so-sw${st.posting ? " on" : ""}`} role="switch" aria-checked={st.posting} aria-readonly aria-label="Live posting (status only)"><i /></span>
          <div><b className={st.posting ? "lime" : "amber"}>{st.posting ? "On · posting live" : "Off · trial mode"}</b>
            <p className="hint">{st.posting ? "Approved drafts will actually be sent." : "Approved items are logged to History, nothing goes to X."} Toggled outside BMQOS.</p></div>
        </div>
      </div>
    </>
  );
}

export function Social({ compact }: { compact: boolean }) {
  const [queue, setQueue] = useState<Draft[] | null>(null);
  const [hist, setHist] = useState<Draft[]>([]);
  const [st, setSt] = useState<Status | null>(null);
  const [down, setDown] = useState(false);
  const [tab, setTab] = useState<Tab>("queue");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ id: string; mode: "edit" | "reject" } | null>(null);
  const [bulkReject, setBulkReject] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ msg: string; undo?: () => void; bad?: boolean } | null>(null);
  const pending = useRef<{ run: () => Promise<void>; timer: ReturnType<typeof setTimeout> } | null>(null);
  const busy = useRef(false);

  const load = useCallback(async () => {
    const [q, stat, ...h] = await Promise.all([api<{ items: Draft[] }>("drafts?status=pending"), api<Status>("status"), ...HIST.map((s) => api<{ items: Draft[] }>(`drafts?status=${s}`))]);
    setSt(stat.ok ? normStatus(stat.data) : null);
    if (!q.ok) { setDown(true); return; }
    setDown(false);
    setQueue(q.data?.items ?? []);
    setHist(h.flatMap((r) => r.data?.items ?? []).sort((a, b) => (b.postedAt ?? b.decidedAt ?? b.createdAt) - (a.postedAt ?? a.decidedAt ?? a.createdAt)));
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { if (!pending.current && !busy.current) void load(); }, 15000);
    return () => clearInterval(t);
  }, [load]);

  const say = (msg: string, bad = false) => { setToast({ msg, bad }); setTimeout(() => setToast(null), 3500); };

  /* only sent after 6s; Undo works until then; a new action immediately flushes the previous one */
  const flush = async () => { const p = pending.current; if (!p) return; clearTimeout(p.timer); pending.current = null; await p.run(); };
  const run = async (ids: string[], label: string, bodies: Body[]) => {
    await flush();
    setHidden((h) => new Set([...h, ...ids]));
    setSel((s) => new Set([...s].filter((i) => !ids.includes(i))));
    setOpen(null); setBulkReject(false);
    const unhide = () => setHidden((h) => new Set([...h].filter((i) => !ids.includes(i))));
    const exec = async () => {
      busy.current = true;
      setToast(null);
      let bad = 0, need: string | undefined;
      for (const b of bodies) {
        const r = ids.length > 1 ? await api<{ ok: string[]; failed: unknown[] }>("drafts/bulk", "POST", { ...b, ids }) : await api(`drafts/${ids[0]}`, "PATCH", b);
        if (!r.ok) { bad = ids.length; need = r.need; break; }
        if (ids.length > 1) bad += (r.data as { failed?: unknown[] } | null)?.failed?.length ?? 0;
      }
      busy.current = false;
      if (need) { setToast(null); askStepUp(need, () => void run(ids, label, bodies)); } else if (bad) say(`Failed (${bad}) – try again`, true); else say("Done");
      await load();
      unhide();
    };
    const last = bodies[bodies.length - 1].action;
    const slot = st?.slots?.find((s) => s.state === "next");
    const msg = `${label}${last === "approve" ? ` · goes out ${slot ? `in the ${slot.time} slot` : "in the next slot"}` : ""}`;
    const timer = setTimeout(() => { pending.current = null; void exec(); }, 6000);
    pending.current = { run: exec, timer };
    setToast({ msg, undo: () => { clearTimeout(timer); pending.current = null; unhide(); setToast(null); } });
  };

  const act = (d: Draft, b: Body, label: string, extra?: Body) => {
    if (b.action === "edit" && !extra) { // "Just save" can't be undone, text persists across reloads
      void flush().then(() => api(`drafts/${d.id}`, "PATCH", b)).then((r) => { if (r.need) { askStepUp(r.need, () => act(d, b, label, extra)); return; } say(r.ok ? label : "Failed – try again", !r.ok); setOpen(null); void load(); });
      return;
    }
    void run([d.id], label, extra ? [b, extra] : [b]);
  };

  const items = (queue ?? []).filter((d) => !hidden.has(d.id));
  const picked = [...sel].filter((i) => items.some((d) => d.id === i));
  const all = items.length > 0 && picked.length === items.length;
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });
  const showTab: Tab = tab === "plan" && !compact ? "queue" : tab;
  const tabs: [Tab, string, number | null][] = [["queue", "Queue", items.length], ["hist", "History", null], ...(compact ? [["plan", "Plan", null] as [Tab, string, null]] : [])];

  const queueView = () => {
    if (down) return <p className="hint">Social manager isn't responding. I'll try again shortly.</p>;
    if (!queue) return <p className="hint">Loading…</p>;
    if (!items.length) return <p className="hint">Social agent hasn't proposed anything new yet. Next batch in the morning.</p>;
    return (
      <>
        <div className="so-sbar">
          <button className={`so-cb${all ? " on" : ""}`} aria-label="Select all" aria-pressed={all} onClick={() => setSel(all ? new Set() : new Set(items.map((d) => d.id)))}>{all && <Check />}</button>
          <span className="mono">Select all</span><span className="sp" /><span className="mono so-hm">Social agent writes the drafts, you just approve</span>
        </div>
        <div className="so-cards">
          {items.map((d) => <Card key={d.id} d={d} sel={sel.has(d.id)} mode={open?.id === d.id ? open.mode : "view"} onSel={() => toggle(d.id)} onMode={(m) => setOpen(m === "view" ? null : { id: d.id, mode: m })} onAct={(b, l, x) => act(d, b, l, x)} />)}
        </div>
      </>
    );
  };

  return (
    <div className="screen so-page">
      <div className="so-main">
        <div className="pagehead">
          <div><h1>Social queue</h1><div className="hint" style={{ marginTop: 8 }}>{items.length} drafts are waiting on you. Approved ones go out in the next slot.</div></div>
          {st && !st.posting && <span className="tag a so-mode">Trial mode · nothing is sent</span>}
        </div>
        <div className="so-seg" role="tablist">
          {tabs.map(([k, l, n]) => <button key={k} role="tab" aria-selected={showTab === k} className={showTab === k ? "on" : ""} onClick={() => setTab(k)}>{l}{n ? <b>{n}</b> : null}</button>)}
        </div>
        <div className="so-list">{showTab === "hist" ? <History items={hist} /> : showTab === "plan" ? <Plan st={st} /> : queueView()}</div>
        {picked.length > 0 && showTab === "queue" && (
          <div className="so-bulk">
            <b><span>{picked.length}</span><span className="so-hm"> selected</span></b>
            <button className="so-cta" onClick={() => void run(picked, "Approved", [{ action: "approve" }])}>Approve <Check /></button>
            <SnoozeMenu icon onPick={(until) => void run(picked, "Snoozed", [{ action: "snooze", until }])} />
            <button className="so-btn rd" onClick={() => setBulkReject(true)}>Reject…</button>
            <button className="so-btn so-ic" aria-label="Clear selection" onClick={() => setSel(new Set())}>✕</button>
          </div>
        )}
      </div>
      {!compact && <aside className="so-plan"><Plan st={st} /></aside>}
      {bulkReject && (
        <>
          <div className="scrim" onClick={() => setBulkReject(false)} />
          <div className="so-dlg" role="dialog" aria-label="Reject selected">
            <h3>Reject {picked.length} {picked.length === 1 ? "draft" : "drafts"}?</h3>
            <div className="so-chips"><RejectPicker onCancel={() => setBulkReject(false)} onSubmit={(reason) => void run(picked, "Rejected", [{ action: "reject", reason }])} /></div>
          </div>
        </>
      )}
      {toast && <div className={`toast${toast.bad ? " bad" : ""}`} role="status"><span>{toast.msg}</span>{toast.undo && <button onClick={toast.undo}>Undo</button>}</div>}
    </div>
  );
}
