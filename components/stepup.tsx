"use client";
import { useState } from "react";

// 2FA verification (code from an app); first use requires setup first – the secret is shown once
export function StepUp({ need, onDone, onClose }: { need: string; onDone: () => void; onClose: () => void }) {
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [backup, setBackup] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const post = async (body: object) => {
    const res = await fetch("/api/2fa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = (await res?.json().catch(() => ({}))) as { error?: string; secret?: string; qr?: string; backup?: string[] };
    if (!res?.ok) { setErr(j.error ?? "Failed"); return null; }
    setErr(""); return j;
  };
  const enroll = async () => { const j = await post({ op: "enroll" }); if (j?.secret && j.qr) setSetup({ secret: j.secret, qr: j.qr }); };
  const confirm = async () => { const j = await post({ op: "confirm", code }); if (j?.backup) { setBackup(j.backup); setCode(""); } };
  const verify = async () => { if (await post({ op: "verify", code })) onDone(); };
  return (
    <div className="stepup" role="dialog" aria-label="2FA verification">
      <div className="stepup-box">
        {backup ? (<>
          <b>Backup codes (shown only now)</b>
          <pre>{backup.join("\n")}</pre>
          <button onClick={onDone}>I saved them, continue</button>
        </>) : need === "enroll" ? (setup ? (<>
          <b>Scan the QR code in your authenticator app (shown only once)</b>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr} width={220} height={220} alt="2FA QR code" />
          <small>Can't scan? Manual key:</small>
          <pre>{setup.secret}</pre>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code" value={code} onChange={(e) => setCode(e.target.value)} />
          <button onClick={confirm}>Confirm</button>
        </>) : (<>
          <b>Sensitive actions require 2FA. Set it up now?</b>
          <button onClick={enroll}>Set up 2FA</button>
        </>)) : (<>
          <b>Enter the code from your authenticator app</b>
          <input inputMode="numeric" autoComplete="one-time-code" placeholder="6-digit code or backup code" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void verify()} autoFocus />
          <button onClick={verify}>Verify (10 min window)</button>
        </>)}
        {err && <p className="stepup-err">{err}</p>}
        <button className="stepup-x" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}
