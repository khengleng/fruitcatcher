/* App-shell service worker: network-first with an offline cache fallback so the
 * portals still open on a flaky/dropped connection. API calls (gateway, cross-
 * origin) and the dynamic config.js always go to the network. */
var CACHE = "lyhuor-shell-v1";
var SHELL = [
  "/", "/index.html", "/student.html", "/parent.html",
  "/i18n.js", "/support-widget.js", "/support-bot-icon.svg", "/manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  // Only cache same-origin app assets. Let the gateway/API + cross-origin pass
  // straight through, and always fetch the dynamic config fresh.
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/config.js" || url.pathname === "/health") return;
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      return res;
    }).catch(function () {
      return caches.match(req).then(function (m) { return m || caches.match("/index.html"); });
    })
  );
});
