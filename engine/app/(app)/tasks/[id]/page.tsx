"use client";
import Link from "next/link";
import { use } from "react";
import { useApi } from "@/components/api";
import { employees, taskDetail } from "@/components/mock";
import type { Employee, TaskDetail } from "@/components/types";
import { PageHead, Status, ago, card, duration, fmtNum, fmtTime, fmtTok, fmtUsd } from "@/components/ui";

export default function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: t } = useApi<TaskDetail>(`/api/tasks/${id}`, taskDetail(Number(id)), 5000);
  const { data: emps } = useApi<Employee[]>("/api/employees", employees);
  const emp = (i: number | null) => emps.find((e) => e.id === i);
  const link = (i: number | null) => {
    const e = emp(i);
    return e ? <Link href={`/team/${e.id}`} className="text-[var(--accent)]">{e.name}</Link> : "—";
  };
  const used = t.tokens.input + t.tokens.output + t.tokens.cache_write;
  const pct = t.token_cap ? Math.round((used / t.token_cap) * 100) : null;
  const end = t.status === "done" ? t.updated_at : new Date().toISOString();
  const handoffs = [
    ...t.events.map((e) => ({ key: `e${e.id}`, at: e.created_at, who: "", text: e.text, tok: 0 })),
    ...t.messages.filter((m) => m.role === "assistant").map((m) => ({ key: `m${m.id}`, at: m.created_at, who: m.employee, text: m.content, tok: m.tokens })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return (
    <>
      <Link href="/tasks" className="text-sm text-[var(--muted)]">← Tasks</Link>
      <PageHead title={`#${t.id} ${t.title}`}><Status s={t.status} /></PageHead>
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <section className={`${card} p-4`}>
            <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Brief</h2>
            <p className="whitespace-pre-wrap text-sm">{t.brief || <span className="text-[var(--muted)]">No brief</span>}</p>
          </section>
          {t.handoff_note && (
            <section className={`${card} p-4`}>
              <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Handoff</h2>
              <p className="whitespace-pre-wrap text-sm">{t.handoff_note}</p>
            </section>
          )}
          <section className={`${card} p-4`}>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-wide text-[var(--muted)]">Handoff history</h2>
            <ol className="space-y-3 border-l border-[var(--border)] pl-4">
              {handoffs.map((h) => (
                <li key={h.key} className="relative text-sm">
                  <span className={`absolute -left-[21px] top-1.5 h-2 w-2 rounded-full ${h.who ? "bg-[var(--accent)]" : "bg-[var(--muted)]"}`} />
                  <div className="text-xs text-[var(--muted)]">
                    {fmtTime(h.at)} · {ago(h.at)}{h.who && ` · ${h.who}`}{h.tok > 0 && ` · ${fmtTok(h.tok)} tok`}
                  </div>
                  <div className={`whitespace-pre-wrap break-words ${h.who ? "line-clamp-6" : ""}`}>{h.text}</div>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <aside className={`${card} space-y-3 self-start p-4 text-sm`}>
          <div><div className="text-xs text-[var(--muted)]">Builder</div>{link(t.owner_id)}</div>
          <div><div className="text-xs text-[var(--muted)]">Reviewer</div>{link(t.reviewer_id)}</div>
          <div>
            <div className="text-xs text-[var(--muted)]">Tokens</div>
            {fmtNum(used)}{t.token_cap ? ` / ${fmtNum(t.token_cap)}${pct !== null ? ` (${pct} %)` : ""}` : ""} · {fmtUsd(t.tokens.cost_usd)}
            <div className="text-xs text-[var(--muted)]">input {fmtTok(t.tokens.input)} · output {fmtTok(t.tokens.output)} · cache {fmtTok(t.tokens.cache_read)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Time</div>
            {duration(t.created_at, end)}{t.status === "done" ? "" : " (running)"}
          </div>
          <div>
            <div className="text-xs text-[var(--muted)]">Pull request</div>
            {t.pr_url ? (
              <>
                <a href={t.pr_url} target="_blank" rel="noreferrer" className="break-all text-[var(--accent)]">{t.pr_url.replace("https://github.com/", "")}</a>
                {t.pr_url.includes("/pull/") && <div><a href={`${t.pr_url}/files`} target="_blank" rel="noreferrer" className="text-[var(--accent)]">Diff →</a></div>}
              </>
            ) : "—"}
          </div>
        </aside>
      </div>
    </>
  );
}
