"use client";
import { useCallback, useEffect, useState } from "react";

/** Loads JSON from the API; if the API is missing (404/error), returns the mock. Optional polling. */
export function useApi<T>(url: string, mock: T, pollMs = 0) {
  const [data, setData] = useState<T>(mock);
  const [live, setLive] = useState(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as T);
      setLive(true);
    } catch {
      setLive(false);
    }
  }, [url]);
  useEffect(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { data, live, reload: load };
}

export async function post(url: string, body: unknown): Promise<boolean> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return r.ok;
  } catch {
    return false;
  }
}
