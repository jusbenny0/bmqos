export type Model = "sonnet" | "haiku";
export type EmpStatus = "idle" | "busy" | "error";
export type TaskStatus = "todo" | "doing" | "review" | "done" | "blocked";

export interface Employee {
  id: number; name: string; role: string; model: Model; system_prompt: string;
  cwd: string; session_id: string | null; status: EmpStatus; context_pct: number; created_at: string;
}
export interface EmployeeCard extends Employee {
  task_id: number | null; task_title: string | null; task_status: TaskStatus | null; last_step: string | null;
  tokens_today: number; last_message: string | null; last_message_at: string | null;
}
export interface Task {
  id: number; title: string; brief: string; owner_id: number | null; reviewer_id: number | null;
  status: TaskStatus; handoff_note: string | null; pr_url: string | null; token_cap: number | null;
  created_at: string; updated_at: string;
}
export interface Message {
  id: number; employee_id: number; task_id: number | null; role: "user" | "assistant" | "system";
  content: string; input_tokens: number; output_tokens: number; cache_read_tokens: number;
  cache_write_tokens: number; cost_usd: number; created_at: string;
}
export interface TaskEvent { id: number; task_id: number; kind: string; text: string; created_at: string }
export interface UsageRow { id: number; label: string; tokens: number; cost_usd: number }
export interface Usage { byEmployee: UsageRow[]; byTask: UsageRow[]; total: { tokens: number; cost_usd: number };
  series: { t: string; tokens: number; cost_usd: number }[] }
export interface TaskMessage { id: number; role: "user" | "assistant" | "system"; employee_id: number; employee: string; content: string; tokens: number; cost_usd: number; created_at: string }
export interface TaskTokens { input: number; output: number; cache_read: number; cache_write: number; cost_usd: number }
export interface TaskDetail extends Task { events: TaskEvent[]; messages: TaskMessage[]; tokens: TaskTokens }
export interface EmployeeDetail extends Employee { messages: Message[] }
