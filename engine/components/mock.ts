import type { EmployeeCard, EmployeeDetail, Message, Task, TaskDetail, Usage } from "./types";

const now = Date.parse("2026-11-18T12:00:00Z"); // fixed time: Date.now() would render different text on server and client (hydration)
const ago = (m: number) => new Date(now - m * 60000).toISOString();

export const employees: EmployeeCard[] = [
  { id: 1, name: "Karel", role: "CEO", model: "sonnet", system_prompt: "You break briefs into tasks and delegate.", cwd: "/work/crew", session_id: "a1f3", status: "idle", context_pct: 22, created_at: ago(900), task_id: null, task_title: null, task_status: null, last_step: null, tokens_today: 0, last_message: null, last_message_at: ago(5) },
  { id: 2, name: "Eva", role: "Builder", model: "sonnet", system_prompt: "You implement tasks in the repo.", cwd: "/work/test-repo", session_id: "b7c2", status: "busy", context_pct: 47, created_at: ago(900), task_id: 11, task_title: "Add /health endpoint", task_status: "doing", last_step: "Writing the /health test", tokens_today: 41200, last_message: "Endpoint is done, running the tests.", last_message_at: ago(5) },
  { id: 3, name: "Tom", role: "Reviewer", model: "sonnet", system_prompt: "You review the diff and run tests.", cwd: "/work/test-repo", session_id: "c9d4", status: "idle", context_pct: 31, created_at: ago(900), task_id: 13, task_title: "Request logging", task_status: "review", last_step: "Reviewing the diff", tokens_today: 12800, last_message: "Diff looks good, still checking the log format.", last_message_at: ago(5) },
  { id: 4, name: "Pavel", role: "Junior", model: "haiku", system_prompt: "Small, well-scoped tasks.", cwd: "/work/test-repo", session_id: null, status: "error", context_pct: 8, created_at: ago(900), task_id: null, task_title: null, task_status: null, last_step: null, tokens_today: 900, last_message: "Session crashed.", last_message_at: ago(5) },
];

export const tasks: Task[] = [
  { id: 11, title: "Add /health endpoint", brief: "GET /health returns {ok:true}. Test.", owner_id: 2, reviewer_id: 3, status: "doing", handoff_note: null, pr_url: null, token_cap: 200000, created_at: ago(80), updated_at: ago(3) },
  { id: 12, title: "Fix typo in README", brief: "Installation section.", owner_id: 4, reviewer_id: 3, status: "blocked", handoff_note: "Session crashed, waiting for restart.", pr_url: null, token_cap: 50000, created_at: ago(120), updated_at: ago(20) },
  { id: 13, title: "Request logging", brief: "Middleware with pino.", owner_id: 2, reviewer_id: 3, status: "review", handoff_note: "Done, PR opened. Check the log format and tests.", pr_url: "https://github.com/example/test-repo/pull/4", token_cap: 200000, created_at: ago(300), updated_at: ago(12) },
  { id: 14, title: "Project setup", brief: "Init, lint, CI.", owner_id: 2, reviewer_id: 3, status: "done", handoff_note: "Approved.", pr_url: "https://github.com/example/test-repo/pull/3", token_cap: null, created_at: ago(600), updated_at: ago(200) },
  { id: 15, title: "List pagination", brief: "limit/offset in GET /items.", owner_id: null, reviewer_id: null, status: "todo", handoff_note: null, pr_url: null, token_cap: 100000, created_at: ago(30), updated_at: ago(30) },
];

const msg = (id: number, e: number, role: Message["role"], content: string, m: number, o = 0): Message => ({
  id, employee_id: e, task_id: 11, role, content, input_tokens: o ? 1800 : 0, output_tokens: o, cache_read_tokens: o ? 9200 : 0,
  cache_write_tokens: 0, cost_usd: o ? 0.0412 : 0, created_at: ago(m),
});
export const messages: Message[] = [
  msg(1, 2, "user", "Task #11: add GET /health, return {ok:true} and write a test.", 14),
  msg(2, 2, "assistant", "On it. First I will look at the router structure.\n\nI added `src/health.ts` and registered it in `app.ts`.", 12, 640),
  msg(3, 2, "user", "Don't forget the test.", 6),
  msg(4, 2, "assistant", "`health.test.ts` is done and passing (3/3).", 4, 310),
];

export const employeeDetail = (id: number): EmployeeDetail => ({
  ...(employees.find((e) => e.id === id) ?? employees[0]), messages: messages.map((m) => ({ ...m, employee_id: id })),
});
export const taskDetail = (id: number): TaskDetail => ({
  ...(tasks.find((t) => t.id === id) ?? tasks[0]), tokens: { input: 1200, output: 9000, cache_read: 30000, cache_write: 1000, cost_usd: 0.42 },
  messages: [],
  events: [
    { id: 1, task_id: id, kind: "created", text: "Task created by CEO", created_at: ago(80) },
    { id: 2, task_id: id, kind: "delegated", text: "Delegated to: Eva (builder)", created_at: ago(78) },
    { id: 3, task_id: id, kind: "status", text: "todo → doing", created_at: ago(77) },
    { id: 4, task_id: id, kind: "handoff", text: "Handed off for review: Tom", created_at: ago(12) },
  ],
});
export const usage: Usage = {
  byEmployee: [
    { id: 2, label: "Eva", tokens: 184000, cost_usd: 1.42 },
    { id: 3, label: "Tom", tokens: 96000, cost_usd: 0.71 },
    { id: 1, label: "Karel", tokens: 41000, cost_usd: 0.33 },
    { id: 4, label: "Pavel", tokens: 12000, cost_usd: 0.02 },
  ],
  byTask: [
    { id: 13, label: "Request logging", tokens: 120000, cost_usd: 0.95 },
    { id: 11, label: "Add /health endpoint", tokens: 41200, cost_usd: 0.4 },
    { id: 14, label: "Project setup", tokens: 99000, cost_usd: 0.78 },
  ],
  total: { tokens: 333000, cost_usd: 2.48 },
  series: [],
};
export const chatMock: Message[] = [
  { ...messages[0], id: 101, employee_id: 1, task_id: null, content: "Add a /health endpoint to the test repo." },
  { ...messages[1], id: 102, employee_id: 1, task_id: null, content: "Broken down: #11 Eva builds, Tom reviews. I will let you know when it is done." },
];
