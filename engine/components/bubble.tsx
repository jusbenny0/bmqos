import type { Message } from "./types";
import { fmtTime } from "./ui";

export function Bubble({ m }: { m: Message }) {
  const me = m.role === "user";
  return (
    <div className={`flex ${me ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
          me ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] bg-[var(--bg)]"
        }`}
      >
        {m.content}
        <div className={`mt-1 text-[11px] ${me ? "text-white/70" : "text-[var(--muted)]"}`}>
          {fmtTime(m.created_at)}
          {m.role === "assistant" && m.output_tokens > 0 && ` · ${m.input_tokens + m.output_tokens} tok · $${m.cost_usd.toFixed(3)}`}
        </div>
      </div>
    </div>
  );
}
