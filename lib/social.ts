import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

// action contract (social-manager): PATCH /api/drafts/:id, POST /api/drafts/bulk
export const ACTIONS = ["approve", "edit", "reject", "snooze"] as const;
export type Action = (typeof ACTIONS)[number];
export interface ActionBody { action: Action; text?: string; reason?: string; until?: number }

const isAction = (a: unknown): a is Action => ACTIONS.includes(a as Action);

/** Validates an action body; returns only known fields, otherwise null. */
export const parseAction = (b: unknown): ActionBody | null => {
  if (!b || typeof b !== "object") return null;
  const { action, text, reason, until } = b as Record<string, unknown>;
  if (!isAction(action)) return null;
  if (action === "edit") return typeof text === "string" && text.trim() && text.length <= 280 ? { action, text: text.trim() } : null;
  if (action === "reject") return typeof reason === "string" && reason.trim() && reason.length <= 200 ? { action, reason: reason.trim() } : null;
  if (action === "snooze") return typeof until === "number" && Number.isFinite(until) && until > Date.now() ? { action, until } : null;
  return { action };
};

export const upstream = (p: string, init: RequestInit = {}): Promise<Response> =>
  fetch(`${process.env.SOCIAL_API_URL ?? ""}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${process.env.DRAFTS_API_TOKEN ?? ""}`, "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

/** Write audit: one JSON line (time, action, ID, result). Text content is never logged. */
export const audit = async (entry: Record<string, unknown>): Promise<void> => {
  const dir = process.env.OS_DATA_DIR ?? "data";
  try {
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "audit.log"), `${JSON.stringify({ at: new Date().toISOString(), user: process.env.OS_USER ?? "admin", module: "social", ...entry })}\n`);
  } catch (e) {
    console.error("audit failed", e);
  }
};
