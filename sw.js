/* =========================================================================
   포켓몬카드모아 — 서비스 워커 (2026-11-25, v1)
   목적은 두 가지뿐입니다.
     1) 안드로이드 크롬이 '앱 설치'를 제안할 수 있게 하는 최소 요건(fetch 처리)
     2) 인터넷이 끊겼을 때 흰 화면 대신 안내 페이지(offline.html) 보여 주기
   사이트 자산·데이터는 캐시에 담지 않습니다. site-config.json·pokemongo.json
   처럼 자주 바뀌는 파일이 낡은 값으로 보이지 않도록, 모든 요청은 그대로
   네트워크로 보내고(패스스루) 실패한 '페이지 열기'만 오프라인 안내로 받습니다.
   ========================================================================= */

const CACHE = 'pokemoa-offline-v1';
const OFFLINE_URL = new URL('offline.html', self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.add(new Request(OFFLINE_URL, { cache: 'reload' }));
      } catch (err) {
        /* 오프라인 안내를 못 담아도 설치는 계속합니다. */
      }
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('pokemoa-offline-') && key !== CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  /* GET 이 아니거나(제보·문의 POST), 다른 출처(중계 서버·카카오맵·애드센스)면
     손대지 않고 브라우저 기본 동작에 맡깁니다. */
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }
  if (url.origin !== self.location.origin) return;

  /* 페이지 열기만 오프라인 안내로 받아 줍니다. */
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (err) {
          const cache = await caches.open(CACHE);
          const cached = await cache.match(OFFLINE_URL);
          if (cached) return cached;
          return new Response(
            '<!doctype html><meta charset="utf-8"><title>오프라인</title>' +
              '<p style="font:16px/1.6 system-ui;padding:24px">인터넷에 연결되어 있지 않습니다. 연결을 확인한 뒤 다시 열어 주세요.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
          );
        }
      })()
    );
  }

  /* 그 밖의 정적 자산·데이터(css·js·json·png)는 캐시 없이 네트워크 그대로. */
});
