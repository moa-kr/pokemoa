/* =========================================================================
 * 포켓몬카드모아 — 화면 동작 (탭 · 지도 연동 · 도감 검색 · 모달 · 계산기)
 * ========================================================================= */
(function () {
  "use strict";
  var D = window.POKEMOA_DATA;
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------- GA4 이벤트 */
  /* gtag(GA4)가 없는 경우(스크립트 차단·오프라인·단일 파일 미리보기) 조용히 넘어간다. */
  function trackEvent(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }

  /* ------------------------------------------------------------ 공통 UI */
  var toastEl = $("#toast");
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add("is-show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove("is-show"); }, 2600);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  /* --------------------------------------------------------------- 탭 */
  var panels = {
    home: $("#panel-home"),
    map: $("#panel-map"),
    schedule: $("#panel-schedule"),
    guide: $("#panel-guide"),
    trends: $("#panel-trends")
  };
  var navBtns = $$(".nav-btn");
  var currentTab = "map";
  var tabBooted = false;
  function showTab(name, opts) {
    if (!panels[name]) name = "map";
    var prevTab = currentTab;
    Object.keys(panels).forEach(function (k) {
      if (panels[k]) panels[k].hidden = k !== name;
    });
    navBtns.forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tab") === name);
    });
    currentTab = name;
    /* 첫 화면 진입과 탭 전환을 구분해 보낸다(페이지뷰·체류 시간 해석용) */
    var tabEntry = tabBooted ? "switch" : "initial";
    tabBooted = true;
    trackEvent("tab_view", { tab: name, entry: tabEntry });
    if (name === "map") {
      ensureMap();
      if (mapReady && window.PokeMoaMap) {
        setTimeout(function () { window.PokeMoaMap.invalidate(); }, 80);
      }
    }
    if (!opts || !opts.keepScroll) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
    /* 다른 탭의 '지도에서 재고 찾기'·'내 주변 매장 지도 열기'로 넘어온 경우 —
       이미 떠 있는 진행률 패널(#brandProgress)이 머리글에 밀려 화면 밖에 있으면
       헤더 바로 아래로 끌어와 보여 준다(패널이 없는 첫 진입은 화면을 건드리지 않는다). */
    if (name === "map" && prevTab !== "map" && tabEntry === "switch") bpScrollIntoView(140);
    if (history.replaceState) history.replaceState(null, "", "#" + name);
  }

  function onTabClick(e) {
    var el = e.currentTarget;
    var name = el.getAttribute("data-tab");
    if (!name) return;
    e.preventDefault();
    showTab(name);
    var setId = el.getAttribute("data-goto-set");
    if (setId) selectSet(setId);
    var href = el.getAttribute("href");
    if (href && href.charAt(0) === "#" && href.length > 1) {
      var target = document.getElementById(href.slice(1));
      if (target) {
        setTimeout(function () {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 80);
      }
    }
  }
  $$("[data-tab]").forEach(function (el) {
    el.addEventListener("click", onTabClick);
  });

  /* --------------------------------------------------------------- 지도 */
  /* 실제 지도 엔진(map.js) 연동: 로딩 상태 · 배지 · 매장 목록 · 내 위치 */
  var mapShell = $("#mapShell");
  var provinceSelect = $("#provinceSelect");
  var districtSelect = $("#districtSelect");
  var regionSearch = $("#regionSearch");
  var regionSuggest = $("#regionSuggest");
  var brandSummary = $("#brandSummary");
  var sortSelect = $("#sortSelect");
  var stockToggle = $("#stockOnly");
  var storeListEl = $("#storeList");
  var storeSkeleton = $("#storeSkeleton");
  var mapCountEl = $("#mapCount");
  var mapLoading = $("#mapLoading");
  var mapLoadingText = $("#mapLoadingText");
  var mapLoadingBar = $("#mapLoadingBar");
  var mapLoadingStep = $("#mapLoadingStep");
  var mapStatusText = $("#mapStatusText");
  var mapStatusDot = $("#mapStatusDot");
  var mapRetry = $("#mapRetry");
  var geoBtn = $("#geoBtn");
  var regionBtn = $("#regionBtn");
  var sideSummary = $("#sideSummary");
  var mapNoticeEl = $("#mapNotice");
  var mapCard = $("#mapCard");
  var mapReady = false;
  var gotFirstData = false;
  var isLoadingMap = true;
  /* 마지막 검색 위치 복원 — 첫 조회를 어디서 시작할지(map.js init 의 start)와
     저장 여부(아무것도 안 고른 첫 방문의 기본값은 저장하지 않는다) */
  var bootMapStart = null;
  var lastBootSource = "default";
  /* 매장 목록 노출: 모바일은 처음 3곳 + 더보기 5곳씩, 980px 이상 2열에서는 10곳부터.
     필터·지역·반경이 바뀌면 처음 값으로 돌아갑니다. */
  var LIST_START = 3;
  var LIST_STEP = 5;
  var LIST_START_WIDE = 10;
  var visibleCount = LIST_START;
  function listStartCount() { return window.innerWidth >= 980 ? LIST_START_WIDE : LIST_START; }
  function resetStoreList() { visibleCount = listStartCount(); }
  var currentStores = [];
  var filterState = {
    region: "seoul-gwanghwamun",
    brand: "all",
    sort: "stock",
    stockOnly: false,
    showOffline: true,
    radius: 3000
  };

  var statusText = { in: "재고 있음", check: "미조회", none: "없음" };

  function ensureMap() {
    if (mapReady || !window.PokeMoaMap || !mapShell) return;
    mapReady = true;
    window.PokeMoaMap.init({ container: mapShell, card: mapCard, start: bootMapStart });
    if (filterState.region && window.PokeMoaMap.getState().regionId !== filterState.region) {
      window.PokeMoaMap.setRegion(filterState.region);
    }
  }

  /* 로딩 오버레이 */
  var loadingTimer = null;
  function renderLoading(d) {
    if (!mapLoading) return;
    isLoadingMap = !!(d && d.active);
    if (!d || !d.active) {
      mapLoading.classList.add("is-done");
      setTimeout(function () { mapLoading.hidden = true; }, 260);
      clearInterval(loadingTimer);
      return;
    }
    mapLoading.hidden = false;
    mapLoading.classList.remove("is-done");
    if (mapCountEl) mapCountEl.textContent = "주변 매장 조회 중...";
    if (sideSummary) sideSummary.textContent = "불러오는 중...";
    var moreWrapEl = $("#storeMoreWrap");
    if (moreWrapEl) moreWrapEl.hidden = true;
    mapLoadingText.textContent = d.message || "실제 지도와 주변 매장 위치를 불러오는 중...";
    mapLoadingBar.style.width = (d.progress || 20) + "%";
    mapLoadingStep.textContent = d.phase === "tiles"
      ? "1/2 · 카카오맵 지도 불러오는 중"
      : "2/2 · 카카오 장소 검색으로 주변 편의점 4사 찾는 중";
    /* 진행 바가 멈춰 보이지 않도록 천천히 늘려 둔다 */
    clearInterval(loadingTimer);
    var base = d.progress || 20;
    var cap = d.phase === "data" ? 92 : 44;
    loadingTimer = setInterval(function () {
      base = Math.min(cap, base + 1);
      if (mapLoadingBar) mapLoadingBar.style.width = base + "%";
    }, 420);
  }

  function renderBadge(b) {
    if (!mapStatusText || !b) return;
    mapStatusText.textContent = b.text;
    if (mapStatusDot) mapStatusDot.className = "ms-dot is-" + (b.kind || "snapshot");
    if (mapRetry) mapRetry.hidden = !b.action;
    if (storeSkeleton) storeSkeleton.hidden = !!(gotFirstData && !isLoadingMap);
    if (storeListEl) storeListEl.hidden = !(gotFirstData && !isLoadingMap);
  }

  /* 429·일시 안내 — 빨간 오류 대신 지도 위에 한 줄로 보여 준다 */
  var mapNoticeTimer = null;
  function showMapNotice(text, autoHideMs) {
    if (!mapNoticeEl) return;
    mapNoticeEl.textContent = text;
    mapNoticeEl.hidden = false;
    clearTimeout(mapNoticeTimer);
    if (autoHideMs) mapNoticeTimer = setTimeout(hideMapNotice, autoHideMs);
  }
  function hideMapNotice() {
    clearTimeout(mapNoticeTimer);
    if (mapNoticeEl) mapNoticeEl.hidden = true;
  }
  var RATE_NOTICE = "⏳ 지금 이용자가 많아 잠시 후(약 1~2분 뒤) 다시 조회해 주세요. 매장 위치는 그대로 보실 수 있습니다.";

  /* ------------------------------------- 편의점 4사 조회 진행률 패널 */
  /* 매장 탐색(카카오 장소 검색) 0→40%, 실시간 재고 조회 40→100% 를 4사별로 보여 준다.
     퍼센트는 실제 응답으로만 올라간다 — 장소 검색은 페이지가 도착할 때마다(map.js 의
     pokemoa:search-progress), 재고는 조회 응답(sources)이 도착할 때(relayRefresh 의
     bpRelayDone) 올린다.
     응답이 없으면 100%로 닫으면서 「미연동 · 매장 위치만」처럼 상태를 분명히 적는다. */
  var bpEl = $("#brandProgress");
  var bpRowsEl = $("#bpRows");
  var bpOverallEl = $("#bpOverall");
  var bpRegionEl = $("#bpRegion");
  var bpSummaryEl = $("#bpSummary");
  var bpToggleEl = $("#bpToggle");
  var bpTitleEl = $("#bpTitle");
  var BP_BRANDS = ["gs25", "cu", "seven", "emart24", "emart"];
  /* 재고 조회는 GS25·CU·이마트24 세 브랜드만 한다. GS25는 우리동네GS 로그인 세션이 있어야
     숫자가 오고, 세션이 없으면 중계가 「GS25 로그인 세션 필요」로 답한다(그때는 매장 위치만 보인다).
     세븐일레븐은 앱·점포 API 가 외부 조회를 403 으로 막아(2026-11-20 확인) 재고는 세븐일레븐 정책상
     확인하지 않고, 카카오 장소 검색으로 잡힌 매장 위치만 안내한다. */
  var BP_RELAY = { gs25: 1, cu: 1, seven: 0, emart24: 1, emart: 0 };
  /* 이마트(대형마트)는 relay 가 아니라 브라우저가 api-eapp.emart.com 을 직접 부른다(EMART 행으로 따로 표기) */
  var BP_EMART = { emart: 1 };
  /* 세븐일레븐 정책상 매장 위치만 안내하는 브랜드 — 실패가 아니라 안내이므로 오류 색을 쓰지 않는다 */
  var BP_POLICY_ONLY = { seven: 1 };
  function policyOnlyBrand(b) { return !!BP_POLICY_ONLY[b]; }
  var bp = {
    rows: {},
    stage: 0,        /* 0 대기 · 1 매장 탐색 · 2 재고 조회 · 3 완료 */
    active: false,
    quiet: true,     /* 첫 자동 조회 때는 패널을 띄우지 않는다 */
    expanded: true,
    userCollapsed: false,
    searchDone: false,
    counts: null,
    sourceLabel: "",
    ticker: null,
    collapseTimer: null,
    emartTimer: null,
    emartSeen: false
  };

  function bpMeta(id) { return D.brandMeta[id] || { label: id, color: "#1b2a4a" }; }

  function bpBuildRows() {
    if (!bpRowsEl) return;
    bpRowsEl.innerHTML = BP_BRANDS.map(function (id) {
      var meta = bpMeta(id);
      return '<li class="bp-row" data-brand="' + id + '" data-state="idle" style="--brand:' + meta.color + '">' +
        '<span class="bp-name"><i class="bp-dot" aria-hidden="true"></i>' + meta.label + "</span>" +
        '<span class="bp-bar" role="progressbar" aria-label="' + meta.label +
          ' 조회 진행률" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></span>' +
        '<span class="bp-pct">0%</span>' +
        '<span class="bp-status">대기 중</span></li>';
    }).join("");
    bp.rows = {};
    BP_BRANDS.forEach(function (id) {
      var li = bpRowsEl.querySelector('.bp-row[data-brand="' + id + '"]');
      bp.rows[id] = {
        li: li,
        bar: li ? li.querySelector(".bp-bar") : null,
        fill: li ? li.querySelector(".bp-bar i") : null,
        pct: li ? li.querySelector(".bp-pct") : null,
        status: li ? li.querySelector(".bp-status") : null,
        pctVal: 0,
        state: "idle",
        text: "대기 중"
      };
    });
  }
  bpBuildRows();

  /* ------------------------------ 진행률 패널로 화면 맞추기(사용자가 직접 시작한 조회만) */
  /* 버튼으로 조회를 시작했는데 패널이 머리글에 밀려 화면 밖에 있으면,
     sticky 헤더 바로 아래로 부드럽게 끌어와 「조회 중」임을 알아볼 수 있게 한다.
     위치는 스크롤 직전에 잰 sticky 헤더 높이(+12px 여백)로 잡는다 — 공지 배너가 붙어
     헤더가 높아진 날에도 패널이 헤더 밑에 깔리지 않는다(CSS `[id]{scroll-margin-top:78px}` 는 기본값).
     첫 자동 조회(페이지 진입)와 지도 드래그 재조회에는 부르지 않는다. */
  var bpScrollTimer = null;
  function bpScrollIntoView(delay) {
    if (!bpEl) return;
    clearTimeout(bpScrollTimer);
    bpScrollTimer = setTimeout(function () {
      if (!bpEl || bpEl.hidden || typeof bpEl.scrollIntoView !== "function") return;
      /* sticky 헤더 높이는 공지 배너가 붙으면 커진다 — 지금 높이를 재서 헤더 바로 아래로 맞춘다 */
      var header = document.querySelector(".site-header");
      var headerH = header && header.getBoundingClientRect ? Math.round(header.getBoundingClientRect().height) : 0;
      if (headerH > 0) bpEl.style.scrollMarginTop = (headerH + 12) + "px";
      var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      try {
        bpEl.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      } catch (e) {
        try { bpEl.scrollIntoView(); } catch (e2) {}
      }
    }, typeof delay === "number" ? delay : 80);
  }

  /* 세븐일레븐 안내 문구 — 장소 검색으로 잡힌 매장 수만 말하고 재고는 세븐일레븐 정책상 미지원임을 적는다 */
  function bpPolicyText() {
    var row = (bp.counts || {}).seven;
    var n = row && isFinite(row.total) ? row.total : null;
    return (n == null ? "매장 위치만 안내" : "위치 " + n + "곳 확인") + " · 세븐일레븐 정책상 재고 미지원";
  }

  function bpSet(id, pct, text, state) {
    var r = bp.rows[id];
    if (!r) return;
    r.pctVal = Math.max(0, Math.min(100, Math.round(pct)));
    if (state) r.state = state;
    if (text != null) r.text = text;
    if (r.fill) r.fill.style.width = r.pctVal + "%";
    if (r.pct) r.pct.textContent = r.pctVal + "%";
    if (r.status) r.status.textContent = r.text;
    if (r.bar) r.bar.setAttribute("aria-valuenow", String(r.pctVal));
    if (r.li) r.li.setAttribute("data-state", r.state);
    bpRenderOverall();
  }

  function bpOverallPct() {
    var sum = 0;
    BP_BRANDS.forEach(function (id) { sum += (bp.rows[id] ? bp.rows[id].pctVal : 0); });
    return Math.round(sum / BP_BRANDS.length);
  }

  function bpStopTicker() {
    if (bp.ticker) { clearInterval(bp.ticker); bp.ticker = null; }
  }

  function bpStartTicker() {
    if (bp.ticker) return;
    /* 조회 응답은 한 번에 오므로, 기다리는 동안만 40%→88% 사이를 부드럽게 올린다.
       100% 는 실제 응답이 왔을 때만 쓴다. */
    bp.ticker = setInterval(function () {
      var moved = false;
      BP_BRANDS.forEach(function (id) {
        var r = bp.rows[id];
        if (!r || r.state !== "run") return;
        if (r.pctVal < 88) { bpSet(id, Math.min(88, r.pctVal + 2), r.text, "run"); moved = true; }
      });
      if (!moved) bpStopTicker();
    }, 380);
  }

  function bpRenderOverall() {
    var p = bpOverallPct();
    if (bpOverallEl) bpOverallEl.textContent = p + "%";
    var running = BP_BRANDS.some(function (id) { return bp.rows[id] && bp.rows[id].state === "run"; });
    if (!running) bpStopTicker();
    if (p >= 100 && bp.stage !== 3) bpFinish();
  }

  function bpRenderSummary() {
    if (!bpSummaryEl) return;
    var c = bp.counts || {};
    var bits = BP_BRANDS.map(function (id) {
      var meta = bpMeta(id);
      var row = c[id];
      var n = row && isFinite(row.total) ? row.total : null;
      return '<span class="bp-sum-item"><i class="bp-dot" style="--brand:' + meta.color + '" aria-hidden="true"></i>' +
        meta.label + " <b>" + (n == null ? "-" : n) + "</b>곳" +
        (policyOnlyBrand(id) ? ' <em class="bp-sum-note">재고 미지원</em>' : (BP_EMART[id] ? ' <em class="bp-sum-note">실시간</em>' : "")) + "</span>";
    });
    bpSummaryEl.innerHTML = '<span class="bp-sum-item"><b>' + escapeHtml(bp.sourceLabel || "조회 완료") + "</b></span>" +
      bits.join("");
  }

  function bpCollapse(on) {
    bp.expanded = !on;
    if (bpRowsEl) bpRowsEl.hidden = !!on;
    if (bpSummaryEl) bpSummaryEl.hidden = !on;
    if (bpToggleEl) {
      bpToggleEl.textContent = on ? "자세히" : "접기";
      bpToggleEl.setAttribute("aria-expanded", on ? "false" : "true");
    }
  }

  function bpFinish() {
    bp.stage = 3;
    if (bpEl) {
      bpEl.hidden = false;
      bpEl.setAttribute("data-state", "done");
    }
    bp.quiet = false;
    bp.active = true;
    if (bpTitleEl) bpTitleEl.textContent = "매장·재고 조회 완료";
    bpRenderSummary();
    clearTimeout(bp.collapseTimer);
    /* 끝난 뒤에도 4사 % 막대와 결과 문구를 그대로 남긴다(자동으로 접지 않는다).
       사용자가 직접 '접기'를 누른 경우에만 접힌 상태를 지킨다. */
    bpCollapse(!!bp.userCollapsed);
  }

  function bpShow(force) {
    if (!bpEl) return;
    if (bp.quiet && !force) return;
    bp.quiet = false;
    bp.active = true;
    clearTimeout(bp.collapseTimer);
    bpEl.hidden = false;
    bpEl.setAttribute("data-state", bp.stage === 3 ? "done" : "running");
    if (bpTitleEl) bpTitleEl.textContent = bp.stage === 3 ? "매장·재고 조회 완료" : "매장·재고 조회 (편의점 4사 · 이마트)";
    bpCollapse(bp.stage === 3 && !!bp.userCollapsed);
  }

  function bpLabel(regionId, origin) {
    var r = regionId ? regionById(regionId) : null;
    var km = (filterState.radius || 3000) / 1000;
    /* 지도를 드래그해 찾은 경우에는 고른 지역이 아니라 '지도 중심'을 기준으로 표시한다 */
    if (origin === "map" && !r) return "지도 중심 · " + km + "km";
    if (r) return r.district ? r.district.replace(/\s*\(.*\)$/, "") + " · " + km + "km" : r.name + " · " + km + "km";
    return km + "km 반경";
  }

  function bpReset(regionId, origin) {
    clearTimeout(bp.collapseTimer);
    bp.stage = 1;
    bp.userCollapsed = false;
    bp.searchDone = false;
    bp.counts = null;
    bp.sourceLabel = "";
    if (bpRegionEl) bpRegionEl.textContent = bpLabel(regionId, origin);
    if (bpSummaryEl) { bpSummaryEl.hidden = true; bpSummaryEl.innerHTML = ""; }
    BP_BRANDS.forEach(function (id) {
      if (policyOnlyBrand(id)) { bpSet(id, 0, "매장 위치 확인 중", "run"); return; }
      if (BP_EMART[id]) { bpSet(id, 0, "이마트 점포 확인 중", "run"); return; }
      bpSet(id, 0, "매장 탐색 중", "run");
    });
    /* 이마트 응답이 끝내 오지 않으면 진행률이 98%에 멈추지 않도록 25초 뒤 문구를 정리한다.
       한 번이라도 응답(진행·완료)이 온 뒤에는 건드리지 않는다. */
    bp.emartSeen = false;
    clearTimeout(bp.emartTimer);
    bp.emartTimer = setTimeout(function () {
      var r = bp.rows.emart;
      if (!bp.emartSeen && r && r.state === "run") bpSet("emart", 100, "응답 없음 · 이마트 점포 미확인", "err");
    }, 25000);
    if (bpEl) bpEl.setAttribute("data-state", "running");
  }

  function relayStateNow() {
    return (typeof relay !== "undefined" && relay && relay.state) || "off";
  }

  function bpRelayDone(sources, stores) {
    if (!bp.searchDone) return;
    var src = sources || {};
    /* 응답에 실린 점포·수량으로 브랜드별 결과를 센다 — sources.count 만 믿지 않는다 */
    var byBrand = {};
    (stores || []).forEach(function (st) {
      var b = st && st.brand;
      if (!b) return;
      var qty = 0;
      (st.items || []).forEach(function (it) { qty += Number(it.qty) || 0; });
      var row = byBrand[b] || (byBrand[b] = { stores: 0, qty: 0 });
      row.stores += 1;
      row.qty += qty;
    });
    BP_BRANDS.forEach(function (id) {
      /* 이마트는 relay 응답이 아니라 pokemoa:emart-progress 로 따로 관리한다 */
      if (BP_EMART[id]) return;
      if (policyOnlyBrand(id)) { bpSet(id, 100, bpPolicyText(), "info"); return; }
      if (!BP_RELAY[id]) {
        /* 재고 조회 대상이 아닌 브랜드 — 매장 위치만 보여 준다 */
        bpSet(id, 100, "미연동 · 매장 위치만", "off");
        return;
      }
      var s = src[id];
      if (!s) { bpSet(id, 100, "미연동 · 매장 위치만", "off"); return; }
      if (s.ok) {
        var row = byBrand[id] || { stores: 0, qty: 0 };
        /* 응답에 실린 점포 수가 실제 화면에 반영되는 수다(수집 단계 count 는 더 클 수 있다) */
        var n = row.stores;
        if (!n && isFinite(Number(s.count))) n = Number(s.count);
        if (!n) {
          var why = String(s.note || "");
          if (/GS25|로그인 세션|GS25_ACCESS_TOKEN/.test(why)) {
            bpSet(id, 100, "로그인 연동 전 · 매장 위치만", "off");
          } else if (/차단|403/.test(why)) {
            bpSet(id, 100, "일시 차단 · 매장 위치만", "off");
          } else {
            bpSet(id, 100, "조회 완료 · 0곳 확인", "done");
          }
          return;
        }
        bpSet(id, 100, "조회 완료 · " + n + "곳 확인(재고 " + row.qty + ")", "done");
      } else {
        bpSet(id, 100, "응답 없음 · 매장 위치만" + (s.upstream ? " (HTTP " + s.upstream + ")" : ""), "err");
      }
    });
    bpRenderOverall();
  }

  function bpRelayStart(manual) {
    if (bp.stage === 1) return;       /* 아직 매장 탐색 중 — search-done 이 이어받는다 */
    if (bp.stage === 0) {
      bp.searchDone = true;
      bp.sourceLabel = "재고 새로고침";
    }
    bp.stage = 2;
    if (bpEl) bpEl.setAttribute("data-state", "running");
    if (bpTitleEl) bpTitleEl.textContent = "편의점 4사 · 이마트 재고 조회";
    BP_BRANDS.forEach(function (id) {
      if (!BP_RELAY[id]) return;
      bpSet(id, 40, "최대 매장 조회 중 (최대 25~30초)", "run");
    });
    /* 완료되어 접혀 있던 패널도 새 진행이 시작되면 다시 펼쳐 보여 준다 */
    if (manual) { bp.quiet = false; bpShow(true); bpScrollIntoView(); }
    else if (bpEl && !bpEl.hidden) bpCollapse(false);
    bpStartTicker();
  }

  function bpRelayFail() {
    if (!bp.searchDone) return;
    BP_BRANDS.forEach(function (id) {
      if (!BP_RELAY[id]) return;
      bpSet(id, 100, "응답 없음 · 매장 위치만", "err");
    });
    bpRenderOverall();
  }

  function bpRelayOff(why) {
    if (!bp.searchDone) return;
    BP_BRANDS.forEach(function (id) {
      if (!BP_RELAY[id]) return;
      bpSet(id, 100, why === "error" ? "응답 없음 · 매장 위치만" : "미연동 · 매장 위치만", why === "error" ? "err" : "off");
    });
    bpRenderOverall();
  }

  if (bpToggleEl) {
    bpToggleEl.addEventListener("click", function () {
      bp.userCollapsed = bp.expanded;   /* 펼쳐져 있으면 → 접기 */
      bpCollapse(bp.expanded);
    });
  }

  document.addEventListener("pokemoa:search-start", function (e) {
    var d = e.detail || {};
    bpReset(d.regionId, d.origin);
    if (d.initial) { bp.quiet = true; return; }
    /* 지도를 드래그해 새 중심으로 다시 찾을 때만 짧게 알려 준다 */
    if (d.origin === "map") {
      toast("지도 중심 기준으로 주변 매장을 다시 찾습니다 · " + ((d.radius || filterState.radius || 3000) / 1000) + "km");
    }
    bpShow(true);
    /* 지도 드래그(origin=map)는 지도를 보면서 하는 조작이라 화면을 끌어오지 않는다 */
    if (d.origin !== "map") bpScrollIntoView();
  });

  document.addEventListener("pokemoa:search-progress", function (e) {
    if (bp.stage !== 1) return;
    var d = e.detail || {};
    var total = Math.max(1, d.total || 1);
    var pct = Math.min(40, Math.round(40 * (d.resolved || 0) / total));
    var found = d.found || {};
    BP_BRANDS.forEach(function (id) {
      /* 이마트는 편의점 장소 검색과 별도 수명으로 돈다 — 여기서 손대지 않는다
         (검색이 늦게 끝날 때 이마트 행을 다시 0%로 되돌리면 완료된 행이 사라진다) */
      if (BP_EMART[id]) return;
      var n = found[id] || 0;
      bpSet(id, pct, n
        ? (policyOnlyBrand(id) ? "위치 " + n + "곳 확인 중" : "매장 " + n + "곳 찾는 중")
        : (policyOnlyBrand(id) ? "매장 위치 확인 중" : "매장 탐색 중"), "run");
    });
  });

  document.addEventListener("pokemoa:search-done", function (e) {
    var d = e.detail || {};
    bp.searchDone = true;
    bp.counts = d.brandCounts || null;
    if (d.source !== "live") {
      /* 카카오맵을 못 그리는 주소·검색 제한 — 내장 좌표로 표시했음을 그대로 적는다 */
      bp.sourceLabel = "내장 좌표로 표시";
      BP_BRANDS.forEach(function (id) {
        if (BP_EMART[id]) return;   /* 이마트는 지도 없이도 직접 조회된다 */
        if (policyOnlyBrand(id)) { bpSet(id, 100, "매장 위치 미확인 · 세븐일레븐 정책상 재고 미지원", "info"); return; }
        bpSet(id, 100, "미연동 · 매장 위치만", "off");
      });
      bpRenderOverall();
      return;
    }
    bp.sourceLabel = "실시간 조회 완료";
    bp.stage = 2;
    /* 세븐일레븐은 재고 조회 대상이 아니다 — 장소 검색으로 잡힌 매장 위치만 확인하고 끝낸다 */
    BP_BRANDS.forEach(function (id) { if (policyOnlyBrand(id)) bpSet(id, 100, bpPolicyText(), "info"); });
    var rs = relayStateNow();
    if (rs === "online" || rs === "checking") {
      BP_BRANDS.forEach(function (id) {
        if (!BP_RELAY[id]) return;
        bpSet(id, 40, rs === "online" ? "재고 조회 중" : "연결 확인 중", "run");
      });
      bpStartTicker();
    } else {
      bpRelayOff(rs === "error" ? "error" : "off");
    }
    bpRenderOverall();
  });

  document.addEventListener("pokemoa:relay-state", function (e) {
    var s = (e.detail && e.detail.state) || "off";
    if (s === "online" || s === "checking") return;   /* 그러면 곧 relayRefresh 가 시작된다 */
    if (!bp.searchDone) return;
    if (bp.rows.cu && bp.rows.cu.state === "run") bpRelayOff(s);
  });

  /* 이마트 실시간 재고 진행 — 점포 목록 0→25%, 점포×카드 25→98%, 응답 도착에 100% */
  var EMART_STOCK_FROM = 25, EMART_STOCK_TO = 98;
  document.addEventListener("pokemoa:emart-progress", function (e) {
    var d = e.detail || {};
    if (!bp.rows.emart) return;
    bp.emartSeen = true;
    if (d.phase === "stores") {
      var pct = d.done ? 25 : 6;
      bpSet("emart", pct, d.done
        ? (d.stores ? "이마트 " + d.stores + "곳 재고 조회 중" : "반경 안 이마트 점포 없음")
        : "이마트 점포 확인 중", "run");
      return;
    }
    var total = Math.max(1, d.total || 1);
    var done = Math.min(total, d.done || 0);
    bpSet("emart", EMART_STOCK_FROM + Math.round((EMART_STOCK_TO - EMART_STOCK_FROM) * done / total),
      "이마트 재고 " + done + "/" + total + " 확인 중", "run");
  });

  document.addEventListener("pokemoa:emart-done", function (e) {
    var d = e.detail || {};
    if (!bp.rows.emart) return;
    bp.emartSeen = true;
    if (!d.stores || !d.stores.length) {
      bpSet("emart", 100, d.ok === false
        ? "응답 없음 · 이마트 점포 미확인"
        : "반경 안 이마트 점포 없음", d.ok === false ? "err" : "off");
      return;
    }
    var n = d.stores.length;
    var inN = 0, unN = 0, closedN = 0;
    d.stores.forEach(function (s) {
      if (s.emartState === "in") inN += 1;
      else if (s.emartState === "undisclosed") unN += 1;
      if (s.emartClosed) closedN += 1;
    });
    var bits = ["이마트 " + n + "곳"];
    if (inN) bits.push("재고 " + inN);
    if (unN) bits.push("비공개 " + unN);
    if (closedN) bits.push("휴무 " + closedN);
    bpSet("emart", 100, "실시간 조회 · " + bits.join(" · "), "done");
  });

  document.addEventListener("pokemoa:loaded", function () {
    if (regionBtn) regionBtn.classList.remove("is-busy");
  });

  /* 매장별 취급·재고 카드 상품명 태그 — 수량 0개 카드는 숨기고 실제 재고(>0)만 보여 준다.
     모든 카드가 0개면 태그 줄을 비우고 상태 배지·수량 칩만 남긴다. */
  function stockedProducts(s) {
    return (s.products || []).filter(function (p) {
      var q = Number(p.qty);
      if (isFinite(q)) return q > 0;
      return p.state === "in" || p.state === "low";
    });
  }

  function productTagsHtml(s) {
    var list = stockedProducts(s);
    if (!list.length) return "";
    var tags = list.map(function (p) {
      return '<span class="p-tag is-' + p.state + '" title="' + p.name + " · " + p.stateLabel + '">' +
        p.short + ' <i>· ' + p.stateLabel + "</i></span>";
    }).join("");
    return '<span class="s-products">' + tags + "</span>";
  }

  /* 정렬: 재고 우선(재고 있음 → 미조회 → 없음, 각각 가까운 순) / 가까운 거리순 */
  var STATUS_RANK = { in: 0, check: 1, none: 2 };
  function sortStores(list) {
    var arr = (list || []).slice();
    if (filterState.sort === "stock") {
      arr.sort(function (a, b) {
        var d = (STATUS_RANK[a.status] || 0) - (STATUS_RANK[b.status] || 0);
        return d !== 0 ? d : a.distance - b.distance;
      });
    } else {
      arr.sort(function (a, b) { return a.distance - b.distance; });
    }
    return arr;
  }

  /* 매장 목록: 재고 우선/가까운 순 정렬 + 처음 10곳 + 더보기 */
  function renderStores(list) {
    currentStores = (list || []).slice();
    drawStoreList();
  }

  function drawStoreList() {
    if (!storeListEl) return;
    var list = sortStores(currentStores);
    var counts = { in: 0, check: 0, none: 0 };
    var offlineN = 0;
    var policyN = 0;
    var emartN = 0, emartUnN = 0, emartClosedN = 0;
    list.forEach(function (s) {
      counts[s.status] += 1;
      if (s.offline) offlineN += 1;
      /* 이마트는 '재고 있음'만 일반 재고로 세고, 수량 비공개·품절은 따로 적는다 */
      if (s.emart) {
        emartN += 1;
        if (s.emartState === "undisclosed") emartUnN += 1;
        if (s.emartClosed) emartClosedN += 1;
      }
      /* 세븐일레븐은 재고를 확인하지 않는다 — '미조회'에 삼키지 않고 위치 안내로 따로 센다 */
      if (policyOnlyBrand(s.brand)) policyN += 1;
    });
    if (mapCountEl) {
      /* 항목을 한 덩어리씩 감싸 줄바꿈이 항목 경계에서 일어나게 한다(줄 끝에 '·'만 남지 않게) */
      var mcParts = ['<span class="mc">표시 중 <b>' + list.length + "</b>곳</span>"];
      if (offlineN) mcParts.push('<span class="mc">오프라인 ' + offlineN + "곳</span>");
      mcParts.push('<span class="mc">재고 ' + counts.in + "</span>");
      mcParts.push('<span class="mc">미조회 ' + Math.max(0, counts.check - offlineN - policyN - emartUnN) + "</span>");
      if (policyN) mcParts.push('<span class="mc">위치안내 ' + policyN + "</span>");
      if (emartN) mcParts.push('<span class="mc">이마트 ' + emartN + (emartClosedN ? " · 휴무 " + emartClosedN : "") + "</span>");
      if (emartUnN) mcParts.push('<span class="mc">비공개 ' + emartUnN + "</span>");
      mcParts.push('<span class="mc">없음 ' + counts.none + "</span>");
      mapCountEl.innerHTML = mcParts.join("");
    }
    if (sideSummary) {
      sideSummary.textContent = list.length
        ? (filterState.sort === "stock" ? "재고 우선 · " : "가까운 순 · ") + list.length + "곳"
        : "조건에 맞는 매장 없음";
    }

    storeListEl.innerHTML = "";
    if (!list.length) {
      var li0 = document.createElement("li");
      li0.className = "store-empty";
      li0.textContent = "이 조건에 맞는 매장이 없습니다. 반경을 넓히거나 다른 브랜드를 골라 보세요.";
      storeListEl.appendChild(li0);
      return;
    }

    var start = listStartCount();
    if (visibleCount < start) visibleCount = start;
    if (visibleCount > list.length) visibleCount = list.length;
    var shown = list.slice(0, visibleCount);
    var selectedId = (window.PokeMoaMap && window.PokeMoaMap.getState) ? window.PokeMoaMap.getState().selectedId : null;

    shown.forEach(function (s) {
      var b = D.brandMeta[s.brand] || { label: s.brand, short: "?", color: "#1b2a4a" };
      var dist = s.distance < 1000 ? Math.round(s.distance) + "m" : (s.distance / 1000).toFixed(1) + "km";
      var sLabel = s.emart
        ? (s.emartState === "in" ? "재고 있음" : s.emartState === "undisclosed" ? "수량 비공개" : "품절")
        : (s.offline
          ? (s.brand === "vending" ? "공식 설치 지점" : s.brand === "cardshop" ? "공인 카드샵" : "매장 확인")
          : (policyOnlyBrand(s.brand) ? "위치 안내" : (!s.relay && s.status === "none" ? "미조회" : statusText[s.status])));
      var item = document.createElement("li");
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "store-item is-" + s.status + (s.offline ? " is-offline" : "") +
        (s.emart ? " is-emart" : "") +
        (policyOnlyBrand(s.brand) ? " is-policy" : "");
      btn.setAttribute("data-store", s.id);
      btn.innerHTML =
        '<span class="s-top">' +
        '<span class="s-brand" style="background:' + b.color + ';color:' + (b.ink || "#ffffff") + '">' + b.short + "</span>" +
        '<span class="s-name">' + s.name + "</span>" +
        '<span class="s-dist">' + dist + "</span>" +
        "</span>" +
        '<span class="s-meta">' +
        '<span class="status-badge ' + (policyOnlyBrand(s.brand) ? "policy" : s.status) + '">' + sLabel + "</span>" +
        (s.emart
          ? '<span class="chip chip-relay">' + (s.emartState === "in" ? "실시간 " + s.emartQty + "개" : s.emartState === "undisclosed" ? "수량 비공개" : "품절") + '</span>' +
            (s.emartClosed ? '<span class="chip chip-closed">오늘 휴무</span>'
              : (s.emartOutside ? '<span class="chip chip-hours">영업시간 외</span>' : ""))
          : (s.offline
          ? '<span class="chip chip-offline">재고 미확인</span>'
          : (policyOnlyBrand(s.brand)
            ? '<span class="chip chip-policy">앱에서 확인</span>'
            : (s.relay
              ? '<span class="chip chip-relay">실시간 ' + (s.relayQty || 0) + '개</span>'
              : '<span class="chip chip-check">수량 미확인</span>')))) +
        (s.street ? "<small>" + escapeHtml(s.street) + "</small>" : "") +
        "</span>" +
        productTagsHtml(s);
      btn.addEventListener("click", function () {
        if (!mapReady) return;
        window.PokeMoaMap.focusStore(s.id);
        if (window.innerWidth < 980) {
          mapShell.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
      if (selectedId && s.id === selectedId) btn.classList.add("is-active");
      item.appendChild(btn);
      storeListEl.appendChild(item);
    });

    syncMoreButton(list.length);
  }

  /* 더보기 버튼 — 한 번에 5곳씩 더 보여 주고, 남은 수를 함께 적는다.
     모두 펼치면 '처음 N곳만 보기'로 접을 수 있다. */
  function syncMoreButton(total) {
    var wrap = $("#storeMoreWrap");
    var more = $("#storeMore");
    if (!wrap || !more) return;
    var start = listStartCount();
    if (total <= start) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    var remaining = Math.max(0, total - visibleCount);
    if (remaining > 0) {
      var step = Math.min(LIST_STEP, remaining);
      more.setAttribute("aria-expanded", "false");
      more.textContent = "매장 더보기 (" + step + "곳 더 보기 · " + remaining + "곳 남음)";
    } else {
      more.setAttribute("aria-expanded", "true");
      more.textContent = "접기 (처음 " + start + "곳만 보기)";
    }
    if (!more.dataset.bound) {
      more.dataset.bound = "1";
      more.addEventListener("click", function () {
        var total2 = sortStores(currentStores).length;
        if (visibleCount >= total2) {
          visibleCount = listStartCount();
          drawStoreList();
          if (storeListEl) {
            var anchor = storeListEl.closest(".map-side") || storeListEl;
            if (anchor && anchor.scrollIntoView) anchor.scrollIntoView({ behavior: "smooth", block: "start" });
          }
        } else {
          visibleCount = Math.min(total2, visibleCount + LIST_STEP);
          drawStoreList();
        }
        trackEvent("store_list_more", { visible: visibleCount, total: total2 });
      });
    }
  }

  /* 980px 경계를 넘나들면 처음 노출 수를 다시 맞춘다 */
  var lastWideLayout = window.innerWidth >= 980;
  window.addEventListener("resize", function () {
    var wide = window.innerWidth >= 980;
    if (wide === lastWideLayout) return;
    lastWideLayout = wide;
    resetStoreList();
    drawStoreList();
  });

  document.addEventListener("pokemoa:loading", function (e) { renderLoading(e.detail); });

  function syncRadiusUI(allow20, radius) {
    var r20 = $("#radius20");
    var note = $("#radiusNote");
    if (r20) {
      r20.disabled = !allow20;
      r20.classList.toggle("is-disabled", !allow20);
      r20.setAttribute("aria-disabled", allow20 ? "false" : "true");
      r20.title = allow20
        ? "넓은 반경으로 주변 매장을 최대 100곳까지 봅니다"
        : "도심은 5km까지 지원합니다";
    }
    if (note) note.hidden = !!allow20;
    if (typeof radius === "number") {
      filterState.radius = radius;
      $$(".radius-btn").forEach(function (b) {
        b.classList.toggle("is-active", Number(b.getAttribute("data-radius")) === radius);
      });
      lastRememberRadius(radius);
    }
  }

  document.addEventListener("pokemoa:data", function (e) {
    var d = e.detail || {};
    syncRadiusUI(d.allow20, d.radius);
    renderBadge(d.badge);
    if (d.badge && d.badge.text && mapStatusText) {
      mapStatusText.title = d.error ? "마지막 실시간 조회 오류: " + d.error : "";
    }
    if (d.source && !d.loading) {
      gotFirstData = true;
      if (storeSkeleton) storeSkeleton.hidden = true;
      if (storeListEl) storeListEl.hidden = false;
    }
    if (d.brandCounts) {
      renderBrandSummary(d.brandCounts, d.brand || filterState.brand);
      renderOfflineChips(d.brandCounts, d.brand || filterState.brand, d.showOffline);
    }
  });

  document.addEventListener("pokemoa:visible", function (e) {
    var d = e.detail || {};
    renderStores(d.stores || []);
  });

  document.addEventListener("pokemoa:loaded", function (e) {
    var d = e.detail || {};
    if (d.source === "snapshot") {
      toast("실시간 조회가 지연되어 미리 저장한 매장 목록으로 표시합니다.");
    } else if (d.source === "live" && d.late) {
      toast("실시간 주변 매장 데이터를 받아 지도에 반영했습니다.");
    }
  });

  document.addEventListener("pokemoa:sdk-error", function (e) {
    /* 카카오맵 SDK는 등록된 도메인에서만 열린다 — 오류로 멈추지 않고 내장 좌표로 계속 쓴다 */
    renderLoading({ active: false });
    toast((e.detail && e.detail.message) || "카카오맵을 이 주소에서 열 수 없어 내장 좌표로 표시합니다.");
  });

  document.addEventListener("pokemoa:error", function (e) {
    toast((e.detail && e.detail.message) || "지도를 불러오지 못했습니다.");
    renderLoading({ active: false });
  });

  document.addEventListener("pokemoa:geo-start", function () {
    if (geoBtn) geoBtn.classList.add("is-busy");
    toast("현재 위치를 확인하는 중입니다. 브라우저 위치 권한을 허용해 주세요.");
  });
  document.addEventListener("pokemoa:geo-done", function (e) {
    if (geoBtn) geoBtn.classList.remove("is-busy");
    if (regionSearch) regionSearch.value = "";
    closeSuggest();
    toast("내 위치 주변 매장을 조회했습니다.");
  });
  document.addEventListener("pokemoa:geo-error", function (e) {
    if (geoBtn) geoBtn.classList.remove("is-busy");
    toast((e.detail && e.detail.message) || "위치를 확인하지 못했습니다.");
  });

  document.addEventListener("pokemoa:store-selected", function (e) {
    var id = e.detail && e.detail.id;
    $$(".store-item").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-store") === id);
    });
    var active = $('.store-item[data-store="' + id + '"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("pokemoa:store-cleared", function () {
    $$(".store-item").forEach(function (b) { b.classList.remove("is-active"); });
  });

  /* --------------------------------------- 편의점 실시간 재고 조회 연결(내부) */
  /* 태블릿(Termux)에서 켜 둔 재고 조회 서버 주소를 기억하고, 연결된 동안에는
     주변 매장 조회마다 실제 재고를 받아 지도·매장 카드에 반영한다.
     연결이 없거나 응답이 없으면 카카오맵 실제 위치만 보여 주고 수량은 「미조회」로 둔다. */
  var RELAY_KEY = "pokemoa.relayUrl";
  var RELAY_PRESET_KEY = "pokemoa.relayPresetUrl"; /* 프리셋으로 자동 저장된 주소 표시 */
  var RELAY_PRESET = D.relayPreset || null;

  /* 이 연결은 화면에 표시하지 않는다(배지·상태바·모달 없음).
     태블릿에서 켜 둔 재고 조회 서버에 조용히 붙어, 주변 매장의 실제 재고만
     지도 말풍선·매장 카드에 반영한다. 응답이 없으면 매장 위치만 남고
     수량은 「미조회」로 표시된다. */
  var relay = {
    url: "",
    state: "off",        /* off | checking | online | error */
    busy: false,
    pending: false,      /* 응답을 기다리는 동안 들어온 새 요청 */
    lastCount: 0,
    lastKey: "",
    timer: null
  };

  function relayNormalize(raw) {
    var v = String(raw || "").trim().replace(/\s+/g, "");
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    v = v.replace(/\/+$/, "");
    if (!/^https?:\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(:\d+)?(\/[^\s]*)?$/i.test(v)) return "";
    return v;
  }

  function relaySaved() {
    try { return localStorage.getItem(RELAY_KEY) || ""; } catch (e) { return ""; }
  }
  function relaySave(url) {
    try { if (url) localStorage.setItem(RELAY_KEY, url); else localStorage.removeItem(RELAY_KEY); } catch (e) {}
  }

  function relayRender() {
    /* 진행률 패널이 연결 상태 변화를 바로 반영하도록 알린다(화면 문구는 없다) */
    document.dispatchEvent(new CustomEvent("pokemoa:relay-state", { detail: { state: relay.state } }));
  }

  function relayCheck(url) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6500);
    return fetch(url + "/health", { signal: ctrl.signal, mode: "cors", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (d) {
        if (!d || d.service !== "pokemoa-relay") throw new Error("unexpected-response");
        return d;
      })
      .finally(function () { clearTimeout(timer); });
  }

  function relayConnect(raw, opts) {
    opts = opts || {};
    var target = relayNormalize(raw);
    if (!target) return;
    relay.url = target;
    relay.state = "checking";
    relayRender();
    relayCheck(target).then(function () {
      relaySave(target);
      /* 프리셋으로 붙은 경우를 기억해 두었다가, 터널 주소가 새로 바뀌면 저장된 옛 주소 대신 새 프리셋으로 갈아탄다. */
      try {
        if (opts.fromPreset) localStorage.setItem(RELAY_PRESET_KEY, target);
        else localStorage.removeItem(RELAY_PRESET_KEY);
      } catch (e) {}
      relay.state = "online";
      relayRender();
      trackEvent("relay_connect", { status: "online", auto: opts.silent ? 1 : 0 });
      relayRefresh(!!opts.manual);
    }).catch(function (err) {
      relay.state = "error";
      relayRender();
      trackEvent("relay_connect", { status: "error", auto: opts.silent ? 1 : 0 });
      bpRelayFail();
    });
  }

  function relayRefresh(manual) {
    /* GS25 팜사이즈 원더 피규어를 고른 동안에는 카드 재고를 덮어쓰지 않는다
       (피규어 모드는 figure.js 가 /api/gs25 로 따로 조회해 지도에 얹는다). */
    if (window.PokeMoaFigure && window.PokeMoaFigure.isActive && window.PokeMoaFigure.isActive()) return;
    if (relay.state !== "online" || !relay.url || !mapReady || !window.PokeMoaMap) return;
    var mstate = window.PokeMoaMap.getState();
    if (!mstate || !mstate.center) return;
    /* 응답을 기다리는 중이면 요청을 버리지 않고, 끝난 뒤 한 번 더 최신 위치로 조회한다
       (버리면 새로 그린 매장에 재고가 붙지 않아 전부 미조회로 보인다). */
    if (relay.busy) { relay.pending = true; return; }
    var lat = Number(mstate.center.lat).toFixed(4);
    var lng = Number(mstate.center.lng).toFixed(4);
    var key = lat + "," + lng;
    relay.busy = true;
    relay.lastKey = key;
    bpRelayStart(!!manual);
    var ctrl = new AbortController();
    /* v1.8 — 중계 서버가 3km 안 매장을 최대한 모으느라 27초까지 쓸 수 있다(서버 전체 마감 27초).
       클라이언트는 그보다 넉넉한 32초까지 기다린다. */
    var timer = setTimeout(function () { ctrl.abort(); }, 32000);
    /* 검색어는 '포켓몬카드' — '포켓몬'으로 넣으면 CU가 과자(빼빼로)만 잡아 카드 상품이 0건이 된다. */
    var radiusM = mstate && mstate.radius ? Math.round(mstate.radius) : 3000;
    var url = relay.url + "/api/nearby?lat=" + lat + "&lng=" + lng +
      "&keyword=" + encodeURIComponent("포켓몬카드") + "&radius=" + radiusM;
    fetch(url, { signal: ctrl.signal, mode: "cors", cache: "no-store" })
      .then(function (res) {
        if (res.status === 429) {
          /* 과다 요청 방어(중계 v2.1) — 잠시 뒤 다시 부탁드리는 안내로 처리한다 */
          var limited = new Error("rate_limited");
          limited.rateLimited = true;
          return res.json().catch(function () { return null; }).then(function (body) {
            limited.retryAfterSec = (body && body.retryAfterSec) || 90;
            throw limited;
          });
        }
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (payload) {
        /* 조회가 도는 사이에 사용자가 GS25 피규어 상품으로 바꿨다면 이 응답은 버린다
           (피규어 모드의 지도·목록을 카드 재고가 덮어쓰지 않도록). */
        if (window.PokeMoaFigure && window.PokeMoaFigure.isActive && window.PokeMoaFigure.isActive()) return;
        var n = window.PokeMoaMap.applyRelay(payload);
        relay.lastCount = n;
        relay.state = "online";
        relayRender();
        hideMapNotice();
        bpRelayDone(payload && payload.sources, payload && payload.stores);
        if (manual && n) toast("실제 재고 " + n + "곳을 지도에 반영했습니다.");
      })
      .catch(function (err) {
        /* 피규어 모드로 바꾼 뒤 도착한 카드 조회 오류는 화면에 반영하지 않는다 */
        if (window.PokeMoaFigure && window.PokeMoaFigure.isActive && window.PokeMoaFigure.isActive()) return;
        if (err && err.rateLimited) {
          /* 이미 받아 둔 재고는 지우지 않고, 안내만 띄운 뒤 잠시 뒤 한 번 더 시도한다 */
          relay.state = "online";
          relayRender();
          showMapNotice(RATE_NOTICE);
          trackEvent("relay_rate_limited", { retry_after_sec: err.retryAfterSec || 90 });
          clearTimeout(relay.timer);
          relay.timer = setTimeout(function () { relayRefresh(false); }, 90000);
          return;
        }
        relay.state = "error";
        relay.lastCount = 0;
        relayRender();
        bpRelayFail();
        if (window.PokeMoaMap) window.PokeMoaMap.clearRelay();
      })
      .finally(function () {
        clearTimeout(timer);
        relay.busy = false;
        if (relay.pending) {
          relay.pending = false;
          if (relay.state === "error") {
            /* 한 번 끊기면 조용히 한 번만 다시 확인한다 */
            relayConnect(relay.url, { silent: true });
          } else {
            setTimeout(function () { relayRefresh(false); }, 250);
          }
        }
      });
  }

  function relayScheduleRefresh() {
    if (relay.state !== "online") return;
    clearTimeout(relay.timer);
    relay.timer = setTimeout(function () { relayRefresh(false); }, 900);
  }

  /* 지도가 새로 조회를 끝낼 때마다(지역 변경·내 위치) 실재고도 같이 새로 받는다 */
  document.addEventListener("pokemoa:loaded", relayScheduleRefresh);
  document.addEventListener("pokemoa:geo-done", relayScheduleRefresh);

  /* ?relay=https://… 로 열면 그 주소를 저장하고 바로 연결한다.
     주소가 없으면 data.js 의 relayPreset(최근 태블릿 터널)으로 조용히 자동 연결한다 —
     방문자가 모달에서 '연결 확인'을 누르지 않아도 실재고가 바로 뜬다. */
  /* 저장된 조회 서버 주소가 예전 태블릿 터널(*.trycloudflare.com)이면 지금 프리셋 주소로
     갈아탄다 — 터널은 다시 열 때마다 주소가 바뀌므로 예전 주소는 늘 응답이 없다.
     사용자가 직접 넣은 비-trycloudflare 주소(개인 도메인 등)는 그대로 둔다. */
  function relayMigrateSaved() {
    var saved = relayNormalize(relaySaved());
    var preset = relayNormalize(RELAY_PRESET && RELAY_PRESET.url);
    if (!saved || !preset || saved === preset) return saved;
    var isTunnel = /\.trycloudflare\.com$/i.test(saved.replace(/^https?:\/\//, ""));
    if (!isTunnel) return saved;
    relaySave(preset);
    try { localStorage.setItem(RELAY_PRESET_KEY, preset); } catch (e) {}
    return preset;
  }

  function relayInit() {
    relayRender();
    var param = "";
    try {
      param = new URLSearchParams(location.search).get("relay") || "";
    } catch (e) {
      param = "";
    }
    var fromQuery = relayNormalize(param);
    if (fromQuery) {
      relayConnect(fromQuery, { keepOpen: true, silent: true });
      return;
    }
    var preset = relayNormalize(RELAY_PRESET && RELAY_PRESET.url);
    var saved = relayMigrateSaved();
    var lastPreset = "";
    try {
      lastPreset = relayNormalize(localStorage.getItem(RELAY_PRESET_KEY) || "");
    } catch (e) {
      lastPreset = "";
    }
    /* 직접 넣은 주소(프리셋으로 저장된 게 아닌 값)가 있으면 그것을 먼저 쓴다 */
    var ownSaved = saved && (!preset || saved !== lastPreset);
    if (ownSaved) {
      relayConnect(saved, { keepOpen: true, silent: true });
      return;
    }
    if (preset) {
      relayConnect(preset, { keepOpen: true, silent: true, fromPreset: true });
      return;
    }
    if (saved) relayConnect(saved, { keepOpen: true, silent: true });
  }
  relayInit();

  if (mapRetry) {
    mapRetry.addEventListener("click", function () {
      if (mapReady) window.PokeMoaMap.retry();
    });
  }

  if (geoBtn) {
    geoBtn.addEventListener("click", function () {
      if (mapReady) window.PokeMoaMap.locate();
    });
  }

  /* 선택 지역 찾기 — 지금 고른 시·도/시·군·구(또는 동네 검색어의 결과)로
     카카오 매장 검색 + 실시간 재고 조회를 바로 실행한다. */
  var regionBtnTimer = null;
  function regionFromQuery() {
    var q = regionSearch ? String(regionSearch.value || "").trim() : "";
    if (!q) return null;
    if (suggestItems.length) {
      var item = suggestItems[suggestActive >= 0 ? suggestActive : 0];
      if (item) return { suggest: item };
    }
    var hits = searchRegions(q);
    if (hits.length) return { regionId: hits[0].id };
    return null;
  }

  if (regionBtn) {
    regionBtn.addEventListener("click", function () {
      bp.quiet = false;
      var target = regionFromQuery();
      if (!target) {
        var id = districtSelect && districtSelect.value ? districtSelect.value : (filterState.region || "");
        if (id && regionById(id)) target = { regionId: id };
      }
      if (!target) {
        toast("시·도와 시·군·구를 고르거나 동네 이름을 입력해 주세요.");
        return;
      }
      regionBtn.classList.add("is-busy");
      clearTimeout(regionBtnTimer);
      regionBtnTimer = setTimeout(function () { regionBtn.classList.remove("is-busy"); }, 12000);
      var name = "";
      if (target.suggest) {
        var it = target.suggest;
        if (it.kind === "place") {
          name = it.place.name;
          selectPlace(it.place);
        } else {
          name = it.region.name;
          selectRegion(it.region.id);
        }
      } else {
        var r = regionById(target.regionId);
        name = r ? (r.name + (r.allow20 ? "" : " (도심 5km까지)")) : "";
        selectRegion(target.regionId);
      }
      if (name) {
        toast("‘" + name + "’ 반경 " + (filterState.radius / 1000) + "km 매장을 찾습니다.");
      }
      trackEvent("region_search_click", {
        region: target.regionId || "kakao-place",
        radius_km: filterState.radius / 1000
      });
    });
  }

  /* --------------------------------------------- 지역 선택기 (전국 2단 + 검색) */
  function regionById(id) {
    for (var i = 0; i < D.regions.length; i++) if (D.regions[i].id === id) return D.regions[i];
    return null;
  }

  function optionLabel(r) {
    /* "경북 · 포항 · 북구 (환호동)" → "포항 · 북구 (환호동)" */
    var prefix = r.province + " · ";
    return r.name.indexOf(prefix) === 0 ? r.name.slice(prefix.length) : r.name;
  }

  function fillDistricts(province, selectedId) {
    if (!districtSelect) return;
    districtSelect.innerHTML = "";
    var list = D.regions.filter(function (r) { return r.province === province; });
    list.forEach(function (r) {
      var o = document.createElement("option");
      o.value = r.id;
      o.textContent = optionLabel(r);
      if (r.id === selectedId) o.selected = true;
      districtSelect.appendChild(o);
    });
    if (selectedId && list.some(function (r) { return r.id === selectedId; })) {
      districtSelect.value = selectedId;
    }
  }

  function applyRegion(id) {
    var r = regionById(id);
    if (!r) return;
    filterState.region = r.id;
    gotFirstData = false;
    resetStoreList();
    if (storeSkeleton) storeSkeleton.hidden = false;
    if (storeListEl) storeListEl.hidden = true;
    if (mapReady) window.PokeMoaMap.setRegion(r.id);
    trackEvent("region_search", {
      region: r.id,
      region_name: r.name,
      radius_km: filterState.radius / 1000
    });
  }

  /* 시·도 · 시군구 드롭다운과 동네 검색이 같은 지역을 가리키도록 맞춘다 */
  function selectRegion(id, opts) {
    var r = regionById(id);
    if (!r) return;
    if (provinceSelect) provinceSelect.value = r.province;
    fillDistricts(r.province, r.id);
    if (regionSearch && (!opts || !opts.keepQuery)) regionSearch.value = "";
    closeSuggest();
    applyRegion(r.id);
  }

  var suggestItems = [];
  var suggestActive = -1;
  var placeTimer = null;
  var placeSeq = 0;

  function closeSuggest() {
    if (!regionSuggest) return;
    regionSuggest.hidden = true;
    regionSuggest.innerHTML = "";
    suggestItems = [];
    suggestActive = -1;
    placeSeq += 1;
    clearTimeout(placeTimer);
    if (regionSearch) regionSearch.setAttribute("aria-expanded", "false");
  }

  function normText(s) {
    return (s || "").toLowerCase().replace(/\s+/g, "");
  }

  function searchRegions(q) {
    var n = normText(q);
    if (!n) return [];
    var hits = [];
    D.regions.forEach(function (r) {
      var hay = normText(r.name) + "|" + normText(r.short) + "|" + normText(r.district) +
        "|" + normText(r.label) + "|" + normText(r.province);
      if (hay.indexOf(n) !== -1) hits.push(r);
    });
    /* 이름 앞부분에서 바로 맞는 지역을 먼저 */
    hits.sort(function (a, b) {
      var ai = normText(a.name).indexOf(n) === 0 || normText(a.short).indexOf(n) === 0 ? 0 : 1;
      var bi = normText(b.name).indexOf(n) === 0 || normText(b.short).indexOf(n) === 0 ? 0 : 1;
      return ai - bi;
    });
    return hits.slice(0, 8);
  }

  function highlightSuggest(i) {
    suggestActive = i;
    $$("li.region-suggest-item", regionSuggest).forEach(function (li, idx) {
      var on = idx === i;
      li.classList.toggle("is-active", on);
      li.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function renderSuggest(q) {
    if (!regionSuggest || !regionSearch) return;
    var hits = searchRegions(q);
    suggestItems = hits.map(function (r) { return { kind: "region", region: r }; });
    suggestActive = suggestItems.length ? 0 : -1;
    var query = String(q || "").trim();
    drawSuggest(query);
    /* 카카오 장소 검색으로 동네·역·건물 이름도 바로 찾는다(지역 목록에 없는 곳) */
    clearTimeout(placeTimer);
    placeSeq += 1;
    if (!query || query.length < 2) return;
    if (!window.PokeMoaMap || !window.PokeMoaMap.searchPlaces) return;
    var seq = placeSeq;
    placeTimer = setTimeout(function () {
      window.PokeMoaMap.searchPlaces(query, function (list) {
        if (seq !== placeSeq || !list || !list.length) return;
        var have = {};
        suggestItems.forEach(function (it) {
          if (it.kind === "region") have[it.region.id] = 1;
        });
        list.forEach(function (p) {
          if (suggestItems.length >= 10) return;
          suggestItems.push({
            kind: "place",
            place: p,
            dup: false
          });
          have[p.name] = 1;
        });
        drawSuggest(query);
      });
    }, 220);
  }

  /* 제안 목록 그리기 — 지역(내장 232개, 전국 230개 시·군·구) 먼저, 그 뒤에 카카오 장소 검색 결과 */
  function drawSuggest(query) {
    if (!regionSuggest || !regionSearch) return;
    regionSuggest.innerHTML = "";
    if (!normText(query)) { closeSuggest(); return; }
    if (!suggestItems.length) {
      var empty = document.createElement("li");
      empty.className = "region-suggest-empty";
      empty.textContent = "일치하는 지역이 없습니다. 시·도와 시·군·구에서 골라 주세요.";
      regionSuggest.appendChild(empty);
    }
    suggestItems.forEach(function (item, i) {
      var li = document.createElement("li");
      li.className = "region-suggest-item" + (i === suggestActive ? " is-active" : "");
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", i === suggestActive ? "true" : "false");
      if (item.kind === "region") {
        var r = item.region;
        li.setAttribute("data-region", r.id);
        li.innerHTML = "<strong>" + r.name + "</strong><span>" +
          (r.allow20 ? "20km까지" : "도심 · 5km까지") + "</span>";
      } else {
        var p = item.place;
        li.setAttribute("data-place", p.name);
        li.innerHTML = "<strong>" + escapeHtml(p.name) + "</strong><span>" +
          escapeHtml(p.address || "카카오맵") + "</span>";
      }
      li.addEventListener("mousedown", function (e) {
        e.preventDefault();
        chooseSuggest(i);
        if (regionSearch) regionSearch.blur();
      });
      regionSuggest.appendChild(li);
    });
    regionSuggest.hidden = false;
    regionSearch.setAttribute("aria-expanded", "true");
  }

  /* 제안 선택 — 내장 지역이면 그 지역으로, 카카오 장소면 그 좌표로 지도를 연다 */
  function chooseSuggest(i) {
    var item = suggestItems[i];
    if (!item) return;
    if (item.kind === "region") { selectRegion(item.region.id); return; }
    selectPlace(item.place);
  }

  /* 카카오 장소 검색 결과(동네·역·건물) 주변을 본다 */
  function selectPlace(p) {
    if (!p) return;
    filterState.region = "";
    gotFirstData = false;
    resetStoreList();
    if (storeSkeleton) storeSkeleton.hidden = false;
    if (storeListEl) storeListEl.hidden = true;
    if (regionSearch) regionSearch.value = p.name;
    /* 시·군·구 드롭다운에는 '검색한 장소'를 임시 항목으로 보여 준다(지역 목록을 골라 다시 이동 가능) */
    if (districtSelect) {
      var tmp = districtSelect.querySelector('option[data-place-temp]');
      if (tmp) tmp.parentNode.removeChild(tmp);
      var opt = document.createElement("option");
      opt.value = "";
      opt.setAttribute("data-place-temp", "1");
      opt.textContent = "검색: " + p.name;
      opt.selected = true;
      districtSelect.insertBefore(opt, districtSelect.firstChild);
      districtSelect.value = "";
    }
    closeSuggest();
    if (mapReady) window.PokeMoaMap.setPoint({ lat: p.lat, lng: p.lng, name: p.name });
    toast("‘" + p.name + "’ 주변 편의점 4사를 찾습니다.");
    trackEvent("region_search", {
      region: "kakao-place",
      region_name: p.name,
      radius_km: filterState.radius / 1000
    });
  }

  if (provinceSelect) {
    provinceSelect.addEventListener("change", function () {
      var prov = provinceSelect.value;
      var first = D.regions.filter(function (r) { return r.province === prov; })[0];
      if (!first) return;
      fillDistricts(prov, first.id);
      applyRegion(first.id);
    });
  }

  if (districtSelect) {
    districtSelect.addEventListener("change", function () {
      if (!districtSelect.value) return;
      var tmp = districtSelect.querySelector('option[data-place-temp]');
      if (tmp) tmp.parentNode.removeChild(tmp);
      if (regionSearch) regionSearch.value = "";
      closeSuggest();
      applyRegion(districtSelect.value);
    });
  }

  if (regionSearch) {
    regionSearch.addEventListener("input", function () { renderSuggest(regionSearch.value); });
    regionSearch.addEventListener("focus", function () {
      if (regionSearch.value) renderSuggest(regionSearch.value);
    });
    regionSearch.addEventListener("keydown", function (e) {
      var open = regionSuggest && !regionSuggest.hidden;
      if (e.key === "ArrowDown" && open) {
        e.preventDefault();
        highlightSuggest(Math.min(suggestItems.length - 1, suggestActive + 1));
      } else if (e.key === "ArrowUp" && open) {
        e.preventDefault();
        highlightSuggest(Math.max(0, suggestActive - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (suggestActive >= 0 && suggestItems[suggestActive]) {
          chooseSuggest(suggestActive);
          regionSearch.blur();
        } else if (suggestItems.length === 1) {
          chooseSuggest(0);
          regionSearch.blur();
        }
      } else if (e.key === "Escape") {
        closeSuggest();
      }
    });
    regionSearch.addEventListener("blur", function () {
      setTimeout(closeSuggest, 120);
    });
  }

  /* 첫 화면: 저장된 마지막 검색 위치가 없으면 서울 광화문(37.5759, 126.9768) 기준 */
  /* 시·도 목록을 data.js 의 regions 순서·표기로 다시 채운다 — HTML 의 option 이
     빠지거나 겹쳐도 전국 17개 시·도가 한 번씩만 나오게 한다. */
  function syncProvinceOptions() {
    if (!provinceSelect) return;
    var order = [];
    D.regions.forEach(function (r) {
      if (r.province && order.indexOf(r.province) < 0) order.push(r.province);
    });
    var current = provinceSelect.value;
    provinceSelect.innerHTML = "";
    order.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p;
      o.textContent = p;
      provinceSelect.appendChild(o);
    });
    if (order.indexOf(current) >= 0) provinceSelect.value = current;
  }
  syncProvinceOptions();

  /* ------------------------------- 마지막 검색 위치 기억 (localStorage)
     지역 선택·내 위치·동네 검색·지도 드래그로 찾은 자리를 브라우저에 남겨 두고,
     다음에 열 때 기본값(서울 광화문)이 아니라 그 자리에서 바로 조회한다.
     저장이 막힌 브라우저(시크릿 모드·저장소 차단)에서는 조용히 넘어간다. */
  var LAST_KEY = "pokemoa.lastLocation";
  var LAST_RADII = [1000, 3000, 5000, 20000];
  var LAST_MODES = ["region", "gps", "search", "drag"];

  function lastMeters(aLat, aLng, bLat, bLng) {
    var R = 6371008.8;
    var dLat = (bLat - aLat) * Math.PI / 180;
    var dLng = (bLng - aLng) * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* 반경 — 화면에서 고를 수 있는 1·3·5·20km 만 쓰고, 도심(allow20 false)은 5km까지 */
  function lastRadiusValue(value, allow20) {
    var n = Number(value);
    if (!isFinite(n) || LAST_RADII.indexOf(n) < 0) n = 3000;
    if (allow20 === false && n > 5000) n = 5000;
    return n;
  }

  /* 동네·내 위치 좌표에 가장 가까운 지역의 시·도 (60km 안) — 드롭다운을 어긋나지 않게 */
  function lastProvinceOf(lat, lng) {
    if (!isFinite(lat) || !isFinite(lng)) return "";
    var best = "", bd = Infinity;
    D.regions.forEach(function (r) {
      var d = lastMeters(lat, lng, r.lat, r.lng);
      if (d < bd) { bd = d; best = r.province || ""; }
    });
    return bd <= 60000 ? best : "";
  }

  function lastRegionLabel(r) {
    if (!r) return "";
    return (r.province ? r.province + " · " : "") + (r.district || r.name || "");
  }

  /* 저장값 검사 — 모드·좌표(NaN·범위 밖)·없는 지역 id 면 null 을 돌려 기본값으로 폴백 */
  function lastClean(rec) {
    if (!rec || typeof rec !== "object") return null;
    var mode = String(rec.mode || "");
    if (LAST_MODES.indexOf(mode) < 0) return null;
    var lat = Number(rec.lat), lng = Number(rec.lng);
    if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    var r = null;
    if (mode === "region") {
      r = regionById(typeof rec.regionId === "string" ? rec.regionId : "");
      if (!r) return null;
      lat = Number(r.lat);
      lng = Number(r.lng);
    }
    var label = typeof rec.label === "string" ? rec.label.slice(0, 60) : "";
    if (!label) label = r ? lastRegionLabel(r) : (mode === "gps" ? "내 위치" : mode === "drag" ? "지도 중심" : "");
    return {
      mode: mode,
      lat: lat,
      lng: lng,
      radius: lastRadiusValue(rec.radius, r ? r.allow20 !== false : true),
      province: typeof rec.province === "string" ? rec.province : (r ? r.province : ""),
      regionId: r ? r.id : "",
      label: label,
      savedAt: typeof rec.savedAt === "string" && rec.savedAt ? rec.savedAt : new Date().toISOString()
    };
  }

  function lastSave(rec) {
    var clean = lastClean(rec);
    if (!clean) return null;
    clean.savedAt = new Date().toISOString();
    try { localStorage.setItem(LAST_KEY, JSON.stringify(clean)); } catch (e) {}
    return clean;
  }

  function lastRead() {
    var raw = "";
    try { raw = localStorage.getItem(LAST_KEY) || ""; } catch (e) { return null; }
    if (!raw) return null;
    var clean = null;
    try { clean = lastClean(JSON.parse(raw)); } catch (e) { clean = null; }
    if (!clean) {
      /* 손상된 값은 지우고 기본값으로 조용히 폴백한다 */
      try { localStorage.removeItem(LAST_KEY); } catch (e) {}
    }
    return clean;
  }

  /* 조회가 시작될 때마다 그 자리를 기억한다 — 지역 선택·내 위치·동네 검색·
     지도 드래그 재검색·반경 변경이 모두 pokemoa:search-start 로 모인다. */
  function lastRemember(detail) {
    var origin = String(detail.origin || "");
    var mode = origin === "region" ? "region" : origin === "geo" ? "gps" : origin === "map" ? "drag" : "search";
    var c = detail.center || {};
    var r = mode === "region" ? regionById(detail.regionId || filterState.region || "") : null;
    if (mode === "region" && !r) return null;
    var lat = Number(c.lat), lng = Number(c.lng);
    var label = "";
    if (r) label = lastRegionLabel(r);
    else if (mode === "gps") label = "내 위치";
    else if (mode === "drag") label = "지도 중심";
    else if (regionSearch) label = String(regionSearch.value || "").trim();
    return lastSave({
      mode: mode,
      lat: lat,
      lng: lng,
      radius: detail.radius,
      province: r ? r.province : lastProvinceOf(lat, lng),
      regionId: r ? r.id : "",
      label: label
    });
  }

  document.addEventListener("pokemoa:search-start", function (e) {
    var d = e.detail || {};
    /* 아무것도 고르지 않은 첫 방문의 기본값(서울)·고정 지역은 '마지막에 검색한 곳'이 아니라 남기지 않는다 */
    if (d.initial && (lastBootSource === "default" || lastBootSource === "pinned")) { lastBootSource = "shown"; return; }
    lastRemember(d);
  });

  /* 반경만 바꾼 경우(조회가 다시 돌지 않는 3km→1km 등)에는 위치는 그대로 두고 반경만 고친다 */
  function lastRememberRadius(radius) {
    var rec = lastRead();
    if (!rec) return;
    var mstate = window.PokeMoaMap && window.PokeMoaMap.getState ? window.PokeMoaMap.getState() : null;
    var value = typeof radius === "number" ? radius : (mstate && typeof mstate.radius === "number" ? mstate.radius : rec.radius);
    var next = lastRadiusValue(value, mstate && typeof mstate.allow20 === "boolean" ? mstate.allow20 : true);
    if (next === rec.radius) return;
    rec.radius = next;
    lastSave(rec);
  }

  /* ------------------------------- 📌 이 지역 고정 (2026-11-20)
     체크하면 지금 보고 있는 지역을 pokemoa.pinnedLocation 에 남겨 두고, 다음 접속에는 다른 곳을
     드래그·검색했더라도 항상 이 자리에서 시작한다. 체크를 풀면 예전처럼 '마지막 검색 위치'를 따른다.
     ※ ?region=·?lat= 같은 공유 링크가 있으면 그쪽이 먼저다. */
  var PIN_KEY = "pokemoa.pinnedLocation";
  var pinInput = $("#pinLocation");
  var pinLabel = $("#pinLocationLabel");

  function pinRead() {
    var raw = "";
    try { raw = localStorage.getItem(PIN_KEY) || ""; } catch (e) { return null; }
    if (!raw) return null;
    try { return lastClean(JSON.parse(raw)); } catch (e) { return null; }
  }

  function pinSync() {
    var rec = pinRead();
    if (pinInput) pinInput.checked = !!rec;
    if (pinLabel) {
      pinLabel.classList.toggle("is-on", !!rec);
      pinLabel.title = rec
        ? "‘" + (rec.label || "고정한 지역") + "’에서 항상 시작합니다. 체크를 풀면 마지막으로 본 곳에서 시작합니다."
        : "체크하면 다음에 열 때도 이 지역에서 시작합니다. 체크를 풀면 마지막으로 본 곳에서 시작합니다.";
    }
    return rec;
  }

  function pinWrite(rec) {
    var clean = lastClean(rec);
    if (!clean) return null;
    clean.savedAt = new Date().toISOString();
    try { localStorage.setItem(PIN_KEY, JSON.stringify(clean)); } catch (e) {}
    pinSync();
    return clean;
  }

  function pinRemove() {
    try { localStorage.removeItem(PIN_KEY); } catch (e) {}
    pinSync();
  }

  /* 지금 화면이 보고 있는 자리 — 시·구를 골랐으면 지역 id, 포인트면 좌표 */
  function pinCurrent() {
    var m = window.PokeMoaMap && window.PokeMoaMap.getState ? window.PokeMoaMap.getState() : null;
    var reg = filterState.region ? regionById(filterState.region) : null;
    var radius = m && typeof m.radius === "number" ? m.radius : filterState.radius;
    if (reg && (!m || m.origin === "region" || m.regionId === reg.id)) {
      return {
        mode: "region",
        regionId: reg.id,
        lat: Number(reg.lat),
        lng: Number(reg.lng),
        radius: radius,
        province: reg.province,
        label: lastRegionLabel(reg)
      };
    }
    var center = (m && m.center) || {};
    var lat = Number(center.lat), lng = Number(center.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      mode: m && m.origin === "geo" ? "gps" : m && m.origin === "search" ? "search" : "drag",
      lat: lat,
      lng: lng,
      radius: radius,
      province: lastProvinceOf(lat, lng),
      label: (regionSearch && String(regionSearch.value || "").trim()) || (m && m.origin === "geo" ? "내 위치" : "지도 중심")
    };
  }

  if (pinInput) {
    pinInput.addEventListener("change", function () {
      if (pinInput.checked) {
        var rec = pinCurrent();
        if (!rec || !pinWrite(rec)) {
          if (pinInput) pinInput.checked = false;
          pinSync();
          toast("고정할 지역을 먼저 골라 주세요.");
          return;
        }
        toast("‘" + (rec.label || "이 지역") + "’ 지역을 고정했습니다. 다음에도 이 자리에서 시작합니다.");
        trackEvent("pin_location", { on: 1, mode: rec.mode });
      } else {
        pinRemove();
        toast("지역 고정을 풀었습니다. 이제 마지막으로 본 곳에서 시작합니다.");
        trackEvent("pin_location", { on: 0 });
      }
    });
  }
  pinSync();

  /* 주소에 붙은 ?region= · ?lat=&lng=&r= — 명시적으로 공유한 링크는 저장값보다 먼저 쓴다 */
  function lastQueryParams() {
    var out = {};
    try {
      var q = new URLSearchParams(location.search);
      out.region = q.get("region") || "";
      out.lat = q.get("lat") || "";
      out.lng = q.get("lng") || "";
      out.radius = q.get("r") || q.get("radius") || "";
      out.label = q.get("label") || "";
    } catch (e) {}
    return out;
  }

  function lastBootIntent() {
    var first = D.regions[0] || { id: "seoul-gwanghwamun" };
    var q = lastQueryParams();
    var qr = q.radius ? Number(q.radius) : NaN;
    if (q.region) {
      var r = regionById(q.region);
      if (r) return { source: "url", mode: "region", regionId: r.id, radius: lastRadiusValue(qr, r.allow20 !== false) };
    }
    if (q.lat && q.lng) {
      var qlat = Number(q.lat), qlng = Number(q.lng);
      if (isFinite(qlat) && isFinite(qlng) && qlat >= -90 && qlat <= 90 && qlng >= -180 && qlng <= 180) {
        return { source: "url", mode: "search", lat: qlat, lng: qlng, radius: lastRadiusValue(qr, true), label: String(q.label || "").slice(0, 60) };
      }
    }
    /* 📌 고정한 지역이 있으면 마지막 검색 위치보다 먼저 쓴다 */
    var pinned = pinRead();
    if (pinned) { pinned.source = "pinned"; return pinned; }
    var saved = lastRead();
    if (saved) { saved.source = "saved"; return saved; }
    return { source: "default", mode: "region", regionId: first.id, radius: 3000 };
  }

  function lastApplyBoot(intent) {
    if (intent.mode === "region" && !regionById(intent.regionId)) {
      intent = { source: "default", mode: "region", regionId: (D.regions[0] || {}).id, radius: 3000 };
    }
    lastBootSource = intent.source === "default" ? "default" : intent.source === "pinned" ? "pinned" : "restored";
    var region = null;

    if (intent.mode === "region") {
      region = regionById(intent.regionId);
      filterState.region = region.id;
      if (provinceSelect) provinceSelect.value = region.province;
      fillDistricts(region.province, region.id);
    } else {
      filterState.region = "";
      var prov = intent.province || lastProvinceOf(Number(intent.lat), Number(intent.lng));
      if (prov) {
        if (provinceSelect) provinceSelect.value = prov;
        fillDistricts(prov, "");
      }
      if (districtSelect) {
        var old = districtSelect.querySelector("option[data-place-temp]");
        if (old) old.parentNode.removeChild(old);
        var opt = document.createElement("option");
        opt.value = "";
        opt.setAttribute("data-place-temp", "1");
        var lab = intent.label || (intent.mode === "gps" ? "내 위치" : "지도 중심");
        opt.textContent = intent.mode === "search" && intent.label && intent.label !== "지도 중심" ? "검색: " + lab : lab;
        opt.selected = true;
        districtSelect.insertBefore(opt, districtSelect.firstChild);
        districtSelect.value = "";
      }
      if (regionSearch) {
        regionSearch.value = intent.mode === "search" && intent.label && intent.label !== "지도 중심" ? intent.label : "";
      }
    }

    filterState.radius = lastRadiusValue(intent.radius, region ? region.allow20 !== false : true);
    $$(".radius-btn").forEach(function (b) {
      b.classList.toggle("is-active", Number(b.getAttribute("data-radius")) === filterState.radius);
    });

    bootMapStart = intent.mode === "region"
      ? { mode: "region", regionId: intent.regionId, radius: filterState.radius }
      : {
        mode: "point", lat: intent.lat, lng: intent.lng, radius: filterState.radius,
        origin: intent.mode === "gps" ? "geo" : intent.mode === "drag" ? "map" : "search"
      };

    if (intent.source === "saved" && intent.label) {
      toast("지난번 찾은 ‘" + intent.label + "’ 자리에서 시작합니다.");
    } else if (intent.source === "pinned" && intent.label) {
      toast("고정한 ‘" + intent.label + "’ 자리에서 시작합니다.");
    }
    trackEvent("last_location_boot", { source: intent.source, mode: intent.mode, radius_km: filterState.radius / 1000 });
  }

  /* 첫 위치: ① 주소에 붙은 ?region=·?lat=&lng= ② 저장된 마지막 검색 위치 ③ 기본(서울 광화문) */
  lastApplyBoot(lastBootIntent());

  /* 카드 상품 필터 (data.js cardProducts 로 칩을 만든다) */
  /* 편의점 4사별 현황 요약 (클릭하면 그 브랜드만 보기 · 한 번 더 누르면 전체)
     이마트(대형마트)는 실제 점포 재고를 직접 조회하므로 같은 줄에 한 칸 더 둔다. */
  var BRAND_ORDER = ["gs25", "cu", "seven", "emart24", "emart"];
  function renderBrandSummary(counts, activeBrand) {
    if (!brandSummary || !counts) return;
    var all = counts.all || { total: 0, in: 0, check: 0, none: 0 };
    /* 전체에서도 세븐일레븐 위치는 '미조회'와 따로 세어 섞는다 */
    var seven = counts.seven || { total: 0, in: 0, check: 0, none: 0 };
    var html = '<button type="button" class="bs-card bs-all' + (activeBrand === "all" ? " is-active" : "") + '" data-brand="all">' +
      '<span class="bs-head"><span class="bs-name">전체</span></span>' +
      '<strong class="bs-count">' + all.total + '<small>곳</small></strong>' +
      '<span class="bs-sub">재고 ' + all.in + " · 없음 " + all.none +
        " · 미조회 " + (all.check - seven.check) +
        (seven.total ? " · 위치 " + seven.total : "") + "</span></button>";
    BRAND_ORDER.forEach(function (id) {
      var meta = D.brandMeta[id] || { label: id, short: id, color: "#1b2a4a" };
      var c = counts[id] || { total: 0, in: 0, check: 0, none: 0 };
      html += '<button type="button" class="bs-card' + (activeBrand === id ? " is-active" : "") + '" data-brand="' + id + '" style="--brand:' + meta.color + '">' +
        '<span class="bs-head"><i class="bs-dot"></i><span class="bs-name">' + meta.label + "</span></span>" +
        '<strong class="bs-count">' + c.total + "<small>곳</small></strong>" +
        '<span class="bs-sub">' + (function () {
          /* 세븐일레븐은 재고를 확인하지 않는다 — '미조회' 대신 위치 안내로 적는다 */
          if (policyOnlyBrand(id)) {
            return c.total ? "위치 " + c.total + "곳 · 재고 미지원" : "표시할 매장 없음";
          }
          /* 이마트는 '미조회' 대신 '수량 비공개'로 적는다(이마트 앱이 수량을 감추는 상태) */
          if (id === "emart") {
            var ebits = [];
            if (c.in) ebits.push("재고 " + c.in + "곳");
            if (c.none) ebits.push("품절 " + c.none + "곳");
            if (c.check) ebits.push("비공개 " + c.check + "곳");
            return ebits.length ? "대형마트 · " + ebits.join(" · ") : "반경 안 점포 없음";
          }
          var bits = [];
          if (c.in) bits.push("재고 " + c.in + "곳");
          if (c.none) bits.push("없음 " + c.none + "곳");
          if (c.check) bits.push("미조회 " + c.check + "곳");
          return bits.length ? bits.join(" · ") : "표시할 매장 없음";
        })() + "</span></button>";
    });
    brandSummary.innerHTML = html;
  }

  /* 오프라인 판매처(마트·아트박스·자판기·카드샵) 칩 — 누르면 그 종류만, 한 번 더 누르면 전체 */
  var offlineChips = $("#offlineChips");
  var offlineToggle = $("#offlineToggle");
  var offlineCounts = null;

  function renderOfflineChips(counts, activeBrand, showOffline) {
    if (!offlineChips) return;
    if (counts) offlineCounts = counts;
    counts = offlineCounts || {};
    var on = showOffline !== false;
    var list = D.offlineBrands || [];
    offlineChips.innerHTML = list.map(function (b) {
      var meta = D.brandMeta[b.id] || { color: "#1b2a4a" };
      var c = counts[b.id] || { total: 0 };
      var active = activeBrand === b.id;
      return '<button type="button" class="off-chip' + (active ? " is-active" : "") + (on ? "" : " is-muted") +
        '" data-offline="' + b.id + '" style="--brand:' + meta.color + '" aria-pressed="' + (active ? "true" : "false") + '">' +
        '<i class="off-dot" aria-hidden="true"></i><span>' + b.label + "</span><b>" + c.total + "</b></button>";
    }).join("");
    if (offlineToggle) offlineToggle.checked = on;
  }

  if (offlineChips) {
    offlineChips.addEventListener("click", function (e) {
      var btn = e.target.closest(".off-chip");
      if (!btn) return;
      var next = btn.getAttribute("data-offline");
      if (!next) return;
      if (next === filterState.brand) next = "all";
      filterState.brand = next;
      resetStoreList();
      if (mapReady) window.PokeMoaMap.setBrand(next);
      else renderOfflineChips(null, next, filterState.showOffline);
    });
  }

  if (offlineToggle) {
    offlineToggle.addEventListener("change", function () {
      filterState.showOffline = offlineToggle.checked;
      resetStoreList();
      if (mapReady) window.PokeMoaMap.setShowOffline(filterState.showOffline);
      toast(filterState.showOffline ? "오프라인 판매처(마트·아트박스·자판기·카드샵)를 함께 표시합니다." : "오프라인 판매처를 지도·목록에서 숨겼습니다.");
    });
  }

  if (brandSummary) {
    brandSummary.addEventListener("click", function (e) {
      var btn = e.target.closest(".bs-card");
      if (!btn) return;
      /* 피규어(GS25 단독) 모드에서는 GS25 카드 하나만 보이므로, 눌러도 ‘전체(4사)’로
         풀리지 않게 막는다 — 카드 모드로 돌아오면 평소처럼 동작한다. */
      if (document.body.classList.contains("figure-mode")) return;
      var next = btn.getAttribute("data-brand");
      if (!next) return;
      if (next !== "all" && next === filterState.brand) next = "all";
      filterState.brand = next;
      resetStoreList();
      if (mapReady) window.PokeMoaMap.setBrand(next);
    });
  }

  if (sortSelect) {
    sortSelect.value = filterState.sort;
    sortSelect.addEventListener("change", function () {
      filterState.sort = sortSelect.value;
      resetStoreList();
      drawStoreList();
    });
  }

  if (stockToggle) {
    stockToggle.addEventListener("change", function () {
      filterState.stockOnly = stockToggle.checked;
      resetStoreList();
      if (mapReady) window.PokeMoaMap.setStockOnly(filterState.stockOnly);
      toast(stockToggle.checked ? "재고 있는 매장만 보여 드립니다." : "미조회·없음 매장도 함께 표시합니다.");
    });
  }

  $$(".radius-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      $$(".radius-btn").forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      filterState.radius = Number(btn.getAttribute("data-radius"));
      resetStoreList();
      if (mapReady) window.PokeMoaMap.setRadius(filterState.radius);
      lastRememberRadius(mapReady && window.PokeMoaMap ? window.PokeMoaMap.getState().radius : filterState.radius);
      var r = regionById(filterState.region);
      trackEvent("region_search", {
        region: filterState.region,
        region_name: r ? r.name : "",
        radius_km: filterState.radius / 1000
      });
    });
  });

  var resetBtn = $("#filterReset");
  if (resetBtn) {
    resetBtn.addEventListener("click", function () {
      filterState.brand = "all";
      filterState.sort = "stock";
      filterState.stockOnly = false;
      filterState.showOffline = true;
      filterState.radius = 3000;
      resetStoreList();
      if (sortSelect) sortSelect.value = "stock";
      if (stockToggle) stockToggle.checked = false;
      $$(".radius-btn").forEach(function (b) {
        b.classList.toggle("is-active", b.getAttribute("data-radius") === "3000");
      });
      if (mapReady) {
        window.PokeMoaMap.setBrand("all");
        window.PokeMoaMap.setStockOnly(false);
        window.PokeMoaMap.setShowOffline(true);
        window.PokeMoaMap.setRadius(3000);
        window.PokeMoaMap.closeCard();
      }
      lastRememberRadius(3000);
      toast("필터를 초기화했습니다.");
    });
  }

  /* ------------------------------------------------------------- 캘린더 */
  /* 오늘(KST) 이후 일정만 기본 표시 · 지난 기록은 접이식 */
  function kstNow() {
    var d = new Date(Date.now() + 9 * 3600 * 1000);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() };
  }
  function ymdNum(y, m, d) { return y * 10000 + m * 100 + d; }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  var calShowPast = false;

  function renderCalendar() {
    var grid = $("#calGrid");
    if (!grid) return;
    var c = D.calendar;
    var year = c.year || 2026;
    var month = c.month || 11;
    var today = kstNow();
    var todayNum = ymdNum(today.y, today.m, today.d);
    var sameMonth = today.y === year && today.m === month;
    var html = Array.prototype.map.call(grid.querySelectorAll(".cal-dow"), function (n) {
      return n.outerHTML;
    }).join("");

    for (var i = 0; i < c.firstWeekday; i++) html += '<div class="cal-cell is-empty"></div>';
    for (var d = 1; d <= c.days; d++) {
      var isPast = ymdNum(year, month, d) < todayNum;
      var isToday = sameMonth && d === today.d;
      var marks = c.marks[d];
      var show = marks && marks.length && (!isPast || calShowPast);
      html += '<div class="cal-cell' + (isToday ? " is-today" : "") + (isPast ? " is-past" : "") +
        '" aria-label="' + month + '월 ' + d + '일' + (show ? " 입고 예상 표시" : (isPast ? " 지난 날짜" : "")) + '">' +
        "<span>" + d + "</span>" +
        (show ? '<span class="marks">' + marks.map(function (k) { return '<i class="m-' + k + '"></i>'; }).join("") + "</span>" : "") +
        "</div>";
    }
    grid.innerHTML = html;
  }

  function buildCalendar() { renderCalendar(); }

  var calPastToggle = $("#calPastToggle");
  if (calPastToggle) {
    calPastToggle.addEventListener("click", function () {
      calShowPast = !calShowPast;
      calPastToggle.setAttribute("aria-expanded", calShowPast ? "true" : "false");
      calPastToggle.textContent = calShowPast ? "지난 입고일 숨기기" : "지난 입고일 보기";
      var note = $("#calNote");
      if (note) note.textContent = calShowPast ? "지난 입고일까지 모두 표시합니다." : "오늘 이후 입고 예정일만 표시합니다.";
      renderCalendar();
    });
  }

  /* 추첨 타임라인: 지난 일정 접기 */
  function buildScheduleFold() {
    var panel = $("#panel-schedule");
    if (!panel) return;
    var today = kstNow();
    var todayNum = ymdNum(today.y, today.m, today.d);
    var ul = panel.querySelector(".timeline");
    if (ul && !panel.querySelector(".timeline-now-label")) {
      var past = [];
      Array.prototype.forEach.call(ul.querySelectorAll("li"), function (li) {
        var end = li.getAttribute("data-end");
        if (!end) return;
        if (Number(end.replace(/-/g, "")) < todayNum) past.push(li);
      });

      var label = document.createElement("p");
      label.className = "timeline-now-label";
      label.textContent = past.length
        ? "다가오는 일정 · 지난 기록 " + past.length + "건은 아래에 접어 두었습니다."
        : "다가오는 일정";
      ul.parentNode.insertBefore(label, ul);

      if (past.length) {
        var box = document.createElement("details");
        box.className = "past-block";
        box.id = "pastTimeline";
        var sum = document.createElement("summary");
        sum.textContent = "지난 일정 보기 (" + past.length + "건)";
        var pul = document.createElement("ul");
        pul.className = "timeline is-past";
        past.forEach(function (li) { pul.appendChild(li); });
        box.appendChild(sum);
        box.appendChild(pul);
        ul.parentNode.appendChild(box);
      }
    }

    var chip = panel.querySelector(".cal-head .chip");
    if (chip) chip.textContent = "오늘 " + pad2(today.m) + "-" + pad2(today.d);
  }

  /* ------------------------------------------------- 도감 · 가이드 (세트별) */
  var SETS = D.SETS || [];
  var activeSetId = SETS.length ? SETS[0].id : "";
  var dexGrid = $("#dexGrid");
  var dexMoreWrap = $("#dexMoreWrap");
  var dexMore = $("#dexMore");
  var DEX_PAGE = 4; /* 도감은 처음 4장만 보이고 '더보기'로 펼침 */
  var dexExpanded = false;
  var dexCount = $("#dexCount");
  var dexEyebrow = $("#dexEyebrow");
  var dexDesc = $("#dexDesc");
  var dexNoteEl = $("#dexNote");
  var searchInput = $("#cardSearch");
  var searchClear = $("#cardSearchClear");
  var setPicker = $("#setPicker");
  var setSummary = $("#setSummary");
  var compareBody = $("#compareBody");
  var compareSub = $("#compareSub");
  var compareNote = $("#compareNote");
  var rarityChipsEl = $("#rarityChips");
  var thPrice = $("#thPrice");
  var thPerUnit = $("#thPerUnit");
  var calcSetName = $("#calcSetName");
  var calcHint = $("#calcHint");
  var calcPerPackLabel = $("#calcPerPackLabel");
  var query = "";
  var rarity = "all";

  var won = function (n) { return Number(n).toLocaleString("ko-KR") + "원"; };
  function signedRate(v) {
    var r = Math.round(v);
    if (r === 0) return "기준";
    return (r > 0 ? "+" : "−") + Math.abs(r) + "%";
  }

  var artClass = {
    fur: "art-fur", sar: "art-sar", ar: "art-ar", sr: "art-sr",
    ur: "art-ur", mur: "art-mur", bwr: "art-bwr", rr: "art-rr",
    deck: "art-deck", pika: "art-pika", classic: "art-classic", energy: "art-energy"
  };

  function artStyle(card) {
    var h = 0;
    for (var i = 0; i < card.id.length; i++) h = (h * 31 + card.id.charCodeAt(i)) % 360;
    if (card.tag === "fur") return "";
    if (card.tag === "classic") return "background:linear-gradient(150deg,hsl(38 32% 89%),hsl(32 26% 80%) 55%,hsl(26 22% 75%))";
    if (card.tag === "energy") return "background:linear-gradient(150deg,hsl(210 34% 89%),hsl(220 30% 81%) 55%,hsl(230 26% 85%))";
    if (card.tag === "deck") return "background:linear-gradient(150deg,hsl(40 44% 92%),hsl(34 32% 85%) 55%,hsl(46 42% 91%))";
    var base =
      card.tag === "pika" ? 44 :
      card.tag === "sar" ? 330 :
      card.tag === "ur" ? 42 :
      card.tag === "mur" ? 275 :
      card.tag === "bwr" ? 220 :
      card.tag === "sr" ? 196 :
      card.tag === "rr" ? 165 : 200;
    var hue = (base + (h % 150) - 75 + 360) % 360;
    return "background:linear-gradient(150deg,hsl(" + hue + " 72% 89%),hsl(" + ((hue + 46) % 360) + " 68% 83%) 55%,hsl(" + ((hue + 92) % 360) + " 62% 89%))";
  }

  function activeSet() {
    for (var i = 0; i < SETS.length; i++) if (SETS[i].id === activeSetId) return SETS[i];
    return SETS[0];
  }
  function isDeck(s) { return !s || s.packsPerBox <= 1; }

  function renderSetNav() {
    if (!setPicker) return;
    setPicker.innerHTML = "";
    SETS.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "set-chip" + (s.id === activeSetId ? " is-active" : "");
      b.setAttribute("data-set", s.id);
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", s.id === activeSetId ? "true" : "false");
      b.innerHTML = "<strong>" + s.short + "</strong><small>" + s.code + " · " + s.release.replace(/-/g, ".") + "</small>";
      b.addEventListener("click", function () { selectSet(s.id); });
      setPicker.appendChild(b);
    });
    var act = setPicker.querySelector(".set-chip.is-active");
    if (act && setPicker.scrollWidth > setPicker.clientWidth + 4) {
      setPicker.scrollLeft = Math.max(0, act.offsetLeft - 10);
    }
  }

  function renderSetSummary() {
    if (!setSummary) return;
    var s = activeSet();
    var deck = isDeck(s);
    var kreamTxt = (s.kream || []).map(function (k) { return won(k.price); });
    var main = s.kream && s.kream[0];
    var rate = main ? ((main.price - s.boxPrice) / s.boxPrice) * 100 : 0;
    var rows = [];
    rows.push(["발매일", s.release]);
    rows.push([
      "구성",
      deck ? "카드 " + s.cardsPerPack + "장 + 플레이 용품" :
        "1팩 " + s.cardsPerPack + "장 · 1박스 " + s.packsPerBox + "팩(카드 " + s.packsPerBox * s.cardsPerPack + "장)"
    ]);
    rows.push([
      "공식 정가",
      deck ? won(s.boxPrice) + " (1세트)" : won(s.packPrice) + " / 1박스 " + won(s.boxPrice)
    ]);
    rows.push(["수록 카드", s.total]);
    rows.push([
      "KREAM 즉시구매",
      kreamTxt.length ? kreamTxt.join(" · ") + " (" + signedRate(rate) + ")" : "미확인"
    ]);

    var links = [];
    if (s.official) links.push('<a href="' + s.official + '" target="_blank" rel="noopener">공식 제품 정보 ↗</a>');
    if (s.extraLink) links.push('<a href="' + s.extraLink.url + '" target="_blank" rel="noopener">' + s.extraLink.label + " ↗</a>");
    (s.kream || []).forEach(function (k, i) {
      links.push('<a href="' + k.url + '" target="_blank" rel="noopener">' + (k.label || "KREAM") + " 시세 ↗</a>");
    });

    setSummary.innerHTML =
      '<div class="ss-head">' +
      '<span class="ss-code">' + s.code + " · " + s.series + "</span>" +
      '<h2 class="ss-name">' + s.short + "</h2>" +
      "</div>" +
      '<p class="ss-summary">' + s.summary + "</p>" +
      '<dl class="ss-grid">' +
      rows.map(function (r) {
        return "<div><dt>" + r[0] + "</dt><dd>" + r[1] + "</dd></div>";
      }).join("") +
      "</dl>" +
      '<div class="ss-links">' + links.join("") + "</div>";
  }

  function renderCompare() {
    var s = activeSet();
    var deck = isDeck(s);
    var unit = deck ? "세트" : "팩";
    var packs = deck ? 1 : s.packsPerBox;
    if (thPrice) thPrice.textContent = deck ? "세트 가격" : "박스 가격";
    if (thPerUnit) thPerUnit.textContent = unit + "당 단가";
    if (calcPerPackLabel) calcPerPackLabel.textContent = unit + "당 단가";
    if (!compareBody) return;

    var rows = [{
      label: "공식 정가 (" + (deck ? "1세트" : "1박스·" + packs + "팩") + ")",
      price: s.boxPrice,
      base: true
    }];
    (s.extra || []).forEach(function (x) { rows.push({ label: x.label, price: x.price }); });
    (s.kream || []).forEach(function (x) { rows.push({ label: x.label, price: x.price }); });

    compareBody.innerHTML = rows.map(function (r) {
      var per = Math.round(r.price / packs);
      var pct = ((r.price - s.boxPrice) / s.boxPrice) * 100;
      var cls = r.base || pct < 0 ? "flat" : pct > 0 ? "up" : "";
      return "<tr><td>" + r.label + "</td>" +
        '<td class="num">' + won(r.price) + "</td>" +
        '<td class="num">' + won(per) + "</td>" +
        '<td class="num ' + cls + '">' + (r.base ? "기준" : signedRate(pct)) + "</td></tr>";
    }).join("");

    if (compareSub) {
      compareSub.innerHTML = deck
        ? "정가 " + won(s.boxPrice) + "(" + s.total + ")를 2026-11-17 KREAM 즉시구매 최저가와 비교한 값입니다."
        : "정가 기준 1박스 " + won(s.boxPrice) + " = " + unit + "당 " + won(Math.round(s.boxPrice / packs)) +
          ". 아래는 2026-11-17 KREAM 한글판 1박스 즉시구매 최저가를 정가와 비교한 값입니다(배송비·검수 수수료 별도).";
    }
    if (compareNote) {
      var links = (s.kream || []).map(function (k, i) {
        return '<a href="' + k.url + '" target="_blank" rel="noopener">' + k.label + "</a>";
      }).join(" · ");
      compareNote.innerHTML =
        "KREAM 시세는 2026-11-17 확인 기준 즉시구매 최저가입니다(한글판 " + (deck ? "스타터 세트" : "1박스") +
        "). 배송비(빠른배송 5,000원 · 일반배송 3,000원)와 검수 수수료는 별도이고, 시점과 박스 상태(슈링크 여부)에 따라 달라집니다. " +
        links;
    }
  }

  function renderRarityChips() {
    if (!rarityChipsEl) return;
    var s = activeSet();
    var seen = [];
    s.cards.forEach(function (c) {
      if (seen.indexOf(c.rarity) === -1) seen.push(c.rarity);
    });
    var html = '<button type="button" class="rarity-chip' + (rarity === "all" ? " is-active" : "") + '" data-rarity="all">전체</button>';
    seen.forEach(function (r) {
      html += '<button type="button" class="rarity-chip' + (rarity === r ? " is-active" : "") + '" data-rarity="' + r + '">' + r + "</button>";
    });
    rarityChipsEl.innerHTML = html;
  }

  function cardMatches(card) {
    if (rarity !== "all" && card.rarity !== rarity) return false;
    if (!query) return true;
    var hay = (card.name + " " + card.rarity + " " + (card.num || "") + " " + (card.illus || "") + " " + card.note).toLowerCase();
    return hay.indexOf(query.toLowerCase()) !== -1;
  }

  function syncDexMore(total) {
    if (!dexMoreWrap || !dexMore) return;
    if (total <= DEX_PAGE) {
      dexExpanded = false;
      dexMoreWrap.hidden = true;
      return;
    }
    dexMoreWrap.hidden = false;
    dexMore.setAttribute("aria-expanded", dexExpanded ? "true" : "false");
    dexMore.textContent = dexExpanded
      ? "접기"
      : "더보기 (" + (total - DEX_PAGE) + "장 더 보기)";
  }

  function renderDex() {
    if (!dexGrid) return;
    var s = activeSet();
    var list = s.cards.filter(cardMatches);
    dexGrid.innerHTML = "";
    if (!list.length) {
      var empty = document.createElement("div");
      empty.className = "dex-empty";
      empty.style.gridColumn = "1 / -1";
      empty.textContent = "‘" + query + "’에 해당하는 카드가 없습니다. 다른 이름이나 레어도로 찾아보세요.";
      dexGrid.appendChild(empty);
    }
    var shown = dexExpanded ? list : list.slice(0, DEX_PAGE);
    shown.forEach(function (card) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dex-card";
      btn.setAttribute("data-card", card.id);
      btn.innerHTML =
        '<span class="dex-art ' + (artClass[card.tag] || "art-energy") + '" data-mark="' + (s.mark || "") + '" style="' + artStyle(card) + '">' +
        '<span class="rarity-tag">' + card.rarity + "</span>" +
        (card.num ? '<span class="art-num">' + card.num + "</span>" : "") +
        '<span class="art-name">' + card.name + "</span>" +
        "</span>" +
        '<span class="dex-info">' +
        "<strong>" + card.name + "</strong>" +
        "<small>" + card.rarity + (card.num ? " · " + card.num : "") + (card.illus ? " · " + card.illus : "") + "</small>" +
        '<span class="dex-note">' + card.note + "</span>" +
        "</span>";
      btn.addEventListener("click", function () { openCardModal(card); });
      dexGrid.appendChild(btn);
    });
    if (dexCount) {
      dexCount.textContent = query || rarity !== "all" ? "검색 결과 " + list.length + "장" : "전체 " + s.cards.length + "장";
    }
    if (searchClear) searchClear.hidden = !query;
    if (dexEyebrow) dexEyebrow.textContent = s.short + " 도감";
    if (dexDesc) dexDesc.innerHTML = "<strong>" + s.total + "</strong> · " + s.summary;
    if (dexNoteEl) dexNoteEl.textContent = s.dexNote || "";
    syncDexMore(list.length);
  }

  function selectSet(id) {
    trackEvent("dex_set_select", { set_id: id });
    activeSetId = id;
    rarity = "all";
    dexExpanded = false; /* 세트를 바꾸면 다시 4장만 */
    renderSetNav();
    renderSetSummary();
    renderCompare();
    renderRarityChips();
    renderDex();
    runCalc();
  }

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      query = searchInput.value.trim();
      renderDex();
    });
  }
  if (searchClear) {
    searchClear.addEventListener("click", function () {
      searchInput.value = "";
      query = "";
      renderDex();
      searchInput.focus();
    });
  }
  if (rarityChipsEl) {
    rarityChipsEl.addEventListener("click", function (e) {
      var btn = e.target.closest(".rarity-chip");
      if (!btn) return;
      $$(".rarity-chip", rarityChipsEl).forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      rarity = btn.getAttribute("data-rarity");
      renderDex();
    });
  }
  if (dexMore) {
    dexMore.addEventListener("click", function () {
      dexExpanded = !dexExpanded;
      renderDex();
      trackEvent("dex_expand", { expanded: dexExpanded });
      if (!dexExpanded && dexGrid) {
        var top = dexGrid.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: top > 0 ? top : 0, behavior: "smooth" });
      }
    });
  }

  /* --------------------------------------------------------------- FAQ */
  /* 처음 3개만 보이고 '더보기 (N개 더 보기)' / '접기'로 펼침 (도감 더보기와 같은 방식) */
  var FAQ_PAGE = 3;
  var faqList = $("#faqList");
  var faqItems = $$(".faq-item");
  var faqMoreWrap = $("#faqMoreWrap");
  var faqMore = $("#faqMore");
  var faqExpanded = false;

  function syncFaqMore() {
    var total = faqItems.length;
    if (!faqMoreWrap || !faqMore) return;
    if (total <= FAQ_PAGE) {
      faqExpanded = false;
      faqMoreWrap.hidden = true;
      faqItems.forEach(function (item) { item.classList.remove("is-faq-hidden"); });
      return;
    }
    faqMoreWrap.hidden = false;
    faqMore.setAttribute("aria-expanded", faqExpanded ? "true" : "false");
    faqMore.textContent = faqExpanded
      ? "접기"
      : "더보기 (" + (total - FAQ_PAGE) + "개 더 보기)";
    faqItems.forEach(function (item, i) {
      var hide = !faqExpanded && i >= FAQ_PAGE;
      item.classList.toggle("is-faq-hidden", hide);
      if (hide) item.open = false;
    });
  }

  faqItems.forEach(function (item) {
    item.addEventListener("toggle", function () {
      if (!item.open) return;
      faqItems.forEach(function (other) {
        if (other !== item) other.open = false;
      });
    });
  });

  if (faqMore) {
    faqMore.addEventListener("click", function () {
      faqExpanded = !faqExpanded;
      syncFaqMore();
      trackEvent("faq_expand", { expanded: faqExpanded });
      if (!faqExpanded && faqList) {
        var top = faqList.getBoundingClientRect().top + window.scrollY - 90;
        window.scrollTo({ top: top > 0 ? top : 0, behavior: "smooth" });
      }
    });
  }
  syncFaqMore();

  /* ------------------------------------------------------------ 계산기 */
  var calcInput = $("#calcInput");
  var calcBtn = $("#calcBtn");
  var calcPerPack = $("#calcPerPack");
  var calcDiff = $("#calcDiff");
  var calcRate = $("#calcRate");
  var calcVerdict = $("#calcVerdict");
  var fmt = function (n) { return Number(n).toLocaleString("ko-KR"); };

  function runCalc() {
    if (!calcInput) return;
    var s = activeSet();
    var deck = isDeck(s);
    var packs = deck ? 1 : s.packsPerBox;
    var unit = deck ? "세트" : "팩";
    var priceWord = deck ? "세트" : "박스";
    if (calcSetName) calcSetName.textContent = "· " + s.short;
    if (calcHint) {
      calcHint.textContent = priceWord + " 가격을 넣으면 " + unit + "당 단가와 정가(" + won(s.boxPrice) + ") 대비 차액을 계산합니다.";
    }
    var raw = Number(String(calcInput.value).replace(/[^0-9]/g, ""));
    if (!raw || raw <= 0) {
      calcPerPack.textContent = "-";
      calcDiff.textContent = "-";
      calcRate.textContent = "-";
      calcRate.className = "";
      calcVerdict.textContent = "정가 " + won(s.boxPrice) + "(" + s.short + ")을 기준으로 판단합니다.";
      return;
    }
    var perPack = Math.round(raw / packs);
    var diff = raw - s.boxPrice;
    var rate = Math.round((diff / s.boxPrice) * 1000) / 10;

    calcPerPack.textContent = fmt(perPack) + "원";
    calcDiff.textContent = (diff > 0 ? "+" : diff < 0 ? "−" : "") + fmt(Math.abs(diff)) + "원";
    calcRate.textContent = (rate > 0 ? "+" : rate < 0 ? "−" : "") + Math.abs(rate) + "%";
    calcRate.className = rate > 30 ? "is-bad" : rate <= 5 ? "is-good" : "";

    if (rate <= 0) {
      calcVerdict.textContent = "정가 이하입니다. 판매 조건(정품·미개봉·배송비)을 확인하세요.";
    } else if (rate <= 5) {
      calcVerdict.textContent = "정가 수준입니다(배송비 포함 범위). 무리 없이 구매할 수 있는 가격대입니다.";
    } else if (rate <= 30) {
      calcVerdict.textContent = "정가보다 조금 비쌉니다. 배송비까지 포함한 총액으로 다시 비교해 보세요.";
    } else {
      calcVerdict.textContent = "정가보다 크게 비쌉니다. 정가 재고를 먼저 확인하는 것을 권합니다.";
    }
  }
  if (calcBtn) calcBtn.addEventListener("click", runCalc);
  if (calcInput) {
    calcInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); runCalc(); }
    });
  }

  /* --------------------------------------------------------------- 모달 */
  var backdrop = $("#modalBackdrop");
  var modalTitle = $("#modalTitle");
  var modalBody = $("#modalBody");
  var modalClose = $("#modalClose");
  var lastFocus = null;

  /* ------------------------------------------- 관리자 문의 (정적 사이트 단독 동작) */
  /* 서버 없이도 100% 동작해야 하므로 mailto: 와 이메일·내용 복사만 쓴다.
     회사복지모아 API(https://bokjimoa.onrender.com/api/inquiries)는 CORS가 열려 있지만
     이 사이트는 호출하지 않는다. 나중에 연동하더라도 아래 두 경로는 그대로 남긴다. */
  var INQUIRY_EMAIL = "acewoni3717@gmail.com";
  var pendingInquiryType = "";

  function inquiryTypeValue() {
    var el = modalBody && modalBody.querySelector("#inquiryType");
    return el ? el.value : "기타";
  }

  /* 메일 제목·본문 — 받는 사람이 유형·제목·내용·보낸 페이지를 바로 알 수 있게 만든다 */
  function buildInquiryMail() {
    var subjectEl = modalBody ? modalBody.querySelector("#inquirySubject") : null;
    var bodyEl = modalBody ? modalBody.querySelector("#inquiryBody") : null;
    var type = inquiryTypeValue();
    var subject = subjectEl ? subjectEl.value.trim() : "";
    var body = bodyEl ? bodyEl.value.trim() : "";
    var where = (location.origin && location.origin !== "null")
      ? location.origin + location.pathname
      : "포켓몬카드모아";
    return {
      subject: "[포켓몬카드모아 관리자 문의] " + (subject || type),
      body: [
        "문의 유형: " + type,
        "제목: " + (subject || "(없음)"),
        "",
        body,
        "",
        "--",
        "보낸 곳: " + where + " (" + new Date().toLocaleString("ko-KR") + ")"
      ].join("\n")
    };
  }

  function copyText(text, okMsg, failMsg) {
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (err) { ok = false; }
      document.body.removeChild(ta);
      toast(ok ? okMsg : failMsg);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function initInquiryForm(form) {
    var typeEl = form.querySelector("#inquiryType");
    var subjectEl = form.querySelector("#inquirySubject");
    var bodyEl = form.querySelector("#inquiryBody");
    if (typeEl && pendingInquiryType) typeEl.value = pendingInquiryType;
    pendingInquiryType = "";

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (bodyEl && !bodyEl.value.trim()) {
        toast("문의 내용을 적어 주세요.");
        bodyEl.focus();
        return;
      }
      var mail = buildInquiryMail();
      trackEvent("admin_inquiry", { method: "mailto", inquiry_type: inquiryTypeValue() });
      window.location.href = "mailto:" + INQUIRY_EMAIL +
        "?subject=" + encodeURIComponent(mail.subject) +
        "&body=" + encodeURIComponent(mail.body);
      toast("메일 앱이 열립니다. 열리지 않으면 이메일 복사로 주소를 복사해 보내주세요.");
    });

    var copyEmailBtn = form.querySelector("#inquiryCopyEmail");
    if (copyEmailBtn) {
      copyEmailBtn.addEventListener("click", function () {
        copyText(INQUIRY_EMAIL,
          "운영자 이메일을 복사했습니다 · " + INQUIRY_EMAIL,
          "복사하지 못했습니다. 메일 주소를 길게 눌러 선택해 주세요.");
        trackEvent("admin_inquiry", { method: "copy_email", inquiry_type: inquiryTypeValue() });
      });
    }

    var copyBodyBtn = form.querySelector("#inquiryCopyBody");
    if (copyBodyBtn) {
      copyBodyBtn.addEventListener("click", function () {
        var mail = buildInquiryMail();
        copyText("받는 사람: " + INQUIRY_EMAIL + "\n제목: " + mail.subject + "\n\n" + mail.body,
          "문의 내용을 복사했습니다. 메일에 붙여넣어 보내주세요.",
          "복사하지 못했습니다. 내용을 길게 눌러 선택해 주세요.");
        trackEvent("admin_inquiry", { method: "copy_body", inquiry_type: inquiryTypeValue() });
      });
    }
  }

  function openModalFromTemplate(key, title) {
    var tpl = document.getElementById("tpl-" + key);
    if (!tpl || !backdrop) return;
    lastFocus = document.activeElement;
    modalTitle.textContent = title;
    modalBody.innerHTML = "";
    modalBody.appendChild(tpl.content.cloneNode(true));
    backdrop.hidden = false;
    document.body.classList.add("no-scroll");
    modalBody.scrollTop = 0;
    setTimeout(function () { if (modalClose) modalClose.focus(); }, 20);

    var form = modalBody.querySelector("#inquiryForm");
    if (form) initInquiryForm(form);
  }

  function openCardModal(card) {
    if (!backdrop) return;
    var tpl = document.getElementById("tpl-card");
    lastFocus = document.activeElement;
    modalTitle.textContent = "카드 정보";
    modalBody.innerHTML = "";
    modalBody.appendChild(tpl.content.cloneNode(true));
    var art = modalBody.querySelector("#modalCardArt");
    art.className = "dex-modal-art " + (artClass[card.tag] || "art-energy");
    modalBody.querySelector("#modalCardName").textContent = card.name;
    modalBody.querySelector("#modalCardTitle").textContent = card.name;
    var meta = modalBody.querySelector("#modalCardMeta");
    var bits = [card.rarity];
    if (card.num) bits.push(card.num);
    if (card.illus) bits.push("Illus. " + card.illus);
    bits.forEach(function (t) {
      var chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = t;
      meta.appendChild(chip);
    });
    modalBody.querySelector("#modalCardNote").textContent = card.note;
    backdrop.hidden = false;
    document.body.classList.add("no-scroll");
    setTimeout(function () { if (modalClose) modalClose.focus(); }, 20);
  }

  function closeModal() {
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.body.classList.remove("no-scroll");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  $$("[data-modal]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var key = btn.getAttribute("data-modal");
      var titles = {
        about: "포켓몬카드모아 소개",
        privacy: "개인정보처리방침",
        terms: "이용약관",
        inquiry: "관리자 문의"
      };
      pendingInquiryType = btn.getAttribute("data-inquiry-type") || "";
      openModalFromTemplate(key, titles[key] || "포켓몬카드모아");
    });
  });
  if (modalClose) modalClose.addEventListener("click", closeModal);
  if (backdrop) {
    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) closeModal();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });

  /* ---------------------------------------- 정가 구매처 밖으로 나가는 클릭 */
  document.addEventListener("click", function (e) {
    var a = e.target && e.target.closest
      ? e.target.closest(".channel-links a[href^='http'], .store-shortcut[href^='http']")
      : null;
    if (!a) return;
    var card = a.closest(".channel-card, .store-shortcut");
    var nameEl = card ? card.querySelector(".channel-name, .store-shortcut-name") : null;
    trackEvent("store_outbound_click", {
      store_name: nameEl ? nameEl.textContent.trim() : "",
      url: a.href
    });
  });

  /* ------------------------------------------- 쿠팡 파트너스 영역 반응 */
  /* iframe 내부 클릭은 cross-origin이라 부모 페이지에서 볼 수 없다. 카드·슬롯 상자의
     클릭·포커스만 집계하고, 슬롯이 없으면 카드 ID를 slot으로 쓴다. */
  function affiliateSlotOf(el) {
    var card = el && el.closest ? el.closest("[data-affiliate-card], .affiliate") : null;
    if (!card) return "";
    var slot = el.closest("[data-affiliate-slot]");
    if (slot) return slot.getAttribute("data-affiliate-slot") || "";
    return card.getAttribute("data-affiliate-card") || "";
  }
  document.addEventListener("click", function (e) {
    var slot = affiliateSlotOf(e.target);
    if (slot) trackEvent("affiliate_interact", { slot: slot, action: "click" });
  }, true);
  document.addEventListener("focusin", function (e) {
    var slot = affiliateSlotOf(e.target);
    if (slot) trackEvent("affiliate_interact", { slot: slot, action: "focus" });
  });

  /* --------------------------------------------------------- 제휴 링크 */
  $$("[data-affiliate]").forEach(function (a) {
    // 실제 파트너스 링크가 들어간 자리는 그대로 새 창으로 이동한다
    var href = a.getAttribute("href") || "";
    if (/^https?:/i.test(href)) return;
    a.addEventListener("click", function (e) {
      e.preventDefault();
      toast("제휴 링크 자리입니다. 배포 시 실제 쿠팡 파트너스 링크로 교체됩니다.");
    });
  });

  /* ------------------------------------- 다른 확장팩·박스 정가 구매처 (v4.6) */
  /* 정가 구매처 탭 안에서 30th가 아닌 박스를 골라 그 박스의 정가·KREAM 시세와
     공식/인증 판매처 링크를 보여 줍니다. 판매처 URL·재고 표시는 data.js의
     STORE_CHECK(2026-11-18) 기준이고, 실시간 재고·금액은 판매처 페이지에서 확인합니다. */
  var BOX_SETS = SETS.filter(function (s) { return s.id !== "m6a"; });
  var boxPicker = $("#boxPicker");
  var boxBoard = $("#boxBoard");
  var activeBoxId = BOX_SETS.length ? BOX_SETS[0].id : "";

  function boxSetById(id) {
    for (var i = 0; i < BOX_SETS.length; i++) if (BOX_SETS[i].id === id) return BOX_SETS[i];
    return BOX_SETS[0];
  }

  function renderBoxPicker() {
    if (!boxPicker) return;
    boxPicker.innerHTML = "";
    BOX_SETS.forEach(function (s) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "set-chip" + (s.id === activeBoxId ? " is-active" : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", s.id === activeBoxId ? "true" : "false");
      b.innerHTML = "<strong>" + escapeHtml(s.short) + "</strong><small>" +
        escapeHtml(s.code) + " · " + escapeHtml(won(s.boxPrice)) + "</small>";
      b.addEventListener("click", function () {
        if (activeBoxId === s.id) return;
        activeBoxId = s.id;
        renderBoxPicker();
        renderBoxBoard();
      });
      boxPicker.appendChild(b);
    });
    var act = boxPicker.querySelector(".set-chip.is-active");
    if (act && boxPicker.scrollWidth > boxPicker.clientWidth + 4) {
      boxPicker.scrollLeft = Math.max(0, act.offsetLeft - 10);
    }
  }

  function renderBoxBoard() {
    if (!boxBoard) return;
    var s = boxSetById(activeBoxId);
    if (!s) return;
    var deck = isDeck(s);
    var packs = deck ? 1 : s.packsPerBox;
    var kream = (s.kream || [])[0];
    var rate = kream ? ((kream.price - s.boxPrice) / s.boxPrice) * 100 : 0;
    var cells = [
      ["발매일", escapeHtml(s.release)],
      [deck ? "세트 정가" : "1팩 정가", deck ? won(s.boxPrice) : won(s.packPrice), deck],
      [deck ? "구성" : "1박스 정가", deck ? "카드 " + s.cardsPerPack + "장 + 플레이 용품" : won(s.boxPrice), !deck],
      deck
        ? null
        : ["1박스 구성", packs + "팩 · 카드 " + packs * s.cardsPerPack + "장"],
      ["KREAM 참고 시세", kream ? won(kream.price) + ' <em>' + signedRate(rate) + "</em>" : "미확인"],
      ["수록 카드", escapeHtml(s.total)]
    ].filter(Boolean);
    var links = [];
    if (s.official) links.push('<a href="' + s.official + '" target="_blank" rel="noopener">공식 제품 정보 ↗</a>');
    if (kream) links.push('<a href="' + kream.url + '" target="_blank" rel="noopener">KREAM 시세 ↗</a>');
    links.push('<button type="button" class="box-dex-btn" data-box-dex="' + s.id + '">이 박스 도감·시세 비교 →</button>');

    var stores = (s.stores || []).map(function (st) {
      var line = st.state
        ? '<span class="store-state ' + (st.stateKind || "none") + '">' + escapeHtml(st.state) + "</span>"
        : '<span class="store-sub">' + escapeHtml(st.sub || "검색 바로가기") + "</span>";
      return '<a class="store-shortcut" href="' + st.url + '" target="_blank" rel="noopener" data-store="' + st.id + '"' +
        ' aria-label="' + escapeHtml((st.label && st.label.indexOf(st.short || "") === 0 ? st.label : (st.short || "") + " · " + (st.label || "")) + " (새 창)") + '">' +
        '<span class="store-badge" style="--brand:' + (st.brand || "#e9eef7") + ';--brand-ink:' + (st.brandInk || "#10203c") + '">' + escapeHtml(st.initial || "") + "</span>" +
        '<span class="store-shortcut-body"><strong class="store-shortcut-name">' + escapeHtml(st.short || "") + "</strong>" + line + "</span>" +
        '<span class="store-go" aria-hidden="true">↗</span>' +
        "</a>";
    }).join("");

    boxBoard.innerHTML =
      '<div class="box-head"><span class="ss-code">' + escapeHtml(s.code + " · " + s.series) + "</span>" +
      '<h3 class="box-name">' + escapeHtml(s.short) + "</h3></div>" +
      '<p class="box-sub">' + escapeHtml(s.name) + " · " + escapeHtml(s.release) + " 발매</p>" +
      '<dl class="box-price">' +
      cells.map(function (c) {
        return '<div' + (c[2] ? ' class="is-key"' : '') + "><dt>" + c[0] + "</dt><dd>" + c[1] + "</dd></div>";
      }).join("") +
      "</dl>" +
      '<div class="box-links">' + links.join("") + "</div>" +
      (s.storeMemo ? '<p class="box-memo"><b>확인 메모</b> — ' + escapeHtml(s.storeMemo) + "</p>" : "") +
      '<div class="box-store-head"><h4>정가 구매처</h4><span>' + (s.stores || []).length +
      "곳 · " + escapeHtml((D.STORE_CHECK || "") + " 확인") + "</span></div>" +
      '<div class="box-store-grid">' + stores + "</div>";

    var dexBtn = boxBoard.querySelector("[data-box-dex]");
    if (dexBtn) {
      dexBtn.addEventListener("click", function () {
        showTab("guide");
        selectSet(s.id);
      });
    }
  }

  /* =========================================================================
   * 시세·이슈·신규팩·팝수 (v4.9)
   * - 시세: data.js 의 kreamMovers(2026-11-18 KREAM 확인값)를 그대로 그립니다.
   *   실시간 조회 응답({relay}/api/kream-movers)이 오면 같은 자리를 그 값으로
   *   바꾸고, 응답이 없거나 형식이 다르면 정적 값으로 남겨 둡니다.
   * - 팝수: 도감·번호 인덱스에서 찾아 기본 정보와 바로가기를 보여 주고,
   *   실시간 /api/pop?q= 응답이 오면 팝수를 함께 표시합니다.
   * ========================================================================= */
  var KC = D.KREAM_CHECKED || {};
  var MOVERS = (D.kreamMovers || []).slice();
  var CARD_NUMBERS = D.cardNumbers || [];
  var CARD_RANGES = D.cardRanges || [];
  var POP_TOOLS = D.popTools || {};

  var moverGrid = $("#moverGrid");
  var kreamTableBody = $("#kreamTableBody");
  var kreamBoardSub = $("#kreamBoardSub");
  var kreamRelayBadge = $("#kreamRelayBadge");
  var trendStats = $("#trendStats");
  var kreamLiveLink = $("#kreamLiveLink");
  var issueList = $("#issueList");
  var releaseGrid = $("#releaseGrid");

  var popForm = $("#popForm");
  var popQueryEl = $("#popQuery");
  var popChips = $("#popChips");
  var popLinks = $("#popLinks");
  var popResults = $("#popResults");
  var popRelayStatus = $("#popRelayStatus");
  var popRelaySeq = 0;

  function won(n) {
    if (n == null || isNaN(n)) return "-";
    return Number(n).toLocaleString("ko-KR") + "원";
  }
  function signed(n) {
    if (n == null || isNaN(n)) return "-";
    return (n > 0 ? "+" : n < 0 ? "-" : "") + Math.abs(Number(n)).toLocaleString("ko-KR");
  }
  function pctAbs(n) {
    if (n == null || isNaN(n)) return "";
    return Math.abs(Number(n)).toFixed(1).replace(/\.0$/, "") + "%";
  }
  function pctOf(n) {
    if (n == null || isNaN(n)) return "";
    return (n > 0 ? "+" : n < 0 ? "-" : "") + pctAbs(n);
  }
  function relDirection(m) {
    if (m.dir === "up") return "up";
    if (m.dir === "down") return "down";
    if (m.dir === "flat") return "flat";
    return "na";
  }
  function artFor(item) {
    var c = artClass[item.tag];
    if (c) return c;
    return "art-sar";
  }
  function artGradient(item) {
    if (item.tag === "fur") return "";
    if (item.tag === "classic") return "background:linear-gradient(150deg,hsl(38 32% 89%),hsl(32 26% 80%) 55%,hsl(26 22% 75%))";
    if (item.tag === "ar") return "background:linear-gradient(150deg,hsl(198 60% 90%),hsl(150 42% 88%) 55%,hsl(44 70% 90%))";
    return "background:linear-gradient(150deg,hsl(330 70% 92%),hsl(292 58% 89%) 55%,hsl(258 56% 92%))";
  }
  function relayUrl() {
    try { return localStorage.getItem("pokemoa.relayUrl") || ""; } catch (e) { return ""; }
  }

  /* --------------------------------------------------- 오늘 오른 카드 */
  function renderTrendStats(list) {
    if (!trendStats) return;
    var up = 0, down = 0, flat = 0, na = 0;
    list.forEach(function (m) {
      var d = relDirection(m);
      if (d === "up") up++; else if (d === "down") down++;
      else if (d === "flat") flat++; else na++;
    });
    trendStats.innerHTML =
      '<span class="trend-stat is-up"><b>' + up + '</b>장 상승</span>' +
      '<span class="trend-stat is-down"><b>' + down + '</b>장 하락</span>' +
      '<span class="trend-stat"><b>' + flat + '</b>장 보합</span>' +
      (na ? '<span class="trend-stat"><b>' + na + '</b>장 비교 불가</span>' : "") +
      '<span class="trend-stat is-src">' + escapeHtml((KC.label || "KREAM") + " · " + (KC.date || "") + " " + (KC.time || "") + " 확인") + "</span>";
  }

  function renderMovers(list) {
    if (!moverGrid) return;
    var rising = list.filter(function (m) { return relDirection(m) === "up"; });
    rising.sort(function (a, b) { return (b.pct || 0) - (a.pct || 0); });
    if (!rising.length) {
      moverGrid.innerHTML = '<p class="mover-empty">지금 확인된 상승 체결이 없습니다. 아래 표에서 오늘 체결 전체를 볼 수 있습니다.</p>';
      return;
    }
    moverGrid.innerHTML = rising.slice(0, 4).map(function (m, i) {
      return '<article class="mover-card">' +
        '<span class="mover-rank">' + (i + 1) + '</span>' +
        '<span class="mover-art ' + artFor(m) + '" data-mark="' + escapeHtml((m.num || "").split("/")[0] || "") + '" style="' + artGradient(m) + '">' +
          '<span class="mover-rarity">' + escapeHtml(m.rarity || "") + '</span>' +
          '<span class="mover-num">' + escapeHtml(m.num || "") + '</span>' +
        '</span>' +
        '<div class="mover-body">' +
          '<div class="mover-top"><strong>' + escapeHtml(m.name) + '</strong>' +
            (m.kreamId ? '<a class="mover-kream" href="' + m.url + '" target="_blank" rel="noopener" data-kream-out="' + m.kreamId + '">KREAM ↗</a>' : '') +
          '</div>' +
          '<div class="mover-price"><b>' + won(m.lastPrice) + '</b>' +
            '<span class="mover-delta is-up">▲ ' + pctAbs(m.pct) + '</span></div>' +
          '<p class="mover-meta">최근 체결 <b>' + escapeHtml(m.lastWhen || "") + '</b> · 직전 ' + won(m.prevPrice) + '(' + escapeHtml(m.prevWhen || "") + ') · 누적 ' + (m.trades || 0) + '건</p>' +
          '<p class="mover-note">' + escapeHtml(m.set || "") + ' · ' + escapeHtml(m.model || "") + '</p>' +
          '<button type="button" class="mover-pop" data-pop-num="' + escapeHtml(m.num || "") + '">' + escapeHtml(m.num || "") + ' 팝수 조회 →</button>' +
        '</div>' +
      '</article>';
    }).join("");
    $$("[data-pop-num]", moverGrid).forEach(function (b) {
      b.addEventListener("click", function () {
        showTab("trends");
        if (popQueryEl) popQueryEl.value = b.getAttribute("data-pop-num");
        runPopSearch(b.getAttribute("data-pop-num"), "mover");
        var anchor = $("#popSection");
        if (anchor) setTimeout(function () { anchor.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
      });
    });
    $$("[data-kream-out]", moverGrid).forEach(function (a) {
      a.addEventListener("click", function () { trackEvent("kream_outbound", { from: "movers" }); });
    });
  }

  function renderKreamTable(list) {
    if (!kreamTableBody) return;
    var order = list.slice().sort(function (a, b) {
      var rank = { up: 0, flat: 1, down: 2, na: 3 };
      function r(m) {
        var v = rank[relDirection(m)];
        return v == null ? 3 : v;
      }
      var d = r(a) - r(b);
      if (d) return d;
      return Math.abs(b.pct || 0) - Math.abs(a.pct || 0);
    });
    kreamTableBody.innerHTML = order.map(function (m) {
      var dir = relDirection(m);
      var pctCell = dir === "na"
        ? '<span class="kream-na">비교 불가</span>'
        : '<span class="kream-pct is-' + dir + '">' + (dir === "up" ? "▲ " : dir === "down" ? "▼ " : "") + pctAbs(m.pct) + '</span>' +
          (m.diff ? '<small>(' + signed(m.diff) + '원)</small>' : "");
      var pageCell = m.pageDelta
        ? '<span class="kream-page is-' + m.pageDelta.kind + '">' + escapeHtml(m.pageDelta.text) + '</span><small>' + escapeHtml(m.pageDelta.note || "") + '</small>'
        : '<span class="kream-na">표시 없음</span>';
      return '<tr>' +
        '<td><a class="kream-name" href="' + m.url + '" target="_blank" rel="noopener" data-kream-out="' + m.kreamId + '">' + escapeHtml(m.name) + '</a>' +
          '<small class="kream-sub">' + escapeHtml(m.num || "") + ' · ' + escapeHtml(m.model || "") + '</small>' +
          '<small class="kream-m-only">직전 ' + won(m.prevPrice) + ' (' + escapeHtml(m.prevWhen || "") + ') · 누적 ' + (m.trades || 0) + '건</small>' +
          (m.pageDelta ? '<small class="kream-m-only">KREAM 표시 ' + escapeHtml(m.pageDelta.text) + ' · ' + escapeHtml(m.pageDelta.note || "") + '</small>' : "") +
        '</td>' +
        '<td class="num">' + won(m.lastPrice) + '<small>' + escapeHtml(m.lastWhen || "") + '</small></td>' +
        '<td class="num">' + won(m.prevPrice) + '<small>' + escapeHtml(m.prevWhen || "") + '</small></td>' +
        '<td class="num">' + pctCell + '</td>' +
        '<td class="num">' + (m.trades || 0) + '건</td>' +
        '<td>' + pageCell + '</td>' +
      '</tr>';
    }).join("");
    $$("[data-kream-out]", kreamTableBody).forEach(function (a) {
      a.addEventListener("click", function () { trackEvent("kream_outbound", { from: "table" }); });
    });
  }

  function renderKreamNote(list) {
    if (kreamBoardSub) {
      kreamBoardSub.textContent = (KC.date || "") + " " + (KC.time || "") + " 확인 · 한글판 · 비로그인 공개 내역 · 수수료·배송비 별도 · " + list.length + "장";
    }
    if (kreamLiveLink && KC.collection) kreamLiveLink.href = KC.collection;
  }

  function applyMovers(list, source) {
    MOVERS = list;
    renderTrendStats(list);
    renderMovers(list);
    renderKreamTable(list);
    renderKreamNote(list);
    if (kreamRelayBadge) {
      kreamRelayBadge.textContent = source === "relay" ? "실시간 확인" : "정적 데이터";
      kreamRelayBadge.className = "chip " + (source === "relay" ? "chip-yellow" : "chip-line");
    }
  }

  var relayMoversTried = false;
  function loadRelayMovers() {
    renderTrendStats(MOVERS);
    renderMovers(MOVERS);
    renderKreamTable(MOVERS);
    renderKreamNote(MOVERS);
    if (relayMoversTried) return;
    relayMoversTried = true;
    trackEvent("trends_view", { cards: MOVERS.length });
    var base = relayUrl();
    if (!base) return;
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, 6000);
    fetch(base + "/api/kream-movers", { signal: ctrl.signal, mode: "cors", cache: "no-store" })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (payload) {
        if (payload && payload.ok && payload.items && payload.items.length) {
          applyMovers(payload.items, "relay");
          toast("KREAM 시세 " + payload.items.length + "장을 실시간으로 받았습니다.");
        }
      })
      .catch(function () { /* 응답이 없으면 정적 값 그대로 */ })
      .finally(function () { clearTimeout(timer); });
  }

  /* ------------------------------------------------------- 카드 이슈 */
  function renderIssues() {
    if (!issueList) return;
    var items = D.cardIssues || [];
    issueList.innerHTML = items.map(function (it) {
      var links = (it.links || []).map(function (l) {
        return '<a href="' + l.url + '" target="_blank" rel="noopener" data-issue-out="' + escapeHtml(it.tag) + '">' + escapeHtml(l.label) + ' ↗</a>';
      }).join("");
      return '<li class="issue-item is-' + (it.kind || "etc") + '">' +
        '<div class="issue-side"><span class="issue-date">' + escapeHtml(it.date) + '</span>' +
          '<span class="issue-tag">' + escapeHtml(it.tag) + '</span></div>' +
        '<div class="issue-body"><h3>' + escapeHtml(it.title) + '</h3>' +
          '<p>' + escapeHtml(it.body) + '</p>' +
          '<div class="issue-links">' + links + '</div></div>' +
      '</li>';
    }).join("");
    $$("[data-issue-out]", issueList).forEach(function (a) {
      a.addEventListener("click", function () { trackEvent("issue_outbound", { tag: a.getAttribute("data-issue-out") }); });
    });
  }

  /* ---------------------------------------------------- 신규 팩 발매 */
  function renderReleases() {
    if (!releaseGrid) return;
    var items = D.newReleases || [];
    releaseGrid.innerHTML = items.map(function (r) {
      var chipCls = r.kind === "soon" ? "chip-yellow" : r.kind === "overseas" ? "chip-blue" : "chip-line";
      return '<article class="release-card is-' + (r.kind || "done") + '">' +
        '<div class="release-head"><span class="chip ' + chipCls + '">' + escapeHtml(r.status) + '</span>' +
          '<span class="release-date">' + escapeHtml(r.date) + '</span></div>' +
        '<h3>' + escapeHtml(r.name) + '</h3>' +
        '<p class="release-type">' + escapeHtml(r.type) + '</p>' +
        '<dl class="release-spec">' +
          '<div><dt>정가</dt><dd>' + escapeHtml(r.price) + '</dd></div>' +
          '<div><dt>구성</dt><dd>' + escapeHtml(r.config) + '</dd></div>' +
        '</dl>' +
        '<p class="release-note">' + escapeHtml(r.note || "") + '</p>' +
        '<div class="release-links">' +
          '<a href="' + r.url + '" target="_blank" rel="noopener" data-release-out="official">공식 제품 정보 ↗</a>' +
          (r.store ? '<a href="' + r.store + '" target="_blank" rel="noopener" data-release-out="store">스토어 상품 페이지 ↗</a>' : '') +
        '</div>' +
      '</article>';
    }).join("");
    $$("[data-release-out]", releaseGrid).forEach(function (a) {
      a.addEventListener("click", function () { trackEvent("release_outbound", { kind: a.getAttribute("data-release-out") }); });
    });
  }

  /* ------------------------------------------------------ 팝수 조회 */
  function normNum(raw) {
    var s = String(raw == null ? "" : raw).replace(/\s+/g, "");
    var m = s.match(/(\d{1,4})\/(\d{1,4})/);
    if (!m) return "";
    return parseInt(m[1], 10) + "/" + parseInt(m[2], 10);
  }
  function moverFor(item) {
    for (var i = 0; i < MOVERS.length; i++) {
      if (item.num && normNum(MOVERS[i].num) === normNum(item.num) && MOVERS[i].name === item.name) return MOVERS[i];
    }
    for (var j = 0; j < MOVERS.length; j++) {
      if (item.num && normNum(MOVERS[j].num) === normNum(item.num)) return MOVERS[j];
    }
    return null;
  }
  function popQueryText(item) {
    var parts = [];
    if (item.en) parts.push(item.en);
    else if (item.name) parts.push(item.name);
    if (item.num) parts.push(item.num);
    if (item.set && !item.en) parts.push(item.set);
    return parts.join(" ");
  }
  function priceChartingUrl(item) {
    var base = POP_TOOLS.pricecharting || "https://www.pricecharting.com/search-products?q=";
    var q = item && item.en ? (item.en + " " + (/30th/i.test(item.set || "") ? "30th Celebration" : (item.set || ""))) : (popQueryEl ? popQueryEl.value : "");
    return base + encodeURIComponent(q.trim()) + "&type=prices";
  }
  function copyText(text) {
    var value = String(text || "");
    if (!value) return Promise.resolve(false);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(value).then(function () { return true; }).catch(function () { return legacyCopy(value); });
    }
    return Promise.resolve(legacyCopy(value));
  }
  function legacyCopy(value) {
    try {
      var ta = document.createElement("textarea");
      ta.value = value;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function openExternal(url) {
    var w = window.open(url, "_blank", "noopener");
    if (w) w.opener = null;
  }

  function popMatches(raw) {
    var q = String(raw || "").trim();
    var out = { items: [], range: null, query: q };
    if (!q) return out;
    var num = normNum(q);
    var seen = {};
    function push(item) {
      var key = (item.set || "") + "|" + item.name + "|" + (item.num || "");
      if (seen[key]) return;
      seen[key] = 1;
      out.items.push(item);
    }
    if (num) {
      CARD_NUMBERS.forEach(function (c) { if (normNum(c.num) === num) push(c); });
      SETS.forEach(function (s) {
        (s.cards || []).forEach(function (c) {
          if (c.num && normNum(c.num) === num) {
            push({ name: c.name, num: c.num, rarity: c.rarity, tag: c.tag, set: s.short, note: c.note });
          }
        });
      });
      if (!out.items.length) {
        var parts = num.split("/");
        var no = parseInt(parts[0], 10), total = parseInt(parts[1], 10);
        CARD_RANGES.forEach(function (r) {
          if (r.total === total && no >= r.from && no <= r.to) {
            out.range = { set: r.set, label: r.label, note: r.note, num: no + "/" + total };
          }
        });
      }
      return out;
    }
    var needle = q.toLowerCase();
    CARD_NUMBERS.forEach(function (c) {
      if (String(c.name).toLowerCase().indexOf(needle) >= 0 || String(c.en || "").toLowerCase().indexOf(needle) >= 0) push(c);
    });
    SETS.forEach(function (s) {
      (s.cards || []).forEach(function (c) {
        if (String(c.name).toLowerCase().indexOf(needle) >= 0) {
          push({ name: c.name, num: c.num, rarity: c.rarity, tag: c.tag, set: s.short, note: c.note });
        }
      });
    });
    return out;
  }

  /* ------------------------------------------------------ 팝수 조회 */
  /* 등급 회사를 먼저 고르고 인증서·카드 번호를 넣으면, 번호를 복사해 그 회사의
     공식 인증서/팝 리포트 페이지로 넘긴다. 팝수를 이 사이트에 저장하지 않는다. */
  var POP_COMPANIES = {
    psa: {
      label: "PSA",
      cert: "https://www.psacard.com/cert/",
      report: "https://www.psacard.com/pop",
      reportLabel: "PSA 팝 리포트 검색",
      hint: "PSA 인증서 번호(8~9자리)를 넣으면 인증서 조회, 카드 번호(예: 127/103)를 넣으면 팝 리포트 검색으로 갑니다."
    },
    cgc: {
      label: "CGC",
      cert: "https://www.cgccards.com/certlookup/?certNumber=",
      report: "https://www.cgccards.com/population-report/",
      reportLabel: "CGC 팝 리포트",
      hint: "CGC 인증서 번호를 넣으면 인증서 조회, 카드 번호를 넣으면 팝 리포트로 갑니다."
    },
    brg: {
      label: "BRG",
      cert: "",
      report: "https://break.co.kr/pop-report",
      reportLabel: "BRG 팝 리포트",
      hint: "BRG는 인증서 번호 대신 카드 이름·번호로 팝 리포트를 찾습니다. 번호를 복사해 붙여넣으세요."
    },
    bgs: {
      label: "BGS",
      cert: "https://www.beckett.com/grading/card-lookup?certNum=",
      report: "https://www.beckett.com/grading/pop-report",
      reportLabel: "BGS 팝 리포트",
      hint: "BGS(Beckett) 인증서 번호를 넣으면 등급카드 조회, 카드 번호를 넣으면 팝 리포트로 갑니다."
    }
  };
  var popCompanyEl = $("#popCompany");
  var popHintEl = $("#popHint");
  var popQueryLabel = $("#popQueryLabel");
  var popCompany = "psa";

  function popCompanyInfo() {
    return POP_COMPANIES[popCompany] || POP_COMPANIES.psa;
  }
  function isCertNumber(raw) {
    return /^\d{7,}$/.test(String(raw || "").replace(/[\s-]/g, ""));
  }
  function popTargetUrl(raw) {
    var info = popCompanyInfo();
    var q = String(raw || "").trim();
    if (!q) return info.report;
    if (isCertNumber(q) && info.cert) return info.cert + encodeURIComponent(q.replace(/[\s-]/g, ""));
    return info.report;
  }
  function renderPopCompany() {
    var info = popCompanyInfo();
    if (popHintEl) popHintEl.textContent = info.hint;
    if (popQueryLabel) {
      popQueryLabel.textContent = info.cert
        ? info.label + " 인증서 번호 또는 카드 번호"
        : info.label + " 카드 번호 (인증서 번호 없음)";
    }
    if (popQueryEl) popQueryEl.placeholder = info.cert ? "인증서 번호 또는 카드 번호" : "카드 번호 (예: 127/103)";
    if (popCompanyEl) {
      $$(".pop-company-btn", popCompanyEl).forEach(function (b) {
        var on = b.getAttribute("data-company") === popCompany;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    }
    renderPopLinks({ query: popQueryEl ? popQueryEl.value : "", items: [] });
    renderPopResults({ query: popQueryEl ? popQueryEl.value : "", items: [] });
  }
  function renderPopLinks() {
    if (!popLinks) return;
    var info = popCompanyInfo();
    var q = popQueryEl ? popQueryEl.value.trim() : "";
    var certHref = popTargetUrl(q);
    popLinks.innerHTML =
      (info.cert && isCertNumber(q)
        ? '<a class="pop-link" href="' + certHref + '" target="_blank" rel="noopener" data-pop-tool="cert"><b>' + info.label + ' 인증서 조회</b><small>인증서 번호로 등급카드 확인</small></a>'
        : info.cert
          ? '<a class="pop-link" href="' + info.cert.replace(/[?].*$/, '') + '" target="_blank" rel="noopener" data-pop-tool="cert"><b>' + info.label + ' 인증서 조회</b><small>인증서 번호를 넣으면 바로 열립니다</small></a>'
          : '') +
      '<a class="pop-link" href="' + info.report + '" target="_blank" rel="noopener" data-pop-tool="report"><b>' + info.reportLabel + '</b><small>공식 사이트에서 팝수 확인</small></a>';
    $$("[data-pop-tool]", popLinks).forEach(function (el) {
      el.addEventListener("click", function () {
        trackEvent("pop_outbound", { tool: el.getAttribute("data-pop-tool"), company: popCompany });
      });
    });
  }
  function renderPopResults(context) {
    if (!popResults) return;
    var q = context && context.query ? context.query : "";
    if (!q) {
      popResults.innerHTML = '<p class="pop-empty">회사를 고르고 등급카드 넘버를 넣으면, 번호를 복사해 공식 팝 리포트·인증서 조회로 넘겨 드립니다.</p>';
      return;
    }
    var items = (context.items || []).slice(0, 4);
    var head = '<p class="pop-query-line"><b>' + escapeHtml(popCompanyInfo().label) + '</b> · ' + escapeHtml(q) +
      (isCertNumber(q) ? ' <span class="pop-kind">인증서 번호</span>' : ' <span class="pop-kind">카드 번호</span>') + '</p>';
    if (items.length) {
      popResults.innerHTML = head + items.map(function (item) {
        return '<div class="pop-match"><span class="pop-match-name">' + escapeHtml(item.name) + '</span>' +
          '<span class="pop-match-meta">' + escapeHtml(item.set || "") + (item.num ? ' · ' + escapeHtml(item.num) : '') +
          (item.rarity ? ' · ' + escapeHtml(item.rarity) : '') + '</span></div>';
      }).join("");
    } else if (context.range) {
      popResults.innerHTML = head + '<p class="pop-empty">' + escapeHtml(context.range.label) + ' 구간의 카드 번호입니다. ' + escapeHtml(context.range.note) + '</p>';
    } else {
      popResults.innerHTML = head + '<p class="pop-empty">사이트 도감에는 없는 번호입니다. 위 공식 조회 페이지에서 확인하세요.</p>';
    }
  }
  function renderPopRelay(payload, context) {
    if (!popRelayStatus) return;
    if (!payload) {
      /* v2.1 — 중계의 /api/pop 은 아직 준비되지 않았습니다(501). ‘실시간 팝수 조회’를 약속하지 않고
         공식 사이트로 넘기는 안내만 짧게 보여 줍니다. */
      popRelayStatus.textContent = "팝수는 각 등급사 공식 페이지에서 확인합니다. 번호를 복사해 열어 드립니다.";
      return;
    }
    var rows = payload.items || payload.results || [];
    if (!payload.ok || !rows.length) {
      popRelayStatus.textContent = "실시간 팝수 응답이 없습니다. 공식 조회 페이지로 확인해 주세요.";
      return;
    }
    popRelayStatus.innerHTML = '<span class="pop-relay-title">실시간 팝수 · ' + escapeHtml(context.query) + '</span>' +
      rows.map(function (r) {
        return '<span class="pop-relay-row"><b>' + escapeHtml(r.name || r.label || "") + '</b> ' +
          (r.psa10 != null ? 'PSA 10 ' + r.psa10 + '장' : '') +
          (r.psaTotal != null ? ' / PSA 전체 ' + r.psaTotal + '장' : '') +
          (r.brg10 != null ? ' · BRG 10 ' + r.brg10 + '장' : '') +
          (r.brgTotal != null ? ' / BRG 전체 ' + r.brgTotal + '장' : '') + '</span>';
      }).join("");
  }
  function runPopSearch(raw, from) {
    var value = String(raw || "").trim();
    var context = popMatches(value);
    context.query = value;
    renderPopLinks(context);
    renderPopResults(context);
    trackEvent("pop_search", { from: from || "form", company: popCompany, has_result: context.items.length ? 1 : 0 });
    if (!value) {
      toast("등급카드 넘버를 먼저 넣어 주세요.");
      return;
    }
    var url = popTargetUrl(value);
    copyText(value).then(function (ok) {
      openExternal(url);
      toast(ok
        ? "\u201c" + value + "\u201d를 복사하고 " + popCompanyInfo().label + " 조회 페이지를 열었습니다."
        : "조회 페이지를 열었습니다. 검색창에 \u201c" + value + "\u201d를 붙여넣으세요.");
    });
    /* 실시간 팝수 중계(/api/pop)는 아직 준비 중이라 부르지 않습니다 — 헛요청·오류 문구를 남기지 않는다. */
    renderPopRelay(null, context);
  }

  function initPop() {
    if (!popForm) return;
    if (popCompanyEl) {
      $$(".pop-company-btn", popCompanyEl).forEach(function (b) {
        b.addEventListener("click", function () {
          popCompany = b.getAttribute("data-company") || "psa";
          renderPopCompany();
        });
      });
    }
    popForm.addEventListener("submit", function (e) {
      e.preventDefault();
      runPopSearch(popQueryEl ? popQueryEl.value : "", "form");
    });
    renderPopCompany();
    renderPopRelay(null, { query: "" });
  }

  /* --------------------------------------- 실시간 환율 위젯 (USD · JPY) */
  /* 무료 공개 환율 API 를 그대로 호출한다. 값을 지어내지 않고, 실패하면 실패했다고 적는다.
     ① open.er-api.com (CORS 허용) ② 실패하면 jsDelivr currency-api 로 한 번 더 시도. */
  var fxUsdEl = $("#fxUsd");
  var fxJpyEl = $("#fxJpy");
  var fxSrcEl = $("#fxSrc");
  var fxNoteEl = $("#fxNote");
  var fxRefreshEl = $("#fxRefresh");
  var fxCardEls = $$("#fxWidget .fx-card");
  var FX_CACHE_KEY = "pokemoa.fx.v1";
  var FX_TTL = 10 * 60 * 1000;   /* 10분 캐시 — 새로고침을 누르면 즉시 다시 받는다 */

  function fxNum(n, digits) {
    if (!isFinite(n)) return "-";
    var fixed = Math.abs(n) >= 100 ? n.toFixed(digits == null ? 2 : digits) : n.toFixed(2);
    var parts = fixed.split(".");
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return parts.join(".");
  }
  function fxClock(ms) {
    var d = new Date(ms);
    if (isNaN(d.getTime())) return "";
    var p = function (v) { return String(v).padStart(2, "0"); };
    return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function fxPaint(data) {
    var usd = data && Number(data.usdKrw);
    var jpy100 = data && Number(data.jpy100);
    if (!isFinite(usd) || !isFinite(jpy100) || usd <= 0 || jpy100 <= 0) { fxFail(); return; }
    if (fxUsdEl) fxUsdEl.textContent = fxNum(usd, 2) + "원";
    if (fxJpyEl) fxJpyEl.textContent = fxNum(jpy100, 1) + "원";
    fxCardEls.forEach(function (c) { c.classList.remove("is-error"); });
    if (fxSrcEl) fxSrcEl.textContent = "기준 " + fxClock(data.at) + " · " + (data.source || "공개 환율 API");
    if (fxNoteEl) {
      fxNoteEl.classList.remove("is-warn");
      fxNoteEl.textContent = "해외 시세(PSA·eBay·SNKRDUNK)를 원화로 환산할 때 참고하세요. 10분마다 새로 받습니다.";
    }
    fxCalcSetRates(data);
  }
  function fxFail(msg) {
    if (fxUsdEl) fxUsdEl.textContent = "불러오지 못함";
    if (fxJpyEl) fxJpyEl.textContent = "불러오지 못함";
    fxCardEls.forEach(function (c) { c.classList.add("is-error"); });
    if (fxSrcEl) fxSrcEl.textContent = "환율 조회 실패";
    if (fxNoteEl) {
      fxNoteEl.classList.add("is-warn");
      fxNoteEl.textContent = msg || "환율을 불러오지 못했습니다. 잠시 후 '새로고침'을 눌러 주세요.";
    }
    fxCalcSetRates(null);
  }
  function fxFromCache(force) {
    if (force) return null;
    try {
      var raw = sessionStorage.getItem(FX_CACHE_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.at || Date.now() - d.at > FX_TTL) return null;
      return d;
    } catch (e) { return null; }
  }
  function fxSave(data) {
    try { sessionStorage.setItem(FX_CACHE_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function fxFetch(force) {
    var cached = fxFromCache(force);
    if (cached) { fxPaint(cached); return; }
    if (fxSrcEl) fxSrcEl.textContent = "불러오는 중…";
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : null;
    var opts = { cache: "no-store" };
    if (ctrl) opts.signal = ctrl.signal;
    fetch("https://open.er-api.com/v6/latest/USD", opts)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (d) {
        var rates = (d && d.rates) || {};
        var usd = Number(rates.KRW);
        var jpy = Number(rates.JPY);
        if (!isFinite(usd) || !isFinite(jpy) || jpy <= 0) throw new Error("rates-missing");
        var at = Number(d && d.time_last_update_unix) ? Number(d.time_last_update_unix) * 1000 : Date.now();
        var data = { usdKrw: usd, jpy100: (usd / jpy) * 100, at: at, source: "open.er-api.com" };
        fxSave(data);
        fxPaint(data);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        /* 대체 소스 — jsDelivr currency-api */
        return fetch("https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json", { cache: "no-store" })
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(function (d) {
            var u = (d && d.usd) || {};
            var usd = Number(u.krw);
            var jpy = Number(u.jpy);
            if (!isFinite(usd) || !isFinite(jpy) || jpy <= 0) throw new Error("rates-missing");
            var at = d && d.date ? new Date(d.date + "T00:00:00Z").getTime() : Date.now();
            var data = { usdKrw: usd, jpy100: (usd / jpy) * 100, at: at, source: "currency-api" };
            fxSave(data);
            fxPaint(data);
          });
      })
      .catch(function () { fxFail(); })
      .finally(function () { if (timer) clearTimeout(timer); });
  }
  function initFx() {
    if (!fxUsdEl && !fxJpyEl) return;
    fxFetch(false);
    if (fxRefreshEl) {
      fxRefreshEl.addEventListener("click", function () {
        fxRefreshEl.disabled = true;
        fxFetch(true);
        setTimeout(function () { fxRefreshEl.disabled = false; }, 1200);
      });
    }
  }

  /* ------------------------ 해외직구 카드값 원화 · 관부가세 계산기 */
  /* 위 환율 위젯이 받은 USD/KRW · 100JPY/KRW 를 그대로 쓴다. 환율을 못 받으면 계산하지 않고 그렇다고 적는다.
     · 면세 판정은 '물품가격(국제배송비 제외)'을 미화로 환산해 일본 $150 / 미국 $200 과 비교한다.
     · 한도를 넘으면 과세가격(상품가 + 국제배송비) 전체에 관세 8%(원산지 인정 시 0%) + 부가세 10% 를 더한다.
     · 실제 통관은 관세청 고시환율·HS코드에 따라 다르므로 화면에도 '참고용'이라고 적는다. */
  var FX_FREE_LIMIT = { JPY: 150, USD: 200 };
  var FX_CALC_CUR = { JPY: { unit: "엔", toKrw: function (v, r) { return v * r.jpy100 / 100; },
    toUsd: function (v, r) { return v * r.jpy100 / (100 * r.usdKrw); } },
    USD: { unit: "$", toKrw: function (v, r) { return v * r.usdKrw; },
    toUsd: function (v) { return v; } } };
  var FX_CALC_HINT = {
    JPY: "일본 직구는 물품가 <b>$150 이하</b>까지 면세입니다. 한도를 넘으면 카드값과 배송비 전체에 관세·부가세가 붙습니다.",
    USD: "미국 직구는 물품가 <b>$200 이하</b>까지 면세(목록통관)입니다. 한미 FTA 원산지가 인정되면 관세율을 0%로 고르세요."
  };
  var fxCalcRateEl = $("#fxCalcRate");
  var fxCalcOutEl = $("#fxCalcOut");
  var fxCalcHintEl = $("#fxCalcHint");
  var fxPriceEl = $("#fxPrice");
  var fxShipEl = $("#fxShip");
  var fxDutyEl = $("#fxDutyRate");
  var fxPriceLabelEl = $("#fxPriceLabel");
  var fxShipLabelEl = $("#fxShipLabel");
  var fxCurBtns = $$("[data-fxcur]");
  var fxCalcCur = "JPY";
  var fxCalcRates = null;
  var fxCalcFailed = false;

  function fxParseNum(v) {
    var m = String(v == null ? "" : v).replace(/,/g, "").match(/\d+(\.\d+)?/);
    return m ? Number(m[0]) : 0;
  }
  function fxWon(n) {
    if (!isFinite(n) || n <= 0) return "0원";
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
  }
  function fxUsd(n) {
    return "$" + fxNum(n, 2);
  }
  function fxCalcCurSet(cur) {
    if (!FX_CALC_CUR[cur]) return;
    fxCalcCur = cur;
    fxCurBtns.forEach(function (b) {
      var on = b.getAttribute("data-fxcur") === cur;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var unit = FX_CALC_CUR[cur].unit;
    if (fxPriceLabelEl) fxPriceLabelEl.textContent = "카드 가격 (" + unit + ")";
    if (fxShipLabelEl) fxShipLabelEl.textContent = "국제 배송비 (" + unit + ", 선택)";
    if (fxPriceEl) fxPriceEl.setAttribute("placeholder", cur === "JPY" ? "예: 25,000" : "예: 180");
    if (fxCalcHintEl) fxCalcHintEl.innerHTML = FX_CALC_HINT[cur];
    fxCalcRender();
  }
  function fxCalcRender() {
    if (!fxCalcOutEl) return;
    var price = fxParseNum(fxPriceEl && fxPriceEl.value);
    var ship = fxParseNum(fxShipEl && fxShipEl.value);
    if (!fxCalcRates) {
      fxCalcOutEl.innerHTML = fxCalcFailed
        ? '<p class="fx-calc-empty">환율을 불러오지 못해 계산할 수 없습니다. 위 <b>새로고침</b>을 한 번 눌러 주세요.</p>'
        : '<p class="fx-calc-empty">환율을 불러오는 중입니다… 금액을 넣어두면 환율이 도착하는 대로 바로 계산됩니다.</p>';
      return;
    }
    if (!(price > 0)) {
      fxCalcOutEl.innerHTML = '<p class="fx-calc-empty">카드 가격을 넣으면 원화 금액과 관부가세를 바로 계산합니다.</p>';
      return;
    }
    var conv = FX_CALC_CUR[fxCalcCur];
    var priceKrw = conv.toKrw(price, fxCalcRates);
    var shipKrw = ship > 0 ? conv.toKrw(ship, fxCalcRates) : 0;
    var priceUsd = conv.toUsd(price, fxCalcRates);
    var limit = FX_FREE_LIMIT[fxCalcCur];
    var taxed = priceUsd > limit + 1e-9;
    var taxable = priceKrw + shipKrw;
    var dutyRate = fxDutyEl ? Number(fxDutyEl.value) : 0.08;
    if (!isFinite(dutyRate) || dutyRate < 0) dutyRate = 0.08;
    var duty = taxed ? taxable * dutyRate : 0;
    var vat = taxed ? (taxable + duty) * 0.1 : 0;
    var total = taxable + duty + vat;
    var pctLabel = Math.round(dutyRate * 1000) / 10;

    var verdict = taxed
      ? '<div class="fx-verdict is-taxed">한도 초과 · 과세 대상<small>물품가 ' + fxUsd(priceUsd) + ' · 한도 ' + fxUsd(limit) + ' 초과 ' + fxUsd(priceUsd - limit) + '</small></div>'
      : '<div class="fx-verdict is-free">면세 한도 안 · 관세·부가세 0원<small>물품가 ' + fxUsd(priceUsd) + ' · 한도 ' + fxUsd(limit) + ' 이하</small></div>';

    var rows = '';
    rows += '<div class="fx-row"><span class="fx-row-label">상품가</span><span class="fx-row-val">' + fxWon(priceKrw) + '</span></div>';
    rows += '<div class="fx-row"><span class="fx-row-label">국제 배송비</span><span class="fx-row-val">' + fxWon(shipKrw) + '</span></div>';
    rows += '<div class="fx-row is-sum"><span class="fx-row-label">원화 카드값 (상품 + 배송)</span><span class="fx-row-val">' + fxWon(taxable) + '</span></div>';
    rows += '<div class="fx-row' + (taxed ? '' : ' is-zero') + '"><span class="fx-row-label">예상 관세 (' + pctLabel + '%)</span><span class="fx-row-val">' + (taxed ? fxWon(duty) : '0원 (면세)') + '</span></div>';
    if (taxed) rows += '<div class="fx-row is-sub"><span class="fx-row-label">과세가격 × ' + pctLabel + '%</span><span class="fx-row-val">' + fxWon(taxable) + '</span></div>';
    rows += '<div class="fx-row' + (taxed ? '' : ' is-zero') + '"><span class="fx-row-label">예상 부가세 (10%)</span><span class="fx-row-val">' + (taxed ? fxWon(vat) : '0원 (면세)') + '</span></div>';
    if (taxed) rows += '<div class="fx-row is-sub"><span class="fx-row-label">(과세가격 + 관세) × 10%</span><span class="fx-row-val">' + fxWon(taxable + duty) + '</span></div>';

    fxCalcOutEl.innerHTML = verdict + '<div class="fx-out-rows">' + rows + '</div>' +
      '<div class="fx-total"><span class="fx-total-label">최종 예상 총액</span><span class="fx-total-val">' + fxWon(total) + '</span></div>';
  }
  function fxCalcSetRates(data) {
    var usd = data && Number(data.usdKrw);
    var jpy100 = data && Number(data.jpy100);
    if (isFinite(usd) && isFinite(jpy100) && usd > 0 && jpy100 > 0) {
      fxCalcRates = { usdKrw: usd, jpy100: jpy100 };
      fxCalcFailed = false;
      if (fxCalcRateEl) {
        fxCalcRateEl.classList.remove("is-warn");
        fxCalcRateEl.textContent = "적용 환율 1 USD = " + fxNum(usd, 2) + "원 · 100 JPY = " + fxNum(jpy100, 1) + "원";
      }
    } else {
      fxCalcRates = null;
      fxCalcFailed = true;
      if (fxCalcRateEl) {
        fxCalcRateEl.classList.add("is-warn");
        fxCalcRateEl.textContent = "환율 조회 실패";
      }
    }
    fxCalcRender();
  }
  function initFxCalc() {
    if (!fxCalcOutEl) return;
    fxCalcFailed = false;
    fxCalcCurSet("JPY");
    fxCurBtns.forEach(function (b) {
      b.addEventListener("click", function () {
        fxCalcCurSet(b.getAttribute("data-fxcur"));
        trackEvent("fx_calc", { currency: fxCalcCur, duty_rate: fxDutyEl ? fxDutyEl.value : "" });
      });
    });
    [fxPriceEl, fxShipEl].forEach(function (el) {
      if (!el) return;
      el.addEventListener("input", fxCalcRender);
      el.addEventListener("change", fxCalcRender);
    });
    if (fxDutyEl) {
      fxDutyEl.addEventListener("change", function () {
        fxCalcRender();
        trackEvent("fx_calc", { currency: fxCalcCur, duty_rate: fxDutyEl.value });
      });
    }
  }

  /* --------------- 시세·거래가 바로가기 (PSA · 크림 · 스니커덩크 · 130point · PriceCharting · eBay) */
  /* 검색창은 두지 않는다. 각 버튼의 주소는 index.html 의 href 에 있고(사이트별 포켓몬 카드 화면으로 바로 이동),
     여기서는 클릭 통계만 남긴다. 이 사이트는 어떤 결제 화면도 열지 않는다. */
  function initMarketTools() {
    $$("[data-market]").forEach(function (a) {
      a.addEventListener("click", function () { trackEvent("market_lookup", { target: a.getAttribute("data-market") }); });
    });
  }
  function jumpToMarket() {
    var navBtn = document.querySelector('.main-nav [data-tab="guide"]') || document.querySelector('[data-tab="guide"]');
    if (navBtn) navBtn.click();
    var target = document.getElementById("marketTools");
    if (target) {
      setTimeout(function () {
        target.scrollIntoView({ block: "start", behavior: "smooth" });
      }, 120);
    }
  }
  var popToMarketEl = $("#popToMarket");
  if (popToMarketEl) popToMarketEl.addEventListener("click", jumpToMarket);

  /* ------------------------------------------- 세트별 정가·리셀 검색 */
  var setSearchForm = $("#setSearchForm");
  var setSearchEl = $("#setSearch");
  var setSearchResult = $("#setSearchResult");
  var BUNJANG_SEARCH = "https://m.bunjang.co.kr/search/products?q=";

  function setResellLinks(s) {
    var kw = (s.short || s.name || "") + " 박스";
    var kream = "https://kream.co.kr/search?keyword=" + encodeURIComponent(kw);
    var bunjang = BUNJANG_SEARCH + encodeURIComponent(kw);
    var pc = (POP_TOOLS.pricecharting || "https://www.pricecharting.com/search-products?q=") +
      encodeURIComponent(s.short || s.name || "") + "&type=prices";
    return '<div class="set-resell-links">' +
      '<a href="' + kream + '" target="_blank" rel="noopener">KREAM 리셀 ↗</a>' +
      '<a href="' + bunjang + '" target="_blank" rel="noopener">번개장터 ↗</a>' +
      '<a href="' + pc + '" target="_blank" rel="noopener">PriceCharting ↗</a>' +
      '</div>';
  }
  function renderSetSearch(raw) {
    if (!setSearchResult) return;
    var q = String(raw || "").trim().toLowerCase();
    if (!q) {
      setSearchResult.innerHTML = "";
      return;
    }
    var hits = SETS.filter(function (s) {
      return (String(s.short) + " " + String(s.name) + " " + String(s.code) + " " + String(s.series)).toLowerCase().indexOf(q) >= 0;
    }).slice(0, 6);
    if (!hits.length) {
      setSearchResult.innerHTML = '<p class="set-search-empty">\u201c' + escapeHtml(raw) + '\u201d에 맞는 세트가 없습니다. 세트 이름 일부(예: 어비스, 블랙)로 다시 검색해 보세요.</p>';
      return;
    }
    setSearchResult.innerHTML = hits.map(function (s) {
      var box = s.boxPrice ? won(s.boxPrice) : "-";
      var pack = s.packPrice ? won(s.packPrice) : "-";
      return '<article class="set-search-card">' +
        '<div class="ssc-head"><span class="ssc-code">' + escapeHtml(s.code || "") + ' · ' + escapeHtml(s.series || "") + '</span>' +
          '<h3>' + escapeHtml(s.short || s.name) + '</h3></div>' +
        '<dl class="ssc-grid">' +
          '<div><dt>공식 정가</dt><dd>' + pack + ' / 1박스 ' + box + '</dd></div>' +
          '<div><dt>구성</dt><dd>1팩 ' + escapeHtml(String(s.cardsPerPack || "-")) + '장 · 1박스 ' + escapeHtml(String(s.packsPerBox || "-")) + '팩</dd></div>' +
          '<div><dt>발매일</dt><dd>' + escapeHtml(s.release || "-") + '</dd></div>' +
        '</dl>' +
        setResellLinks(s) +
        '<div class="ssc-actions"><button type="button" class="btn btn-ghost btn-sm" data-set-open="' + escapeHtml(s.id) + '">이 세트 도감·정가 비교 보기</button></div>' +
      '</article>';
    }).join("");
    $$("[data-set-open]", setSearchResult).forEach(function (b) {
      b.addEventListener("click", function () {
        selectSet(b.getAttribute("data-set-open"));
        var target = document.getElementById("setSummary");
        if (target && target.scrollIntoView) target.scrollIntoView({ block: "start", behavior: "smooth" });
      });
    });
  }
  function initSetSearch() {
    if (!setSearchForm) return;
    setSearchForm.addEventListener("submit", function (e) {
      e.preventDefault();
      renderSetSearch(setSearchEl ? setSearchEl.value : "");
      trackEvent("set_search", { q_len: (setSearchEl && setSearchEl.value || "").trim().length });
    });
  }

  /* -------------------------------------- 일정·소식 서브탭 (일정/뉴스) */
  function initSubTabs() {
    var btns = $$(".sub-tab");
    if (!btns.length) return;
    btns.forEach(function (b) {
      b.addEventListener("click", function () {
        var key = b.getAttribute("data-subtab");
        btns.forEach(function (o) {
          var on = o.getAttribute("data-subtab") === key;
          o.classList.toggle("is-active", on);
          o.setAttribute("aria-selected", on ? "true" : "false");
        });
        [["cal", "subtabCal"], ["news", "subtabNews"], ["collab", "subtabCollab"]].forEach(function (pair) {
          var panel = document.getElementById(pair[1]);
          if (panel) panel.hidden = pair[0] !== key;
        });
        trackEvent("schedule_subtab", { tab: key });
      });
    });
  }

  /* --------------------------------------------------------------- 초기화 */
  buildCalendar();
  buildScheduleFold();
  renderSetNav();
  renderSetSummary();
  renderCompare();
  renderRarityChips();
  renderDex();
  runCalc();
  renderBoxPicker();
  renderBoxBoard();
  renderIssues();
  renderReleases();
  initPop();
  initSetSearch();
  initSubTabs();
  initFx();
  initFxCalc();
  initMarketTools();

  /* #stores·#boxStores는 「정가 구매처」 탭의 짧은 주소로 같이 받아 줍니다. */
  function tabOfHash(h) {
    if (h === "stores" || h === "boxStores") return "home";
    if (h === "cards") return "guide";
    if (h === "pop") return "trends";
    if (h === "issues" || h === "releases") return "schedule";
    return panels[h] ? h : "";
  }

  var hash = (location.hash || "").replace("#", "");
  var hashTab = tabOfHash(hash);
  if (hashTab) {
    showTab(hashTab, { keepScroll: true });
    if (hash === "boxStores") {
      var boxAnchor = document.getElementById("boxStores");
      if (boxAnchor && boxAnchor.scrollIntoView) {
        setTimeout(function () { boxAnchor.scrollIntoView({ block: "start" }); }, 60);
      }
    }
  } else {
    /* v2: 첫 화면 = 동네 찾기(실제 지도) */
    showTab("map", { keepScroll: true });
  }

  window.addEventListener("hashchange", function () {
    var h = tabOfHash((location.hash || "").replace("#", ""));
    if (h && h !== currentTab) showTab(h, { keepScroll: true });
  });
})();
