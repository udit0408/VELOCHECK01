const CACHE_NAME = "velocheck-v16";
const ASSETS = [
  "./",
  "./index.html",
  "./homepage.html",
  "./auth.html",
  "./subscription.html",
  "./maintenance.html",
  "./index (1).html",
  "./auth-client.js",
  "./ai-assistant.js",
  "./towing.html",
  "./bike.html",
  "./car.html",
  "./detail.html",
  "./setting.html",
  "./notification.html",
  "./registeration.html",
  "./style.css",
  "./gauge.js",
  "./live-dashboard.js",
  "./app-navigation.js",
  "./manifest.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.url.includes("/api/")) {
    e.respondWith(fetch(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then((res) => res || fetch(e.request)));
});
