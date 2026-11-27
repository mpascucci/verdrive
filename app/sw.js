// sw.js — makes the app work offline and keeps it up to date.
//
// Strategy: network first, cache as the fallback.
//   - Online: every file is fetched fresh (bypassing the HTTP cache) and the cached copy is replaced.
//     So a new version is picked up without bumping any version number.
//   - Offline, or the network is slower than NETWORK_TIMEOUT: the cached copy is served.
// The files in PRECACHE are stored at install, so the first offline launch already works.
// All paths are relative, so the app works from a sub-folder (e.g. GitHub Pages).

const CACHE = 'fuelprice-v1'; // only change this to drop every old cached file (e.g. after renaming files)
const NETWORK_TIMEOUT = 4000; // ms; a weak signal in the car should not freeze the app

const PRECACHE = [
  './',
  'index.html',
  'style.css',
  'app.js',
  'model.js',
  'gps.js',
  'triplog.js',
  'update.js',
  'profile.js',
  'vehicles.js',
  'wltc.js',
  'elevation.js',
  'i18n.js',
  'segments.js',
  'footer.js',
  'CREDITS.md',
  'share-qr.svg',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((f) => new Request(f, { cache: 'reload' }))))
      .then(() => self.skipWaiting()), // take over without waiting for old tabs to close
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(networkFirst(request));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  const navigating = request.mode === 'navigate';
  try {
    const response = await fetchFresh(request.url, navigating);
    // An expired Cloudflare Access session answers a page load with a redirect to the login page.
    // Pass that redirect on so the browser shows the login (never cache it). Other requests
    // that get redirected fail and fall back to the cache below.
    if (response.type === 'opaqueredirect') return response;
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const page = await cache.match(new URL('index.html', self.registration.scope));
      if (page) return page;
    }
    return Response.error();
  }
}

function fetchFresh(url, manualRedirect = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NETWORK_TIMEOUT);
  return fetch(url, {
    cache: 'no-cache',
    signal: controller.signal,
    redirect: manualRedirect ? 'manual' : 'follow',
  }).finally(() => clearTimeout(timer));
}
