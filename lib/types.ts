export type AgentState = "running" | "idle" | "paused" | "error";
export type Kind = "Question" | "PR to merge" | "Decision" | "Approval";

export interface Project { id: string; n: string; short: string; open: number; you: number; tot: number }
export interface Venture { n: string; url: string; you: number; open: number; now: string }
export interface Agent {
  id: string; n: string; s: string; role: string; st: AgentState; pr: string; adapter: string;
  hb: string; tok: string; tokN: number; runs: number; ok: number; cur?: string; curT?: string; since?: string; err?: string; spark: number[];
}
export interface Wait {
  id: string; t: string; kind: Kind; st: string; age: string; ageMin: number; pr: string; ag: string;
  why: string; runs: number; tok: string; cm: [string, string, string][]; url: string;
}
export interface FeedRow { t: string; a: string; aid: string; i: string; r: string; s: "ok" | "er" | "run"; d: string; k: string }
export interface FlowNode { n: string; ag: string; c: number; w: string; iss: string[]; on?: boolean; you?: boolean }
export interface Server { n: string; where: string; target: string; up: boolean; ms: number; at: string }
export interface Snapshot {
  control: boolean; servers: Server[];
  at: string; clock: string; date: string; ok: boolean;
  projects: Project[]; ventures: Venture[]; agents: Agent[]; wait: Wait[]; feed: FeedRow[]; talk: [string, string, string][];
  flow: FlowNode[]; feedHours: number[]; done24: number;
  days: { lbl: string; v: number }[]; tokToday: string; tokTodayN: number; tokAvgPct: number; usd: string;
  kpi: { runs: number; running: number; okPct: number; failed: number; avg: string; longest: string };
  errors: { t: string; a: string; i: string; msg: string }[];
  comments: { t: string; a: string; text: string }[];
  waitOldest: string;
  sim?: boolean; // demo simulator running
}
