import "server-only";
import { connect } from "node:net";
import type { Server } from "./types";

/* What's running where. Default list = LAN preview server; override via OS_SERVERS = "name|where|host:port;…" */
const HOST = process.env.OS_PREVIEW_HOST ?? "127.0.0.1";
const DEFAULTS = [
  ["Preview · Leads (DL)", "LAN", `${HOST}:3200`], ["Preview · Leads 2", "LAN", `${HOST}:3201`],
  ["Preview · site", "LAN", `${HOST}:3300`], ["Preview · CRM", "LAN", `${HOST}:3400`],
  ["Preview · Social manager", "LAN", `${HOST}:3430`], ["Preview · outreach", "LAN", `${HOST}:3500`],
  ["Postgres preview", "Local", "127.0.0.1:5433"],
  ["Dokploy", "Dokploy", process.env.OS_DOKPLOY_TARGET ?? ""],
];

const list = (): string[][] =>
  process.env.OS_SERVERS ? process.env.OS_SERVERS.split(";").map((x) => x.split("|")) : DEFAULTS.map((x) => [...x]);

const probe = (target: string): Promise<{ up: boolean; ms: number }> =>
  new Promise((done) => {
    const [host, port] = target.split(":");
    const t0 = Date.now();
    const s = connect({ host, port: Number(port) || 80, timeout: 1500 });
    s.once("connect", () => { s.destroy(); done({ up: true, ms: Date.now() - t0 }); });
    s.once("timeout", () => { s.destroy(); done({ up: false, ms: 0 }); });
    s.once("error", () => done({ up: false, ms: 0 }));
  });

let cache: { at: number; v: Server[] } | null = null;
export const servers = async (): Promise<Server[]> => {
  if (cache && Date.now() - cache.at < 15_000) return cache.v;
  const at = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Europe/Prague" });
  const v = await Promise.all(list().filter((x) => x[2]).map(async ([n, where, target]): Promise<Server> => ({ n, where, target, at, ...(await probe(target)) })));
  cache = { at: Date.now(), v };
  return v;
};
