import { NextResponse } from "next/server";
import { db } from "@/lib/db";

const SUMS = `COUNT(*) AS messages, COALESCE(SUM(input_tokens),0) AS input, COALESCE(SUM(output_tokens),0) AS output,
  COALESCE(SUM(cache_read_tokens),0) AS cache_read, COALESCE(SUM(cache_write_tokens),0) AS cache_write,
  COALESCE(SUM(cost_usd),0) AS cost_usd,
  COALESCE(SUM(input_tokens + output_tokens + cache_write_tokens),0) AS tokens`;

export function GET(req: Request) {
  const range = new URL(req.url).searchParams.get("range") ?? "24h";
  if (range !== "24h" && range !== "7d") return NextResponse.json({ error: "range must be 24h or 7d" }, { status: 400 });
  const days = range === "7d" ? 7 : 1;
  const since = `created_at >= datetime('now', '-${days} days')`;
  const byEmployee = db()
    .prepare(`SELECT employee_id AS id, e.name AS label, ${SUMS} FROM messages m JOIN employees e ON e.id = m.employee_id WHERE m.${since} GROUP BY m.employee_id ORDER BY m.employee_id`)
    .all();
  const byTask = db()
    .prepare(`SELECT task_id AS id, t.title AS label, ${SUMS} FROM messages m JOIN tasks t ON t.id = m.task_id WHERE m.${since} GROUP BY m.task_id ORDER BY m.task_id`)
    .all();
  const total = db().prepare(`SELECT ${SUMS} FROM messages WHERE ${since}`).get();

  // Series: 24 hourly (1d) or 7 daily (7d) UTC buckets, empty ones filled with zero.
  const hourly = days === 1;
  const step = hourly ? 3600_000 : 86400_000;
  const fmt = hourly ? "%Y-%m-%d %H:00:00" : "%Y-%m-%d 00:00:00";
  const got = new Map(
    (db().prepare(`SELECT strftime('${fmt}', created_at) AS t, ${SUMS} FROM messages WHERE ${since} GROUP BY t`).all() as { t: string; tokens: number; cost_usd: number }[])
      .map((r) => [r.t, r]),
  );
  const n = hourly ? 24 : 7;
  const end = Math.floor(Date.now() / step) * step;
  const series = Array.from({ length: n }, (_, i) => {
    const t = new Date(end - (n - 1 - i) * step).toISOString().slice(0, 19).replace("T", " ");
    const r = got.get(t);
    return { t, tokens: r?.tokens ?? 0, cost_usd: r?.cost_usd ?? 0 };
  });

  return NextResponse.json({ byEmployee, byTask, total, series });
}
