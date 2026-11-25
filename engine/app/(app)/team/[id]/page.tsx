"use client";
import Link from "next/link";
import { FormEvent, use, useEffect, useRef, useState } from "react";
import { post, useApi } from "@/components/api";
import { Bubble } from "@/components/bubble";
import { employeeDetail } from "@/components/mock";
import type { EmployeeDetail } from "@/components/types";
import { Bar, PageHead, Status, btn, card, input } from "@/components/ui";

export default function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: e, reload } = useApi<EmployeeDetail>(`/api/employees/${id}`, employeeDetail(Number(id)), 3000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [e.messages.length]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    await post(`/api/employees/${id}/send`, { text });
    setText("");
    setSending(false);
    reload();
  }

  return (
    <>
      <Link href="/team" className="text-sm text-[var(--muted)]">← Team</Link>
      <PageHead title={e.name} sub={`${e.role} · ${e.model}`}><Status s={e.status} /></PageHead>
      <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
        <section className={`${card} flex h-[60vh] flex-col`}>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {e.messages.map((m) => <Bubble key={m.id} m={m} />)}
            {e.status === "busy" && <div className="text-xs text-[var(--muted)]">Working…</div>}
            <div ref={end} />
          </div>
          <form onSubmit={submit} className="flex gap-2 border-t border-[var(--border)] p-3">
            <input className={input} placeholder={`Message ${e.name}…`} value={text} onChange={(x) => setText(x.target.value)} />
            <button className={btn} disabled={sending}>Send</button>
          </form>
        </section>
        <aside className={`${card} space-y-3 p-4 text-sm`}>
          <div><div className="text-xs text-[var(--muted)]">Context</div><div className="mb-1">{e.context_pct} %</div><Bar pct={e.context_pct} warn={e.context_pct >= 60} /></div>
          <div><div className="text-xs text-[var(--muted)]">Session</div><div className="font-mono text-xs">{e.session_id ?? "—"}</div></div>
          <div><div className="text-xs text-[var(--muted)]">Folder</div><div className="break-all font-mono text-xs">{e.cwd}</div></div>
          <div><div className="text-xs text-[var(--muted)]">Role</div><div className="text-[var(--muted)]">{e.system_prompt}</div></div>
        </aside>
      </div>
    </>
  );
}
