const { invoke } = window.__TAURI__.core;
const $ = (id) => document.getElementById(id);
const say = (title, msg, err) => { $("title").textContent = title; $("msg").textContent = msg; $("msg").className = err ? "err" : "muted"; };

async function connect() {
  $("retry").disabled = true;
  say("Connecting…", "");
  try { await invoke("connect", { url: $("url").value }); }
  catch (e) { say("Server not responding", String(e), true); }
  $("retry").disabled = false;
}

$("f").addEventListener("submit", (e) => { e.preventDefault(); connect(); });
$("save").addEventListener("click", async () => {
  try {
    await invoke("save_settings", { shortcut: $("sc").value, autostart: $("auto").checked });
    $("note").textContent = "Saved.";
  } catch (e) { $("note").textContent = String(e); }
});

(async () => {
  const s = await invoke("get_settings");
  $("url").value = s.os_url; $("sc").value = s.shortcut; $("auto").checked = s.autostart;
  const q = new URLSearchParams(location.search);
  if (q.has("offline")) say("Server not responding", "Check the address or connection and try again.", true);
  else if (q.has("settings")) { say("Settings", ""); $("adv").open = true; }
  else connect();
})();
