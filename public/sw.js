/* ─────────────────────────────────────────────────
   신트리 도서관 큐레이션 — Service Worker v1
   전략:
     - 앱 셸 (/) : Stale-While-Revalidate
     - /api/curation  : Network-first → 캐시 폴백
     - /api/refresh   : Network-only (캐시 금지)
     - 이미지/아이콘  : Cache-first
───────────────────────────────────────────────── */
const CACHE = 'shintree-v1';
const PRECACHE = ['/', '/manifest.json', '/icons/icon-192.png'];

/* ── Install: 앱 셸 프리캐시 ── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE))
  );
  self.skipWaiting();
});

/* ── Activate: 이전 캐시 정리 ── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

/* ── Fetch 전략 ── */
self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // /api/refresh → 네트워크 전용 (캐시하면 안 됨)
  if (url.pathname === '/api/refresh') return;

  // /api/curation → Network-first, 오프라인 시 캐시 폴백
  if (url.pathname === '/api/curation') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
          return res;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 책 표지 이미지 → Cache-first
  if (url.hostname !== location.hostname) {
    event.respondWith(
      caches.match(request).then(cached =>
        cached || fetch(request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
      )
    );
    return;
  }

  // 앱 셸 (/) 및 기타 정적 파일 → Stale-While-Revalidate
  event.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(request).then(cached => {
        const fetchPromise = fetch(request).then(res => {
          if (res.ok) cache.put(request, res.clone());
          return res;
        });
        return cached || fetchPromise;
      })
    )
  );
});
