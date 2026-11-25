import type { Agent, Snapshot } from "./types";
import type { Svc } from "./services";
import type { Machine } from "./storage";
import type { Item } from "./items";
import type { Service } from "./netmap";
import type { Card } from "./inbox";
import { getConfig, type AgentCfg } from "./config";

// Demo mode: when PAPERCLIP_API_URL is not set (or OS_DEMO=1) the panel shows this sample data
// instead of talking to a backend. No real agents, hosts or people are involved.
export const demoOn = (): boolean => process.env.OS_DEMO === "1" || (process.env.OS_DEMO !== "0" && !process.env.PAPERCLIP_API_URL);

const spark = (seed: number): number[] => Array.from({ length: 12 }, (_, i) => 2 + ((seed * (i + 3) * 7) % 9));
const agent = (id: string, n: string, s: string, role: string, st: Agent["st"], runs: number, tokN: number, cur?: string): Agent => ({
  id, n, s, role, st, pr: "claude", adapter: "demo", hb: st === "running" ? "now" : "4 min ago",
  tok: `${Math.round(tokN / 1000)}k`, tokN, runs, ok: Math.round(runs * 0.9), spark: spark(runs),
  ...(cur ? { cur, curT: "12 min", since: "12 min" } : {}),
});

export const demoSnapshot = (): Snapshot => {
  const now = new Date();
  const agents: Agent[] = [
    agent("a1", "Planner", "PL", "Plans and assigns work", "running", 14, 480_000, "Splitting the onboarding epic"),
    agent("a2", "Builder 1", "B1", "Build", "running", 22, 910_000, "Add CSV export to reports"),
    agent("a3", "Builder 2", "B2", "Build", "idle", 17, 620_000),
    agent("a4", "Designer", "DS", "UI design before code", "idle", 6, 190_000),
    agent("a5", "Reviewer", "RV", "Code review", "running", 19, 350_000, "Reviewing PR #42"),
    agent("a6", "QA", "QA", "Browser testing", "idle", 9, 210_000),
    agent("a7", "Release Manager", "RM", "Summary for the owner", "paused", 3, 40_000),
  ];
  const own = getConfig<AgentCfg[]>("agents"); // names from the onboarding wizard
  if (own) agents.splice(0, agents.length, ...own.map((a, i) => agent(`a${i + 1}`, a.name, a.name.slice(0, 2).toUpperCase(), a.role, i % 3 === 2 ? "idle" : "running", 6 + i * 3, 150_000 + i * 90_000)));
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "today"].map((lbl, i) => ({ lbl, v: [1.8, 2.4, 2.1, 3.0, 2.7, 0.9, 2.8][i] * 1e6 }));
  const tokTodayN = days[6].v;
  return {
    at: now.toISOString(),
    clock: now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }),
    date: now.toLocaleDateString("en-GB", { day: "numeric", month: "numeric" }),
    ok: true, control: false,
    servers: [
      { n: "web-1", where: "eu-west", target: "demo", up: true, ms: 18, at: now.toISOString() },
      { n: "db-1", where: "eu-west", target: "demo", up: true, ms: 6, at: now.toISOString() },
      { n: "worker-1", where: "eu-central", target: "demo", up: true, ms: 41, at: now.toISOString() },
    ],
    projects: [
      { id: "p1", n: "Acme Storefront", short: "AS", open: 7, you: 2, tot: 31 },
      { id: "p2", n: "Mobile App", short: "MA", open: 4, you: 1, tot: 18 },
      { id: "p3", n: "Internal Tools", short: "IT", open: 2, you: 0, tot: 9 },
    ],
    ventures: [
      { n: "Acme Storefront", url: "https://example.com", you: 2, open: 7, now: "Checkout redesign" },
      { n: "Mobile App", url: "https://example.com/app", you: 1, open: 4, now: "Push notifications" },
    ],
    agents,
    wait: [
      { id: "DEMO-1", t: "Merge CSV export for reports", kind: "PR to merge", st: "in_review", age: "35 min", ageMin: 35, pr: "Acme Storefront", ag: "Builder 1", why: "Tests green, reviewer approved.", runs: 4, tok: "210k", cm: [["Reviewer", "10:12", "Approved, one nit."]], url: "https://example.com/pr/42" },
      { id: "DEMO-2", t: "Which payment provider for the pilot?", kind: "Question", st: "blocked", age: "2 h", ageMin: 120, pr: "Acme Storefront", ag: "Planner", why: "Two options, needs your call.", runs: 2, tok: "60k", cm: [], url: "https://example.com/issue/17" },
      { id: "DEMO-3", t: "Approve staging deploy", kind: "Approval", st: "blocked", age: "5 h", ageMin: 300, pr: "Mobile App", ag: "Release Manager", why: "Waiting for sign-off.", runs: 1, tok: "12k", cm: [], url: "https://example.com/issue/21" },
    ],
    feed: [
      { t: "10:41", a: "Builder 1", aid: "a2", i: "AS-31", r: "Add CSV export to reports", s: "run", d: "12 min", k: "42k" },
      { t: "10:18", a: "Reviewer", aid: "a5", i: "AS-30", r: "Review PR #42", s: "ok", d: "6 min", k: "35k" },
      { t: "09:50", a: "Planner", aid: "a1", i: "MA-18", r: "Split push notifications epic", s: "ok", d: "4 min", k: "28k" },
      { t: "09:12", a: "QA", aid: "a6", i: "MA-17", r: "Smoke test on staging", s: "er", d: "9 min", k: "51k" },
    ],
    talk: [["Planner", "Builder 1", "CSV export is next, spec is in the issue."], ["Reviewer", "Builder 1", "Looks good, one naming nit."]],
    flow: [
      { n: "Assignment", ag: "Planner", c: 2, w: "2 min", iss: ["MA-18"], on: true },
      { n: "Build", ag: "Builder 1–2", c: 3, w: "12 min", iss: ["AS-31"], on: true },
      { n: "Review", ag: "Reviewer · QA", c: 1, w: "6 min", iss: ["AS-30"] },
      { n: "Release", ag: "Owner", c: 2, w: "35 min", iss: ["AS-29"], you: true },
    ],
    feedHours: [0, 0, 0, 0, 0, 1, 0, 2, 4, 6, 5, 3, 4, 6, 7, 5, 4, 3, 2, 1, 0, 0, 0, 0],
    done24: 11, days,
    tokToday: "2.8M", tokTodayN, tokAvgPct: 118, usd: "≈ $14",
    kpi: { runs: 31, running: 3, okPct: 90, failed: 2, avg: "7 min", longest: "21 min" },
    errors: [{ t: "09:12", a: "QA", i: "MA-17", msg: "Staging login timed out" }],
    comments: [{ t: "10:20", a: "Reviewer", text: "Approved PR #42, merge when ready." }],
    waitOldest: "5 h",
  };
};

/* Sample services and machines for the Services and Machines screens (demo mode only). */
const now = (): number => Date.now();
export const demoServices = (): Svc[] => [
  { id: "demo-web", name: "Website", project: "Example Shop", machine: "demo-1", domain: "shop.example.com", addr: "10.0.0.11:3000", public: true, version: { branch: "main", commit: "a1b2c3d", at: new Date(now() - 3_600_000).toISOString() }, up: true, ms: 42, certDays: 61, deploy: { at: new Date(now() - 3_600_000).toISOString(), status: "done" }, source: "demo", at: now() },
  { id: "demo-api", name: "API", project: "Example Shop", machine: "demo-1", domain: "api.example.com", addr: "10.0.0.11:4000", public: true, version: { branch: "main", commit: "e4f5a6b", at: new Date(now() - 86_400_000).toISOString() }, up: true, ms: 77, certDays: 61, deploy: { at: new Date(now() - 86_400_000).toISOString(), status: "done" }, source: "demo", at: now() },
  { id: "demo-docs", name: "Docs", project: "Example Docs", machine: "demo-2", domain: null, addr: "10.0.0.12:8080", public: false, version: null, up: false, ms: null, certDays: null, deploy: null, source: "demo", at: now() },
];
export const demoMachines = (): Machine[] => ["demo-1", "demo-2", "demo-3"].map((name, i) => ({
  name, ok: true, trend: [],
  m: { host: name, at: now(), cpu: 12 + i * 9, load: [0.4 + i * 0.2, 0.5, 0.4], mem: { total: 16e9, avail: (9 - i * 2) * 1e9 }, up: 86_400 * (14 + i * 5), disks: [{ mount: "/", total: 200e9, used: (60 + i * 35) * 1e9, free: (140 - i * 35) * 1e9 }] },
}));

export const demoItems = (): Item[] => {
  const at = (h: number): string => new Date(Date.now() - h * 3_600_000).toISOString();
  const mk = (id: string, state: Item["state"], type: Item["type"], project: string, text: string, h: number, q?: string): Item => ({
    id: `demo:${id}`, source: "mine", owner: { kind: "you", name: "You" }, state, type, project, text, q, actions: [], href: "", at: at(h),
  });
  return [
    mk("1", "na-mne", "smer", "Mobile App", "Approve the new landing page copy", 1, "Ship the draft as is, or ask for another round?"),
    mk("2", "na-mne", "penize", "Acme Storefront", "Renew the example.com domain", 5),
    mk("3", "bezi", "obsah", "Mobile App", "Agent is drafting the weekly newsletter", 2),
    mk("4", "hotovo", "moje", "Acme Storefront", "Fix the checkout button on mobile", 30),
  ];
};

export const demoNetmap = (): { services: Service[]; guests: never[]; live: { proxmox: boolean; dokploy: boolean } } => ({
  services: [
    { id: "demo-1:web", name: "web", machine: "demo-1", ip: "10.0.0.11", port: 443, domain: "app.example.com", scope: "public", up: true, ms: 42, certExpires: null, certDays: 60, url: "https://app.example.com", isNew: false, source: "demo" },
    { id: "demo-2:api", name: "api", machine: "demo-2", ip: "10.0.0.12", port: 8080, domain: null, scope: "lan", up: true, ms: 8, certExpires: null, certDays: null, url: null, isNew: false, source: "demo" },
  ],
  guests: [],
  live: { proxmox: false, dokploy: false },
});

/* demo task card (detail + questions) for the Needs you items */
export const demoCard = (id: string): Card | null => {
  const w = demoSnapshot().wait.find((x) => x.id === id);
  if (!w) return null;
  const q = w.kind === "Question"
    ? [{ id: "q1", text: w.t, options: [
        { key: "a", label: "Stripe", consequence: "Fastest to ship, standard fees.", recommended: true },
        { key: "b", label: "Paddle", consequence: "Handles VAT for you, higher fees.", recommended: false },
      ] }]
    : [{ id: "q1", text: `${w.kind}: ${w.t}?`, options: [
        { key: "yes", label: "Approve", consequence: "The agent continues right away.", recommended: true },
        { key: "no", label: "Send back", consequence: "The agent gets your note and reworks it.", recommended: false },
      ] }];
  return {
    issue: w.id, title: w.t, kind: w.kind, lead: w.why ?? "", url: w.url ?? "", write: false,
    original: { messages: [{ text: `Please handle: ${w.t}`, author: "You", at: "today", via: "BMQOS" }], attachments: [], found: true, brief: w.t },
    outcome: { lines: [w.why ?? "", `${w.runs ?? 1} runs · ${w.tok ?? "–"} tokens`], rows: [], links: w.url ? [["Open", w.url]] : [], media: [] },
    questions: q,
    next: { owner: w.ag ?? "Agent", text: "After your answer the agent continues and reports back here.", stage: 2 },
  };
};
