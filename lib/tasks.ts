import "server-only";
import { scrub, writeOn, ISSUE } from "./inbox";
import { company, pcGet, pcSend } from "./paperclip";
import { GATES, scoreOf, shotsOf, verdictOf, type Verdict } from "./verdict";

/* New task from OS + review of results. Paperclip is the single source of truth; writes only when PAPERCLIP_WRITE=1. */
interface PAgent { id: string; name: string }
interface PProject { id: string; name: string }
interface PIssue { id: string; identifier: string; title: string; status: string; parentId: string | null; assigneeAgentId: string | null; updatedAt: string }
interface PComment { body: string; createdAt: string }

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export interface NewTask { title: string; assigneeAgentId: string; projectId: string; priority: string; description: string; zadani: string }
const ID_RE = /^[\w-]{1,64}$/;

export const options = async (): Promise<{ write: boolean; agents: PAgent[]; projects: PProject[]; priorities: readonly string[] }> => {
  const C = company();
  const [agents, projects] = await Promise.all([pcGet<PAgent[]>(`/companies/${C}/agents`, 60_000), pcGet<PProject[]>(`/companies/${C}/projects`, 300_000)]);
  return { write: writeOn(), agents: agents.map(({ id, name }) => ({ id, name })), projects: projects.map(({ id, name }) => ({ id, name })), priorities: PRIORITIES };
};

export const validate = (t: Partial<NewTask>): string | null => {
  if (!t.title?.trim() || t.title.length > 200) return "title must be 1–200 characters";
  if (!ID_RE.test(t.assigneeAgentId ?? "")) return "invalid agent";
  if (!ID_RE.test(t.projectId ?? "")) return "invalid project";
  if (!PRIORITIES.includes((t.priority ?? "") as (typeof PRIORITIES)[number])) return "invalid priority";
  if ((t.description ?? "").length > 20_000 || (t.zadani ?? "").length > 50_000) return "text is too long";
  return null;
};

/** Returns the new task's identifier. The guard (task.create) handles the write toggle and a draft when it's off. */
export const createTask = async (t: NewTask): Promise<{ issue: string; zadaniChyba?: boolean }> => {
  const body = {
    title: t.title.trim(), description: t.description.trim() || undefined, assigneeAgentId: t.assigneeAgentId,
    projectId: t.projectId, priority: t.priority, status: "todo",
  };
  const issue = await pcSend<{ id: string; identifier: string }>("POST", `/companies/${company()}/issues`, body);
  if (!issue.id || !issue.identifier) throw new Error("Paperclip did not return a task");
  // the brief goes verbatim into the `zadani` document (the Inbox card reads it unchanged)
  // a document failure must not break the response: the task already exists, resending would duplicate it
  const zadaniChyba = t.zadani.trim() ? await pcSend("PUT", `/issues/${issue.id}/documents/zadani`, { title: "Brief", format: "markdown", body: t.zadani }).then(() => false, () => true) : false;
  return zadaniChyba ? { issue: issue.identifier, zadaniChyba } : { issue: issue.identifier };
};

export interface TaskPatch { assigneeAgentId?: string; priority?: string; title?: string }
export const validatePatch = (p: TaskPatch): string | null => {
  if (!p.assigneeAgentId && !p.priority && !p.title) return "no change";
  for (const v of [p.assigneeAgentId, p.priority, p.title]) if (v !== undefined && typeof v !== "string") return "field must be text";
  if (p.assigneeAgentId !== undefined && !ID_RE.test(p.assigneeAgentId)) return "invalid agent";
  if (p.priority !== undefined && !PRIORITIES.includes(p.priority as (typeof PRIORITIES)[number])) return "invalid priority";
  if (p.title !== undefined && (!p.title.trim() || p.title.length > 200)) return "title must be 1–200 characters";
  return null;
};
/** Only these three fields; anything else in the body is dropped. */
export const updateTask = async (id: string, p: TaskPatch): Promise<void> => {
  const body = { ...(p.assigneeAgentId && { assigneeAgentId: p.assigneeAgentId }), ...(p.priority && { priority: p.priority }), ...(p.title && { title: p.title.trim() }) };
  await pcSend("PATCH", `/issues/${id}`, body);
};

/* ---------- review of results: gate verdicts from subtasks ---------- */
export interface Gate { gate: string; issue: string; title: string; status: string; verdict: Verdict; score: number | null; at: string; excerpt: string; shots: string[] }

export const review = async (identifier: string): Promise<{ issue: string; gates: Gate[] } | null> => {
  if (!ISSUE.test(identifier)) return null;
  const C = company();
  const [issues, agents] = await Promise.all([pcGet<PIssue[]>(`/companies/${C}/issues?limit=1000`, 30_000), pcGet<PAgent[]>(`/companies/${C}/agents`, 60_000)]);
  const root = issues.find((i) => i.identifier === identifier);
  if (!root) return null;
  const name = new Map(agents.map((a) => [a.id, a.name]));
  // both direct and nested subtasks (a gate is often one level below a build subtask)
  const family = new Set([root.id]);
  for (let grew = true; grew; ) { grew = false; for (const i of issues) if (i.parentId && family.has(i.parentId) && !family.has(i.id)) { family.add(i.id); grew = true; } }
  const mine = issues.filter((i) => i.id !== root.id && family.has(i.id) && GATES.includes((name.get(i.assigneeAgentId ?? "") ?? "") as (typeof GATES)[number]));
  const gates = await Promise.all(mine.map(async (i): Promise<Gate> => {
    const comments = await pcGet<PComment[]>(`/issues/${i.id}/comments`, 30_000).catch(() => []);
    const sorted = [...comments].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const withVerdict = sorted.find((c) => verdictOf(c.body.slice(0, 400)) !== "neznamy") ?? sorted[0];
    const text = withVerdict?.body ?? "";
    return {
      gate: name.get(i.assigneeAgentId ?? "") ?? "", issue: i.identifier, title: scrub(i.title), status: i.status,
      verdict: verdictOf(text.slice(0, 400)), score: scoreOf(text), at: withVerdict?.createdAt ?? i.updatedAt,
      excerpt: scrub(text.replace(/\s+/g, " ").slice(0, 280)), shots: shotsOf(sorted.map((c) => c.body).join("\n")),
    };
  }));
  return { issue: identifier, gates: gates.sort((a, b) => a.gate.localeCompare(b.gate) || Date.parse(b.at) - Date.parse(a.at)) };
};
