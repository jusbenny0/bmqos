"use client";
import { useState } from "react";
import { useApi } from "@/components/api";
import { usage as mock } from "@/components/mock";
import type { Usage, UsageRow } from "@/components/types";
import { PageHead, card, fmtTok, fmtUsd } from "@/components/ui";

function Table({ title, rows }: { title: string; rows: UsageRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <section className={`${card} p-4`}>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{title}</h2>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="text-sm">
            <div className="flex justify-between gap-3">
              <span className="truncate">{r.label}</span>
              <span className="shrink-0 tabular-nums text-[var(--muted)]">{fmtTok(r.tokens)} · {fmtUsd(r.cost_usd)}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-[var(--border)]">
              <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${(r.tokens / max) * 100}%` }} />
            </div>
          </li>
        ))}
        {rows.length === 0 && <li className="text-sm text-[var(--muted)]">Nothing yet.</li>}
      </ul>
    </section>
  );
}

const parseUtc = (t: string) => new Date(t.replace(" ", "T") + "Z");

function Chart({ series, hourly }: { series: Usage["series"]; hourly: boolean }) {
  const W = 600, H = 160, pad = 4;
  const max = Math.max(1, ...series.map((s) => s.tokens));
  const bw = W / Math.max(1, series.length);
  const label = (t: string) => {
    const d = parseUtc(t);
    return hourly ? `${d.getHours()}:00` : d.toLocaleDateString("en-US", { weekday: "short", day: "numeric", month: "numeric" });
  };
  const every = hourly ? 4 : 1;
  return (
    <section className={`${card} mb-4 p-4`}>
      <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{hourly ? "Tokens per hour (24 h)" : "Tokens per day (7 d)"}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-40 w-full" role="img" aria-label="Token usage chart">
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--border)" />
        {series.map((s, i) => {
          const h = (s.tokens / max) * (H - pad);
          return (
            <g key={s.t}>
              <rect x={i * bw + bw * 0.12} y={H - h} width={bw * 0.76} height={Math.max(h, s.tokens ? 1 : 0)} rx="2" fill="var(--accent)">
                <title>{`${label(s.t)} · ${fmtTok(s.tokens)} · ${fmtUsd(s.cost_usd)}`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex text-[10px] text-[var(--muted)]">
        {series.map((s, i) => (
          <span key={s.t} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center">{i % every === 0 ? label(s.t) : ""}</span>
        ))}
      </div>
    </section>
  );
}

export default function UsagePage() {
  const [range, setRange] = useState<"1d" | "7d">("1d");
  const { data } = useApi<Usage>(`/api/usage?range=${range}`, mock, 10000);
  return (
    <>
      <PageHead title="Usage" sub="Tokens and estimated cost from messages">
        <div className="inline-flex rounded-md border border-[var(--border)] p-0.5 text-sm">
          {(["1d", "7d"] as const).map((r) => (
            <button key={r} onClick={() => setRange(r)}
              className={`rounded px-3 py-1 ${range === r ? "bg-[var(--accent)] text-white" : "text-[var(--muted)]"}`}>
              {r === "1d" ? "Today" : "7 days"}
            </button>
          ))}
        </div>
      </PageHead>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div className={`${card} p-4`}><div className="text-xs text-[var(--muted)]">Tokens</div><div className="text-2xl font-semibold tabular-nums">{fmtTok(data.total.tokens)}</div></div>
        <div className={`${card} p-4`}><div className="text-xs text-[var(--muted)]">Cost</div><div className="text-2xl font-semibold tabular-nums">{fmtUsd(data.total.cost_usd)}</div></div>
      </div>
      <Chart series={data.series} hourly={range === "1d"} />
      <div className="grid gap-4 md:grid-cols-2">
        <Table title="Per employee" rows={data.byEmployee} />
        <Table title="Per task" rows={data.byTask} />
      </div>
    </>
  );
}
