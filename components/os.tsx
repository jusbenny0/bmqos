"use client";
import { StepUp } from "./stepup";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKey, type MouseEvent } from "react";
import { esc } from "@/lib/stage";
import { sendsOnEnter } from "@/lib/chatkey";
import type { Snapshot } from "@/lib/types";
import type { Card } from "@/lib/inbox";
import { bubble, apprCard, type ChatMsg } from "./inbox";
import { parseSse, splitActions, type Action } from "@/lib/chatparse";
import { Social } from "./social";
import { CmdK } from "./mod/cmdk";
import { mountCharts } from "./chart";
import { bindVoice } from "./voice";
import type { StorData, Tops } from "./mod/storage";
import type { DocFull, DocsData } from "./mod/docs";
import type { PushState } from "./settings";
import { chrome, parseRoute, shell, ST, sugHtml } from "./views";
import { loadOps, tiles } from "./home";
import "./mod/projects.css";
import "./mod/crew.css";
import "./mod/dash.css";
import { loadDash, setSimFast } from "./mod/dash";
import type { ProjData } from "./mod/projects";
import type { ProjectView } from "@/lib/services";
import { snoozeUntil, TAB_OF, type ItemsData, type TaskUi } from "./mod/items";
import type { Item } from "@/lib/items";
import { mountIdeas } from "./mod/ideas";
import { mountBrand } from "./mod/brand";
import "./mod/brand.css";
import { mountCrewGraph, loadInstructions } from "./mod/crew";
import type { CrewTeamUi, CrewTasksUi, CrewUsageUi, CrewTxUi, CrewSendSt } from "./mod/crew";
import type { TaskDetail as CrewTaskDetail, BrainHit, BrainNode, TranscriptMessage, Usage } from "@/lib/crew";

const svgNS = "http://www.w3.org/2000/svg";

const idOf = async (e: string): Promise<string> => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(e)))].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
/* highlights the selected color in the owner's menu */
const paintAcc = (): void => { const k = document.documentElement.dataset.acc; document.querySelectorAll<HTMLElement>("button[data-acc]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.acc === k))); };

export function Os({ name }: { name?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [stale, setStale] = useState<string | null>(null);
  const [soc, setSoc] = useState(0);
  const [post, setPost] = useState(false); // Social posting enabled
  const [hash, setHash] = useState("");
  const [push, setPush] = useState<PushState | null>(null);
  const [compact, setCompact] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undo: () => void } | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [playing, setPlaying] = useState("");
  const [editing, setEditing] = useState("");
  const [live, setLive] = useState(false);
  const [herm, setHerm] = useState(false); // Assistant panel: opens from anywhere, not the main canvas
  /* chat lives outside React state: during streaming only the text node of the last bubble changes, the shell doesn't re-render */
  const chatRef = useRef<ChatMsg[]>([]);
  const busyRef = useRef(false);
  const actsRef = useRef<Record<string, string>>({}); // action card state: "i:n" → busy | ok | err
  const notesRef = useRef<string[]>([]); // action results to add to the next turn
  const imgsRef = useRef<{ name: string; dataUrl: string }[]>([]);
  const opened = useRef(new Set<string>());
  const relBusy = useRef(false);
  const routeRef = useRef<{ s: string; q: Record<string, string> }>({ s: "overview", q: {} });
  const cardRef = useRef<Card | null>(null);
  const [step, setStep] = useState<{ need: string; retry: () => void } | null>(null);
  const [dlg, setDlg] = useState<{ title: string; items: string[]; ok: string; run: () => void } | null>(null);
  const [stor, setStor] = useState<StorData | null>(null);
  const [tops, setTops] = useState<Tops>({});
  const [docs, setDocs] = useState<DocsData | null>(null);
  const [proj, setProj] = useState<ProjData | null>(null);
  const [ix, setIx] = useState<ItemsData | null>(null);
  const [tk, setTk] = useState<TaskUi>({ opts: null, rv: null });
  const [crewTeam, setCrewTeam] = useState<CrewTeamUi | null>(null);
  const crewTxRef = useRef<CrewTxUi>({});
  const [crewTxV, setCrewTxV] = useState(0); // transcript lives in a ref (polling), this counter just forces the sheet to re-render
  const [crewSend, setCrewSend] = useState<Record<string, CrewSendSt>>({});
  const [crewTasks, setCrewTasks] = useState<CrewTasksUi | null>(null);
  const [crewTaskDetail, setCrewTaskDetail] = useState<CrewTaskDetail | null>(null);
  const [crewTaskErr, setCrewTaskErr] = useState(false);
  const crewUsageRef = useRef<CrewUsageUi>({ data: { "24h": null, "7d": null } });
  const [crewUsageV, setCrewUsageV] = useState(0);
  const [crewBrainHits, setCrewBrainHits] = useState<BrainHit[] | null>(null);
  const [crewNode, setCrewNode] = useState<BrainNode | null>(null);
  const [crewNodeErr, setCrewNodeErr] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pend = useRef<(() => void) | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  snapRef.current = snap;

  useEffect(() => { const h = (e: Event) => setStep((e as CustomEvent<{ need: string; retry: () => void }>).detail); window.addEventListener("os-stepup", h); return () => window.removeEventListener("os-stepup", h); }, []);
  /* write; 403 with need=stepup/enroll opens the 2FA dialog and retries once verified */
  const send = async (msg: string, body: object, onDone?: (id?: string) => void, onUndo?: () => void, url = "/api/act", onFail?: () => void, method = "POST") => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (res ? await res.clone().json().catch(() => ({})) : {}) as { need?: string; draft?: boolean; issue?: string; zadaniChyba?: boolean };
    const need = res?.status === 403 ? j.need : undefined;
    if (need === "stepup" || need === "enroll") setStep({ need, retry: () => act(msg, body, onDone, onUndo, url, onFail, method) });
    const draft = res?.status === 403 && url.startsWith("/api/tasks") && j.draft === true;
    setToast({ msg: res?.ok ? (url === "/api/tasks" && j.issue ? (j.zadaniChyba ? `Task ${j.issue} was created, but the brief wasn't saved – add it in Paperclip` : `Task ${j.issue} created`) : "Done") : draft ? "Writes are disabled, nothing was sent" : need === "typed" || need === "code" ? "Machine name or 2FA code doesn't match" : need ? "Needs 2FA verification" : url === "/api/storage" ? "Cleanup failed – check the machine and try again" : "Failed – try again", undo: () => setToast(null) });
    if (res?.ok) onDone?.(j.issue); else onFail?.();
    if (hide.current) clearTimeout(hide.current);
    hide.current = setTimeout(() => setToast(null), 3500);
  };
  /* the action is sent only after 6 s; until then the Undo button cancels it */
  const act = (msg: string, body: object, onDone?: () => void, onUndo?: () => void, url = "/api/act", onFail?: () => void, method = "POST") => {
    if (timer.current) { clearTimeout(timer.current); pend.current?.(); } // send the first pending action right away instead of dropping it
    if (hide.current) clearTimeout(hide.current);
    const run = () => { timer.current = null; pend.current = null; void send(msg, body, onDone, onUndo, url, onFail, method); };
    const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; pend.current = null; setToast(null); onUndo?.(); };
    setToast({ msg: `${msg} · sends in 6 s`, undo: cancel });
    pend.current = run;
    timer.current = setTimeout(run, 6000);
  };

  /* Tasks: count of "Needs you" for the badge + the current tab's list; doesn't re-render while typing in the Add field */
  const loadItems = useCallback(async () => {
    const get = async (tab: string): Promise<Item[] | null> => { const r = await fetch(`/api/items?tab=${tab}`, { cache: "no-store" }).catch(() => null); return r?.ok ? ((await r.json()) as { items: Item[] }).items : null; };
    const tab = TAB_OF[routeRef.current.s] ?? "na-mne";
    const [na, cur] = await Promise.all([get("na-mne"), tab === "na-mne" ? null : get(tab)]);
    const list = tab === "na-mne" ? na : cur;
    if (!na || !list) { setIx((o) => (o && o.tab === tab ? o : { n: o?.n ?? 0, tab, list: [], err: true })); return; }
    if (root.current?.querySelector("input[data-add]:not(:placeholder-shown)")) return;
    setIx((o) => (o && o.n === na.length && o.tab === tab && JSON.stringify(o.list) === JSON.stringify(list) ? o : { n: na.length, tab, list }));
  }, []);

  useEffect(() => {
    const mq = matchMedia("(max-width:900px)");
    const sync = () => {
      setCompact(mq.matches);
      // backward compatibility with old links #hermes&from=…: opens the panel and returns the hash to the original screen
      if (location.hash.startsWith("#hermes")) { setHerm(true); location.hash = parseRoute(location.hash).q.from || "overview"; return; }
      setHash(location.hash);
    };
    sync();
    mq.addEventListener("change", sync);
    addEventListener("hashchange", sync);
    return () => { mq.removeEventListener("change", sync); removeEventListener("hashchange", sync); };
  }, []);

  useEffect(() => {
    let alive = true, last = "";
    const tick = async () => {
      try {
        const res = await fetch("/api/snapshot", { cache: "no-store" });
        if (res.status === 401) { location.href = "/login"; return; }
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as Snapshot;
        const sr = await fetch("/api/social/drafts?status=pending", { cache: "no-store" }).catch(() => null);
        const sj = sr?.ok ? ((await sr.json()) as { items?: unknown[] }) : null;
        if (sj && alive) setSoc(sj.items?.length ?? 0);
        const st = await fetch("/api/social/status", { cache: "no-store" }).then((x) => (x.ok ? (x.json() as Promise<{ posting?: { enabled?: boolean } }>) : null)).catch(() => null);
        if (alive) setPost(st?.posting?.enabled === true);
        void loadItems();
        if (!alive) return;
        setStale(d.ok ? null : d.clock);
        const key = JSON.stringify({ ...d, at: 0 });
        const typing = root.current?.querySelector("textarea:not(:placeholder-shown), textarea[data-chat]:focus, select:focus, input[data-ttyped]:not(:placeholder-shown), input[data-tcode]:not(:placeholder-shown)");
        const r = routeRef.current;
        const hold = busyRef.current || (r.s === "waiting" && !!cardRef.current && JSON.stringify(d.wait.map((w) => w.id)) === JSON.stringify(snapRef.current?.wait.map((w) => w.id)));
        if (key !== last && !typing && !hold) { last = key; setSnap(d); }
      } catch {
        if (alive) setStale((s) => s ?? new Date().toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }));
      }
    };
    void tick();
    const t = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(t); };
  }, [loadItems]);

  /* demo simulator: ?autoplay=1 starts it, while it runs the snapshot refreshes every second */
  const simOn = snap?.sim === true;
  const simToggle = useCallback(async (on: boolean) => {
    const res = await fetch(`/api/snapshot?sim=${on ? 1 : 0}`, { cache: "no-store" });
    if (res.ok) setSnap((await res.json()) as Snapshot);
  }, []);
  useEffect(() => { if (snap?.sim === false && new URLSearchParams(location.search).get("autoplay") === "1") void simToggle(true); }, [snap?.sim, simToggle]);
  useEffect(() => {
    if (!simOn) return;
    setSimFast(true);
    const t = setInterval(async () => { loadDash(); const res = await fetch("/api/snapshot", { cache: "no-store" }); if (res.ok) setSnap((await res.json()) as Snapshot); }, 1000);
    return () => { clearInterval(t); setSimFast(false); };
  }, [simOn]);

  /* mobile: skeleton tracks the visible height so the chat dock stays above the keyboard (iOS doesn't shrink the layout viewport) */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () => { if (vv.scale === 1) document.documentElement.style.setProperty("--vvh", `${Math.round(vv.height)}px`); };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => { vv.removeEventListener("resize", set); vv.removeEventListener("scroll", set); document.documentElement.style.removeProperty("--vvh"); };
  }, []);

  const route = useMemo(() => parseRoute(hash), [hash]);
  routeRef.current = route;
  cardRef.current = card;
  /* Inbox's default item is fixed; polling won't swap it out from under the user */
  const defSel = useRef("");
  if (route.s !== "waiting" || !snap?.wait.some((w) => w.id === defSel.current)) defSel.current = snap?.wait[0]?.id ?? "";
  const sel = route.s === "waiting" ? route.q.issue ?? defSel.current : "";
  const want = useRef("");
  const loadCard = useCallback(async (id: string) => {
    want.current = id;
    const r = await fetch(`/api/inbox?id=${encodeURIComponent(id)}`, { cache: "no-store" }).catch(() => null);
    const c = r?.ok ? ((await r.json()) as Card) : null;
    if (want.current === id) setCard(c); // a late response for a different item is dropped
  }, []);
  useEffect(() => { setEditing(""); setPlaying(""); setCard(null); if (sel) void loadCard(sel); else want.current = ""; }, [sel, loadCard]);

  const paintChat = useCallback(() => {
    const l = root.current?.querySelector("#clog");
    if (!l) return;
    l.innerHTML = chatRef.current.map((m, i) => bubble(m, i, actsRef.current)).join("") || '<div class="hc-empty"><b>Ask the Assistant</b><span>It\'s the same Assistant as on Discord. It knows your tasks, projects and servers, and can handle them directly.</span>' + sugHtml + '</div>';
    l.scrollTop = l.scrollHeight;
  }, []);
  useEffect(() => {
    if (!herm) return;
    void fetch("/api/chat").then((r) => r.json()).then((j: { live: boolean; messages: ChatMsg[] }) => { setLive(j.live); if (!busyRef.current) { chatRef.current = j.messages; paintChat(); } });
  }, [herm, paintChat]);
  useEffect(() => { if (TAB_OF[route.s]) void loadItems(); }, [route.s, loadItems]);
  const tkLoaded = tk.opts !== null;
  useEffect(() => {
    if (!TAB_OF[route.s] || tkLoaded) return;
    void fetch("/api/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((o: TaskUi["opts"] & { error?: string } | null) => { if (o && !o.error) setTk((t) => ({ ...t, opts: o })); }).catch(() => undefined);
  }, [route.s, tkLoaded]);
  useEffect(() => { if (route.s === "overview") loadOps(); }, [route.s]);
  /* push: server state + this browser's state (Notifications in the user menu) */
  const loadPush = useCallback(async () => {
    const j = (await fetch("/api/push", { cache: "no-store" }).then((r) => r.json()).catch(() => null)) as Omit<PushState, "standalone" | "perm" | "ios" | "here" | "supported"> | null;
    if (!j) return;
    const supported = "serviceWorker" in navigator && "PushManager" in window;
    const sub = supported ? await (await navigator.serviceWorker.ready).pushManager.getSubscription() : null;
    const hid = sub ? await idOf(sub.endpoint) : "";
    setPush({ ...j, supported, perm: "Notification" in window ? Notification.permission : "denied", here: !!sub && j.devices.some((d) => d.id === hid),
      standalone: matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true, ios: /iPhone|iPad/.test(navigator.userAgent) });
  }, []);
  useEffect(() => { if (name) document.querySelectorAll(".logo").forEach((l) => { l.textContent = name; }); });
  useEffect(() => { try { document.documentElement.dataset.acc = localStorage.getItem("bmqos-acc2") ?? "zelena"; } catch { document.documentElement.dataset.acc = "zelena"; } paintAcc(); });
  useEffect(() => { if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js").catch(() => undefined); }, []);
  useEffect(() => { // after logout, clear the SW cache (/api/ted, /)
    const h = (e: Event) => {
      const f = e.target;
      if (!(f instanceof HTMLFormElement) || !f.action.endsWith("/api/logout") || !("caches" in window)) return;
      e.preventDefault();
      void caches.delete("bmqos-v1").catch(() => undefined).finally(() => f.submit());
    };
    document.addEventListener("submit", h);
    return () => document.removeEventListener("submit", h);
  }, []);
  useEffect(() => { if (hash.startsWith("#settings")) void loadPush(); }, [hash, loadPush]);
  const pushPost = (body: object) => fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json() as Promise<{ sent?: number }>).catch(() => ({ sent: 0 }));
  const pushOn = async () => {
    if (!push || (await Notification.requestPermission()) !== "granted") return void loadPush();
    const reg = await navigator.serviceWorker.ready;
    const b64 = push.key.replace(/-/g, "+").replace(/_/g, "/");
    const key = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
    const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
    await pushPost({ sub: sub.toJSON() });
    void loadPush();
  };
  const pushOff = async () => {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (sub) { await pushPost({ id: await idOf(sub.endpoint) }); await sub.unsubscribe(); }
    void loadPush();
  };

  const ex = { card, playing, editing, live, soc, post, stor, tops, docs, proj, ix, push, tk,
    crewTeam, crewTx: crewTxRef.current, crewSend, crewTasks, crewTaskDetail, crewTaskErr, crewUsage: crewUsageRef.current, crewBrainHits, crewNode, crewNodeErr, herm };
  const social = route.s === "social";
  // an unfinished task brief must not disappear on data refresh: while the form is in progress (and tk doesn't change), keep the previous HTML
  const lastHtml = useRef({ html: "", tk });
  const html = useMemo(() => {
    const next = snap && !social ? shell(snap, route, compact, stale, ex) : "";
    const dirty = [...(root.current?.querySelectorAll<HTMLInputElement>("[data-task-form] input[name=title], [data-task-form] textarea") ?? [])].some((e) => e.value);
    const out = dirty && lastHtml.current.tk === tk && lastHtml.current.html ? lastHtml.current.html : next;
    lastHtml.current = { html: out, tk };
    return out;
  }, [snap, route, compact, stale, social, herm, card, playing, editing, live, soc, post, stor, tops, docs, proj, ix, push, tk, crewTeam, crewTxV, crewSend, crewTasks, crewTaskDetail, crewTaskErr, crewUsageV, crewBrainHits, crewNode, crewNodeErr]); // eslint-disable-line react-hooks/exhaustive-deps
  const frame = useMemo(() => (snap && social ? chrome(snap, route, compact, stale, ex) : null), [snap, route, compact, stale, social, herm, card, playing, editing, live, soc, post, stor, tops, docs, proj, ix, push, tk, crewTeam, crewTxV, crewSend, crewTasks, crewTaskDetail, crewTaskErr, crewUsageV, crewBrainHits, crewNode, crewNodeErr]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (herm) paintChat(); }, [html, frame, herm, paintChat]);

  /* Storage: load on entry (and for the Needs attention bar on Overview), refresh every 60 s */
  useEffect(() => {
    if (route.s !== "servers" && route.s !== "overview") return;
    const load = () => void fetch("/api/storage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j: StorData | null) => { if (j) setStor(j); }).catch(() => undefined);
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [route.s]);

  /* Documents: list / search / open document / old version by hash */
  const dq = route.s === "docs" ? route.q : null;
  const dKey = dq ? `${dq.q ?? ""}|${dq.doc ?? ""}|${dq.at ?? ""}` : "";
  useEffect(() => {
    if (!dq) return;
    let alive = true;
    const g = <T,>(u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<T>) : null)).catch(() => null);
    void (async () => {
      let [list, hits, doc, old] = await Promise.all([
        g<{ docs: DocsData["list"]; writeOn: boolean }>("/api/docs"),
        dq.q ? g<{ hits: NonNullable<DocsData["hits"]> }>(`/api/docs?q=${encodeURIComponent(dq.q)}`) : null,
        dq.doc ? g<DocFull>(`/api/docs?id=${encodeURIComponent(dq.doc)}`) : null,
        dq.doc && dq.at ? g<{ body: string | null }>(`/api/docs?id=${encodeURIComponent(dq.doc)}&at=${encodeURIComponent(dq.at)}`) : null,
      ]);
      const first = !dq.doc && !compact ? (hits?.hits ?? list?.docs ?? [])[0]?.id : undefined;
      if (first) doc = await g<DocFull>(`/api/docs?id=${encodeURIComponent(first)}`);
      if (alive) setDocs({ list: list?.docs ?? [], hits: hits?.hits ?? null, doc, old: old?.body != null && dq.at ? { at: dq.at, body: old.body } : null, writeOn: list?.writeOn ?? false });
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dKey, dq === null, compact]);

  /* Projects: grid (#projects) or a single project (#project&id=…); data is discarded on exit so a foreign project never shows */
  const pid = route.s === "project" ? route.q.id ?? "" : route.s === "projects" ? "*" : null;
  useEffect(() => {
    setProj(null);
    if (pid === null) return;
    let alive = true;
    const load = () => void fetch(pid === "*" ? "/api/projects" : `/api/projects/${encodeURIComponent(pid)}`, { cache: "no-store" })
      .then(async (r) => {
        const j = r.ok ? ((await r.json()) as { projects?: ProjectView[] } | ProjectView) : null;
        const list = j && "projects" in j && Array.isArray(j.projects) ? j.projects : [];
        const one = j && !("projects" in j) ? (j as ProjectView) : null;
        if (alive) setProj((prev) => (!j && r.status !== 404 && prev ? prev : { list, one, err: !j && r.status !== 404 }));
      })
      .catch(() => { if (alive) setProj((prev) => prev ?? { list: [], one: null, err: true }); });
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, [pid]);

  /* Company · Team and Tasks: refresh every 10 s only while the screen is visible */
  useEffect(() => {
    const onTeam = route.s === "crew-team", onTasks = route.s === "crew-tasks";
    if (!onTeam && !onTasks) return;
    let alive = true;
    const load = () => {
      if (document.hidden) return;
      if (onTeam) void fetch("/api/crew/team", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
        .then((j: unknown) => { if (alive) setCrewTeam(j ? { list: j as never } : { list: null, err: true }); })
        .catch(() => { if (alive) setCrewTeam((p) => p ?? { list: null, err: true }); });
      if (onTasks) {
        void fetch("/api/crew/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (alive) setCrewTasks(j ? { list: j as never } : { list: null, err: true }); })
          .catch(() => { if (alive) setCrewTasks((p) => p ?? { list: null, err: true }); });
        if (!crewTeam) void fetch("/api/crew/team", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
          .then((j) => { if (alive && j) setCrewTeam({ list: j as never }); }).catch(() => undefined);
      }
    };
    load();
    const t = setInterval(load, 10_000);
    const vis = () => { if (!document.hidden) load(); };
    document.addEventListener("visibilitychange", vis);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.s]);

  /* Company · Team detail: transcript polled every 4 s while the sheet is open */
  const crewMemberId = route.s === "crew-team" ? route.q.id ?? "" : "";
  useEffect(() => {
    const ids = crewMemberId ? [Number(crewMemberId)] : route.s === "crew-team" ? (crewTeam?.list ?? []).map((m) => m.id) : [];
    if (!ids.length) return; const t = setTimeout(() => ids.forEach(loadInstructions), 50); return () => clearTimeout(t);
  }, [crewMemberId, crewTxV, route.s, crewTeam]);
  useEffect(() => {
    if (!crewMemberId) return;
    let alive = true;
    const poll = () => {
      if (document.hidden) return;
      const after = crewTxRef.current[Number(crewMemberId)]?.lastId ?? 0;
      void fetch(`/api/crew/team/${crewMemberId}/transcript?after=${after}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ messages: TranscriptMessage[]; last_id: number }>) : null))
        .then((j) => {
          if (!alive || !j) return;
          const id = Number(crewMemberId), prev = crewTxRef.current[id]?.messages ?? [];
          if (!j.messages.length && crewTxRef.current[id]) return;
          crewTxRef.current = { ...crewTxRef.current, [id]: { messages: [...prev, ...j.messages], lastId: j.last_id } };
          setCrewTxV((v) => v + 1);
        }).catch(() => undefined);
    };
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [crewMemberId]);

  /* Company · Tasks detail: one fetch when the sheet opens */
  const crewTaskId = route.s === "crew-tasks" ? route.q.id ?? "" : "";
  useEffect(() => {
    setCrewTaskDetail(null); setCrewTaskErr(false);
    if (!crewTaskId) return;
    let alive = true;
    void fetch(`/api/crew/tasks/${crewTaskId}`, { cache: "no-store" }).then((r) => {
      if (r.status === 404) { if (alive) setCrewTaskErr(true); return null; }
      return r.ok ? r.json() : Promise.reject(new Error("tasks"));
    }).then((j) => { if (alive && j) setCrewTaskDetail(j as CrewTaskDetail); })
      .catch(() => { if (alive) setCrewTaskErr(true); });
    return () => { alive = false; };
  }, [crewTaskId]);

  /* Company · Spend: 24h/7d on demand, cached in a ref so switching doesn't redraw from scratch */
  const crewRange = route.s === "crew-usage" ? (route.q.range === "7d" ? "7d" : "24h") : null;
  useEffect(() => {
    if (!crewRange || crewUsageRef.current.data[crewRange]) return;
    let alive = true;
    void fetch(`/api/crew/usage?range=${crewRange}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Usage>) : Promise.reject(new Error("usage"))))
      .then((u) => { if (!alive) return; crewUsageRef.current = { data: { ...crewUsageRef.current.data, [crewRange]: u } }; setCrewUsageV((v) => v + 1); })
      .catch(() => { if (alive) { crewUsageRef.current = { ...crewUsageRef.current, err: true }; setCrewUsageV((v) => v + 1); } });
    return () => { alive = false; };
  }, [crewRange]);

  /* Company · Brain: search (debounced) + open node */
  const crewQ = route.s === "crew-brain" ? route.q.q ?? "" : "";
  useEffect(() => {
    if (!crewQ) { setCrewBrainHits(null); return; }
    let alive = true;
    const t = setTimeout(() => {
      void fetch(`/api/crew/brain/search?q=${encodeURIComponent(crewQ)}`, { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<{ results: BrainHit[] }>) : null))
        .then((j) => { if (alive) setCrewBrainHits(j?.results ?? []); }).catch(() => { if (alive) setCrewBrainHits([]); });
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [crewQ]);
  const crewNodeId = route.s === "crew-brain" ? route.q.node ?? "" : "";
  useEffect(() => {
    setCrewNode(null); setCrewNodeErr(false);
    if (!crewNodeId) return;
    let alive = true;
    void fetch(`/api/crew/brain/node/${crewNodeId}`, { cache: "no-store" }).then((r) => {
      if (r.status === 404) { if (alive) setCrewNodeErr(true); return null; }
      return r.ok ? r.json() : Promise.reject(new Error("node"));
    }).then((j) => { if (alive && j) setCrewNode(j as BrainNode); }).catch(() => { if (alive) setCrewNodeErr(true); });
    return () => { alive = false; };
  }, [crewNodeId]);

  /* Company · send a message to an employee / give the company a task; busy/ok/err state for the UI */
  const crewSend2 = async (url: string, body: object, key: string, after?: () => void) => {
    setCrewSend((o) => ({ ...o, [key]: "busy" }));
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    setCrewSend((o) => ({ ...o, [key]: r?.ok ? "ok" : "err" }));
    if (r?.ok) after?.();
  };

  const showImgs = () => {
    const box = root.current?.querySelector("#cimgs");
    if (box) box.innerHTML = imgsRef.current.map((im, i) => `<span class="cimg"><img src="${im.dataUrl}" alt=""><button data-imgx="${i}" aria-label="Remove image">×</button></span>`).join("");
  };
  const addImgs = async (files: File[]) => {
    for (const f of files) {
      if (imgsRef.current.length >= 3) return void setToast({ msg: "At most 3 images", undo: () => setToast(null) });
      if (!f.type.startsWith("image/") || f.size > 4_000_000) { setToast({ msg: "Images up to 4 MB only", undo: () => setToast(null) }); continue; }
      const dataUrl = await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(f); });
      imgsRef.current = [...imgsRef.current, { name: f.name.slice(0, 80), dataUrl }];
    }
    showImgs();
  };

  const sendChat = async (text: string) => {
    busyRef.current = true;
    const images = imgsRef.current;
    imgsRef.current = [];
    showImgs();
    const notes = notesRef.current.splice(0).join("\n");
    chatRef.current = [...chatRef.current, { role: "user", text, images: images.length || undefined, src: "bmqos" }, { role: "assistant", text: "", src: "bmqos" }];
    paintChat();
    const log = root.current?.querySelector("#clog");
    const last = log?.lastElementChild;
    const bt = last?.querySelector<HTMLElement>(".bt");
    const evs = last?.querySelector<HTMLElement>(".evs");
    const node = document.createTextNode("");
    bt?.classList.add("live");
    bt?.appendChild(node);
    const cur = routeRef.current;
    const near = () => !log || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: notes ? `${notes}\n${text}` : text, view: cur.s, issue: cur.q.issue ?? "", ...(images.length ? { images } : {}) }) }).catch(() => null);
    const rd = res?.body?.getReader(), dec = new TextDecoder();
    const appr: NonNullable<ChatMsg["approvals"]> = [];
    let buf = "", full = "", err = "";
    try {
      while (rd) {
        const { done, value } = await rd.read();
        if (done) break;
        const p = parseSse(buf + dec.decode(value, { stream: true }));
        buf = p.rest;
        for (const ev of p.events) {
          if (ev.error) err = ev.error;
          const add = ev.delta ?? "";
          if (add) { full += add; const stick = near(); node.appendData(add); if (stick && log) log.scrollTop = log.scrollHeight; }
          if (ev.tool && evs) evs.innerHTML = ev.tool.state === "done" ? "" : `<span class="mono">using tool ${esc(ev.tool.name)}…</span>`;
          if (ev.approval && Array.isArray(ev.approval.choices) && ev.approval.choices.includes("once")) {
            appr.push({ run: ev.approval.run, title: ev.approval.title });
            if (evs) evs.insertAdjacentHTML("beforeend", apprCard(appr[appr.length - 1]));
            if (log) log.scrollTop = log.scrollHeight;
          }
        }
      }
    } catch { /* connection dropped: keep the text received so far */ }
    if (!rd) err = "BMQOS couldn't reach the Assistant. Check the connection and try again.";
    if (!full && !err) err = "The Assistant didn't respond. Try again.";
    chatRef.current = [...chatRef.current.slice(0, -1), { role: "assistant", text: full, src: "bmqos", approvals: appr.length ? appr : undefined, err: err || undefined, ask: err ? text : undefined }];
    busyRef.current = false;
    paintChat(); // once at the end: markdown, action cards, links
    for (const sg of splitActions(full)) if (sg.t === "act" && sg.a.do === "open" && !opened.current.has(sg.a.id + full.length)) { opened.current.add(sg.a.id + full.length); location.hash = `waiting&issue=${sg.a.id}`; break; }
  };

  /* action suggested by the Assistant: runs only after a click and only through existing guarded endpoints; the result goes back to the Assistant on the next turn */
  const runAct = (key: string) => {
    if (busyRef.current || actsRef.current[key] === "busy") return;
    const [i, n] = key.split(":").map(Number);
    const sg = splitActions(chatRef.current[i]?.text ?? "").find((x) => x.t === "act" && x.n === n);
    if (!sg || sg.t !== "act") return;
    const a: Action = sg.a;
    const set = (st: string) => { actsRef.current[key] = st; if (!busyRef.current) paintChat(); };
    const ok = (note: string) => () => { notesRef.current.push(`[BMQOS: done – ${note}]`); set("ok"); };
    const bad = () => set("err");
    set("busy");
    if (a.do === "open") { location.hash = `waiting&issue=${a.id}`; return ok(`opened ${a.id}`)(); }
    if (a.do === "answer") return void (a.qid ? send(`Reply to ${a.id}`, { issue: a.id, qid: a.qid, value: a.text }, ok(`reply to ${a.id}`), undefined, "/api/inbox/answer", bad) : send(`Reply to ${a.id}`, { op: "reply", id: a.id, value: a.text }, ok(`comment on ${a.id}`), undefined, "/api/act", bad));
    if (a.do === "approve" || a.do === "reject") return void send(a.do === "approve" ? `Approved ${a.id}` : `Sent back for rework ${a.id}`, { op: "status", id: a.id, value: a.do === "approve" ? "done" : "in_progress" }, ok(`${a.do === "approve" ? "approved" : "sent back for rework"} ${a.id}`), undefined, "/api/act", bad);
    if (a.do === "comment") return void send(`Comment on ${a.id}`, { op: "reply", id: a.id, value: a.text }, ok(`comment on ${a.id}`), undefined, "/api/act", bad);
    const o = tk.opts, by = (l: { id: string; name: string }[], q?: string) => (q ? l.find((x) => x.name.toLowerCase() === q.toLowerCase()) : undefined);
    const prio = o?.priorities.includes(a.priority ?? "") ? a.priority : undefined;
    if (a.do === "update") {
      const ag = by(o?.agents ?? [], a.agent);
      if (!o || (a.agent && !ag)) return bad(); // unknown agent: nothing is sent blindly
      return void send(`Edit ${a.id}`, { assigneeAgentId: ag?.id, priority: prio, title: a.title }, ok(`edited ${a.id}`), undefined, `/api/tasks/${a.id}`, bad, "PATCH");
    }
    const ag = o && (a.agent ? by(o.agents, a.agent) : by(o.agents, "CTO")), pr = by(o?.projects ?? [], a.project);
    if (!o) return bad();
    // unknown agent or project = form pre-filled for editing, nothing is sent
    if (!ag || !pr) { set(""); setTk((t) => ({ ...t, draft: { title: a.title ?? "", agent: a.agent ?? "CTO", project: a.project ?? "", priority: prio ?? "medium", zadani: a.text } })); location.hash = "waiting"; return; }
    void send("New task", { title: a.title, assigneeAgentId: ag.id, projectId: pr.id, priority: prio ?? "medium", zadani: a.text }, (id) => { ok(`created task${id ? ` ${id}` : ""} "${a.title}"`)(); if (id) set(`ok:${id}`); }, undefined, "/api/tasks", bad);
  };

  /* Edit: opens the New task form pre-filled from the suggestion */
  const editAct = (key: string) => {
    const [i, n] = key.split(":").map(Number);
    const sg = splitActions(chatRef.current[i]?.text ?? "").find((x) => x.t === "act" && x.n === n);
    if (!sg || sg.t !== "act") return;
    const a = sg.a;
   
    setTk((t) => ({ ...t, draft: { title: a.title ?? "", agent: a.agent ?? "CTO", project: a.project ?? "", priority: a.priority ?? "medium", zadani: a.text } }));
    location.hash = "waiting";
  };

  const askRun = (run: string, choice: "once" | "deny") =>
    void send(choice === "once" ? "Allowed once" : "Rejected", { run, choice }, () => {
      const m = chatRef.current.find((x) => x.approvals?.some((p) => p.run === run));
      const p = m?.approvals?.find((x) => x.run === run);
      if (p) p.state = choice;
      const card = document.querySelector(`[data-appr="${run}"]`)?.closest(".appr");
      card?.insertAdjacentHTML("afterend", apprCard({ run, title: p?.title ?? "", state: choice }));
      card?.remove();
    }, undefined, "/api/chat/approval");

  const ask = (issue: string, qid: string, value: string) =>
    act(`Answer to question ${qid}`, { issue, qid, value }, () => { setEditing(""); void loadCard(issue); }, undefined, "/api/inbox/answer");

  /* hover on the canvas: dim the surroundings, draw connectors, tooltip */
  const stage = useCallback((ev: MouseEvent<HTMLDivElement>) => {
    const el = root.current?.querySelector<HTMLElement>("#stage");
    const svg = el?.querySelector("svg");
    const tip = el?.querySelector<HTMLElement>(".tip");
    const hov = svg?.querySelector("#hovl");
    if (!el || !svg || !tip || !hov || !snap) return;
    const clear = () => { hov.replaceChildren(); el.classList.remove("dim"); svg.querySelectorAll(".hl").forEach((p) => p.classList.remove("hl")); tip.classList.remove("show"); };
    clear();
    const t = ev.target as Element;
    const g = t.closest<SVGGElement>(".agent[data-a]");
    const il = t.closest<SVGGElement>(".island-l");
    const pid = g ? snap.agents.find((a) => a.id === g.dataset.a)?.pr : il?.dataset.p;
    if (!pid) return;
    el.classList.add("dim");
    svg.querySelectorAll(`[data-p="${CSS.escape(pid)}"]`).forEach((p) => p.classList.add("hl"));
    if (!g) return;
    const a = snap.agents.find((x) => x.id === g.dataset.a);
    if (!a) return;
    const ax = Number(g.dataset.x), ay = Number(g.dataset.y);
    svg.querySelectorAll<SVGCircleElement>(`.pt[data-p="${CSS.escape(pid)}"][data-st="o"],.pt[data-p="${CSS.escape(pid)}"][data-st="a"]`).forEach((p, i) => {
      if (i > 4) return;
      const x = Number(p.getAttribute("cx")), y = Number(p.getAttribute("cy"));
      const path = document.createElementNS(svgNS, "path");
      path.setAttribute("class", "link hov");
      path.setAttribute("style", `--len:${Math.round(Math.hypot(x - ax, y - ay) * 1.1)}`);
      path.setAttribute("d", `M${ax} ${ay} Q ${400 + (ax - 400) * 0.25} ${400 + (ay - 400) * 0.25} ${x} ${y}`);
      hov.appendChild(path);
    });
    const proj = snap.projects.find((p) => p.id === a.pr)?.n ?? "Other";
    const cls = a.st === "running" ? "lime" : a.st === "error" ? "red" : "";
    tip.innerHTML = `<b>${esc(a.n)}</b><span class="mono">${esc(a.role)}</span><span class="mono ${cls}" style="margin-top:8px">● ${ST[a.st]}${a.cur ? ` · ${esc(a.cur)}` : ""} · ${esc(proj)}</span>`;
    const b = el.getBoundingClientRect(), sb = svg.getBoundingClientRect(), k = sb.width / 800, ox = (b.width - sb.width) / 2;
    let px = ox + ax * k + 24;
    const py = (b.height - sb.height) / 2 + ay * k - 30;
    if (px + 210 > b.width) px = ox + ax * k - 230;
    tip.style.left = `${Math.max(8, px)}px`;
    tip.style.top = `${Math.max(8, py)}px`;
    tip.classList.add("show");
  }, [snap]);

  const change = (ev: Event) => {
    const el = ev.target as HTMLSelectElement;
    if (el.id === "cfile") { const f = (el as unknown as HTMLInputElement).files; void addImgs(Array.from(f ?? [])); (el as unknown as HTMLInputElement).value = ""; return; }
    if (el.dataset.ttyped !== undefined || el.dataset.tcode !== undefined) {
      const sd = el.closest(".sdet"), b = sd?.querySelector<HTMLButtonElement>("[data-sact]");
      if (b) b.disabled = sd?.querySelector<HTMLInputElement>("[data-ttyped]")?.value.trim() !== b.dataset.host || !/^\d{6}$/.test(sd?.querySelector<HTMLInputElement>("[data-tcode]")?.value.trim() ?? "");
      return;
    }
    if (!el.dataset.set || !el.dataset.id) return;
    act(el.dataset.set === "status" ? `Status ${el.dataset.id} → ${el.selectedOptions[0].text}` : `Reassign ${el.dataset.id} → ${el.selectedOptions[0].text}`,
      { op: el.dataset.set, id: el.dataset.id, value: el.value }, undefined, () => { el.value = el.dataset.prev ?? el.value; });
  };

  // the select lives in innerHTML (outside the React tree) → React onChange won't catch it, so use a native listener
  const sendRef = useRef(send), loadRef = useRef(loadItems);
  sendRef.current = send;
  loadRef.current = loadItems;
  const changeRef = useRef(change);
  changeRef.current = change;
  const crewSendRef = useRef(crewSend2);
  crewSendRef.current = crewSend2;
  useEffect(() => {
    const r = root.current;
    const h = (e: Event) => changeRef.current(e);
    const hi = (e: Event) => { if ((e.target as HTMLElement).matches("[data-ttyped],[data-tcode]")) changeRef.current(e); };
    const sub = (e: Event) => {
      const f = e.target as HTMLFormElement;
      if (f.matches("[data-add-form]")) {
        e.preventDefault();
        const inp = f.elements.namedItem("t") as HTMLInputElement, text = inp.value.trim();
        if (text) void sendRef.current("Add task", { op: "add", text }, () => { inp.value = ""; void loadRef.current(); }, undefined, "/api/items");
        return;
      }
      if (f.matches("[data-task-form]")) {
        e.preventDefault();
        const v = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim();
        const title = v("title");
        const err = f.querySelector<HTMLElement>("[data-err]");
        if (err) err.hidden = !!title;
        if (title) void sendRef.current("New task", { title, assigneeAgentId: v("assigneeAgentId"), projectId: v("projectId"), priority: v("priority"), zadani: (f.elements.namedItem("zadani") as HTMLTextAreaElement).value }, () => { f.reset(); setTk((t) => ({ ...t, draft: undefined })); void loadRef.current(); }, undefined, "/api/tasks");
        return;
      }
      if (f.matches("[data-crew-task-form]")) {
        e.preventDefault();
        const ta = f.elements.namedItem("text") as HTMLTextAreaElement, raw = ta.value.trim();
        if (!raw) return;
        const text = f.dataset.task ? `Re task #${f.dataset.task}: ${raw}` : raw; // CEO query directly from the task detail
        void crewSendRef.current("/api/crew/chat", { text }, "crew-chat", () => { ta.value = ""; void fetch("/api/crew/tasks", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j) setCrewTasks({ list: j as never }); }); });
        return;
      }
      if (f.matches("[data-crew-search-form]")) {
        e.preventDefault();
        const v = (f.elements.namedItem("q") as HTMLInputElement).value.trim();
        location.hash = `crew-brain${v ? `&q=${encodeURIComponent(v)}` : ""}`;
        return;
      }
      if (!f.matches("[data-dsearch]")) return;
      e.preventDefault();
      const v = (f.elements.namedItem("q") as HTMLInputElement).value.trim();
      location.hash = `docs${v ? `&q=${encodeURIComponent(v)}` : ""}`;
    };
    r?.addEventListener("change", h);
    r?.addEventListener("input", hi);
    r?.addEventListener("submit", sub);
    return () => { r?.removeEventListener("change", h); r?.removeEventListener("input", hi); r?.removeEventListener("submit", sub); };
  }, []);

  /* Home tiles; writes go through act() → /api/act (step-up guard watches past layer 1) */
  const doAct = (id: string) => {
    if (!snap) return;
    const go = (h: string) => { location.hash = h; };
    const chat = (pre?: string) => {
      setHerm(true);
      setTimeout(() => { const ta = root.current?.querySelector<HTMLTextAreaElement>("textarea[data-chat]"); if (!ta) return; if (pre) ta.value = pre; ta.focus(); }, 150);
    };
    const oldest = [...snap.wait].sort((a, b) => b.ageMin - a.ageMin)[0];
    if (id === "hermes") chat();
    else if (id === "task") chat("New task: ");
    else if (id === "reply" && oldest) go(`waiting&issue=${oldest.id}`);
    else if (id === "posts") go("social");
    else if (id === "merge") go("waiting");
    else if (id === "disks") go("servers");
    else if (id === "deploy") dispatchEvent(new CustomEvent("bmq:cmdk", { detail: "redeploy " }));
    else if (id === "stop" || id === "wake") {
      const stop = id === "stop";
      const who = snap.agents.filter((a) => a.st === (stop ? "running" : "paused"));
      if (!who.length) return;
      setDlg({
        title: stop ? `Pause ${who.length} agents?` : `Wake ${who.length} agents?`,
        items: who.map((a) => `${a.n}${a.cur ? ` · ${a.cur}` : ""}`),
        ok: stop ? "Stop all" : "Wake all",
        run: () => act(stop ? `Pausing ${who.length} agents` : `Waking ${who.length} agents`, { op: "agents", id: who.map((a) => a.id).join(","), value: stop ? "pause" : "resume" }),
      });
    }
  };
  const doRef = useRef(doAct);
  doRef.current = doAct;
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (dlg || e.metaKey || e.ctrlKey || e.altKey || !snap) return;
      if ((e.target as HTMLElement).closest("input,textarea,select,[contenteditable]") || document.querySelector(".ck-back")) return;
      const key = e.shiftKey ? (e.key === "S" ? "⇧S" : "") : e.key.toUpperCase();
      if (key === "H") { e.preventDefault(); setHerm((o) => !o); return; }
      if (route.s !== "overview") return;
      const t = tiles(snap, post ? soc : 0).find((x) => x.k === key);
      if (t) { e.preventDefault(); doRef.current(t.id); }
    };
    addEventListener("keydown", k);
    return () => removeEventListener("keydown", k);
  }, [route.s, dlg, snap, soc, post]);

  const click = (ev: MouseEvent<HTMLDivElement>) => {
    const t = ev.target as Element;
    const go = (h: string) => { location.hash = h; };
    const s = route.s;
    const hbtn = t.closest<HTMLElement>("[data-herm]");
    if (hbtn?.dataset.herm) { setHerm(hbtn.dataset.herm === "open"); return; }
    if (t.closest("[data-close]")) return go(s);
    const crm = t.closest<HTMLElement>("[data-crew-m]");
    if (crm?.dataset.crewM) return go(`crew-team&id=${crm.dataset.crewM}`);
    const crt = t.closest<HTMLElement>("[data-crew-t]");
    if (crt?.dataset.crewT) return go(`crew-tasks&id=${crt.dataset.crewT}`);
    const crs = t.closest<HTMLElement>("[data-crew-send]");
    if (crs?.dataset.crewSend) {
      const id = crs.dataset.crewSend;
      const ta = crs.closest(".bd")?.querySelector<HTMLTextAreaElement>(`[data-crew-msg="${id}"]`);
      const text = ta?.value.trim();
      if (!text) return;
      if (ta) ta.value = "";
      return void crewSend2(`/api/crew/team/${id}/message`, { text }, id, () => { crewTxRef.current = { ...crewTxRef.current }; });
    }
    const be = t.closest<HTMLElement>("[data-bedit]");
    if (be?.dataset.bedit) return editAct(be.dataset.bedit);
    const ba = t.closest<HTMLElement>("[data-bact]");
    if (ba?.dataset.bact) return runAct(ba.dataset.bact);
    const ac = t.closest<HTMLElement>("[data-acc]");
    if (ac?.dataset.acc && ac.tagName === "BUTTON") { const k = ac.dataset.acc; document.documentElement.dataset.acc = k; try { localStorage.setItem("bmqos-acc2", k); } catch { /* no storage available */ } paintAcc(); return; }
    const rt = t.closest<HTMLElement>("[data-retry]");
    if (rt && !busyRef.current) { const k = Number(rt.dataset.retry), m = chatRef.current[k]; if (m?.ask) { chatRef.current = chatRef.current.filter((_, j) => j !== k && j !== k - 1); return void sendChat(m.ask); } }
    const ap = t.closest<HTMLElement>("[data-appr]");
    if (ap?.dataset.appr) return askRun(ap.dataset.appr, ap.dataset.choice === "once" ? "once" : "deny");
    if (t.closest("[data-attach]")) return void root.current?.querySelector<HTMLInputElement>("#cfile")?.click();
    const ix = t.closest<HTMLElement>("[data-imgx]");
    if (ix) { imgsRef.current = imgsRef.current.filter((_, j) => j !== Number(ix.dataset.imgx)); return showImgs(); }
    const iss = t.closest<HTMLElement>("a.iss");
    if (iss?.dataset.issue) { ev.preventDefault(); return go(`waiting&issue=${iss.dataset.issue}`); }
    const sug = t.closest<HTMLElement>("[data-sug]");
    if (sug?.dataset.sug) { if (!busyRef.current) void sendChat(sug.dataset.sug); return; }
    if (t.closest("[data-cmdk]")) return void dispatchEvent(new CustomEvent("bmq:cmdk"));
    const dd = t.closest<HTMLElement>("[data-do]");
    if (dd?.dataset.do) return doAct(dd.dataset.do);
    const sc = t.closest<HTMLElement>("[data-scroll]");
    if (sc?.dataset.scroll) return void root.current?.querySelector(`#${CSS.escape(sc.dataset.scroll)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const rv = t.closest<HTMLElement>("[data-rv]")?.dataset.rv;
    if (rv) {
      setTk((o) => ({ ...o, rv: { id: rv, gates: null } }));
      return void fetch(`/api/tasks/review?id=${encodeURIComponent(rv)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("rv")))).then((j: { gates: NonNullable<TaskUi["rv"]>["gates"] }) => setTk((o) => ({ ...o, rv: { id: rv, gates: j.gates } }))).catch(() => setTk((o) => ({ ...o, rv: { id: rv, gates: null, err: true } })));
    }
    if (t.closest("[data-itretry]")) { setIx(null); return void loadItems(); }
    const pf = t.closest<HTMLElement>("[data-pref]");
    if (pf?.dataset.pref) return void pushPost({ cat: pf.dataset.pref, mode: pf.dataset.mode }).then(loadPush);
    const pu = t.closest<HTMLElement>("[data-push]");
    if (pu?.dataset.push === "on") return void pushOn();
    if (pu?.dataset.push === "off") return void pushOff();
    if (pu?.dataset.push === "test") return void pushPost({ test: true }).then((r) => setToast({ msg: r.sent ? "Test sent" : "Couldn't send anywhere", undo: () => setToast(null) }));
    const un = t.closest<HTMLElement>("[data-unsub]");
    if (un?.dataset.unsub) return void pushPost({ id: un.dataset.unsub }).then(loadPush);
    const rl = t.closest<HTMLElement>("[data-release]");
    if (rl?.dataset.release) {
      const p = proj?.one;
      if (!p || p.id !== rl.dataset.release || relBusy.current) return;
      relBusy.current = true;
      return void fetch("/api/release", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: p.id, commits: p.envs.test?.commits }) })
        .then(async (r) => { const j = (await r.json().catch(() => ({}))) as { id?: number; error?: string }; if (r.ok && j.id) go(`waiting&item=card:${j.id}`); else if (r.status === 409) go("waiting"); else setToast({ msg: j.error ?? "Couldn't create the card", undo: () => setToast(null) }); })
        .catch(() => setToast({ msg: "Couldn't create the card", undo: () => setToast(null) }))
        .finally(() => { relBusy.current = false; });
    }
    const it = t.closest<HTMLElement>("[data-item]");
    if (it?.dataset.item) return go(`${s}&item=${encodeURIComponent(it.dataset.item)}`);
    const ia = t.closest<HTMLElement>("[data-ia]");
    if (ia?.dataset.id) {
      const id = ia.dataset.id, op = ia.dataset.ia, msg = ia.dataset.msg ?? "Akce", done = () => void loadItems();
      if (op === "card") return act(msg, { choice: Number(ia.dataset.v) }, done, undefined, `/api/cards/${id.replace("card:", "")}`);
      if (op === "snooze") return act(msg, { op, id, until: snoozeUntil(Number(ia.dataset.days)) }, done, undefined, "/api/items");
      return act(msg, { op, id }, done, undefined, "/api/items");
    }
    const btn = t.closest<HTMLElement>("[data-act]");
    if (btn?.dataset.id && btn.dataset.v) return act(btn.dataset.msg ?? "Akce", { op: btn.dataset.act ?? "", id: btn.dataset.id, value: btn.dataset.v });
    const send = t.closest<HTMLElement>("[data-send]");
    if (send?.dataset.send) {
      const ta = send.closest(".ctl")?.querySelector<HTMLTextAreaElement>("textarea");
      if (!ta?.value.trim()) return;
      return act("Reply", { op: "reply", id: send.dataset.send, value: ta.value }, () => { ta.value = ""; });
    }
    const tp = t.closest<HTMLElement>("[data-top]");
    if (tp?.dataset.top) {
      const key = tp.dataset.top, [host, path] = key.split("|");
      setTops((o) => ({ ...o, [key]: null }));
      return void fetch(`/api/storage?host=${encodeURIComponent(host)}&path=${encodeURIComponent(path)}`, { cache: "no-store" }).then((r) => r.json()).then((j: { top: Tops[string] }) => setTops((o) => ({ ...o, [key]: j.top }))).catch(() => undefined);
    }
    const sa = t.closest<HTMLElement>("[data-sact]");
    if (sa?.dataset.sact && !sa.hasAttribute("disabled")) {
      const sd = sa.closest(".sdet"), typed = sd?.querySelector<HTMLInputElement>("[data-ttyped]")?.value.trim(), code = sd?.querySelector<HTMLInputElement>("[data-tcode]")?.value.trim();
      return act(`${sa.textContent} · ${sa.dataset.host}`, { host: sa.dataset.host, name: sa.dataset.sact, confirm: true, typed, code }, undefined, undefined, "/api/storage");
    }
    const ds = t.closest<HTMLElement>("[data-dsave]");
    if (ds?.dataset.dsave) {
      const ta = root.current?.querySelector<HTMLTextAreaElement>("textarea[data-dbody]");
      if (ta) return act("Save document", { action: "save", id: ds.dataset.dsave, body: ta.value }, () => { location.hash = `docs&doc=${encodeURIComponent(ds.dataset.dsave ?? "")}`; }, undefined, "/api/docs");
    }
    const play = t.closest<HTMLElement>("[data-play]");
    if (play?.dataset.play) return setPlaying(play.dataset.play);
    const jump = t.closest<HTMLElement>("[data-jump]");
    if (jump?.dataset.jump) { ev.preventDefault(); return jump.closest(".card")?.querySelector(`[data-sec="${CSS.escape(jump.dataset.jump)}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }
    const qa = t.closest<HTMLElement>("[data-qa]");
    if (qa?.dataset.qa && card) return ask(card.issue, qa.dataset.qa, qa.dataset.v ?? "");
    const qs = t.closest<HTMLElement>("[data-qsend]");
    if (qs?.dataset.qsend && card) {
      const ta = qs.closest(".free")?.querySelector<HTMLTextAreaElement>("textarea");
      if (ta?.value.trim()) ask(card.issue, qs.dataset.qsend, ta.value.trim());
      return;
    }
    const qc = t.closest<HTMLElement>("[data-qchange]");
    if (qc?.dataset.qchange) return setEditing(qc.dataset.qchange);
    const cs = t.closest<HTMLElement>("[data-chatsend]");
    if (cs) {
      const ta = root.current?.querySelector<HTMLTextAreaElement>("textarea[data-chat]");
      const v = ta?.value.trim();
      if ((v || imgsRef.current.length) && !busyRef.current) { if (ta) ta.value = ""; void sendChat(v || "(image)"); }
      return;
    }
    const copy = t.closest<HTMLElement>("[data-copy]");
    if (copy?.dataset.copy) { void navigator.clipboard.writeText(copy.dataset.copy); copy.textContent = "Copied"; return; }
    const core = t.closest<HTMLElement>("[data-go]");
    if (core?.dataset.go) return go(core.dataset.go);
    const ag = t.closest<HTMLElement>("[data-agent],[data-a]");
    const aid = ag?.dataset.agent ?? ag?.dataset.a;
    if (aid) return go(`${s}&agent=${aid}`);
    const is = t.closest<HTMLElement>("[data-issue]");
    if (is?.dataset.issue) return go(`${s}&issue=${is.dataset.issue}`);
    const chip = t.closest(".chip");
    if (chip && snap?.wait.some((w) => w.id === chip.textContent)) go(`flow&issue=${chip.textContent}`);
  };

  const chatKey = (e: RKey<HTMLDivElement>) => {
    const ta = e.target as HTMLElement;
    if (!sendsOnEnter({ key: e.key, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing }, ta.matches("textarea[data-chat]"), matchMedia("(any-pointer:fine)").matches)) return;
    e.preventDefault();
    root.current?.querySelector<HTMLElement>("[data-chatsend]")?.click();
  };

  const vRef = useRef(sendChat);
  vRef.current = sendChat;
  useEffect(() => bindVoice({ chat: (t) => { if (!busyRef.current) void vRef.current(t); }, task: (b, done) => sendRef.current("New task", b, done, undefined, "/api/tasks") }), []);
  useEffect(() => (root.current ? mountCharts(root.current) : undefined), [html]);
  useEffect(() => { if (root.current?.querySelector("#brand-root")) return mountBrand(root.current); }, [html]);
  useEffect(() => { if (root.current?.querySelector("#ideas-root")) return mountIdeas(root.current); }, [html]);
  useEffect(() => { if (root.current?.querySelector("#crewgraph")) return mountCrewGraph(root.current); }, [html]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key !== "Escape") return;
      if (document.querySelector(".ck-back,.dlg-back")) return;
      if (herm) { setHerm(false); return; }
      const crewOv = /^crew-(team|tasks)/.test(route.s) && route.q.id || route.s === "crew-brain" && route.q.node;
      if (/agent=|issue=|item=/.test(location.hash) || crewOv) location.hash = route.s; };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [route.s, route.q, herm]);

  return (
    <div id="root" ref={root} onClick={click} onKeyDown={chatKey} onMouseOver={stage} onMouseLeave={stage}>
      {frame ? (
        <>
          <div className="app">
            <div className="fr" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: frame.head }} />
            <Social compact={compact} />
            <div className="fr" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: frame.foot }} />
          </div>
          <div className="fr" style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: frame.herm }} />
        </>
      ) : snap ? <div style={{ display: "contents" }} dangerouslySetInnerHTML={{ __html: html }} /> : <div className="hint" style={{ padding: 40 }}>Loading…</div>}
      {snap?.sim !== undefined && <button type="button" className="simbtn" onClick={() => void simToggle(!simOn)}>{simOn ? "■ Stop simulation" : "▶ Simulate a live run"}</button>}
      {step && <StepUp need={step.need} onClose={() => setStep(null)} onDone={() => { const r = step.retry; setStep(null); r(); }} />}
      <CmdK />
      {dlg && (
        <div className="dlg-back" onMouseDown={(e) => { if (e.target === e.currentTarget) setDlg(null); }} onKeyDown={(e) => { if (e.key === "Escape") setDlg(null); }}>
          <div className="dlg" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t">
            <h2 id="dlg-t">{dlg.title}</h2>
            <ul>{dlg.items.map((x) => <li key={x}>{x}</li>)}</ul>
            <p className="hint">You can undo this with the Undo button within 6 seconds.</p>
            <div className="dlg-a"><button className="btn ghost" autoFocus onClick={() => setDlg(null)}>Cancel</button><button className="btn danger" onClick={() => { const r = dlg.run; setDlg(null); r(); }}>{dlg.ok}</button></div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status"><span>{toast.msg}</span><button onClick={toast.undo}>Undo</button></div>}
    </div>
  );
}
