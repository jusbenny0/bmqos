import { esc } from "@/lib/stage";

export interface PushState {
  configured: boolean; key: string;
  cats: { id: string; name: string; hint: string }[]; prefs: Record<string, string>;
  devices: { id: string; endpoint: string; ua: string; at: string }[];
  // state of this browser
  standalone: boolean; perm: string; ios: boolean; here: boolean; supported: boolean;
}
const MODES: [string, string][] = [["push", "Beep"], ["quiet", "Quiet"], ["off", "Off"]];

export const settingsHTML = (s: PushState | null): string => {
  if (!s) return '<div class="screen page setp"><div class="hint" style="padding:40px">Loading…</div></div>';
  const need = s.ios && !s.standalone
    ? '<div class="pr-warn">On iPhone, push only works from the app on the home screen. Safari → Share → Add to Home Screen, then open it from there.</div>' : "";
  const state = !s.configured ? ["Push isn't configured on the server (missing VAPID keys).", ""]
    : !s.supported ? ["This browser doesn't support push.", ""]
    : s.perm === "denied" ? ["Notifications are blocked in the browser. Allow them in the site settings.", ""]
    : s.here ? ["This device is signed in.", "test"] : ["This device doesn't beep yet.", "on"];
  const cats = s.cats.map((c) => `<div class="prow"><div><b>${esc(c.name)}</b><span class="hint">${esc(c.hint)}</span></div><div class="seg" role="group" aria-label="${esc(c.name)}">${MODES.map(([m, l]) => `<button class="${s.prefs[c.id] === m ? "on" : ""}" data-pref="${esc(c.id)}" data-mode="${m}" aria-pressed="${s.prefs[c.id] === m}">${l}</button>`).join("")}</div></div>`).join("");
  const dev = s.devices.map((d) => `<div class="prow"><div><b>${esc(d.ua.replace(/\(.*?\)/g, "").trim().slice(0, 40) || "Device")}</b><span class="hint mono">…${esc(d.endpoint)} · ${esc(new Date(d.at).toLocaleDateString("cs-CZ"))}</span></div><button class="cta ghost" data-unsub="${esc(d.id)}">Disconnect</button></div>`).join("");
  return `<div class="screen page setp"><div class="pagehead"><div><div class="lbl" style="margin-bottom:10px">Notifications · PWA</div><h1>What's allowed to <i>beep</i></h1></div><div class="hint phint">Notifications carry only a kind and an ID, never task text. Quiet 22:30–7:30, only Needs attention gets through.</div></div>
 <div class="setg"><section class="card2"><div class="lbl">Install and this device</div>
 <p class="ln">${s.standalone ? "✓ Installed as an app." : "Running in the browser. Add it to your home screen for an icon with the number of pending items."}</p>${need}
 <p class="ln"><span class="st ${s.here ? "ok" : "bad"}"><i></i>${esc(state[0])}</span></p>
 <div class="ctlrow">${state[1] === "test" ? '<button class="cta" data-push="test">Send test</button><button class="cta ghost" data-push="off">Turn off here</button>' : ""}</div></section>
 <section class="card2"><div class="lbl">What pings</div>${state[1] === "on" ? '<div class="ctlrow"><button class="cta" data-push="on">Turn on notifications</button></div>' : ""}<div class="${s.here ? "" : "dim"}">${cats}</div><div class="hint" style="margin-top:12px">"Quiet" = just a badge with the count on the icon, no sound (updates when the OS is open).</div></section>
 <section class="card2"><div class="lbl">Signed-in devices</div>${dev || '<div class="hint">None.</div>'}</section></div></div>`;
};
