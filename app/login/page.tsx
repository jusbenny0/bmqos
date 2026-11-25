import { stageSvg } from "@/lib/stage";
import type { Agent, Project } from "@/lib/types";

// purely decorative: no real data before login
const P: Project[] = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, n: "", short: "", open: 3 + (i % 4), you: i % 3 === 0 ? 2 : 0, tot: 14 + i * 3 }));
const A: Agent[] = Array.from({ length: 17 }, (_, i) => ({
  id: `a${i}`, n: "", s: "", role: "", st: i % 4 === 0 ? "running" : "idle", pr: `p${i % 8}`, adapter: "", hb: "", tok: "", tokN: 0, runs: 0, ok: 0, spark: [],
}));
const art = stageSvg(P, A, 0, false, true);

export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <div className="login">
      <div className="art">
        <div className="hud tl" style={{ zIndex: 2 }}>localhost:3000</div>
        <div dangerouslySetInnerHTML={{ __html: art }} style={{ display: "contents" }} />
      </div>
      <form className="form" method="post" action="/api/login">
        <div className="lbl">Access for one person only</div>
        <h1>Your company,<br /><i>at a glance</i></h1>
        <div className="hint">There's nothing to see here without logging in.</div>
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" required autoFocus />
        </label>
        <button className="cta" type="submit" style={{ marginTop: 8, padding: "15px 22px", border: 0, cursor: "pointer" }}>Log in →</button>
        {e ? <div className="red" role="alert" style={{ fontSize: 13 }}>This account doesn't have access here.</div> : null}
        <div className="lbl" style={{ color: "var(--dim)", marginTop: "auto" }}>BMQOS</div>
      </form>
    </div>
  );
}
