// push + notification click; cache only the static shell and the latest /api/ted response (stale-while-revalidate). Other routes (auth, API) are never cached.
const CACHE = "bmqos-v2"; // v2: page and JS always from network, cache is just an offline fallback (the owner didn't see deployed changes)
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.filter((u) => u !== "/")))); }); // a new version takes over the page right away
self.addEventListener("activate", (e) => e.waitUntil(Promise.all([self.clients.claim(), caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))]))); // claim: the SW controls the open window immediately (otherwise navigate() on click would fail)
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  if (u.pathname !== "/api/ted" && u.pathname !== "/ted" && !SHELL.includes(u.pathname) && !u.pathname.startsWith("/fonts/") && !u.pathname.startsWith("/_next/static/")) return;
  const fresh = e.request.mode === "navigate" || u.pathname === "/" || u.pathname === "/ted";
  if (fresh) { e.respondWith(caches.open(CACHE).then((c) => fetch(e.request).then(async (r) => { if (r.ok && !r.redirected) await c.put(e.request, r.clone()); return r; }).catch(async () => (await c.match(e.request)) || Response.error()))); return; }
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(e.request);
    const net = fetch(e.request).then(async (r) => { if (r.ok && !r.redirected) await c.put(e.request, r.clone()); return r; }); // 401/redirect to login isn't cached
    if (hit) { e.waitUntil(net.catch(() => undefined)); return hit; }
    return net;
  }));
});
self.addEventListener("push", (e) => {
  const d = e.data ? e.data.json() : {};
  e.waitUntil(self.registration.showNotification(d.title || "bmq/os", { body: d.body || "", tag: d.tag, silent: !!d.silent, icon: "/icon-192.png", badge: "/icon-192.png", data: { url: d.url || "/" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL(e.notification.data.url, self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    const w = cs.find((c) => c.url.startsWith(self.location.origin));
    if (w) { return w.navigate(url).catch(() => self.clients.openWindow(url)).then(() => w.focus()).catch(() => undefined); }
    return self.clients.openWindow(url);
  }));
});
