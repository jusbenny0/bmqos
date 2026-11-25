import type { ReactNode } from "react";
import type { EmpStatus, TaskStatus } from "./types";

export const card = "lift rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]";
export const btn =
  "inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50";
export const input =
  "w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--fg)] outline-none focus:border-[var(--accent)]";

const tone: Record<string, string> = {
  idle: "", busy: "pill-info", error: "pill-err",
  todo: "", doing: "pill-info", review: "pill-warn", done: "pill-ok", blocked: "pill-err",
};
export const statusLabel: Record<EmpStatus | TaskStatus, string> = {
  idle: "Idle", busy: "Working", error: "Error",
  todo: "To do", doing: "In progress", review: "Review", done: "Done", blocked: "Blocked",
};

export function Status({ s }: { s: EmpStatus | TaskStatus }) {
  return <span className={`pill ${tone[s]}`}>{statusLabel[s]}</span>;
}

export function PageHead({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-[var(--muted)]">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

export const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
export const fmtTok = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
export const fmtUsd = (n: number) => `$${n.toFixed(2)}`;
// SQLite returns UTC without "Z" ("YYYY-MM-DD HH:MM:SS"); without it the value would be read as local time.
const parse = (iso: string) => new Date(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(" ", "T") + "Z");
export const fmtTime = (iso: string) =>
  parse(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: process.env.NEXT_PUBLIC_CREW_TZ ?? "UTC" });
export function duration(from: string, to: string) {
  const m = Math.max(0, Math.round((parse(to).getTime() - parse(from).getTime()) / 60000));
  return m < 1 ? "< 1 min" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
export function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - parse(iso).getTime()) / 60000));
  return m < 1 ? "now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
}

export function Bar({ pct, warn }: { pct: number; warn?: boolean }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--border)]">
      <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: warn ? "var(--warn)" : "var(--accent)" }} />
    </div>
  );
}
