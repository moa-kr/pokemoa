/* =========================================================================
   포켓몬카드모아 — 앱 설치(PWA) 지원 (2026-11-25, v2)
   · manifest.webmanifest 연결은 index.html 의 <link rel="manifest">
   · 이 파일은 ① 홈 화면 앱으로 열렸는지 집계 ② 헤더 「앱 설치」 버튼
     ③ 서비스 워커 등록만 합니다. 화면·기존 기능(지도·달력·팝업)에는 관여하지 않습니다.

   「📲 앱 설치」 버튼 (index.html 의 #appInstallBtn)
   - 안드로이드 크롬·엣지처럼 beforeinstallprompt 를 보내는 브라우저:
     이벤트를 붙잡아 두었다가 버튼을 보이고, 누르면 브라우저 설치 창을 띄웁니다.
   - iOS 사파리(이벤트가 없음): 버튼을 보이고, 누르면 공유 → 홈 화면에 추가 안내를 띄웁니다.
   - 그 밖에 설치를 지원하지 않는 브라우저(데스크톱 파이어폭스 등): 버튼을 숨깁니다.
   - 이미 홈 화면 앱으로 열린 경우(standalone): 버튼을 숨깁니다.
   버튼은 처음부터 hidden 으로 두고 위 조건을 만족할 때만 보이므로,
   설치를 지원하지 않는 환경에서 빈 자리나 깨진 버튼이 남지 않습니다.
   ========================================================================= */
(function () {
  'use strict';

  var doc = document;
  var btn = null;
  var promptEvent = null;
  var noteTimer = null;

  /* ------------------------------------------------------------ 상태 판별 */
  /* 홈 화면에 추가한 앱으로 열렸는지 (안드로이드 크롬 / iOS 사파리) */
  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      if (window.navigator && window.navigator.standalone === true) return true;
    } catch (err) {
      /* 판별 실패는 '일반 브라우저'로 봅니다. */
    }
    return false;
  }

  function userAgent() {
    return (window.navigator && window.navigator.userAgent) || '';
  }

  /* iOS·iPadOS — beforeinstallprompt 가 없어 '공유 → 홈 화면에 추가' 안내로 대신합니다. */
  function isIos() {
    if (/iPad|iPhone|iPod/.test(userAgent())) return true;
    /* iPadOS 13 부터는 데스크톱 사파리처럼 MacIntel 로 보입니다. */
    return (window.navigator && window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  }

  /* 카카오톡·인스타그램 등 앱 안의 브라우저에서는 홈 화면 추가가 되지 않습니다. */
  function isInAppBrowser() {
    return /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\//i.test(userAgent());
  }

  function track(name, params) {
    if (typeof window.gtag !== 'function') return;
    var p = { event_category: 'pwa', app_name: 'pokemoa' };
    if (params) for (var k in params) if (Object.prototype.hasOwnProperty.call(params, k)) p[k] = params[k];
    window.gtag('event', name, p);
  }

  /* 안내 문구는 사이트 공통 토스트(#toast)를 그대로 씁니다. */
  function note(msg) {
    var el = doc.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('is-show');
    if (noteTimer) clearTimeout(noteTimer);
    noteTimer = setTimeout(function () { el.classList.remove('is-show'); }, 5000);
  }

  /* -------------------------------------------------------- 설치 버튼 동작 */
  function showButton() {
    if (btn) btn.hidden = false;
  }
  function hideButton() {
    if (btn) btn.hidden = true;
  }

  function onInstallClick() {
    /* ① 브라우저가 설치 창을 열어 줄 수 있는 경우 */
    if (promptEvent) {
      var ev = promptEvent;
      promptEvent = null; /* 설치 창은 한 번만 쓸 수 있습니다. */
      hideButton();
      track('pwa_install_prompt');
      try {
        ev.prompt();
      } catch (err) {
        note('브라우저가 설치 창을 열지 못했습니다. 브라우저 메뉴의 「앱 설치」를 이용해 주세요.');
        return;
      }
      try {
        var choice = ev.userChoice;
        if (choice && typeof choice.then === 'function') {
          choice.then(function (result) {
            var outcome = (result && result.outcome) || 'unknown';
            track('pwa_install_result', { outcome: outcome });
            if (outcome === 'dismissed') {
              note('나중에 설치하려면 브라우저 메뉴의 「앱 설치」를 눌러 주세요.');
            }
          });
        }
      } catch (err) {
        /* 결과를 못 받아도 설치는 이미 진행 중일 수 있습니다. */
      }
      return;
    }

    /* ② beforeinstallprompt 가 없는 환경 — 손으로 추가하는 길을 안내합니다. */
    if (isInAppBrowser()) {
      note('지금은 앱 안의 브라우저입니다. 사파리에서 주소를 연 뒤 공유 → 「홈 화면에 추가」를 눌러 주세요.');
      return;
    }
    if (isIos()) {
      note('사파리 하단의 공유 버튼을 누르고 「홈 화면에 추가」를 고르면 앱처럼 열립니다.');
      return;
    }
    note('이 브라우저는 앱 설치를 지원하지 않습니다. 크롬·엣지에서 열어 주세요.');
  }

  function initInstallButton() {
    btn = doc.getElementById('appInstallBtn');
    if (!btn) return;
    hideButton(); /* 기본은 숨김 — 설치할 수 있게 될 때만 보입니다. */
    if (isStandalone()) {
      btn.setAttribute('data-state', 'installed');
      return;
    }
    btn.addEventListener('click', onInstallClick);

    window.addEventListener('beforeinstallprompt', function (e) {
      /* 브라우저가 띄우는 기본 미니 배너 대신 헤더의 우리 버튼을 씁니다. */
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      promptEvent = e;
      if (isStandalone()) return;
      btn.setAttribute('data-state', 'ready');
      showButton();
    });

    window.addEventListener('appinstalled', function () {
      promptEvent = null;
      btn.setAttribute('data-state', 'installed');
      hideButton();
      track('pwa_installed');
      note('홈 화면에 포켓몬카드모아가 설치되었습니다. 아이콘으로 열면 주소창 없이 열립니다.');
    });

    /* iOS 는 beforeinstallprompt 가 오지 않으므로 처음부터 버튼을 보이고 안내로 동작합니다. */
    if (isIos()) {
      btn.setAttribute('data-state', 'ios');
      showButton();
    }
  }

  /* 1) 홈 화면에서 앱처럼 열렸는지 GA4 에 한 번 남깁니다. */
  var standalone = isStandalone();
  if (standalone) track('pwa_standalone_view');

  /* 2) 「앱 설치」 버튼 — defer 로 실행되므로 이 시점에 헤더 버튼은 이미 그려져 있습니다. */
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', initInstallButton);
  else initInstallButton();

  /* 3) 서비스 워커 등록 — 오프라인 안내 + 설치 요건 충족용 최소 워커.
     (설치를 지원하지 않는 브라우저에서도 버튼 동작에는 영향이 없습니다.) */
  if (!('serviceWorker' in navigator)) return;

  function register() {
    /* sw.js 는 이 페이지와 같은 폴더(사이트 루트)에 있고 범위도 그 폴더입니다.
       상대 경로로 등록해 GitHub Pages(/pokemoa/)와 로컬 미리보기 모두에서 동작합니다. */
    navigator.serviceWorker.register('sw.js').catch(function (err) {
      /* 등록이 안 되어도 사이트는 그대로 동작합니다(설치 제안·오프라인 안내만 빠짐). */
      if (window.console && console.warn) console.warn('[pwa] 서비스 워커 등록 실패:', err && err.message);
    });
  }

  if (doc.readyState === 'complete') register();
  else window.addEventListener('load', register);
})();
