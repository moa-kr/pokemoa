/* =========================================================================
   GS25 팜사이즈 원더 피규어 (2026-11-20 출시 · 총 20종 랜덤 · 개당 5,800원)

   · 첫 방문 안내 팝업 — GS25 공식 판매 이미지 + 출시 정보 + ‘바로 재고 찾기’
     (오늘 하루 보지 않기 / 닫기, 닫은 뒤에는 오른쪽 아래 ‘다시 보기’ 버튼)
   · 「동네에서 찾기」 탭의 상품 전환 — 포켓몬 카드 ↔ 팜사이즈 원더 피규어
   · 피규어를 고르면 중계 서버로 주변 GS25 의 1·2·3탄 실재고를 받아 지도·매장 목록에 그대로 얹습니다.
     중계 v2.2 부터는 상품 지정 3km 격자(/api/gs25-grid)로 조회하고, 태블릿이 아직 v2.1 이라
     그 경로가 404 면 예전 상품 지정 조회(/api/gs25?item=)로 조용히 물러납니다(1km).
   · 도감·시세 탭의 세트 검색에서도 이름·키워드로 찾히도록 결과를 덧붙입니다.

   중계 v2.1 의 /api/nearby 는 GS25 상품을 카드 상품만 골라 내므로(피규어는 빠짐)
   피규어는 상품코드로 바로 묻는 경로를 씁니다. v2.2 의 /api/gs25-grid 는 카드 조회와 같은
   3km 격자(중심 + 내링·외링 8방위 17지점)를 돌아 점포별 수량을 매장코드로 합쳐 줍니다.
   ========================================================================= */
(function () {
  "use strict";

  var D = window.POKEMOA_DATA || {};
  var F = D.figure;
  if (!F) return;

  var POPUP_KEY = "moa:figure:palm-size-until";   /* ‘오늘 하루 보지 않기’ 만료 시각(ms) */
  var RELAY_KEY = "pokemoa.relayUrl";             /* app.js 와 같은 저장 키 */
  var QUERY_TTL = 120000;                         /* 같은 자리 재조회는 2분에 한 번 */
  var GRID_TIMEOUT = 32000;                       /* 3km 격자는 27초까지 걸린다 — 사이트 타임아웃과 같게 */
  var LEGACY_TIMEOUT = 25000;

  var state = {
    mode: "card",
    requested: false,     /* ?figure=1 로 열렸는지 */
    popupEl: null,
    popupCfg: null,
    reopenEl: null,
    lastFocus: null,
    busy: false,
    lastAt: 0,
    lastKey: "",
    lastPayload: null,        /* 마지막 성공 응답 — 지도를 다시 그려도 같은 자리면 그대로 다시 얹는다 */
    lastStatusHtml: "",
    lastStatusKind: "",
    lastSummary: "",
    clearedBySearch: false,   /* 방금 지도 재조회로 clearRelay() 가 돌았는지 */
    brandBefore: "all",
    sideTitle: ""
  };

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function won(n) {
    var v = Number(n);
    if (!isFinite(v)) return String(n || "");
    return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "원";
  }
  function hhmm(date) {
    var d = date || new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function track(name, params) {
    try { if (window.gtag) window.gtag("event", name, params || {}); } catch (e) {}
  }

  /* ------------------------------------- 피규어 재고 조회 진행률(#figureProgress) */
  /* 카드 모드의 4사 진행률 패널은 피규어 모드에서 숨긴다(CSS). 그 자리를 이 패널이 맡아
     '매장 찾는 중 → GS25 3km 격자(17지점 · 1·2·3탄) 재고 조회 중 → 완료'를
     스피너·진행 바·%로 보여 준다.
     지도 툴바의 ‘선택 지역 찾기’·‘내 위치로 찾기’는 패널보다 아래에 있어 조회가 도는 줄
     모르고 기다리게 되므로, 조회를 시작하면 sticky 헤더 바로 아래로 끌어온다(v=110 카드 모드와 같은 방식). */
  var pg = {
    el: null, title: null, note: null, pct: null, bar: null, fill: null,
    value: 0, stage: "idle", ticker: null, hideTimer: null, scrollTimer: null, wired: false
  };

  function pgEnsure() {
    if (!pg.wired) {
      pg.wired = true;
      pg.el = $("#figureProgress");
      pg.title = $("#figureProgressTitle");
      pg.note = $("#figureProgressNote");
      pg.pct = $("#figureProgressPct");
      pg.bar = $("#figureProgressBar");
      pg.fill = $("#figureProgressFill");
    }
    return pg.el ? pg : null;
  }
  function pgVisible() { return !!(pg.el && !pg.el.hidden); }
  function pgPaint() {
    if (!pg.el) return;
    var v = Math.max(0, Math.min(100, Math.round(pg.value)));
    if (pg.fill) pg.fill.style.width = v + "%";
    if (pg.pct) pg.pct.textContent = v + "%";
    if (pg.bar) pg.bar.setAttribute("aria-valuenow", String(v));
  }
  function pgStopTicker() { if (pg.ticker) { clearInterval(pg.ticker); pg.ticker = null; } }
  function pgTicker(max) {
    pgStopTicker();
    pg.ticker = setInterval(function () {
      if (!pgVisible()) { pgStopTicker(); return; }
      if (pg.value >= max) { pgStopTicker(); return; }
      pg.value = Math.min(max, pg.value + 1);
      pgPaint();
    }, 380);
  }
  function pgShow(st, note, from, max, stage) {
    if (!pgEnsure()) return;
    if (!isActive()) return;
    clearTimeout(pg.hideTimer);
    pg.el.hidden = false;
    pg.el.setAttribute("data-state", st || "running");
    if (typeof from === "number") pg.value = from;
    if (note != null && pg.note) pg.note.textContent = note;
    if (pg.title) pg.title.textContent = "GS25 피규어 재고 조회";
    if (stage) pg.stage = stage;
    pgPaint();
    if (st !== "done" && st !== "error") pgTicker(typeof max === "number" ? max : 88);
  }
  function pgDone(note) {
    if (!pgEnsure()) return;
    /* 조회 중에 카드 모드로 돌아갔으면 피규어 패널을 다시 띄우지 않는다 */
    if (!isActive()) { hideProgress(); return; }
    pgStopTicker();
    pg.value = 100;
    pg.stage = "done";
    pg.el.hidden = false;
    pg.el.setAttribute("data-state", "done");
    if (note != null && pg.note) pg.note.textContent = note;
    if (pg.title) pg.title.textContent = "GS25 피규어 재고 조회 완료";
    pgPaint();
    clearTimeout(pg.hideTimer);
    pg.hideTimer = setTimeout(hideProgress, 4200);
  }
  function pgFail(note) {
    if (!pgEnsure()) return;
    if (!isActive()) { hideProgress(); return; }
    pgStopTicker();
    pg.value = 100;
    pg.stage = "error";
    pg.el.hidden = false;
    pg.el.setAttribute("data-state", "error");
    if (note != null && pg.note) pg.note.textContent = note;
    if (pg.title) pg.title.textContent = "GS25 피규어 재고 조회";
    pgPaint();
    clearTimeout(pg.hideTimer);
    pg.hideTimer = setTimeout(hideProgress, 6000);
  }
  function hideProgress() {
    pgStopTicker();
    clearTimeout(pg.hideTimer);
    clearTimeout(pg.scrollTimer);
    pg.stage = "idle";
    if (pg.el) pg.el.hidden = true;
  }
  function pgScrollIntoView(delay) {
    if (!pgEnsure()) return;
    clearTimeout(pg.scrollTimer);
    pg.scrollTimer = setTimeout(function () {
      if (!pgVisible() || typeof pg.el.scrollIntoView !== "function") return;
      /* sticky 헤더 높이는 공지 배너가 붙으면 커진다 — 지금 높이를 재서 헤더 바로 아래로 맞춘다 */
      var header = document.querySelector(".site-header");
      var headerH = header && header.getBoundingClientRect ? Math.round(header.getBoundingClientRect().height) : 0;
      if (headerH > 0) pg.el.style.scrollMarginTop = (headerH + 12) + "px";
      var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
      try {
        pg.el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      } catch (e) {
        try { pg.el.scrollIntoView(); } catch (e2) {}
      }
    }, typeof delay === "number" ? delay : 80);
  }

  /* ---------------------------------------------------------- 저장 값 */
  function dismissedUntil() {
    try { return Number(localStorage.getItem(POPUP_KEY)) || 0; } catch (e) { return 0; }
  }
  function dismissToday() {
    var d = new Date();
    d.setHours(24, 0, 0, 0);   /* 오늘 하루 = 자정까지 */
    try { localStorage.setItem(POPUP_KEY, String(d.getTime())); } catch (e) {}
  }
  function relayUrl() {
    var saved = "";
    try { saved = localStorage.getItem(RELAY_KEY) || ""; } catch (e) {}
    var preset = (D.relayPreset && D.relayPreset.url) || "";
    return String(saved || preset || "").replace(/\/+$/, "");
  }

  /* ------------------------------------------------------ 시리즈 목록 채우기 */
  function seriesListHtml(kind) {
    return (F.series || []).map(function (s) {
      var lineup = (s.lineup || []).join(" · ");
      if (kind === "promo") {
        return '<li>' +
          '<img src="' + esc(s.image) + '" alt="팜사이즈 원더 ' + s.no + '탄 상품 이미지" width="40" height="40" loading="lazy">' +
          '<span class="fp-s-no">' + s.no + '탄</span>' +
          '<span class="fp-s-lineup"><b>' + s.count + '종</b> — ' + esc(lineup) + '</span>' +
          '</li>';
      }
      if (kind === "modal") {
        return '<li><img src="' + esc(s.image) + '" alt="" width="30" height="30" loading="lazy">' +
          '<b>' + s.no + '탄</b><span>' + s.count + '종 · ' + esc(lineup) + '</span></li>';
      }
      return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener" title="우리동네GS ' + s.no + '탄 상품 페이지">' +
        '<img src="' + esc(s.image) + '" alt="" width="38" height="38" loading="lazy">' +
        '<span><b>팜사이즈 ' + s.no + '탄 <span class="fs-count">' + s.count + '종</span></b>' +
        '<span>' + esc(lineup) + '</span></span></a></li>';
    }).join("");
  }

  function fillSeries() {
    var strip = $("#figureSeries");
    if (strip) strip.innerHTML = seriesListHtml("strip");
    var promo = $("#figurePromoSeries");
    if (promo) promo.innerHTML = seriesListHtml("promo");
  }

  /* ================================================================ 팝업 */
  /* 어드민(모아 어드민 ① 팝업 관리)이 켜고 끄고 문구를 고치는 안내 팝업.
     site-config.json 의 figurePopup 을 그대로 읽되, 값이 없으면 지금까지의 화면
     (켜짐 · 첫 방문 자동 열기 · 닫은 뒤 우하단 ‘다시 보기’)을 기본값으로 쓴다. */
  var POPUP_DEFAULTS = {
    enabled: true,
    autoOpen: true,
    floating: true,
    floatingLabel: "팜사이즈 원더 안내",
    badge: "GS25 NEW · 2026.11.20",
    eyebrow: "GS25 신상 · 총 " + F.totalCount + "종 랜덤",
    title: "포켓몬스터 팜사이즈 원더 피규어",
    body: F.summary || "",
    buttonLabel: "바로 재고 찾기",
    buttonAction: "stock",
    buttonValue: "",
    dismissToday: true,
    startDate: "",
    endDate: ""
  };
  var POPUP_BOOLS = { enabled: 1, autoOpen: 1, floating: 1, dismissToday: 1 };
  var POPUP_ACTIONS = { stock: 1, tab: 1, url: 1, close: 1 };
  var popupSig = "";
  var popupTimer = 0;

  function boolOf(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string") return !/^(false|0|off|no)$/i.test(value.trim());
    return Boolean(value);
  }

  function rawPopupConfig() {
    var api = window.MoaSiteConfig;
    var cfg = api && api.config;
    var raw = cfg && cfg.figurePopup;
    return raw && typeof raw === "object" ? raw : null;
  }

  function popupCfg() {
    var raw = rawPopupConfig();
    var out = {};
    Object.keys(POPUP_DEFAULTS).forEach(function (key) {
      var fallback = POPUP_DEFAULTS[key];
      var value = raw ? raw[key] : undefined;
      if (POPUP_BOOLS[key]) { out[key] = boolOf(value, fallback); return; }
      out[key] = value == null ? fallback : String(value);
    });
    if (!out.title.replace(/\s/g, "")) out.title = POPUP_DEFAULTS.title;
    if (!out.buttonLabel.replace(/\s/g, "")) out.buttonLabel = POPUP_DEFAULTS.buttonLabel;
    if (!POPUP_ACTIONS[out.buttonAction]) out.buttonAction = "stock";
    out.startDate = String(out.startDate || "").slice(0, 10);
    out.endDate = String(out.endDate || "").slice(0, 10);
    return out;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function isPreviewFrame() {
    try {
      if (window.MoaSiteConfig && window.MoaSiteConfig.state && window.MoaSiteConfig.state.preview) return true;
      return document.documentElement.classList.contains("moa-preview-mode");
    } catch (e) { return false; }
  }

  function inPopupPeriod(p) {
    if (isPreviewFrame()) return true;   /* 미리보기는 기간 밖이어도 그대로 보여 준다 */
    var iso = todayISO();
    if (p.startDate && iso < p.startDate) return false;
    if (p.endDate && iso > p.endDate) return false;
    return true;
  }

  function popupButtonHtml(p) {
    var label = esc(p.buttonLabel);
    if (p.buttonAction === "url" && /^https?:\/\//i.test(p.buttonValue)) {
      return '<a class="fg-btn-primary" href="' + esc(p.buttonValue) + '" target="_blank" rel="noopener"' +
        ' data-moa-focus=\'{"kind":"figurePopup","key":"buttonLabel"}\'>' + label + '</a>';
    }
    return '<button type="button" class="fg-btn-primary" data-fg-action="' + esc(p.buttonAction) + '"' +
      ' data-moa-focus=\'{"kind":"figurePopup","key":"buttonLabel"}\'>' + label + '</button>';
  }

  function popupHtml(p) {
    var badge = p.badge ? '<span class="fg-flag">' + esc(p.badge) + '</span>' : "";
    var eyebrow = p.eyebrow ? '<p class="fg-eyebrow">' + esc(p.eyebrow) + '</p>' : "";
    var today = p.dismissToday
      ? '<label><input type="checkbox" data-fg-today> 오늘 하루 보지 않기</label>'
      : '<span aria-hidden="true"></span>';
    return '' +
      '<div class="fg-modal" role="document">' +
        '<div class="fg-hero">' +
          '<button type="button" class="fg-close" data-fg-close aria-label="안내 팝업 닫기">✕</button>' +
          '<img src="' + esc(F.image) + '" alt="' + esc(F.imageAlt) + '" width="' + (F.imageWidth || 600) + '" height="' + (F.imageHeight || 736) + '">' +
          badge +
        '</div>' +
        '<div class="fg-body">' +
          eyebrow +
          '<h2 id="fgPopupTitle" data-moa-focus=\'{"kind":"figurePopup","key":"title"}\'>' + esc(p.title) + '</h2>' +
          '<p class="fg-desc" data-moa-focus=\'{"kind":"figurePopup","key":"body"}\'>' + esc(p.body) + '</p>' +
          '<ul class="fg-facts">' +
            '<li><span>가격</span><b>' + esc(F.priceLabel) + '</b></li>' +
            '<li><span>출시</span><b>' + esc(F.releaseLabel) + '</b></li>' +
            '<li><span>판매</span><b>전국 GS25</b></li>' +
          '</ul>' +
          '<ul class="fg-series">' + seriesListHtml("modal") + '</ul>' +
          '<div class="fg-actions">' +
            popupButtonHtml(p) +
            '<a class="fg-btn-ghost" href="' + esc(F.productUrl) + '" target="_blank" rel="noopener">우리동네GS 공식 상품 보기 ↗</a>' +
          '</div>' +
          '<p class="fg-note">' + esc(F.periodNote) + ' 재고는 우리동네GS 앱·매장에서 확인하세요.<br>' + esc(F.sourceNote) + '</p>' +
          '<div class="fg-foot">' +
            today +
            '<button type="button" data-fg-close>닫기</button>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function openPopup() {
    if (state.popupEl) return;
    var p = state.popupCfg || popupCfg();
    state.popupCfg = p;
    var backdrop = document.createElement("div");
    backdrop.className = "fg-backdrop";
    backdrop.id = "fgPopup";
    backdrop.setAttribute("role", "dialog");
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("aria-labelledby", "fgPopupTitle");
    backdrop.innerHTML = popupHtml(p);
    state.lastFocus = document.activeElement;
    document.body.appendChild(backdrop);
    document.body.classList.add("no-scroll");
    state.popupEl = backdrop;

    backdrop.addEventListener("click", function (e) {
      if (e.target === backdrop) { closePopup(false); return; }
      if (e.target.closest("[data-fg-close]")) {
        var today = $("[data-fg-today]", backdrop);
        closePopup(!!(today && today.checked));
        return;
      }
      var actionEl = e.target.closest("[data-fg-action]");
      if (actionEl) {
        var action = actionEl.getAttribute("data-fg-action");
        var target = (state.popupCfg && state.popupCfg.buttonValue) || "";
        closePopup(false);
        if (action === "stock") { goStock(); return; }
        if (action === "tab") { activateTab(target); return; }
      }
    });
    document.addEventListener("keydown", onKeydown);
    /* 어드민 미리보기에서는 포커스를 가져오지 않는다 — 어드민 입력칸에서 타자를 이어갈 수 있게. */
    if (!isPreviewFrame()) {
      var closeBtn = $(".fg-close", backdrop);
      if (closeBtn) closeBtn.focus();
    }
    track("figure_popup_open", { product: F.id });
    hideReopen();
  }

  /* 버튼이 ‘탭 이동’일 때 — 사이트 로더가 있으면 그쪽 탭 열기를 쓰고, 없으면 직접 누른다. */
  function activateTab(id) {
    var value = String(id || "").trim();
    if (!value) return false;
    if (window.MoaSiteConfig && typeof window.MoaSiteConfig.activateTab === "function") {
      try { if (window.MoaSiteConfig.activateTab(value)) return true; } catch (e) {}
    }
    var tab = document.querySelector('[data-tab="' + value + '"],[data-nav="' + value + '"]');
    if (tab) { try { tab.click(); return true; } catch (e) {} }
    if (value.charAt(0) === "#") { try { location.hash = value.slice(1); return true; } catch (e) {} }
    return false;
  }

  function onKeydown(e) {
    if (!state.popupEl) return;
    if (e.key === "Escape") { e.preventDefault(); closePopup(false); return; }
    if (e.key !== "Tab") return;
    var focusables = $$("button, a[href], input", state.popupEl).filter(function (el) {
      return !el.disabled && el.offsetParent !== null;
    });
    if (!focusables.length) return;
    var first = focusables[0];
    var last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function closePopup(todayOff) {
    if (!state.popupEl) return;
    if (todayOff) dismissToday();
    state.popupEl.parentNode.removeChild(state.popupEl);
    state.popupEl = null;
    document.removeEventListener("keydown", onKeydown);
    document.body.classList.remove("no-scroll");
    if (state.lastFocus && state.lastFocus.focus) { try { state.lastFocus.focus(); } catch (e) {} }
    state.lastFocus = null;
    showReopen(state.popupCfg);
    track("figure_popup_close", { today_off: todayOff ? 1 : 0 });
  }

  function updateReopenLabel(p, btn) {
    var el = btn || state.reopenEl;
    if (!el) return;
    var span = el.querySelector("span");
    if (span) span.textContent = (p && p.floatingLabel) || POPUP_DEFAULTS.floatingLabel;
    el.setAttribute("aria-label", ((p && p.floatingLabel) || POPUP_DEFAULTS.floatingLabel) + " 다시 보기");
  }

  function showReopen(p) {
    var cfgPopup = p || popupCfg();
    if (!cfgPopup.floating) { hideReopen(); return; }
    if (state.reopenEl) {
      state.reopenEl.hidden = false;
      updateReopenLabel(cfgPopup);
      return;
    }
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "fg-reopen";
    btn.setAttribute("data-moa-focus", JSON.stringify({ kind: "figurePopup", key: "floatingLabel" }));
    btn.innerHTML = '<img src="' + esc(F.series[0].image) + '" alt="" width="30" height="30">' +
      '<span></span>';
    updateReopenLabel(cfgPopup, btn);
    btn.addEventListener("click", function () { openPopup(); });
    document.body.appendChild(btn);
    state.reopenEl = btn;
  }
  function hideReopen() {
    if (state.reopenEl) state.reopenEl.hidden = true;
  }
  function removeReopen() {
    if (state.reopenEl && state.reopenEl.parentNode) state.reopenEl.parentNode.removeChild(state.reopenEl);
    state.reopenEl = null;
  }

  /* 어드민 설정이 바뀔 때마다(저장본·미리보기 draft) 팝업과 다시 보기 버튼을 그 값에 맞춘다.
     - 꺼짐·기간 밖 : 팝업과 버튼을 모두 없앤다.
     - 미리보기     : 편집 중인 설정을 그대로 보여 주려고 항상 연다.
     - 자동 열기    : 첫 방문에 0.9초 뒤 연다(‘오늘 하루 보지 않기’가 살아 있으면 버튼만).
     - 자동 열기 끔 : 팝업을 열지 않고 ‘다시 보기’ 버튼으로만 열 수 있게 한다. */
  function setupPopupFromConfig(force) {
    var p = popupCfg();
    var sig = JSON.stringify(p);
    if (!force && sig === popupSig) return;
    popupSig = sig;
    state.popupCfg = p;
    clearTimeout(popupTimer);

    if (!p.enabled || !inPopupPeriod(p)) {
      if (state.popupEl) closePopup(false);
      removeReopen();
      return;
    }

    if (isPreviewFrame()) {
      /* 미리보기에서는 팝업을 닫았다 열지 않고 내용만 갈아 끼운다 — 어드민에서 타자를 이어갈 수 있게.
         팝업을 닫았을 때만 ‘다시 보기’ 버튼이 보이게 한다. */
      if (state.popupEl) state.popupEl.innerHTML = popupHtml(p);
      else openPopup();
      hideReopen();
      return;
    }

    if (state.popupEl) return;   /* 이미 보고 있는 팝업은 문구가 바뀌어도 그대로 둔다 */

    if (!p.autoOpen) {
      if (p.floating) showReopen(p); else hideReopen();
      return;
    }
    if (dismissedUntil() > Date.now()) {
      if (p.floating) showReopen(p); else hideReopen();
      return;
    }
    hideReopen();
    popupTimer = setTimeout(function () {
      /* 공통 첫 방문 팝업(site-config popup)이 떠 있으면 두 겹이 되지 않게 양보한다 */
      if (state.popupEl || document.querySelector(".moa-popup-backdrop")) return;
      openPopup();
    }, 900);
  }

  /* ====================================================== 상품 전환 · 재고 */
  function isActive() { return state.mode === "figure"; }

  function setMode(mode, opts) {
    opts = opts || {};
    var next = mode === "figure" ? "figure" : "card";
    if (next === state.mode && !opts.force) {
      if (next === "figure" && opts.scroll) scrollToStrip();
      return;
    }
    if (next === "figure" && state.mode !== "figure") {
      var st0 = mapState();
      state.brandBefore = (st0 && st0.brand) || "all";
    }
    state.mode = next;
    syncButtons();
    /* 카드(4사) 진행률 패널은 피규어 모드에서 의미가 없어 CSS 로 숨긴다 —
       hidden 속성을 건드리지 않아 카드 모드로 돌아오면 원래 상태 그대로 보인다. */
    document.body.classList.toggle("figure-mode", next === "figure");
    var strip = $("#figureStrip");
    if (strip) strip.hidden = next !== "figure";
    setSideTitle(next === "figure");
    /* 4사 현황 요약은 피규어 모드에서 GS25 카드만 남기므로(CSS) 읽어 주는 이름도 바꿔 준다 */
    var sumEl = $("#brandSummary");
    if (sumEl) {
      sumEl.setAttribute("aria-label", next === "figure" ? "GS25 매장·재고 현황" : "편의점 4사별 현황");
    }

    if (window.PokeMoaMap) {
      if (window.PokeMoaMap.closeCard) window.PokeMoaMap.closeCard();
      window.PokeMoaMap.clearRelay();
      window.PokeMoaMap.setBrand(next === "figure" ? "gs25" : (state.brandBefore || "all"));
      /* 이마트(대형마트) 실시간 재고는 카드 모드 전용 — 피규어 모드에서는 지우고,
         카드 모드로 돌아오면 현재 중심·반경으로 다시 조회한다(v=125). */
      if (next === "figure") {
        if (window.PokeMoaMap.clearEmart) window.PokeMoaMap.clearEmart();
      } else if (window.PokeMoaMap.refreshEmart) {
        window.PokeMoaMap.refreshEmart();
      }
    }
    /* 피규어 모드는 '가까운 거리순'이 읽기 쉽다 — 카드 모드의 정렬은 기억해 두었다가 돌려준다 */
    var sortEl = $("#sortSelect");
    if (sortEl) {
      if (next === "figure") {
        if (!state.sortBefore) state.sortBefore = sortEl.value || "stock";
        if (sortEl.value !== "distance") {
          sortEl.value = "distance";
          sortEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } else if (state.sortBefore && sortEl.value !== state.sortBefore) {
        sortEl.value = state.sortBefore;
        state.sortBefore = "";
        sortEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    if (next === "figure") {
      setStatus("주변 GS25 재고를 조회하는 중…", "busy");
      queryStock(true);
      if (opts.scroll) scrollToStrip();
    } else {
      setStatus("");
      hideProgress();
      var brief = $("#figureStockNote");
      if (brief) { brief.textContent = "주변 GS25 재고를 조회하려면 ‘재고 조회’를 눌러 주세요."; brief.className = "fs-status"; }
      /* 카드 재고를 다시 받는다 — app.js 가 이 이벤트에서 relayRefresh 를 예약한다 */
      document.dispatchEvent(new CustomEvent("pokemoa:loaded", { detail: { source: "figure-exit" } }));
    }
    track("figure_mode", { mode: next });
  }

  function syncButtons() {
    $$("#productPicker [data-product]").forEach(function (b) {
      var on = b.getAttribute("data-product") === state.mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function scrollToStrip() {
    var el = $("#figureStrip");
    if (!el || el.hidden) return;
    setTimeout(function () {
      try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { el.scrollIntoView(); }
    }, 80);
  }

  function setSideTitle(figure) {
    var el = $('[data-copy="mapSideTitle"]') || $(".map-side-head strong");
    if (!el) return;
    if (!state.sideTitle) state.sideTitle = el.textContent;
    el.textContent = figure ? "매장별 피규어 재고" : state.sideTitle;
  }

  function setStatus(html, kind) {
    var el = $("#figureStockNote");
    if (!el) return;
    /* 조회 결과는 <b> 강조를 섞어 쓰고, 바뀌는 값은 호출하는 쪽에서 escape 합니다 */
    el.innerHTML = html || "";
    el.className = "fs-status" + (kind ? " is-" + kind : "");
  }

  function mapState() {
    return (window.PokeMoaMap && window.PokeMoaMap.getState) ? window.PokeMoaMap.getState() : null;
  }

  /* 점포명 비교 — 앱 응답의 매장코드 접두(VNC93 …)와 브랜드 접두를 떼고 비교한다 */
  function normName(name) {
    return String(name || "")
      .trim()
      .replace(/^(gs25|지에스25|이마트24|emart24|세븐일레븐|cu)\s+/i, "")
      .replace(/^[a-z0-9]{4,6}\s+/i, "")
      .replace(/[\s\-_.,()\[\]{}·'"`]/g, "")
      .replace(/(지점|점)$/, "");
  }
  function normAddr(addr) {
    return String(addr || "").split(",")[0].replace(/[\s()]/g, "");
  }

  function findStore(all, name, address) {
    var target = normName(name);
    var addrKey = normAddr(address);
    var byName = null;
    var byAddr = null;
    for (var i = 0; i < all.length; i++) {
      var s = all[i];
      if (s.relay || s.brand !== "gs25" || s.offline) continue;
      var n = normName(s.name);
      if (target && n && n === target) return s;
      if (!byName && target && n && (n.indexOf(target) >= 0 || target.indexOf(n) >= 0)) byName = s;
      if (!byAddr && addrKey.length >= 10) {
        var a = normAddr(s.street);
        if (a && (a === addrKey || a.indexOf(addrKey) === 0 || addrKey.indexOf(a) === 0)) byAddr = s;
      }
    }
    return byName || byAddr;
  }

  /* 반경 — 지도의 1km / 3km 선택을 따른다(5km·20km 은 3km 로 묶는다).
     중계 v2.1(구버전)은 1km 한 곳만 보므로 그때는 실제 조회 반경도 1km 다. */
  function pickRadius(st) {
    var r = Number(st && st.radius) || 3000;
    return r <= 1500 ? 1000 : 3000;
  }
  function radiusText(m) {
    return Number(m) >= 2000 ? "3km" : "1km";
  }
  /* 진행률 패널에 쓰는 조회 단계 문구 — 지도의 3km/1km 선택을 그대로 따른다 */
  function gridNote(st) {
    return radiusText(pickRadius(st)) === "3km"
      ? "GS25 3km 격자(17지점 · 1·2·3탄) 재고 조회 중…"
      : "GS25 1km 격자 재고 조회 중…";
  }

  function fetchJson(url, ms) {
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms);
    return fetch(url, { signal: ctrl.signal, mode: "cors", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) {
          var err = new Error("HTTP " + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .finally(function () { clearTimeout(timer); });
  }

  /* 중계 v2.2 — 상품 지정 3km 격자(/api/gs25-grid). 1·2·3탄을 한 번에 묻는다. */
  function fetchGrid(url, lat, lng, radius) {
    var codes = (F.series || []).map(function (s) { return s.code; });
    var q = url + "/api/gs25-grid?lat=" + lat + "&lng=" + lng +
      "&radius=" + radius + "&items=" + encodeURIComponent(codes.join(","));
    return fetchJson(q, GRID_TIMEOUT).then(function (body) {
      if (!body || body.ok === false) throw new Error("grid-response");
      return { grid: true, body: body, radius: Number(body.radius) || radius };
    });
  }

  /* 중계 v2.1 이하 — 상품마다 /api/gs25?item= (지도 중심 한 곳 · 1km) */
  function fetchLegacy(url, lat, lng, radius) {
    var legacyRadius = Math.min(1500, Math.max(300, radius));
    var jobs = (F.series || []).map(function (s) {
      var q = url + "/api/gs25?lat=" + lat + "&lng=" + lng +
        "&item=" + encodeURIComponent(s.code) + "&radius=" + legacyRadius;
      return fetchJson(q, LEGACY_TIMEOUT)
        .then(function (body) { return { series: s, body: body }; })
        .catch(function (err) { return { series: s, error: err }; });
    });
    return Promise.all(jobs).then(function (results) {
      return { grid: false, results: results, radius: legacyRadius };
    });
  }

  function seriesFor(code, fallbackIndex) {
    var list = F.series || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].code) === String(code)) return list[i];
    }
    return list[fallbackIndex] || null;
  }

  /* 두 경로의 응답을 같은 모양 { byStore, sessionNeeded, notes, errors } 로 만든다 */
  function readGrid(body) {
    var byStore = {};
    (body.stores || []).forEach(function (row) {
      if (!row || !row.id) return;
      var rec = byStore[row.id] || (byStore[row.id] = {
        id: row.id, name: row.name || "", address: row.address || "",
        distanceM: Number(row.distanceM) || 0, items: []
      });
      (row.items || []).forEach(function (it) {
        var qty = Number(it && it.qty);
        if (!isFinite(qty)) return;
        var series = seriesFor(it.code, 0);
        rec.items.push({
          name: "팜사이즈 " + (series ? series.no : "?") + "탄",
          code: String(it.code || ""),
          qty: qty
        });
      });
    });
    return {
      byStore: byStore,
      sessionNeeded: !!(body.session && body.session.configured === false),
      notes: body.note ? [String(body.note)] : [],
      errors: [],
      points: (body.grid && body.grid.points) || 0
    };
  }

  function readLegacy(results) {
    var byStore = {};
    var errors = [];
    var notes = [];
    var sessionNeeded = false;
    results.forEach(function (r) {
      if (r.error) { errors.push((r.error && r.error.message) || String(r.error)); return; }
      var body = r.body || {};
      if (!body.ok) { errors.push("조회 서버 응답 오류"); return; }
      if (body.session && body.session.configured === false) sessionNeeded = true;
      if (body.note && /세션|오류/.test(String(body.note))) notes.push(String(body.note));
      (body.stores || []).forEach(function (row) {
        if (!row || !row.id) return;
        var rec = byStore[row.id] || (byStore[row.id] = {
          id: row.id, name: row.name || "", address: row.address || "",
          distanceM: Number(row.distanceM) || 0, items: []
        });
        (row.items || []).forEach(function (it) {
          var qty = Number(it && it.qty);
          if (!isFinite(qty)) return;
          rec.items.push({ name: "팜사이즈 " + r.series.no + "탄", code: String(it.code || r.series.code), qty: qty });
        });
      });
    });
    return { byStore: byStore, sessionNeeded: sessionNeeded, notes: notes, errors: errors, points: 0 };
  }

  function queryStock(manual) {
    if (!isActive()) return;
    if (state.busy) return;
    var st = mapState();
    var url = relayUrl();
    if (!st || !st.center) {
      setStatus("지도 매장 정보를 아직 불러오지 못했습니다. 지역을 고른 뒤 ‘재고 조회’를 눌러 주세요.", "error");
      pgFail("지도 매장 정보를 아직 불러오지 못했습니다. 지역을 고른 뒤 다시 조회해 주세요.");
      return;
    }
    if (!url) {
      setStatus("실시간 재고 조회 서버에 연결되어 있지 않습니다. 잠시 뒤 다시 시도해 주세요.", "error");
      pgFail("실시간 재고 조회 서버에 연결되어 있지 않습니다. 잠시 뒤 다시 시도해 주세요.");
      return;
    }
    var lat = Number(st.center.lat).toFixed(4);
    var lng = Number(st.center.lng).toFixed(4);
    var radius = pickRadius(st);
    var key = lat + "," + lng + "," + radius;
    /* 지도가 아직 GS25 매장을 하나도 그리지 않았으면(첫 진입·지역 변경 직후) 조회해도
       붙일 곳이 없다 — 20~30초 걸리는 격자 조회를 버리고, pokemoa:loaded 가 다시 부를 때까지 기다린다. */
    var hasGs25 = (st.all || []).some(function (s) {
      return s && !s.relay && String(s.brand || "").toLowerCase() === "gs25";
    });
    if (!hasGs25) {
      setStatus("주변 GS25 매장을 찾는 중입니다. 잠시 뒤 재고를 조회합니다.", "busy");
      pgShow("running", "주변 GS25 매장 위치를 찾는 중…", 10, 40, "search");
      return;
    }
    if (!manual && state.lastKey === key && Date.now() - state.lastAt < QUERY_TTL) {
      /* 같은 자리를 다시 찾은 경우 — 지도가 새로 그려지면서 search-start 의 clearRelay() 로
         모든 매장이 ‘미조회’가 됐다면, 캐시해 둔 마지막 결과를 조회 없이 그대로 다시 얹는다.
         (이걸 빠뜨리면 ‘선택 지역 찾기’·‘내 위치로 찾기’ 뒤에 전부 미조회로 남는다) */
      if (state.clearedBySearch && state.lastPayload) {
        state.clearedBySearch = false;
        if (window.PokeMoaMap) window.PokeMoaMap.applyRelay(state.lastPayload);
        setStatus(state.lastStatusHtml, state.lastStatusKind);
        setSideTitle(true);
        if (pgVisible()) pgDone(state.lastSummary || "지도에 마지막 재고를 다시 표시했습니다.");
      }
      return;
    }

    state.busy = true;
    state.clearedBySearch = false;
    state.lastKey = key;
    setStatus("주변 GS25 " + radiusText(radius) + " 안 재고를 조회하는 중…", "busy");
    pgShow("running", gridNote(st), 42, 88, "stock");

    fetchGrid(url, lat, lng, radius)
      .catch(function (err) {
        /* 태블릿이 아직 v2.1 이면 이 경로가 404 다 — 예전 1km 경로로 조용히 물러난다 */
        if (err && err.status === 404) {
          pgShow("running", "구버전 중계 — GS25 1km 상품별 재고로 다시 조회하는 중…", 46, 88, "stock");
          return fetchLegacy(url, lat, lng, radius).then(function (out) {
            out.fallback = true;
            return out;
          });
        }
        throw err;
      })
      .then(function (out) {
        var data = out.grid ? readGrid(out.body) : readLegacy(out.results);
        var byStore = data.byStore || {};
        var errors = data.errors || [];
        var notes = data.notes || [];
        var sessionNeeded = data.sessionNeeded;

        /* 앱 응답 점포 → 지도(카카오) 점포 좌표에 붙인다 */
        var all = (mapState() && mapState().all) || [];
        var payloadStores = [];
        var seenTwin = {};
        var matched = 0;
        var unmatched = 0;
        var inStock = 0;
        var totalQty = 0;
        Object.keys(byStore).forEach(function (id) {
          var rec = byStore[id];
          var twin = findStore(all, rec.name, rec.address);
          if (!twin) { unmatched += 1; return; }
          /* 같은 지도 매장에 두 건이 붙을 수 있다(이름이 같은 점포가 둘). applyRelay 가 어차피
             한 곳으로 합치므로, 안내 문구의 곳수도 화면에 보이는 매장 수와 같게 센다. */
          var twinKey = String(twin.id || (twin.lat + "," + twin.lng));
          if (seenTwin[twinKey]) return;
          seenTwin[twinKey] = 1;
          matched += 1;
          var sum = rec.items.reduce(function (a, b) { return a + (b.qty || 0); }, 0);
          if (sum > 0) inStock += 1;
          totalQty += sum;
          payloadStores.push({
            brand: "gs25",
            id: rec.id,
            name: twin.name,
            address: twin.street || rec.address,
            lat: twin.lat,
            lng: twin.lng,
            status: sum > 0 ? "in_stock" : "out_of_stock",
            items: rec.items,
            updatedAt: new Date().toISOString()
          });
        });

        var total = payloadStores.length;
        var payload = {
          ok: true,
          generatedAt: new Date().toISOString(),
          keyword: F.short,
          radius: out.radius,
          sources: {
            gs25: {
              ok: !errors.length,
              count: total,
              products: (F.series || []).length,
              note: "GS25 팜사이즈 원더 " + total + "곳 확인"
            }
          },
          stores: payloadStores
        };
        /* 같은 자리 재조회(선택 지역·내 위치) 뒤 clearRelay 로 사라진 결과를 되살릴 수 있게 캐시.
           지도 매장과 하나도 연결하지 못한 응답(지도가 아직 안 그려진 경우)은 캐시하지 않고,
           TTL 도 세우지 않아 다음 pokemoa:loaded 에서 다시 조회합니다. */
        var applied = total > 0;
        if (applied) state.lastPayload = payload;
        if (window.PokeMoaMap && applied && isActive()) window.PokeMoaMap.applyRelay(payload);

        var now = hhmm();
        var label = radiusText(out.radius);
        var bits = [];
        if (total) {
          bits.push("주변 GS25 <b>" + total + "곳</b> 확인");
          bits.push(inStock ? "<b>" + inStock + "곳</b>에 재고(합계 " + totalQty + "개)" : "재고 있는 곳 없음");
          bits.push(now + " 조회 · 반경 " + label + (out.fallback ? " · 구버전 중계" : ""));
        } else if (matched === 0 && unmatched > 0) {
          bits.push("조회된 GS25 " + unmatched + "곳을 지도 매장과 연결하지 못했습니다. 장소를 다시 조회해 주세요.");
        } else if (sessionNeeded) {
          bits.push("GS25 로그인 세션이 없어 재고를 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.");
        } else if (errors.length) {
          bits.push("GS25 재고 조회가 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요.");
        } else {
          bits.push("반경 " + label + " 안에 GS25 점포가 없습니다. 반경을 넓히거나 지도를 옮겨 보세요.");
        }
        if (notes.length && !total) bits.push(esc(notes[0]).slice(0, 80));
        var summaryHtml = bits.join(" · ");
        var summaryKind = total ? "" : (errors.length ? "error" : "");
        setStatus(summaryHtml, summaryKind);
        state.lastStatusHtml = summaryHtml;
        state.lastStatusKind = summaryKind;
        state.lastSummary = summaryHtml.replace(/<[^>]+>/g, "");
        state.lastAt = total ? Date.now() : 0;
        if (errors.length && !total) pgFail(state.lastSummary);
        else pgDone(state.lastSummary);
        track("figure_stock", {
          stores: total,
          in_stock: inStock,
          qty: totalQty,
          errors: errors.length,
          radius_m: out.radius,
          grid: out.grid ? 1 : 0,
          fallback: out.fallback ? 1 : 0
        });
      })
      .catch(function (err) {
        var msg = (err && err.message) || String(err);
        var text = "GS25 재고 조회가 지연되고 있습니다. 잠시 뒤 다시 시도해 주세요." + (/rate|429/i.test(msg) ? " (요청이 많아 잠시 대기 중)" : "");
        setStatus(text, "error");
        pgFail(text);
      })
      .finally(function () {
        state.busy = false;
      });
  }

  function goStock() {
    var nav = $('.main-nav [data-tab="map"]') || $('[data-tab="map"]');
    if (nav) nav.click();
    setMode("figure", { scroll: true, force: false });
    scrollToStrip();
    queryStock(true);
  }

  /* ================================================== 도감·시세 세트 검색 */
  function figureSearchCardHtml() {
    return '<article class="set-search-card figure-search-card">' +
      '<div class="fsc-head">' +
        '<img src="' + esc(F.series[0].image) + '" alt="" width="64" height="64" loading="lazy">' +
        '<div><span class="ssc-code">GS25 · ' + esc(F.releaseLabel) + ' · 총 ' + F.totalCount + '종 랜덤</span>' +
        '<h3>' + esc(F.name) + '</h3></div>' +
      '</div>' +
      '<dl class="ssc-grid">' +
        '<div><dt>가격</dt><dd>' + esc(F.priceLabel) + '</dd></div>' +
        '<div><dt>구성</dt><dd>1탄 6종 · 2탄 8종 · 3탄 6종 (총 ' + F.totalCount + '종 랜덤)</dd></div>' +
        '<div><dt>판매</dt><dd>전국 GS25 · 재고 소진 시까지</dd></div>' +
      '</dl>' +
      '<div class="ssc-actions">' +
        '<button type="button" class="btn btn-dark btn-sm" data-figure-stock>지도에서 GS25 재고 찾기</button>' +
        '<a class="btn btn-ghost btn-sm" href="' + esc(F.productUrl) + '" target="_blank" rel="noopener">우리동네GS 공식 상품 ↗</a>' +
      '</div>' +
    '</article>';
  }

  function matchesFigure(raw) {
    var q = String(raw || "").toLowerCase().replace(/\s+/g, "");
    if (q.length < 2) return false;
    /* 전체 상품명에는 '포켓몬스터'가 들어 있어 카드 검색('포켓몬')까지 피규어를 띄우게 된다.
       그래서 짧은 이름·영문명·키워드로만 맞춘다. */
    var pool = [F.short, F.english].concat(F.keywords || []);
    for (var i = 0; i < pool.length; i++) {
      var k = String(pool[i] || "").toLowerCase().replace(/\s+/g, "");
      if (!k) continue;
      if (k.indexOf(q) >= 0 || q.indexOf(k) >= 0) return true;
    }
    return false;
  }

  function appendFigureSearch(query) {
    var box = $("#setSearchResult");
    if (!box || !matchesFigure(query)) return;
    if ($(".figure-search-card", box)) return;
    var empty = $(".set-search-empty", box);
    if (empty) box.innerHTML = "";
    box.insertAdjacentHTML("afterbegin", figureSearchCardHtml());
    var btn = $("[data-figure-stock]", box);
    if (btn) btn.addEventListener("click", goStock);
    track("set_search", { figure: 1 });
  }

  /* ============================================================ 초기화 */
  function init() {
    fillSeries();

    var picker = $("#productPicker");
    if (picker) {
      picker.addEventListener("click", function (e) {
        var b = e.target.closest("[data-product]");
        if (!b) return;
        if (b.getAttribute("data-product") === "figure") {
          setMode("figure", { scroll: true, force: true });
        } else {
          setMode("card");
        }
      });
    }
    var qBtn = $("#figureQuery");
    if (qBtn) qBtn.addEventListener("click", function () { queryStock(true); });

    /* 반경 1km / 3km 를 바꾸면 피규어 재고도 그 반경으로 다시 받는다.
       지도가 같은 반경 구간(3km→3km)이라 재조회를 돌리지 않는 경우에도 여기서 한 번 묻는다. */
    function requeryForRadius(tries) {
      if (!isActive()) return;
      if (state.busy && tries > 0) {
        setTimeout(function () { requeryForRadius(tries - 1); }, 1200);
        return;
      }
      queryStock(false);
    }
    $$(".radius-btn").forEach(function (b) {
      b.addEventListener("click", function () {
        if (!isActive()) return;
        setTimeout(function () { requeryForRadius(3); }, 600);
      });
    });

    $$("[data-figure-stock]").forEach(function (b) {
      b.addEventListener("click", goStock);
    });
    $$("[data-figure-info]").forEach(function (b) {
      b.addEventListener("click", openPopup);
    });

    /* 지도가 새로 그려질 때마다(지역 변경·내 위치·지도 이동) 피규어 재고도 다시 받는다 */
    document.addEventListener("pokemoa:loaded", function () {
      if (!isActive()) return;
      var st = mapState();
      if (st && st.brand !== "gs25" && window.PokeMoaMap) window.PokeMoaMap.setBrand("gs25");
      setSideTitle(true);
      queryStock(false);
    });
    /* 내 위치 → 지도 중심 변경 → load() 순서로 진행되므로, 여기서 먼저 조회하면
       아직 새로 그려지지 않은 매장 목록과 맞춰 보게 된다. 조회는 위 pokemoa:loaded 가 맡는다. */
    document.addEventListener("pokemoa:geo-start", function () {
      if (!isActive()) return;
      pgShow("running", "현재 위치를 확인하는 중…", 2, 20, "search");
      pgScrollIntoView(120);
    });
    document.addEventListener("pokemoa:search-start", function (e) {
      if (!isActive()) return;
      var d = (e && e.detail) || {};
      /* 지역을 새로 찾으면 카드 4사 패널이 다시 떠오르므로 피규어 모드에서는 곧바로 숨긴다.
         이때 지도 점포가 새로 그려져 전부 ‘미조회’가 되므로, 같은 자리면 queryStock 의 TTL 경로가
         state.lastPayload 를 다시 엎는다(clearedBySearch). */
      state.clearedBySearch = true;
      if (window.PokeMoaMap) window.PokeMoaMap.clearRelay();
      /* 매장 탐색 단계도 눈에 보이게 — 사용자가 직접 시작한 조회만 화면으로 끌어온다 */
      pgShow("running", d.origin === "map"
        ? "지도 중심 주변 GS25 매장을 찾는 중…"
        : "선택한 지역 주변 GS25 매장을 찾는 중…", 4, 40, "search");
      if (!d.initial && d.origin !== "map") pgScrollIntoView();
    });
    document.addEventListener("pokemoa:search-progress", function (e) {
      if (!isActive() || !pgVisible()) return;
      var d = (e && e.detail) || {};
      var total = Math.max(1, d.total || 1);
      var done = Math.min(1, (d.resolved || 0) / total);
      pg.value = Math.max(pg.value, 4 + Math.round(34 * done));
      pgPaint();
    });
    document.addEventListener("pokemoa:search-done", function () {
      if (!isActive()) return;
      document.body.classList.add("figure-mode");
      /* 매장 탐색이 끝나면 재고 조회 단계로 — 3km 격자 조회는 최대 27초 걸린다.
         이미 재고 조회가 돌고 있거나(state.busy) 캐시를 다시 얹어 끝난 패널이면
         문구를 되돌리지 않는다 — 그러면 진행률이 88% 에 멈춰 서 있게 된다. */
      if (state.busy || pg.stage !== "search") return;
      pgShow("running", gridNote(mapState()), 40, 88, "stock");
    });

    /* 세트 검색 — app.js 가 먼저 결과를 그린 뒤 우리 카드를 덧붙인다 */
    var form = $("#setSearchForm");
    if (form) {
      form.addEventListener("submit", function () {
        var el = $("#setSearch");
        appendFigureSearch(el ? el.value : "");
      });
    }

    /* ?figure=1 로 들어오면 지도가 준비된 뒤 피규어 모드로 */
    try {
      var params = new URLSearchParams(location.search);
      if (params.get("figure") === "1") state.requested = true;
    } catch (e) {}
    if (state.requested) {
      if (window.PokeMoaMap) setMode("figure", { scroll: false, force: true });
      document.addEventListener("pokemoa:loaded", function () {
        if (state.requested) { state.requested = false; setMode("figure", { scroll: false, force: true }); }
      }, { once: true });
    }

    /* 안내 팝업 — 어드민 설정(figurePopup)을 기다렸다가 그 값대로 띄운다.
       설정은 로더가 늦게 받아올 수 있어(공개 API 2.5초) 받는 즉시 다시 맞춘다. */
    setupPopupFromConfig(true);
    document.addEventListener("moa:site-config-applied", function () { setupPopupFromConfig(false); });
    document.addEventListener("moa:preview-applied", function () { setupPopupFromConfig(true); });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.PokeMoaFigure = {
    isActive: isActive,
    setMode: setMode,
    openPopup: openPopup,
    closePopup: closePopup,
    popupConfig: popupCfg,
    syncPopup: setupPopupFromConfig,
    goStock: goStock,
    refreshStock: function () { queryStock(true); },
    product: F
  };
})();
