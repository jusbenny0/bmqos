// metrics sampling (5 min) and push observer (1 min): server only, not in the edge runtime
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { sample } = await import("./lib/metrics");
  const { tick } = await import("./lib/push");
  setInterval(() => { void sample().catch(() => undefined); }, 300_000);
  const morning = await import("./lib/morning");
  setInterval(() => { void morning.tick().catch(() => undefined); }, 60_000);
  setInterval(() => { void tick().catch(() => undefined); }, 60_000);
  void sample().catch(() => undefined);
}
