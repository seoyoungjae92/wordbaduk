/* 끝말잇기 대국 — 서비스 워커
   게임은 원래 오프라인으로 돌아간다. 사전까지 번들에 있어서 네트워크가 필요 없다.
   그래서 전략은 단순하다 — 같은 출처 GET은 캐시 우선, 없으면 받아서 캐시에 넣는다. */
const CACHE = 'wordbaduk-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './dict.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(CORE))
      .catch(() => {})            // 하나라도 실패해도 설치는 막지 않는다
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

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;   // 폰트 등은 건드리지 않는다

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() =>
        // 오프라인에서 페이지를 요청하면 캐시된 껍데기를 돌려준다
        req.mode === 'navigate' ? caches.match('./index.html') : Response.error()
      );
    })
  );
});
