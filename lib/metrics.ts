import "server-only";
import { sql } from "./db";
import { snapshot } from "./paperclip";

/* OS time series. Interface for other modules (E1 service latency, deploys…):
   record("svc:<service>", ms)  – stores a sample in a 5-min bucket (same bucket = overwrite)
   query("svc:<service>", "24h"|"7d"|"30d") – points {t: ms, v}, always sorted and thinned for charting
   The `pve:*` series aren't read from SQLite but directly from Proxmox rrddata (not stored). */
export type Range = "24h" | "7d" | "30d";
export interface Point { t: number; v: number }
const MIN5 = 3e5, HOUR = 36e5, DAY = 864e5;
const SPAN: Record<Range, number> = { "24h": DAY, "7d": 7 * DAY, "30d": 30 * DAY };
const STEP: Record<Range, number> = { "24h": MIN5, "7d": HOUR, "30d": 3 * HOUR };
export const isRange = (s: string): s is Range => s in SPAN;
export const isSeries = (s: string): boolean => /^[a-z0-9][a-z0-9:_.-]{0,63}$/.test(s);

const table = (): ReturnType<typeof sql> => {
  const d = sql();
  d.exec("CREATE TABLE IF NOT EXISTS metrics (series TEXT, at INTEGER, v REAL, PRIMARY KEY (series, at)) WITHOUT ROWID");
  return d;
};

export const record = (series: string, value: number, now = Date.now()): void => {
  if (!isSeries(series) || !Number.isFinite(value)) return;
  table().prepare("INSERT OR REPLACE INTO metrics VALUES (?,?,?)").run(series, now - (now % MIN5), value);
};

/* older than 7 d → averaged hourly, older than 30 d → gone */
let lastCompact = 0;
const compact = (now: number): void => {
  if (now - lastCompact < HOUR) return;
  lastCompact = now;
  const d = table(), cut = now - 7 * DAY - ((now - 7 * DAY) % HOUR);
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM metrics WHERE at<?").run(now - 30 * DAY);
    d.prepare(`INSERT OR REPLACE INTO metrics SELECT series, at/${HOUR}*${HOUR}, avg(v) FROM metrics WHERE at<? AND at%${HOUR}!=0 GROUP BY series, at/${HOUR}`).run(cut);
    d.prepare(`DELETE FROM metrics WHERE at<? AND at%${HOUR}!=0`).run(cut);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
};

export const query = (series: string, range: Range, now = Date.now()): Point[] => {
  const step = STEP[range];
  const rows = table().prepare(`SELECT at/${step}*${step} t, avg(v) v FROM metrics WHERE series=? AND at>=? GROUP BY t ORDER BY t`).all(series, now - SPAN[range]) as unknown as Point[];
  return rows.map((r) => ({ t: Number(r.t), v: Number(r.v) }));
};

/* ---------- Proxmox rrddata (direct, not stored) ---------- */
const FRAME: Record<Range, string> = { "24h": "day", "7d": "week", "30d": "month" };
type Rrd = { time: number; cpu?: number; mem?: number; memused?: number; memtotal?: number; netin?: number; netout?: number; rootused?: number; roottotal?: number };
const pick: Record<string, (r: Rrd) => number | undefined> = {
  "pve:cpu": (r) => (r.cpu == null ? undefined : r.cpu * 100),
  "pve:ram": (r) => (r.memused != null && r.memtotal ? (r.memused / r.memtotal) * 100 : undefined),
  "pve:disk": (r) => (r.rootused != null && r.roottotal ? (r.rootused / r.roottotal) * 100 : undefined),
  "pve:netin": (r) => r.netin,
  "pve:netout": (r) => r.netout,
};
const pveCache = new Map<Range, { at: number; rows: Rrd[] }>();
const pve = async (series: string, range: Range): Promise<Point[]> => {
  const f = pick[series], url = process.env.PVE_API_URL, tok = process.env.PVE_TOKEN, node = process.env.PVE_NODE;
  if (!f || !url || !tok || !node) return [];
  let hit = pveCache.get(range);
  if (!hit || Date.now() - hit.at > 60_000) {
    const r = await fetch(`${url}/api2/json/nodes/${encodeURIComponent(node)}/rrddata?timeframe=${FRAME[range]}&cf=AVERAGE`, { cache: "no-store", headers: { Authorization: `PVEAPIToken=${tok}` }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`proxmox ${r.status}`);
    hit = { at: Date.now(), rows: ((await r.json()) as { data: Rrd[] }).data };
    pveCache.set(range, hit);
  }
  return hit.rows.flatMap((r) => { const v = f(r); return v == null ? [] : [{ t: r.time * 1000, v }]; });
};

export const read = async (series: string, range: Range): Promise<Point[]> => {
  if (series.startsWith("pve:")) return pve(series, range);
  compact(Date.now());
  return query(series, range);
};

/* ---------- sampling agent work from Paperclip (every 5 min) ---------- */
let prevTok = -1;
export const sample = async (): Promise<void> => {
  const s = await snapshot();
  if (!s.ok) return;
  const usd = Number(process.env.OS_USD_PER_MTOK ?? "5");
  const delta = prevTok < 0 ? 0 : s.tokTodayN >= prevTok ? s.tokTodayN - prevTok : s.tokTodayN;
  prevTok = s.tokTodayN;
  record("agents:tokens", delta);
  record("agents:usd", (delta / 1e6) * usd);
  record("agents:running", s.agents.filter((a) => a.st === "running").length);
  record("work:done24", s.done24);
  record("work:waiting", s.wait.length);
};
