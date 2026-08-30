// FlowPy service worker -- caches the whole app shell so the editor loads
// and runs with no network at all (Simulate, build, save/open all work
// offline already; this just makes the page itself not need a fetch).
// Cross-origin requests (the Pyodide CDN, if that engine is ever used) are
// left alone -- only same-origin GETs are cached.
const CACHE = 'flowpy-v1';
const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/model.js',
  './js/editor.js',
  './js/router.js',
  './js/codegen.js',
  './js/sim-fast.js',
  './js/device.js',
  './fonts/Sono-Light.woff2',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// stale-while-revalidate: serve from cache instantly when we have it (so a
// flaky or absent network never blocks loading), refresh the cache from the
// network in the background, and fall back to network-then-nothing when a
// file was never cached yet.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const network = fetch(e.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
