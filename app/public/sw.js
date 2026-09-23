/* 끝말잇기 대국 — 서비스 워커
   게임은 원래 오프라인으로 돌아간다. 사전까지 번들에 있어서 네트워크가 필요 없다.

   다만 캐시 우선을 문서에까지 적용하면 안 된다. index.html을 캐시에서만 꺼내 쓰면
   새로 배포한 빌드가 기존 설치본에 영영 도달하지 않는다. TWA는 껍데기만 스토어에 올라가고
   내용은 매번 웹에서 받아오는 구조라, 문서가 낡으면 업데이트 경로 자체가 막힌다.

   그래서 둘로 나눈다.
     · 문서(네비게이션)  — 네트워크 우선, 실패하면 캐시. 오프라인에서도 열리고 갱신도 된다.
     · 나머지 같은 출처  — 캐시 우선. 파일명에 해시가 박혀 있어 내용이 바뀌면 이름이 바뀐다. */
const CACHE = 'wordbaduk-v2';
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

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match('./index.html').then((hit) => hit || Response.error()))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      }).catch(() => Response.error());
    })
  );
});
