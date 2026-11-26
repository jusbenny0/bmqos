const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const $ = (id) => document.getElementById(id);
const log = $("log");
let step = 0, cat = null;

listen("log", (e) => { log.textContent += e.payload + "\n"; log.scrollTop = log.scrollHeight; });

function show(n) {
  step = n;
  document.querySelectorAll("main > section").forEach((s, i) => (s.hidden = i !== n));
  document.querySelectorAll("#steps li").forEach((li, i) => li.classList.toggle("on", i <= n));
}
function msg(t, bad) { $("msg").textContent = t || ""; $("msg").className = bad ? "bad" : ""; }
async function busy(btn, fn) {
  btn.disabled = true; msg("");
  try { await fn(); } catch (e) { msg(String(e), true); } finally { btn.disabled = false; }
}
const li = (cls, t) => { const el = document.createElement("li"); el.className = cls; el.textContent = t; return el; };

async function check() {
  const r = await invoke("detect_env");
  const ul = $("env"); ul.replaceChildren(
    li(r.node_ok ? "ok" : "bad", `Node.js ≥ 22: ${r.node ?? "not found"}${r.node && !r.node_ok ? " (too old)" : ""}`),
    li(r.git ? "ok" : "bad", `git: ${r.git ?? "not found"}`),
    li(r.claude ? "ok" : "warn", `claude CLI: ${r.claude ?? "not found (optional; roles run in mock mode)"}`),
    li(r.claude_logged_in ? "ok" : "warn", `claude login: ${r.claude_logged_in ? "yes" : "no (run \`claude\` once to log in)"}`),
  );
  $("envmsg").textContent = r.node_ok && r.git ? "" : "Install Node.js 22+ and git, then re-check.";
  $("to1").disabled = !(r.node_ok && r.git);
}

async function loadCatalog() {
  cat = JSON.parse(await invoke("bridge_detect", { dir: $("dir").value }));
  $("providers").replaceChildren(...cat.providers.map((p) => li(p.available ? "ok" : "muted", `${p.available ? "✔" : "✘"} ${p.id} – ${p.detail}${p.available && !p.supported ? " (not supported yet)" : ""}`)));
  const usable = cat.providers.filter((p) => p.supported).map((p) => p.id);
  const g = $("groups"); g.replaceChildren();
  for (const grp of cat.groups) {
    const l = document.createElement("label"); l.textContent = `${grp}: service / personality`;
    const s = document.createElement("select"); s.dataset.group = grp;
    for (const id of usable.length ? usable : ["mock"]) s.add(new Option(id, id, false, id === cat.plan[grp]));
    const p = document.createElement("select"); p.dataset.persona = grp; p.add(new Option("(default)", ""));
    for (const n of cat.personas) p.add(new Option(n, n));
    l.append(s, p); g.append(l);
  }
  $("playbook").replaceChildren(new Option("none", ""), ...cat.playbooks.map((n) => new Option(n, n)));
}

function collect() {
  const choice = {}, personas = {};
  document.querySelectorAll("[data-group]").forEach((s) => (choice[s.dataset.group] = s.value));
  document.querySelectorAll("[data-persona]").forEach((s) => s.value && (personas[s.dataset.persona] = s.value));
  return { dir: $("dir").value, company: $("company").value, owner: $("owner").value, port: Number($("port").value), choice, personas, playbook: $("playbook").value || null };
}

$("recheck").onclick = () => busy($("recheck"), check);
$("to1").onclick = () => show(1);
$("go1").onclick = () => busy($("go1"), async () => { await invoke("install", { dir: $("dir").value }); await loadCatalog(); show(2); });
$("to3").onclick = () => show(3);
$("go3").onclick = () => busy($("go3"), async () => { await invoke("configure", { config: collect() }); show(4); });
$("go4").onclick = () => busy($("go4"), async () => {
  msg(await invoke("finish", { dir: $("dir").value, start: $("start").checked }) + ($("start").checked ? " BMQOS is starting – the panel opens in your browser." : ""));
  $("go4").hidden = true;
});

(async () => { $("dir").value = await invoke("default_dir"); show(0); await check(); })();
