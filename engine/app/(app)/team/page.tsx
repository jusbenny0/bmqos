"use client";
import Link from "next/link";
import { useApi } from "@/components/api";
import { employees as mock } from "@/components/mock";
import type { EmployeeCard } from "@/components/types";
import { Bar, PageHead, Status, ago, card, fmtTok, statusLabel } from "@/components/ui";

function Card({ e }: { e: EmployeeCard }) {
  const busy = e.status === "busy";
  return (
    <Link href={`/team/${e.id}`} className={`${card} block p-4 transition-colors hover:border-[var(--accent)] ${busy ? "border-[var(--accent)]/50" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{e.name}</div>
          <div className="text-sm text-[var(--muted)]">{e.role} · {e.model}</div>
        </div>
        <Status s={e.status} />
      </div>

      <div className="mt-4 min-h-[3.25rem]">
        {e.task_title ? (
          <>
            <div className="text-xs text-[var(--muted)]">{e.task_status ? statusLabel[e.task_status] : "Task"} · #{e.task_id}</div>
            <div className="truncate text-sm font-medium">{e.task_title}</div>
            {e.last_step && <div className="mt-0.5 line-clamp-1 text-xs text-[var(--muted)]">↳ {e.last_step}</div>}
          </>
        ) : (
          <div className="text-sm text-[var(--muted)]">{busy ? "Working on a chat request…" : "Waiting for a task. Give one to the CEO in chat."}</div>
        )}
      </div>

      {e.last_message && (
        <div className="mt-3 rounded-md bg-[var(--surface-2)] px-3 py-2 text-xs">
          <div className="line-clamp-2 break-words">{e.last_message}</div>
          {e.last_message_at && <div className="mt-1 text-[11px] text-[var(--muted)]">{ago(e.last_message_at)}</div>}
        </div>
      )}

      <div className="mt-4 flex items-baseline justify-between text-xs text-[var(--muted)]">
        <span><span className="text-base font-semibold text-[var(--fg)]">{fmtTok(e.tokens_today)}</span> tok dnes</span>
        <span>kontext {Math.round(e.context_pct)} %</span>
      </div>
      <div className="mt-1.5"><Bar pct={e.context_pct} warn={e.context_pct >= 60} /></div>
    </Link>
  );
}

export default function Team() {
  const { data, live } = useApi<EmployeeCard[]>("/api/employees", mock, 3000);
  return (
    <>
      <PageHead title="Team" sub={`${data.length} employees · ${data.filter((e) => e.status === "busy").length} working`}>
        <span className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-[var(--ok)]" : "bg-[var(--err)]"}`} />
          {live ? "live · 3 s" : "offline (sample data)"}
        </span>
      </PageHead>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {data.map((e) => <Card key={e.id} e={e} />)}
      </div>
    </>
  );
}
