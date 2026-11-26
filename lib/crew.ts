import "server-only";
import { crewConn, getConfig, type AgentCfg } from "./config";
import { simCrew, simStatus } from "./simulator";
// demo timestamps relative to now, so sample data never looks stale
const ago = (days: number, hms: string): string => {
  // same clock time `days` ago; if that's still in the future today, use yesterday
  const d = new Date(Date.now() - days * 86_400_000), [h, m] = hms.split(":").map(Number);
  d.setUTCHours(h, m, 0, 0);
  if (d.getTime() > Date.now()) d.setTime(d.getTime() - 86_400_000);
  return d.toISOString().slice(0, 19).replace("T", " ");
};

/* Crew API client (v1 contract, engine/docs/api.md). Server-only; token never reaches the browser.
   Without CREW_API_URL, runs a mock with the same data shape (for dev and screenshots). */
export type TaskStatus = "todo" | "doing" | "review" | "done" | "blocked";
export interface Employee { id: number; name: string; role: string; model: "sonnet" | "haiku" }
export interface TeamMember extends Employee { task_id: number | null; task_title: string | null; task_status: TaskStatus | null; last_step: string | null; tokens_today: number; last_message: string | null; last_message_at: string | null; context_pct: number | null }
export interface Task { id: number; title: string; brief: string; owner_id: number | null; reviewer_id: number | null; status: TaskStatus; handoff_note: string | null; pr_url: string | null; token_cap: number | null; created_at: string; updated_at?: string }
export interface TaskEvent { id: number; task_id: number; kind: string; text: string; created_at: string }
export interface Tokens { input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }
export interface TaskDetail extends Task { events: TaskEvent[]; messages: unknown[]; tokens: Tokens }
export interface TranscriptMessage { id: number; role: "user" | "assistant" | "system"; content: string; task_id: number | null; input_tokens: number; output_tokens: number; cache_read_tokens: number; cache_write_tokens: number; cost_usd: number; created_at: string }
export interface UsageRow { id: number; label: string; messages: number; input: number; output: number; cache_read: number; cache_write: number; cost_usd: number; tokens: number }
export interface Usage { byEmployee: UsageRow[]; byTask: UsageRow[]; total: { tokens: number; cost_usd: number }; series: { t: string; tokens: number; cost_usd: number }[]; compare: { label: string; tokens_per_task: number }[] | null }
export interface SendResult { reply: string; tokens: number; cost_usd: number }
export interface BrainHit { id: string; title: string; snippet: string; score: number }
export interface BrainNode { id: string; title: string; body: string; links: string[] }
export interface GraphNode { id: string; title: string; group: string }
export interface GraphLink { source: string; target: string }
export interface Graph { nodes: GraphNode[]; links: GraphLink[] }

export const live = (): boolean => !!crewConn();
export class CrewError extends Error { constructor(public status: number, msg: string) { super(msg); } }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const c = crewConn()!;
  const r = await fetch(c.url.replace(/\/$/, "") + path, {
    ...init, cache: "no-store", signal: AbortSignal.timeout(path.endsWith("/message") ? 600_000 : 15_000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
  });
  if (!r.ok) throw new CrewError(r.status === 404 ? 404 : 502, `crew ${r.status}`);
  return r.json() as Promise<T>;
}

/* ---------- mock (without CREW_API_URL): same shape as the contract, for dev and screenshots ---------- */
const M = { team: [
  { id: 1, name: "CTO", role: "Planning", model: "sonnet", task_id: 12, task_title: "Plan the checkout redesign", task_status: "doing", last_step: "Writing subtasks", tokens_today: 48200, last_message: "Done, handing off to the Engineer.", last_message_at: ago(0, "09:12:00"), context_pct: 42 },
  { id: 2, name: "Engineer 2", role: "Development", model: "sonnet", task_id: 13, task_title: "Checkout page redesign", task_status: "doing", last_step: "tsc + build", tokens_today: 91400, last_message: "Cart step is done, building payment step.", last_message_at: ago(0, "10:41:00"), context_pct: 78 },
  { id: 3, name: "Junior", role: "Small tasks", model: "haiku", task_id: 14, task_title: "Fixing text in settings", task_status: "review", last_step: "Awaiting review", tokens_today: 3100, last_message: "Done, waiting for review.", last_message_at: ago(0, "08:55:00"), context_pct: 12 },
  { id: 4, name: "Security", role: "Security", model: "sonnet", task_id: null, task_title: null, task_status: null, last_step: null, tokens_today: 0, last_message: null, last_message_at: null, context_pct: null },
  { id: 5, name: "QA", role: "Quality control", model: "haiku", task_id: 11, task_title: "Prod build + screenshots", task_status: "blocked", last_step: "Waiting for deploy", tokens_today: 18700, last_message: "Build is green, waiting on deploy.", last_message_at: ago(0, "07:20:00"), context_pct: 55 },
] as TeamMember[], tasks: [
  { id: 13, title: "Checkout page redesign", brief: "New checkout flow for Acme Storefront", owner_id: 2, reviewer_id: 1, status: "doing", handoff_note: null, pr_url: null, token_cap: 200000, created_at: ago(0, "08:00:00") },
  { id: 14, title: "Fixing text in settings", brief: "A few wrong strings", owner_id: 3, reviewer_id: 1, status: "review", handoff_note: "Done, waiting for CTO review.", pr_url: "https://github.com/your-org/acme-storefront/pull/51", token_cap: 50000, created_at: ago(0, "07:40:00") },
  { id: 12, title: "Plan the checkout redesign", brief: "Split into design and build", owner_id: 1, reviewer_id: null, status: "done", handoff_note: "Assigned", pr_url: "https://github.com/your-org/acme-storefront/pull/50", token_cap: null, created_at: ago(0, "07:30:00") },
  { id: 11, title: "Prod build + screenshots", brief: "Verify the build at 1440/390 before merge", owner_id: 5, reviewer_id: 1, status: "blocked", handoff_note: "Build is green, waiting on deploy to verify live.", pr_url: null, token_cap: 30000, created_at: ago(0, "06:50:00") },
  { id: 10, title: "Weekly newsletter draft", brief: "Request from the owner via the CEO chat", owner_id: 1, reviewer_id: null, status: "todo", handoff_note: null, pr_url: null, token_cap: null, created_at: ago(0, "21:10:00") },
] as Task[] };
const row = (id: number, label: string, tokens: number): UsageRow => ({ id, label, messages: Math.max(2, Math.round(tokens / 4000)), input: Math.round(tokens * 0.6), output: Math.round(tokens * 0.1), cache_read: Math.round(tokens * 0.3), cache_write: 0, cost_usd: Math.round((tokens / 1e5) * 100) / 100, tokens });
// mock team/tasks; while the demo simulator runs they carry the simulated run
const mockView = (): { team: TeamMember[]; tasks: Task[]; burned: number } => {
  const own = getConfig<AgentCfg[]>("agents"), st = simStatus();
  const team = own ? M.team.map((m, i) => (own[i] ? { ...m, name: own[i].name, role: own[i].role } : m)) : M.team;
  return st.on ? simCrew(team, M.tasks, st.t) : { team, tasks: M.tasks, burned: 0 };
};
const mockUsage = (range: "24h" | "7d"): Usage => {
  const mul = range === "7d" ? 6.4 : 1, n = range === "7d" ? 7 : 24;
  const { team: T, tasks: K, burned } = mockView();
  const total = T.reduce((s, m) => s + m.tokens_today, 0) * mul;
  return {
    byEmployee: T.filter((m) => m.tokens_today > 0 || range === "7d").map((m) => row(m.id, m.name, Math.round(m.tokens_today * mul))),
    byTask: K.map((t) => row(t.id, t.title, Math.round((t.id * 3500 + 4000) * (mul / (range === "7d" ? 2.2 : 1))))),
    total: { tokens: Math.round(total), cost_usd: Math.round((total / 1e5) * 100) / 100 },
    series: Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.now() - (range === "7d" ? (n - 1 - i) * 86_400_000 : (n - 1 - i) * 3_600_000));
      const tokens = Math.round(4000 + Math.sin(i / 2.3) * 3000 + i * 600 + (i % 5 === 0 ? 9000 : 0)) + (i === n - 1 ? burned : 0); // burned = demo simulator
      return { t: d.toISOString().slice(0, range === "7d" ? 10 : 13).replace("T", " ") + (range === "7d" ? " 00:00:00" : ":00:00"), tokens, cost_usd: Math.round((tokens / 1e5) * 100) / 100 };
    }),
    compare: null,
  };
};

const BRAIN: Record<string, BrainNode> = {
  "projects/bmqos": { id: "projects/bmqos", title: "Acme Storefront", body: "# Acme Storefront\nOnline shop run by the agent team. Current goal: new checkout flow.\n\nBuilt with [[projects/agent-team]]. Design decision: [[decisions/one-accent]].\nSee also [[handoff/bmqos-crew-ui]].", links: ["projects/agent-team", "decisions/one-accent", "handoff/bmqos-crew-ui"] },
  "projects/agent-team": { id: "projects/agent-team", title: "Agent team", body: "# Agent team\nPlanner, builders, reviewer and QA working in parallel.\n\nWorks on [[projects/bmqos]]. Model decision: [[decisions/model-choice]].", links: ["projects/bmqos", "decisions/model-choice"] },
  "decisions/one-accent": { id: "decisions/one-accent", title: "One accent colour", body: "# Decision: visual style\nLight UI, one accent colour, one sans-serif font, no italics.\n\nRelates to [[projects/bmqos]].", links: ["projects/bmqos"] },
  "decisions/model-choice": { id: "decisions/model-choice", title: "Which model for which job", body: "# Decision: model choice\nPlanning and review = bigger model. Small tasks and QA = smaller, cheaper model.\n\nRelates to [[projects/agent-team]].", links: ["projects/agent-team"] },
  "handoff/bmqos-crew-ui": { id: "handoff/bmqos-crew-ui", title: "Handoff: checkout redesign", body: "# Handoff\nPlanner → Builder: cart step done, payment step next.\n\nRelates to [[projects/bmqos]] and [[voice/owner-requirements]].", links: ["projects/bmqos", "voice/owner-requirements"] },
  "voice/owner-requirements": { id: "voice/owner-requirements", title: "Owner's requirements (voice note)", body: "# From a voice note\nClarity before style. One main task per screen.\n\nRelates to [[projects/bmqos]].", links: ["projects/bmqos"] },
};
const GRAPH: Graph = {
  nodes: [
    { id: "projects/bmqos", title: "Acme Storefront", group: "projects" },
    { id: "projects/agent-team", title: "Agent team", group: "projects" },
    { id: "decisions/one-accent", title: "One accent", group: "decisions" },
    { id: "decisions/model-choice", title: "Sonnet vs Haiku", group: "decisions" },
    { id: "handoff/bmqos-crew-ui", title: "Handoff: checkout", group: "handoff" },
    { id: "voice/owner-requirements", title: "Owner's requirements", group: "voice" },
  ],
  links: [
    { source: "projects/bmqos", target: "projects/agent-team" },
    { source: "projects/bmqos", target: "decisions/one-accent" },
    { source: "projects/agent-team", target: "decisions/model-choice" },
    { source: "projects/bmqos", target: "handoff/bmqos-crew-ui" },
    { source: "handoff/bmqos-crew-ui", target: "voice/owner-requirements" },
    { source: "voice/owner-requirements", target: "projects/bmqos" },
  ],
};

// mock team takes names/roles from the onboarding wizard
const mockTeam = (): TeamMember[] => mockView().team;
export const team = (): Promise<TeamMember[]> => live() ? call("/api/team") : Promise.resolve(mockTeam());
/** first task from the setup wizard; only when a Crew engine is connected. Returns false on any failure (non-fatal). */
export const createFirstTask = async (title: string, brief: string): Promise<boolean> => {
  if (!live() || !title) return false;
  try { await call("/api/tasks", { method: "POST", body: JSON.stringify({ title, brief }) }); return true; } catch { return false; }
};
export const tasks = (): Promise<Task[]> => live() ? call("/api/tasks") : Promise.resolve(mockView().tasks);
export const task = async (id: number): Promise<TaskDetail> => {
  if (live()) return call(`/api/tasks/${id}`);
  const t = mockView().tasks.find((x) => x.id === id);
  if (!t) throw new CrewError(404, "not found");
  const events: TaskEvent[] = [{ id: 1, task_id: id, kind: "status", text: "Task assigned", created_at: t.created_at }];
  if (t.status !== "todo") events.push({ id: 2, task_id: id, kind: "status", text: "In progress", created_at: t.created_at });
  if (t.handoff_note) events.push({ id: 3, task_id: id, kind: "handoff", text: t.handoff_note, created_at: t.created_at });
  return { ...t, events, messages: [], tokens: { input: 4000, output: 800, cache_read: 2000, cache_write: 0, cost_usd: 0.04 } };
};
export const usage = (range: "24h" | "7d"): Promise<Usage> => live() ? call(`/api/usage?range=${range}`) : Promise.resolve(mockUsage(range));
/* employee instructions (system_prompt) – read-only, no messages */
export type Persona = { name?: string; tone: string; values: string[]; avoid: string[] };
export const instructions = async (id: number): Promise<{ system_prompt: string; engine?: string; engine_model?: string | null; persona?: Persona | null }> => {
  if (!live()) return { system_prompt: "Demo mode – instructions load from Crew." };
  const e = await call<{ system_prompt?: string; engine?: string; engine_model?: string | null; persona?: Persona | null }>(`/api/employees/${id}`);
  return { system_prompt: e.system_prompt ?? "", engine: e.engine, engine_model: e.engine_model ?? null, persona: e.persona ?? null };
};
export const transcript = (id: number, after: number): Promise<{ messages: TranscriptMessage[]; last_id: number }> => {
  if (live()) return call(`/api/team/${id}/transcript?after=${after}`);
  const m = M.team.find((x) => x.id === id);
  const base: TranscriptMessage[] = m?.last_message
    ? [
      { id: 1, role: "user", content: `How's "${m.task_title ?? "the task"}" coming along?`, task_id: m.task_id, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, created_at: m.last_message_at ?? "" },
      { id: 2, role: "assistant", content: m.last_message, task_id: m.task_id, input_tokens: 1800, output_tokens: 420, cache_read_tokens: 900, cache_write_tokens: 0, cost_usd: 0.012, created_at: m.last_message_at ?? "" },
    ]
    : [];
  return Promise.resolve({ messages: base.filter((x) => x.id > after), last_id: Math.max(after, base.length ? base[base.length - 1].id : after) });
};
export const message = (id: number, text: string, taskId?: number): Promise<SendResult> =>
  live() ? call(`/api/team/${id}/message`, { method: "POST", body: JSON.stringify({ text, taskId }) }) : Promise.resolve({ reply: "(demo) Got it, getting started.", tokens: 0, cost_usd: 0 });
export const chat = (text: string): Promise<SendResult> =>
  live() ? call("/api/chat", { method: "POST", body: JSON.stringify({ text }) }) : Promise.resolve({ reply: "(demo) I split up the request and assigned it to the team.", tokens: 0, cost_usd: 0 });

/* ---------- ideas: rough idea -> team discussion -> approve -> tasks (engine /api/ideas) ---------- */
export interface IdeaSynthesis { summary: string; questions: { q: string; recommended: string }[]; tasks: { title: string; brief: string; size: "S" | "M" | "L"; tokens: number }[] }
export interface Idea { id: number; text: string; status: "discussing" | "ready" | "approved" | "failed"; opinions: { role: string; text: string }[]; synthesis: IdeaSynthesis | null; tokens: number; task_ids: number[]; created_at: string }
const demoIdea = (id: number, text: string, status: Idea["status"]): Idea => ({ id, text, status, tokens: 0, task_ids: [], created_at: new Date().toISOString(),
  opinions: [{ role: "Designer", text: "(demo) Keep the first version small." }, { role: "Builder", text: "(demo) Doable in one slice." }, { role: "Security", text: "(demo) No sensitive data in v1." }],
  synthesis: { summary: "(demo) The team would build a small first slice.", questions: [{ q: "Who is the first user?", recommended: "The owner." }], tasks: [{ title: "First slice", brief: "Smallest useful version.", size: "S", tokens: 300_000 }] } });
export const ideas = (): Promise<Idea[]> => live() ? call("/api/ideas") : Promise.resolve([]);
export const idea = (id: number): Promise<Idea> => live() ? call(`/api/ideas/${id}`) : Promise.resolve(demoIdea(id, "(demo)", "ready"));
export const createIdea = (text: string): Promise<Idea> =>
  live() ? call("/api/ideas", { method: "POST", body: JSON.stringify({ text }) }) : Promise.resolve(demoIdea(1, text, "ready"));
export const approveIdea = (id: number, answers: string[]): Promise<Idea> =>
  live() ? call(`/api/ideas/${id}/approve`, { method: "POST", body: JSON.stringify({ answers }) }) : Promise.resolve({ ...demoIdea(id, "(demo)", "approved"), task_ids: [1] });

export const brainSearch = (q: string): Promise<{ results: BrainHit[] }> => {
  if (live()) return call(`/api/brain/search?q=${encodeURIComponent(q)}`);
  const ql = q.trim().toLowerCase();
  if (!ql) return Promise.resolve({ results: [] });
  const results = Object.values(BRAIN).map((n) => {
    const t = n.title.toLowerCase().includes(ql) ? 3 : 0, b = n.body.toLowerCase().includes(ql) ? 1 : 0;
    return { id: n.id, title: n.title, snippet: n.body.replace(/^#.*\n/, "").trim().slice(0, 140), score: t + b };
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 20);
  return Promise.resolve({ results });
};
export const brainNode = (id: string): Promise<BrainNode> => {
  if (live()) return call(`/api/brain/node/${id}`);
  const n = BRAIN[id];
  if (!n) throw new CrewError(404, "not found");
  return Promise.resolve(n);
};
export const brainGraph = (): Promise<Graph> => live() ? call("/api/brain/graph") : Promise.resolve(GRAPH);
