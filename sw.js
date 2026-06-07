/* TaskHub Service Worker
   - Cache-first for static assets (HTML, icons, manifest, Vazirmatn fonts)
   - Network-first for navigation (so updates reach the user fast)
   - Stale-while-revalidate for Google Fonts CSS
   Bump CACHE_VERSION any time the HTML changes to bust the old cache. */
const CACHE_VERSION = 'taskhub-v9-36';
const CACHE_NAME = `taskhub-${CACHE_VERSION}`;

const APP_SHELL = [
  './',
  './index.html',
  './Task_Manager_v8_Responsive_T7.html',
  './manifest.webmanifest',
  './icon-192.svg',
  './icon-512.svg',
];

const FONT_CDN_RE = /fonts\.(googleapis|gstatic)\.com/;
const SUPABASE_CDN_RE = /cdn\.jsdelivr\.net/;

// ── Install: pre-cache the app shell ──
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL).catch(err => console.warn('[SW] pre-cache failed for some:', err));
    self.skipWaiting();
  })());
});

// ── Activate: wipe old caches ──
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('taskhub-') && k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// ── Fetch handler ──
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Navigation requests: network-first → cache fallback
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, fresh.clone()).catch(()=>{});
        return fresh;
      } catch {
        const cached = await caches.match(req) || await caches.match('./Task_Manager_v8_Responsive_T7.html');
        return cached || new Response('offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  // Google Fonts: stale-while-revalidate
  if (FONT_CDN_RE.test(url.host)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetching = fetch(req).then(resp => { cache.put(req, resp.clone()).catch(()=>{}); return resp; }).catch(() => cached);
      return cached || fetching;
    })());
    return;
  }

  // Supabase SDK & other CDNs: cache-first
  if (SUPABASE_CDN_RE.test(url.host)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try { const fresh = await fetch(req); cache.put(req, fresh.clone()).catch(()=>{}); return fresh; }
      catch { return new Response('', { status: 504 }); }
    })());
    return;
  }

  // Same-origin static assets: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone()).catch(()=>{});
        return fresh;
      } catch {
        return cached || new Response('offline', { status: 503 });
      }
    })());
    return;
  }

  // Default: try network, fallback to cache
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

// ── Message channel for forced update from app ──
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
