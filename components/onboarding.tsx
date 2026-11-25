"use client";
import { useState } from "react";
import type { AgentCfg } from "@/lib/config";

const STEPS = ["Company", "Team", "Engine", "Goals", "Access"];
const MODELS = ["haiku", "sonnet", "opus"];

export function Onboarding({ template, accent: defAccent, needCode = false }: { template: AgentCfg[]; accent: string; needCode?: boolean }) {
  const [step, setStep] = useState(0);
  const [company, setCompany] = useState({ name: "", accent: defAccent, owner: "" });
  const [agents, setAgents] = useState<AgentCfg[]>(template);
  const [engine, setEngine] = useState({ mode: "demo", url: "", token: "" });
  const [goal, setGoal] = useState({ model: "sonnet", limit: 0, goal: "", task: "" });
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totp, setTotp] = useState(false);
  const [otp, setOtp] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [env, setEnv] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async (body: unknown) => {
    setBusy(true); setErr("");
    const r = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json", "x-setup-token": code.trim() }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? ((await r.json().catch(() => ({}))) as { error?: string; env?: string | null; otpauth?: string | null; taskSent?: boolean }) : { error: "Network error." };
    setBusy(false);
    if (!r?.ok) { setErr(j.error ?? "Something went wrong."); return false; }
    setEnv(j.env ?? null); setOtp(j.otpauth ?? null); setSent(!!j.taskSent); setDone(true);
    return true;
  };
  const next = () => {
    if (step === 0 && !company.name.trim()) return setErr("Give your company a name.");
    if (step === 1 && !agents.some((a) => a.name.trim())) return setErr("Keep at least one agent.");
    if (step === 2 && engine.mode === "crew" && (!/^https?:\/\//.test(engine.url) || !engine.token)) return setErr("Enter the engine URL (http/https) and token, or choose demo.");
    setErr(""); setStep(step + 1);
  };
  const finish = () => send({ company, agents, engine, goal, password, totp: !!password && totp });
  const setAgent = (i: number, p: Partial<AgentCfg>) => setAgents(agents.map((a, j) => (j === i ? { ...a, ...p } : a)));

  if (done) return (
    <main className="ob"><section className="ob-card">
      <div className="lbl">All set</div>
      <h1>{company.name || "Your company"} is ready</h1>
      {env ? (<>
        <p className="hint">To turn the password login on, add these lines to your <span className="mono">.env</span> and restart BMQOS. Your password and 2FA secret are not stored in the database (the engine token, if you entered one, is; setting it in .env takes precedence).</p>
        <pre className="ob-env">{env}</pre>
        {otp && <p className="hint">Two-factor: add this key to your authenticator app, then confirm it with a code in Settings after the restart.<br /><span className="mono">{otp}</span></p>}
      </>) : <p className="hint">Running without a login. You can add a password any time (see the README).</p>}
      {sent && <p className="hint">Your first task was sent to the engine.</p>}
      <a className="cta ob-cta" href="/">Open the dashboard →</a>
    </section></main>
  );

  return (
    <main className="ob"><section className="ob-card">
      <div className="ob-top">
        <div className="lbl">Setup · step {step + 1} of {STEPS.length}</div>
        <button className="ob-skip" disabled={busy} onClick={async () => { if (await send({ skip: true })) location.href = "/"; }}>Skip, use demo mode</button>
      </div>
      <ol className="ob-steps" aria-label="Progress">{STEPS.map((s, i) => <li key={s} className={i === step ? "on" : i < step ? "ok" : ""}>{s}</li>)}</ol>

      {step === 0 && (<div className="ob-body">
        <h1>Tell us about your company</h1>
        <label className="field"><span>Company name</span><input value={company.name} onChange={(e) => setCompany({ ...company, name: e.target.value })} maxLength={60} autoFocus /></label>
        <label className="field"><span>Your name (optional)</span><input value={company.owner} onChange={(e) => setCompany({ ...company, owner: e.target.value })} maxLength={60} /></label>
        {needCode && <label className="field"><span>Setup code (OS_SETUP_TOKEN)</span><input value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
        <label className="field"><span>Accent color</span><input type="color" value={company.accent} onChange={(e) => setCompany({ ...company, accent: e.target.value })} /></label>
      </div>)}

      {step === 1 && (<div className="ob-body">
        <h1>Your agent team</h1>
        <p className="hint">Start from the default team. Rename, edit or remove roles, or add your own.</p>
        {agents.map((a, i) => (
          <div className="ob-row" key={i}>
            <input aria-label="Agent name" value={a.name} onChange={(e) => setAgent(i, { name: e.target.value })} maxLength={40} />
            <input aria-label="Agent role" value={a.role} onChange={(e) => setAgent(i, { role: e.target.value })} maxLength={80} />
            <button aria-label="Remove agent" onClick={() => setAgents(agents.filter((_, j) => j !== i))}>×</button>
          </div>
        ))}
        {agents.length < 12 && <button className="ob-add" onClick={() => setAgents([...agents, { name: "", role: "" }])}>+ Add agent</button>}
      </div>)}

      {step === 2 && (<div className="ob-body">
        <h1>Agent engine</h1>
        <div className="ob-choice">
          {(["demo", "crew"] as const).map((m) => (
            <button key={m} className={engine.mode === m ? "on" : ""} onClick={() => setEngine({ ...engine, mode: m })}>
              <b>{m === "demo" ? "Demo" : "Connect Crew API"}</b>
              <span>{m === "demo" ? "Sample data, nothing to set up." : "Live team and tasks from your Crew server."}</span>
            </button>
          ))}
        </div>
        {engine.mode === "crew" && (<>
          <label className="field"><span>Crew API URL</span><input value={engine.url} onChange={(e) => setEngine({ ...engine, url: e.target.value })} placeholder="https://crew.example.com" /></label>
          <label className="field"><span>API token</span><input type="password" value={engine.token} onChange={(e) => setEngine({ ...engine, token: e.target.value })} autoComplete="off" /></label>
        </>)}
      </div>)}

      {step === 3 && (<div className="ob-body">
        <h1>Model, limit and first goal</h1>
        <label className="field"><span>Default model</span>
          <select value={goal.model} onChange={(e) => setGoal({ ...goal, model: e.target.value })}>{MODELS.map((m) => <option key={m}>{m}</option>)}</select></label>
        <label className="field"><span>Daily token limit (0 = none)</span><input type="number" min={0} value={goal.limit} onChange={(e) => setGoal({ ...goal, limit: Number(e.target.value) })} /></label>
        <label className="field"><span>First goal</span><input value={goal.goal} onChange={(e) => setGoal({ ...goal, goal: e.target.value })} maxLength={300} placeholder="Launch the new website" /></label>
        <label className="field"><span>First task for the lead agent</span><input value={goal.task} onChange={(e) => setGoal({ ...goal, task: e.target.value })} maxLength={300} placeholder="Draft a plan with milestones" /></label>
      </div>)}

      {step === 4 && (<div className="ob-body">
        <h1>Protect access</h1>
        <p className="hint">Optional. Leave empty to run without a login (fine on your own machine or a private network). </p>
        <label className="field"><span>Password (min. 8 characters)</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
        <label className="ob-check"><input type="checkbox" checked={totp} disabled={!password} onChange={(e) => setTotp(e.target.checked)} /><span>Also require a two-factor code (authenticator app)</span></label>
      </div>)}

      {err && <div className="red" role="alert">{err}</div>}
      <div className="ob-nav">
        {step > 0 ? <button className="ob-back" onClick={() => { setErr(""); setStep(step - 1); }}>← Back</button> : <span />}
        {step < STEPS.length - 1 ? <button className="cta ob-cta" onClick={next}>Continue →</button> : <button className="cta ob-cta" disabled={busy} onClick={finish}>Finish setup</button>}
      </div>
    </section></main>
  );
}
