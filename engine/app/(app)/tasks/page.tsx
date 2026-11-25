"use client";
import { useState } from "react";
import Link from "next/link";
import { useApi } from "@/components/api";
import { employees, tasks as mock } from "@/components/mock";
import type { Employee, Task, TaskStatus } from "@/components/types";
import { PageHead, ago, card, input, statusLabel } from "@/components/ui";

const cols: TaskStatus[] = ["todo", "doing", "review", "done", "blocked"];

export default function Tasks() {
  const { data } = useApi<Task[]>("/api/tasks", mock, 5000);
  const { data: emps } = useApi<Employee[]>("/api/employees", employees);
  const [who, setWho] = useState("");
  const shown = data.filter((t) => !who || String(t.owner_id) === who || String(t.reviewer_id) === who);
  const name = (id: number | null) => emps.find((e) => e.id === id)?.name ?? "—";
  return (
    <>
      <PageHead title="Tasks" sub={`${shown.length} total`}>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by employee" className={`${input} w-auto`}>
          <option value="">All employees</option>
          {emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </PageHead>
      <div className="flex flex-col gap-5 md:grid md:grid-cols-5 md:gap-3">
        {cols.map((c) => {
          const list = shown.filter((t) => t.status === c);
          return (
            <section key={c} className="md:w-auto">
              <h2 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wide text-[var(--muted)]">
                {statusLabel[c]} <span className="rounded-full bg-[var(--surface-2)] px-2 py-0.5 text-[var(--fg)]">{list.length}</span>
              </h2>
              <div className="space-y-2">
                {list.map((t) => (
                  <Link key={t.id} href={`/tasks/${t.id}`} className={`${card} block p-3 hover:border-[var(--accent)]`}>
                    <div className="text-sm font-medium leading-snug">{t.title}</div>
                    <div className="mt-2 flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>#{t.id} · {name(t.owner_id)}</span>
                      <span>{ago(t.updated_at)}</span>
                    </div>
                  </Link>
                ))}
                {list.length === 0 && <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-xs text-[var(--muted)]">Empty</div>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
