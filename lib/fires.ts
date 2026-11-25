import type { Snapshot } from "./types";

/* "Needs attention" = servers down, agents in error. Failed runs and limits are Hermes's own problem, not a red card. Shared by Home (Needs attention strip) and Hermes context. */
export const fires = (d: Snapshot): { t: string; why: string; go: string; b: string }[] => [
  ...d.servers.filter((s) => !s.up).map((s) => ({ t: `${s.n} is down`, why: `${s.where} · ${s.target}`, go: "servers", b: "Machines" })),
  ...d.agents.filter((a) => a.st === "error").map((a) => ({ t: `${a.n} is in error`, why: a.err ?? a.role, go: `agents&agent=${a.id}`, b: "Detail" })),
];
