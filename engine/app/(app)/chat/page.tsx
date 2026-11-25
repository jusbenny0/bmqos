"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { post, useApi } from "@/components/api";
import { Bubble } from "@/components/bubble";
import { chatMock } from "@/components/mock";
import type { EmployeeDetail } from "@/components/types";
import { PageHead, btn, card, input } from "@/components/ui";
import { employeeDetail } from "@/components/mock";

// CEO = the employee with the CEO role; the transcript comes from /api/employees/:id (id 1 until the API says otherwise).
export default function Chat() {
  const mock = { ...employeeDetail(1), messages: chatMock };
  const { data: ceo, reload } = useApi<EmployeeDetail>("/api/employees/1", mock, 2000);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [ceo.messages.length]);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    await post("/api/ceo/chat", { text });
    setText("");
    setSending(false);
    reload();
  }

  return (
    <>
      <PageHead title="Chat with CEO" sub="Describe a task; the CEO breaks it down and hands it to the team." />
      <section className={`${card} flex h-[calc(100vh-14rem)] min-h-80 flex-col`}>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {ceo.messages.map((m) => <Bubble key={m.id} m={m} />)}
          {ceo.status === "busy" && <div className="text-xs text-[var(--muted)]">CEO is thinking…</div>}
          <div ref={end} />
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t border-[var(--border)] p-3">
          <input className={input} placeholder="Write a brief…" value={text} onChange={(x) => setText(x.target.value)} />
          <button className={btn} disabled={sending}>Send</button>
        </form>
      </section>
    </>
  );
}
