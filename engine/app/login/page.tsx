"use client";
import { useState } from "react";

export default function Login() {
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = new FormData(e.currentTarget).get("password");
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password }) });
    if (r.ok) location.href = "/";
    else setError("Wrong password");
  }
  return (
    <main className="mx-auto mt-32 max-w-xs p-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <input name="password" type="password" placeholder="Password" autoFocus className="rounded border px-3 py-2" />
        <button className="rounded bg-black px-3 py-2 text-white">Sign in</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </form>
    </main>
  );
}
