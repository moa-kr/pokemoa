/* =========================================================================
   포켓몬카드모아 — 앱 설치(PWA) 지원 (2026-11-25, v1)
   · manifest.webmanifest 연결은 index.html 의 <link rel="manifest">
   · 이 파일은 서비스 워커 등록과 '홈 화면 앱으로 열림' 집계만 합니다.
     화면·기존 기능(지도·달력·팝업)에는 관여하지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  /* 1) 홈 화면에서 앱처럼 열렸는지 GA4 에 한 번 남깁니다. */
  try {
    var standalone =
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;
    if (standalone && typeof window.gtag === 'function') {
      window.gtag('event', 'pwa_standalone_view', {
        event_category: 'pwa',
        app_name: 'pokemoa'
      });
    }
  } catch (err) {
    /* 집계 실패는 무시합니다. */
  }

  /* 2) 서비스 워커 등록 — 오프라인 안내 + 설치 요건 충족용 최소 워커. */
  if (!('serviceWorker' in navigator)) return;

  function register() {
    /* sw.js 는 이 페이지와 같은 폴더(사이트 루트)에 있고 범위도 그 폴더입니다.
       상대 경로로 등록해 GitHub Pages(/pokemoa/)와 로컬 미리보기 모두에서 동작합니다. */
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      /* 등록이 안 되어도 사이트는 그대로 동작합니다(설치 제안·오프라인 안내만 빠짐). */
      if (window.console && console.warn) console.warn('[pwa] 서비스 워커 등록 실패:', err && err.message);
    });
  }

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();
