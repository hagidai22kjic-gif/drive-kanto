const CACHE = 'drive-kanto-v4';
const OSRM_CACHE = 'drive-kanto-osrm-v1';
const PRECACHE = [
  '/index_5.html',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Outfit:wght@500;700&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== OSRM_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // OSRM: cache-first（ルート形状は変わらない）、30日TTL相当
  if (url.hostname.includes('osrm')) {
    e.respondWith(
      caches.open(OSRM_CACHE).then(cache =>
        cache.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(res => {
            if (res.ok) cache.put(e.request, res.clone());
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // OSM tiles: network first（描画は localStorage JPEG でカバー済み）
  if (url.hostname.includes('tile.openstreetmap') || url.hostname.includes('.tile.')) {
    e.respondWith(fetch(e.request).catch(() => new Response('', { status: 503 })));
    return;
  }

  // Everything else: cache first, then network, then update cache
  e.respondWith(
    caches.match(e.request).then(cached => {
      const networkFetch = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || networkFetch;
    })
  );
});
