/* 모아 어드민 공통 사이트 설정 로더 v4
   ────────────────────────────────────────────────────────────────
   moa-kr/pokemoa · moa-kr/bokjinabi 에 실제로 들어가 있는 파일과 같은 내용입니다.
   모아 어드민이 커밋하는 site-config.json 을 읽어 공지 배너 · 팝업 · 탭 순서/노출 ·
   섹션 순서/노출 · 섹션 본문 · 문구를 화면에 적용합니다.

   붙이는 방법 (HTML 의 </body> 앞, 사이트 스크립트 뒤)
     <script src="assets/js/site-config-loader.js?v=1" defer
             data-config="assets/config/site-config.json"
             data-tab-container=".main-nav"
             data-banner-host=".site-header"></script>

   - data-config       : 설정 JSON 경로(필수). 없으면 아무것도 하지 않습니다.
   - data-tab-container: 탭 요소를 담은 컨테이너(CSS 선택자). 기본 ".main-nav"
   - data-banner-host  : 공지 바를 넣을 요소(CSS 선택자). 기본 "header" → 없으면 body
   - data-section-root : 섹션을 찾을 범위(CSS 선택자). 기본 body

   화면에서 바꿀 수 있는 표시
   - 탭       : [data-tab] 또는 [data-nav] 요소 (id = data-tab/data-nav 값)
   - 섹션     : [data-section] 요소 (id = data-section 값)
   - 섹션 제목: 섹션 안의 [data-section-title] 요소 (없으면 그대로 둠)
   - 섹션 본문: navigation.sections[].body 값 → 섹션 맨 아래 .moa-section-body 로 그려짐
   - 문구     : [data-copy="heroDescription"] (글자로) / [data-copy-html="heroTitle"] (일부 태그만 허용)

   섹션 순서는 같은 탭 패널(.tab-panel · #view 등) 안에서만 바뀜니다. 서로 다른 .wrap 에
   들어 있어도 앞 섹션 바로 뒤로 옮겨 순서를 맞추므로 탭 내부 블록 순서를 자유롭게 바꿀 수 있습니다.

   SPA(회사복지모아)처럼 화면을 다시 그리는 사이트는 다시 그린 뒤
   document.dispatchEvent(new CustomEvent("moa:route-rendered")) 를 보내면
   섹션·문구를 그 화면 기준으로 다시 적용합니다.

   v4.4 — 공개 설정 API 우선 읽기 (2026-11-24)
   모아 어드민이 저장하면 복지모아 서버가 GitHub 에 커밋하면서 그 설정을 메모리에 들고 있고,
   포케모아는 아래 주소에서 그것을 바로 받아 옵니다(GitHub Pages 빌드 30초~1분을 기다리지 않음).
     <script src="assets/js/site-config-loader.js" defer
             data-config="assets/config/site-config.json"
             data-config-api="https://bokjimoa.onrender.com/api/site-config?site=pokemoa">
   - data-config-api : 선택. API 가 2.5초 안에 정상 설정(schemaVersion 1)을 주면 그것을 쓰고,
                       실패하면 데이터 경로(data-config)의 정적 JSON 으로 조용히 넘어갑니다.
   - 받은 곳은 window.MoaSiteConfig.source, 화면 이벤트 detail.source 로 알 수 있습니다(api|file).

   v4 — 모아 어드민의 실제 미리보기(iframe) 연동
   모아 어드민(https://moa-kr.github.io/moa-admin/)이 이 사이트를 390px iframe 으로 띄우고
   저장 전 draft 설정을 보내면, 이 로더가 받아 화면에 바로 적용합니다(새로고침 없이).
   - 받는 메시지: { type: "moa-preview-config", config, activeTab }  ← 허용 출처만
   - 보내는 메시지: { type: "moa-preview-ready" } (로더 준비됨)
                   { type: "moa-preview-applied", ok } (설정 반영 끝)
   허용 출처는 https://moa-kr.github.io 와 로컬 테스트(localhost·127.0.0.1)뿐입니다.
   미리보기 중에는 방문자의 ‘다시 보지 않기’ 저장소를 건드리지 않고, 팝업 기간도 무시해
   어드민에서 만든 화면 그대로 보여 줍니다.
   v4.3 — 미리보기 클릭 → 어드민 입력칸 이동 (2026-11-20)
   어드민 미리보기(iframe)에서 data-copy·data-section·data-moa-focus 가 붙은 곳을 누르면
   기본 링크 이동을 막고 { type: “moa-preview-focus”, target:{ kind, key|id } } 를 부모(어드민)에
   보냅니다. 어드민은 해당 탭을 열고 그 입력칸으로 스크롤·포커스합니다.
   v4.2 — 기능 스위치(features)
   site-config.json 의 features 값이 false 인 요소를 숨깁니다. 요소는 data-feature="플래그"
   로 표시해 둡니다(포케모아: 반경 버튼 5km·20km). 지금 고른 반경이 꺼진 반경이면 3km 로
   되돌리고, 저장소에 남은 꺼진 반경 값도 3km 로 고쳐 둡니다.
   v4.1 — 방문 통계 수집기
   화면을 떠날 때(탭 전환·숨김·페이지 이탈) 이전 화면의 체류 초·경로·탭과 유입 도메인·
   기기·OS 를 복지모아 서버(/api/analytics/collect)로 보냅니다. IP·쿠키·이메일 같은
   개인 식별 값은 보내지 않고 익명 세션 ID 만 씁니다. 어드민 미리보기(iframe·
   ?moa_preview=)와 localhost 는 보내지 않습니다. data-track-site 로 사이트 이름을 넘길 수
   있습니다(없으면 site-config.json 의 site 값 / 주소로 판단).
   ──────────────────────────────────────────────────────────────── */
(function () {
  "use strict";

  const VERSION = "4.4";
  const STYLE_ID = "moa-site-config-style";
  const DISMISS_PREFIX = "moa:popup:";
  const TAB_SELECTOR = "[data-tab],[data-nav]";
  const SECTION_SELECTOR = "[data-section]";
  const HIDDEN_CLASS = "moa-hidden-by-config";
  const BODY_CLASS = "moa-section-body";
  // 섹션을 담는 화면 단위(탭 패널·뷰). 섹션 순서는 이 안에서만 맞춘다.
  const PANEL_SELECTOR = "[data-panel], .tab-panel, #view, [data-view], main";
  // 제목처럼 마크업이 필요한 자리에서만 허용하는 태그(나머지는 글자로 내린다).
  const SAFE_TAGS = { B: 1, STRONG: 1, EM: 1, I: 1, U: 1, SMALL: 1, BR: 1, SPAN: 1 };
  // 사이트의 강조 표시(예: 복지모아 .hl)를 살리기 위해 class 만 남긴다. 그 밖의 속성(style·on*)은 지운다.
  const SAFE_ATTRS = { class: 1, "aria-hidden": 1 };

  /* 모아 어드민 미리보기 연동 — 허용 출처와 메시지 이름 */
  const PREVIEW = {
    config: "moa-preview-config",
    ready: "moa-preview-ready",
    applied: "moa-preview-applied",
    request: "moa-preview-request",
    focus: "moa-preview-focus"
  };
  const PREVIEW_PARENTS = [
    "https://moa-kr.github.io",
    "http://localhost", "https://localhost",
    "http://127.0.0.1", "https://127.0.0.1"
  ];

  const STYLES = {
    info: { light: ["#eaf0ff", "#1b3a8f"], dark: ["#22345e", "#dbe7ff"] },
    warn: { light: ["#fff4e0", "#8a5300"], dark: ["#4a3a12", "#ffe6a8"] },
    urgent: { light: ["#fdecec", "#a01c22"], dark: ["#4a1620", "#ffd4d6"] }
  };

  const state = { path: "", apiPath: "", source: "", config: null, options: null, preview: false, bannerEl: null, popupEl: null };

  function ensureStyle(dark) {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .moa-banner{display:flex;gap:8px;align-items:center;justify-content:center;padding:9px 14px;
        font-size:13px;font-weight:700;line-height:1.4;text-decoration:none;position:relative;z-index:60}
      .moa-banner a{color:inherit;text-decoration:underline}
      .moa-banner .moa-banner-link{margin-left:6px;white-space:nowrap}
      .moa-banner button{background:transparent;border:0;color:inherit;cursor:pointer;font-size:14px;
        margin-left:auto;opacity:.7;padding:2px 6px}
      .moa-popup-backdrop{position:fixed;inset:0;background:rgba(8,14,28,.55);display:flex;align-items:center;
        justify-content:center;padding:20px;z-index:9999}
      .moa-popup{width:100%;max-width:380px;background:#fff;color:#101f3c;border-radius:18px;padding:20px 18px 14px;
        box-shadow:0 20px 60px rgba(0,0,0,.3);font-size:14px}
      .moa-popup h3{margin:0 0 8px;font-size:17px;letter-spacing:-.02em}
      .moa-popup p{margin:0 0 14px;font-size:13px;line-height:1.6;white-space:pre-wrap;color:#46506b}
      .moa-popup .moa-popup-btn{display:block;width:100%;border:0;border-radius:11px;padding:11px;font:inherit;
        font-weight:800;font-size:14px;cursor:pointer;text-align:center;text-decoration:none}
      .moa-popup .moa-popup-dismiss{display:flex;gap:14px;justify-content:center;margin-top:12px;font-size:12px;color:#8b95ac}
      .moa-popup .moa-popup-dismiss button{background:none;border:0;color:inherit;cursor:pointer;font:inherit;text-decoration:underline}
      .${BODY_CLASS}{margin:16px 0 0;padding:12px 14px;border-radius:12px;border:1px solid rgba(125,135,160,.32);
        background:rgba(125,135,160,.06);font-size:13.5px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
      .${BODY_CLASS} p{margin:0 0 8px}
      .${BODY_CLASS} p:last-child{margin-bottom:0}
      .${BODY_CLASS} b,.${BODY_CLASS} strong{font-weight:800}
      .${HIDDEN_CLASS}{display:none !important}
    `;
    document.head.appendChild(style);
    document.documentElement.dataset.moaTheme = dark ? "dark" : "light";
  }

  /* 숨김 클래스 규칙은 배너·팝업을 그릴 때만 주입되므로, 기능 스위치·탭/섹션 숨김이
     배너·팝업 모두 꺼진 화면에서도 동작하도록 규칙 하나를 따로 보장한다. */
  const HIDDEN_STYLE_ID = "moa-hidden-style";
  const PREVIEW_STYLE_ID = "moa-preview-style";
  function ensureHiddenStyle() {
    if (document.getElementById(STYLE_ID) || document.getElementById(HIDDEN_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIDDEN_STYLE_ID;
    style.textContent = `.${HIDDEN_CLASS}{display:none !important}`;
    document.head.appendChild(style);
  }

  function load(path) {
    const url = path + (path.indexOf("?") === -1 ? "?" : "&") + "_moa=" + Date.now();
    return fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg) => (cfg && cfg.schemaVersion === 1 ? cfg : null))
      .catch(() => null);
  }

  /* 공개 설정 API — 어드민이 저장하면 바로 최신값을 준다. 늦거나 실패하면 null 로 떨어져
     정적 JSON 폴백을 쓴다. 방문자 화면을 오래 붙잡지 않도록 2.5초에서 끊는다. */
  const API_TIMEOUT_MS = 2500;
  function loadRemote(path) {
    const url = path + (path.indexOf("?") === -1 ? "?" : "&") + "_moa=" + Date.now();
    return new Promise((resolve) => {
      let settled = false;
      let controller = null;
      try { if (typeof AbortController === "function") controller = new AbortController(); } catch (err) { controller = null; }
      const finish = (cfg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(cfg && cfg.schemaVersion === 1 ? cfg : null);
      };
      const timer = setTimeout(() => {
        try { if (controller) controller.abort(); } catch (err) { /* 무시 */ }
        finish(null);
      }, API_TIMEOUT_MS);
      try {
        fetch(url, { cache: "no-store", credentials: "omit", signal: controller ? controller.signal : undefined })
          .then((res) => (res.ok ? res.json() : null))
          .then(finish)
          .catch(() => finish(null));
      } catch (err) {
        finish(null);
      }
    });
  }

  /* ───────────── 공지 배너 ───────────── */
  function mountBanner(cfg, opts) {
    const options = opts || {};
    const banner = cfg.banner;
    if (!banner || !banner.enabled || !String(banner.text || "").trim()) return null;
    ensureStyle(String(cfg.theme && cfg.theme.mode) === "dark");
    const palette = (STYLES[banner.style] || STYLES.info)[Number(cfg.theme && cfg.theme.mode === "dark") ? "dark" : "light"];
    const el = document.createElement("div");
    el.className = "moa-banner";
    el.setAttribute("role", "status");
    el.setAttribute("data-moa-focus", JSON.stringify({ kind: "banner" }));
    el.style.background = options.background || palette[0];
    el.style.color = options.color || palette[1];
    const text = document.createElement("span");
    text.textContent = banner.text;
    el.appendChild(text);
    if (banner.linkUrl) {
      const link = document.createElement("a");
      link.className = "moa-banner-link";
      link.href = banner.linkUrl;
      link.textContent = banner.linkLabel || "자세히 보기";
      if (banner.linkUrl.indexOf("http") === 0) { link.target = "_blank"; link.rel = "noreferrer"; }
      el.appendChild(link);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.setAttribute("aria-label", "공지 닫기");
    close.textContent = "✕";
    close.addEventListener("click", () => el.remove());
    el.appendChild(close);

    const host = options.host || document.body;
    if (options.place === "afterbegin") host.insertBefore(el, host.firstChild);
    else host.appendChild(el);
    state.bannerEl = el;
    return el;
  }

  /* 다시 적용하기 전에 이전에 그린 배너를 지운다(중복으로 쌓이지 않도록). */
  function unmountBanner() {
    if (state.bannerEl && state.bannerEl.parentNode) state.bannerEl.parentNode.removeChild(state.bannerEl);
    state.bannerEl = null;
  }

  /* ───────────── 첫 방문 팝업 ───────────── */
  function popupDismissed(id) {
    if (state.preview) return false; // 미리보기는 항상 화면 그대로 보여 준다
    try {
      const raw = localStorage.getItem(DISMISS_PREFIX + id);
      if (!raw) return false;
      const until = Number(raw);
      if (!until) return true; // 0일 = 이번 방문에서만 닫기
      return until > Date.now();
    } catch (err) { return false; }
  }

  function dismissPopup(id, days) {
    if (state.preview) return; // 미리보기에서는 방문자의 ‘다시 보지 않기’ 저장소를 건드리지 않는다
    try {
      const until = days > 0 ? Date.now() + days * 86400000 : 0;
      localStorage.setItem(DISMISS_PREFIX + id, String(until));
    } catch (err) { /* 저장소를 못 쓰면 그냥 닫기만 한다 */ }
  }

  function inPeriod(popup) {
    if (state.preview) return true; // 미리보기에서는 기간 밖이어도 그대로 보여 준다
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (popup.startDate && iso < popup.startDate) return false;
    if (popup.endDate && iso > popup.endDate) return false;
    return true;
  }

  function mountPopup(cfg) {
    const popup = cfg.popup;
    if (!popup || !popup.enabled || !inPeriod(popup)) return null;
    const id = popup.id || "popup-1";
    if (popupDismissed(id)) return null;
    ensureStyle(String(cfg.theme && cfg.theme.mode) === "dark");
    const accent = (cfg.theme && cfg.theme.accentSoft) || (cfg.theme && cfg.theme.accent) || "#2c5bf6";

    const backdrop = document.createElement("div");
    backdrop.className = "moa-popup-backdrop";
    const box = document.createElement("div");
    box.className = "moa-popup";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", popup.title || "안내");

    const title = document.createElement("h3");
    title.textContent = popup.title || "";
    title.setAttribute("data-moa-focus", JSON.stringify({ kind: "popup" }));
    const body = document.createElement("p");
    body.textContent = popup.body || "";
    box.appendChild(title);
    box.appendChild(body);

    const btn = document.createElement(popup.buttonUrl ? "a" : "button");
    btn.className = "moa-popup-btn";
    btn.style.background = "#101f3c";
    btn.style.color = "#fff";
    if (popup.buttonUrl) {
      btn.href = popup.buttonUrl;
      if (popup.buttonUrl.indexOf("http") === 0) { btn.target = "_blank"; btn.rel = "noreferrer"; }
    } else {
      btn.type = "button";
    }
    btn.textContent = popup.buttonText || "확인";
    btn.addEventListener("click", () => backdrop.remove());
    box.appendChild(btn);

    const dismiss = document.createElement("div");
    dismiss.className = "moa-popup-dismiss";
    if (Number(popup.dismissDays) > 0) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = `${popup.dismissDays}일 동안 보지 않기`;
      b.addEventListener("click", () => { dismissPopup(id, Number(popup.dismissDays)); backdrop.remove(); });
      dismiss.appendChild(b);
    }
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "닫기";
    close.addEventListener("click", () => backdrop.remove());
    dismiss.appendChild(close);
    box.appendChild(dismiss);

    backdrop.appendChild(box);
    backdrop.addEventListener("click", (event) => { if (event.target === backdrop) backdrop.remove(); });
    document.body.appendChild(backdrop);
    state.popupEl = backdrop;
    return backdrop;
  }

  function unmountPopup() {
    if (state.popupEl && state.popupEl.parentNode) state.popupEl.parentNode.removeChild(state.popupEl);
    state.popupEl = null;
  }

  /* ───────────── 탭 · 섹션 순서/노출 ───────────── */
  function idOf(el, attr) {
    return el.getAttribute(attr) || "";
  }

  /* 이 항목을 숨길지 — 어드민은 visible, 다른 도구는 enabled 를 쓸 수 있어 둘 다 본다. */
  function isOff(item) {
    return Boolean(item) && (item.visible === false || item.enabled === false);
  }

  /* 탭 id 로 그 탭의 패널을 찾는다(#panel-home · [data-panel="home"] · #viewHome 등). */
  function panelOfTabId(id) {
    if (!id) return null;
    return document.querySelector(`[data-panel="${id}"], .tab-panel#panel-${id}, #panel-${id}, #view-${id}, #view-${id}-panel`);
  }

  /* 설정의 order 순서대로, 같은 부모 안에서만 자리를 맞춘다(패널을 넘나들지 않는다).
     섹션 사이에 낀 광고·안내 요소는 건드리지 않도록 자리표시(주석)를 써서 맞바꾼다. */
  function placeInOrder(elements, list, idGetter) {
    if (!elements.length || !list.length) return;
    const conf = new Map(list.map((item) => [item.id, item]));
    const groups = new Map();
    elements.forEach((el) => {
      if (!el.parentNode) return;
      const key = el.parentNode;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });
    groups.forEach((items) => {
      if (items.length < 2) return;
      const rank = (el) => {
        const item = conf.get(idGetter(el));
        const order = item ? Number(item.order) : NaN;
        return Number.isFinite(order) ? order : 999;
      };
      const sorted = items.slice().sort((a, b) => rank(a) - rank(b));
      const marks = items.map((el) => {
        const mark = document.createComment("moa-slot");
        el.parentNode.insertBefore(mark, el);
        el.remove();
        return mark;
      });
      sorted.forEach((el, index) => {
        const mark = marks[index];
        mark.parentNode.insertBefore(el, mark);
      });
      marks.forEach((mark) => mark.remove());
    });
  }

  function setLabel(el, label) {
    if (!label) return;
    const target = el.querySelector(".nav-label") || el.querySelector(".moa-label");
    if (target) { target.textContent = label; return; }
    // 아이콘 같은 자식 요소는 두고, 글자 노드만 바꾼다.
    let textNode = null;
    Array.prototype.forEach.call(el.childNodes, (node) => {
      if (node.nodeType === 3 && node.textContent.trim()) textNode = node;
    });
    if (textNode) { textNode.textContent = label; return; }
    if (!el.children.length) { el.textContent = label; return; }
    const span = document.createElement("span");
    span.className = "moa-label";
    span.textContent = label;
    el.appendChild(span);
  }

  function applyTabs(container, cfg) {
    if (!container || !cfg.navigation || !Array.isArray(cfg.navigation.tabs)) return;
    const items = Array.prototype.slice.call(container.querySelectorAll(TAB_SELECTOR));
    if (!items.length) return;
    const conf = new Map(cfg.navigation.tabs.map((tab) => [tab.id, tab]));
    const idOfTab = (el) => el.getAttribute("data-tab") || el.getAttribute("data-nav") || "";
    items.forEach((el) => {
      const tab = conf.get(idOfTab(el));
      if (!tab) return;
      el.classList.toggle(HIDDEN_CLASS, isOff(tab));
      setLabel(el, tab.label);
      if (isOff(tab)) el.setAttribute("tabindex", "-1");
      else el.removeAttribute("tabindex");
    });
    placeInOrder(items, cfg.navigation.tabs, idOfTab);

    const visible = items.filter((el) => !el.classList.contains(HIDDEN_CLASS)).length;
    container.style.setProperty("--moa-tab-count", String(Math.max(1, visible)));

    ensureActiveTabVisible(items);
  }

  /* 지금 보고 있는 탭이 꺼졌으면 첫 번째 보이는 탭으로 옮긴다.
     사이트 핸들러가 붙기 전이거나 반응하지 않으면 패널을 직접 바꿔 안전하게 마무리한다. */
  function ensureActiveTabVisible(items) {
    const isHidden = (el) => el.classList.contains(HIDDEN_CLASS);
    const idOfTab = (el) => el.getAttribute("data-tab") || el.getAttribute("data-nav") || "";

    // 꺼진 탭의 패널이 열려 있으면 먼저 감춘다(보이는 탭의 패널은 건드리지 않는다).
    const visibleIds = new Set(items.filter((el) => !isHidden(el)).map(idOfTab));
    items.filter(isHidden).map(idOfTab).forEach((id) => {
      const panel = panelOfTabId(id);
      if (panel) panel.hidden = true;
    });

    const active = items.find((el) => el.classList.contains("is-active") || el.classList.contains("active"));
    if (!active || !isHidden(active)) return;
    const first = items.find((el) => !isHidden(el));
    if (!first) return;

    const snapshot = () => Array.prototype.map.call(
      document.querySelectorAll("[data-panel], .tab-panel"), (panel) => (panel.hidden ? "1" : "0")
    ).join("");
    const before = snapshot();
    try { first.click(); } catch (err) { /* 핸들러가 없으면 아래에서 직접 바꾼다 */ }
    if (snapshot() !== before) return;

    // 사이트 핸들러가 반응하지 않았다 — 탭 표시와 패널을 직접 맞춘다.
    const firstId = idOfTab(first);
    items.forEach((el) => {
      const on = el === first;
      el.classList.toggle("is-active", on);
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-panel], .tab-panel").forEach((panel) => {
      const pid = panel.getAttribute("data-panel") || String(panel.id || "").replace(/^panel-/, "");
      if (!pid) return;
      if (pid === firstId) panel.hidden = false;
      else if (!visibleIds.has(pid)) panel.hidden = true;
    });
  }

  /* 섹션을 담는 화면 단위. 가장 가까운 탭 패널/뷰를 찾고, 없으면 body. */
  function panelOf(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.matches && node.matches(PANEL_SELECTOR)) return node;
      node = node.parentElement;
    }
    return document.body;
  }

  /* 같은 탭 안의 섹션을 order 순서대로 나란히 놓는다.
     섹션이 서로 다른 .wrap 안에 있어도 순서를 바꿀 수 있도록, 앞 섹션 바로 뒤로 옮긴다.
     (옮겨도 각 섹션의 class·바깥 .wrap 은 그대로라 화면 폭·여백은 유지된다.) */
  function orderSections(items, list) {
    if (!items.length || !list.length) return;
    const conf = new Map(list.map((item) => [item.id, item]));
    const groups = new Map();
    items.forEach((el) => {
      if (!el.parentNode) return;
      const key = panelOf(el);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    });
    groups.forEach((group) => {
      if (group.length < 2) return;
      const rank = (el) => {
        const item = conf.get(el.getAttribute("data-section") || "");
        const order = item ? Number(item.order) : NaN;
        return Number.isFinite(order) ? order : 999;
      };
      const sorted = group.slice().sort((a, b) => rank(a) - rank(b));
      // 이미 문서 순서가 맞으면 손대지 않는다(필요한 섹션만 옮김).
      const FOLLOWING = 4; // Node.DOCUMENT_POSITION_FOLLOWING
      let prev = sorted[0];
      for (let i = 1; i < sorted.length; i++) {
        const el = sorted[i];
        if (el === prev) continue;
        if (!(prev.compareDocumentPosition(el) & FOLLOWING)) {
          prev.parentNode.insertBefore(el, prev.nextSibling);
        }
        prev = el;
      }
    });
  }

  /* 섹션 하나에 붙는 ‘본문 문단’(admin 의 navigation.sections[].body).
     비어 있으면 붙이지 않고, 값이 있으면 섹션 맨 아래에 한 번만 그린다. */
  function directChild(el, className) {
    for (let i = 0; i < el.children.length; i++) {
      if (el.children[i].classList.contains(className)) return el.children[i];
    }
    return null;
  }

  function applySectionBody(el, section) {
    const html = section && section.body != null ? String(section.body).trim() : "";
    let body = directChild(el, BODY_CLASS);
    if (!html) {
      if (body) body.remove();
      return;
    }
    if (!body) {
      body = document.createElement("div");
      body.className = BODY_CLASS;
      body.setAttribute("data-moa-section-body", section.id || "");
      el.appendChild(body);
    }
    const next = sanitizeHtml(html);
    if (body.innerHTML !== next) body.innerHTML = next;
  }

  function applySections(root, cfg) {
    const scope = root || document.body;
    if (!cfg.navigation || !Array.isArray(cfg.navigation.sections)) return;
    const items = Array.prototype.slice.call(scope.querySelectorAll(SECTION_SELECTOR));
    if (!items.length) return;
    const conf = new Map(cfg.navigation.sections.map((section) => [section.id, section]));
    items.forEach((el) => {
      const section = conf.get(idOf(el, "data-section"));
      if (!section) return;
      el.classList.toggle(HIDDEN_CLASS, isOff(section));
      const title = el.querySelector("[data-section-title]");
      if (title && section.label) title.textContent = section.label;
      applySectionBody(el, section);
    });
    orderSections(items, cfg.navigation.sections);
  }

  /* ───────────── 문구 ───────────── */
  function copyValue(cfg, key) {
    if (!cfg.copy || !key) return null;
    const value = cfg.copy[key];
    return value == null ? null : String(value);
  }

  function sanitizeHtml(value) {
    const holder = document.createElement("div");
    holder.innerHTML = String(value == null ? "" : value);
    (function clean(node) {
      Array.prototype.slice.call(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) return;
        if (child.nodeType !== 1) { child.remove(); return; }
        if (!SAFE_TAGS[child.tagName]) {
          const text = document.createTextNode(child.textContent || "");
          child.parentNode.replaceChild(text, child);
          return;
        }
        Array.prototype.slice.call(child.attributes).forEach((attr) => {
          if (!SAFE_ATTRS[attr.name.toLowerCase()]) child.removeAttribute(attr.name);
        });
        clean(child);
      });
    })(holder);
    return holder.innerHTML;
  }

  function applyCopy(cfg, root) {
    const scope = root || document.body;
    Array.prototype.forEach.call(scope.querySelectorAll("[data-copy]"), (el) => {
      const value = copyValue(cfg, el.getAttribute("data-copy"));
      if (value == null) return;
      if (el.tagName === "META") el.setAttribute("content", value);
      else el.textContent = value;
    });
    Array.prototype.forEach.call(scope.querySelectorAll("[data-copy-html]"), (el) => {
      const value = copyValue(cfg, el.getAttribute("data-copy-html"));
      if (value == null) return;
      el.innerHTML = sanitizeHtml(value);
    });
  }

  /* ───────────── 기능 스위치(features) ─────────────
     features[플래그] 가 false 면 data-feature="플래그" 요소를 숨긴다. 값이 없으면 켜짐(true). */
  const RADIUS_FEATURES = [
    { flag: "radius5km", radius: 5000 },
    { flag: "radius20km", radius: 20000 }
  ];
  const RADIUS_FALLBACK = 3000;

  function featureOn(cfg, flag) {
    const features = cfg && cfg.features && typeof cfg.features === "object" ? cfg.features : null;
    const value = features ? features[flag] : undefined;
    if (value == null) return true;
    if (typeof value === "string") return !/^(false|0|off|no)$/i.test(value.trim());
    return Boolean(value);
  }

  function setFeatureElement(el, on) {
    el.classList.toggle(HIDDEN_CLASS, !on);
    if (on) {
      el.removeAttribute("hidden");
      el.removeAttribute("aria-hidden");
      el.removeAttribute("tabindex");
      return;
    }
    el.setAttribute("hidden", "");
    el.setAttribute("aria-hidden", "true");
    el.setAttribute("tabindex", "-1");
  }

  /* 지금 선택된 반경 — 지도 상태를 먼저 보고, 없으면 화면의 활성 버튼에서 읽는다. */
  function currentRadius() {
    if (window.PokeMoaMap && typeof window.PokeMoaMap.getState === "function") {
      const mapState = window.PokeMoaMap.getState();
      if (mapState && typeof mapState.radius === "number") return mapState.radius;
    }
    const active = document.querySelector(".radius-btn.is-active[data-radius]");
    return active ? Number(active.getAttribute("data-radius")) : null;
  }

  function markRadiusButton(radius) {
    Array.prototype.forEach.call(document.querySelectorAll(".radius-btn[data-radius]"), (btn) => {
      btn.classList.toggle("is-active", Number(btn.getAttribute("data-radius")) === radius);
    });
  }

  /* 꺼진 반경이 선택돼 있으면 3km 로 되돌린다.
     사이트 핸들러(버튼 클릭)를 먼저 쓰고, 반응하지 않으면 지도·표시를 직접 맞춘다. */
  function fallbackRadius(offRadii) {
    const radius = currentRadius();
    if (radius == null || !offRadii.some((r) => radius >= r)) return;
    const btn = document.querySelector(`.radius-btn[data-radius="${RADIUS_FALLBACK}"]`);
    if (btn && !btn.classList.contains(HIDDEN_CLASS)) {
      try { btn.click(); } catch (err) { /* 아래에서 직접 맞춘다 */ }
    }
    const after = currentRadius();
    if (after != null && offRadii.some((r) => after >= r)) {
      if (window.PokeMoaMap && typeof window.PokeMoaMap.setRadius === "function") {
        try { window.PokeMoaMap.setRadius(RADIUS_FALLBACK); } catch (err) { /* 무시 */ }
      }
      markRadiusButton(RADIUS_FALLBACK);
    }
    forgetStoredRadius(offRadii);
  }

  /* 예전 화면·직접 저장한 반경 값이 꺼진 반경이면 3km 로 고친다(km·m 표기 모두). */
  function forgetStoredRadius(offRadii) {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || "";
        if (/radius/i.test(key)) keys.push(key);
      }
      keys.forEach((key) => {
        const raw = localStorage.getItem(key);
        const value = Number(raw);
        if (!raw || !Number.isFinite(value) || value <= 0) return;
        const inKm = value <= 100;
        const meters = inKm ? value * 1000 : value;
        if (!offRadii.some((r) => meters >= r)) return;
        localStorage.setItem(key, String(inKm ? RADIUS_FALLBACK / 1000 : RADIUS_FALLBACK));
      });
    } catch (err) { /* 저장소를 못 쓰면 무시 */ }
  }

  function applyFeatures(cfg) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-feature]"), (el) => {
      const flag = el.getAttribute("data-feature");
      if (flag) setFeatureElement(el, featureOn(cfg, flag));
    });
    const offRadii = RADIUS_FEATURES.filter((item) => !featureOn(cfg, item.flag)).map((item) => item.radius);
    // 20km 버튼이 꺼지면 ‘도심은 5km까지 지원’ 안내도 의미가 없어 함께 숨긴다.
    // (사이트의 syncRadiusUI 가 hidden 을 다시 풀어도 숨겨지도록 class 로도 표시한다.)
    const note = document.getElementById("radiusNote");
    if (note) {
      const hideNote = offRadii.indexOf(20000) >= 0;
      note.classList.toggle(HIDDEN_CLASS, hideNote);
      if (hideNote) note.hidden = true;
    }
    if (!offRadii.length) return;
    fallbackRadius(offRadii);
  }

  function apply(cfg, options) {
    const opts = options || {};
    if (!cfg) return null;
    ensureHiddenStyle();
    state.config = cfg;
    state.options = opts;
    // 이전에 그린 배너·팝업을 지우고 새 설정으로 다시 그린다(미리보기 갱신 때 중복 방지).
    unmountBanner();
    unmountPopup();
    mountBanner(cfg, opts);
    mountPopup(cfg);
    if (opts.tabContainer) applyTabs(opts.tabContainer, cfg);
    applySections(opts.sectionRoot || document.body, cfg);
    applyCopy(cfg, opts.copyRoot || document.body);
    applyFeatures(cfg);
    return cfg;
  }

  /* 화면을 다시 그린 사이트가 부르면 배너·팝업은 그대로 두고 섹션·탭·문구만 다시 맞춘다. */
  function refresh() {
    const cfg = state.config;
    if (!cfg) return null;
    const opts = state.options || {};
    if (opts.tabContainer) applyTabs(opts.tabContainer, cfg);
    applySections(opts.sectionRoot || document.body, cfg);
    applyCopy(cfg, opts.copyRoot || document.body);
    applyFeatures(cfg);
    return cfg;
  }

  /* ───────────── 모아 어드민 실제 미리보기(iframe) ─────────────
     어드민이 보낸 draft 설정을 그대로 적용한다. 탭 이동도 함께 맞춘다. */
  function isAdminOrigin(origin) {
    const value = String(origin || "");
    return PREVIEW_PARENTS.some((base) => value === base || value.indexOf(`${base}:`) === 0);
  }

  function postToParent(message) {
    if (window.parent === window) return;
    let target = "*";
    try {
      const ancestors = location.ancestorOrigins;
      if (ancestors && ancestors.length) target = ancestors[0] || "*";
    } catch (err) { /* 지원하지 않는 브라우저는 * 로 보낸다(설정은 공개 값) */ }
    try { window.parent.postMessage(message, target); } catch (err) { /* 무시 */ }
  }

  /* 지정한 탭을 연다 — 사이트의 탭 버튼을 눌러 보고, 패널이 그대로면 직접 맞춘다. */
  function activateTab(id) {
    if (!id) return false;
    const tab = document.querySelector(`[data-tab="${id}"],[data-nav="${id}"]`);
    let clicked = false;
    if (tab) {
      try { tab.click(); clicked = true; } catch (err) { /* 아래에서 직접 맞춘다 */ }
    }
    const panel = panelOfTabId(id);
    if (panel && panel.hidden) forceTab(id);
    return clicked;
  }

  function forceTab(id) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel], .tab-panel"), (panel) => {
      const pid = panel.getAttribute("data-panel") || String(panel.id || "").replace(/^panel-/, "");
      if (!pid) return;
      panel.hidden = pid !== id;
    });
    Array.prototype.forEach.call(document.querySelectorAll(TAB_SELECTOR), (el) => {
      const on = (el.getAttribute("data-tab") || el.getAttribute("data-nav")) === id;
      el.classList.toggle("is-active", on);
      el.classList.toggle("active", on);
      el.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  /* 미리보기 설정 적용 — 배너·팝업·탭·섹션·문구를 한 번에 다시 그린다. */
  function applyPreview(cfg, activeTab) {
    if (!cfg || typeof cfg !== "object") return null;
    state.preview = true;
    apply(cfg, state.options || {});
    if (activeTab) activateTab(activeTab);
    enablePreviewClick();
    postToParent({ type: PREVIEW.applied, ok: true, at: Date.now(), tab: activeTab || "", version: VERSION });
    return cfg;
  }

  /* ─────────── v4.3 미리보기 클릭 → 어드민 입력칸 이동 ───────────
     미리보기(iframe) 안에서 고칠 수 있는 요소를 누르면 그 요소가 어느 설정 값인지
     (data-copy · data-section · data-moa-focus) 찾아 어드민에 알린다. 어드민은 해당 탭을
     열고 그 입력칸으로 스크롤·포커스한다. 기본 링크 이동·제출은 막는다. */
  const PREVIEW_HIT_SELECTOR = "[data-moa-focus],[data-copy-html],[data-copy],[data-section-title],[data-section]";

  function previewTargetOf(node) {
    const hit = node && node.closest ? node.closest(PREVIEW_HIT_SELECTOR) : null;
    if (!hit) return null;
    /* 탭 버튼·링크는 미리보기 둘러보기용이라 그대로 둔다 */
    if (hit.matches("[data-tab],[data-nav]")) return null;
    const raw = hit.getAttribute("data-moa-focus");
    if (raw) {
      try { return JSON.parse(raw); } catch (err) { return null; }
    }
    if (hit.hasAttribute("data-copy")) return { kind: "copy", key: hit.getAttribute("data-copy") };
    if (hit.hasAttribute("data-copy-html")) return { kind: "copy", key: hit.getAttribute("data-copy-html") };
    const section = hit.closest("[data-section]");
    if (section) return { kind: "section", id: section.getAttribute("data-section") };
    return null;
  }

  function flashPreviewHit(node) {
    const hit = node && node.closest ? node.closest(PREVIEW_HIT_SELECTOR) : null;
    if (!hit || !hit.classList) return;
    hit.classList.remove("moa-preview-hit");
    void hit.offsetWidth;
    hit.classList.add("moa-preview-hit");
    setTimeout(() => hit.classList.remove("moa-preview-hit"), 1200);
  }

  function onPreviewClick(event) {
    if (!state.preview) return;
    const target = previewTargetOf(event.target);
    if (!target) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    postToParent({ type: PREVIEW.focus, target, at: Date.now() });
    flashPreviewHit(event.target);
  }

  function enablePreviewClick() {
    document.documentElement.classList.add("moa-preview-mode");
    if (!document.getElementById(PREVIEW_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PREVIEW_STYLE_ID;
      const hoverSelectors = PREVIEW_HIT_SELECTOR.split(",")
        .map((sel) => "html.moa-preview-mode " + sel.trim() + ":hover")
        .join(",");
      style.textContent =
        hoverSelectors + "{cursor:pointer;outline:2px dashed rgba(240,165,0,.9);outline-offset:2px;border-radius:6px}" +
        ".moa-preview-hit{outline:3px solid #ffcb05 !important;outline-offset:2px;background:rgba(255,203,5,.14) !important}";
      document.head.appendChild(style);
    }
    if (!enablePreviewClick.bound) {
      document.addEventListener("click", onPreviewClick, true);
      enablePreviewClick.bound = true;
    }
  }

  window.addEventListener("message", (event) => {
    if (!isAdminOrigin(event.origin)) return;
    const data = event.data;
    if (!data || typeof data !== "object") return;
    if (data.type === PREVIEW.config) {
      if (applyPreview(data.config, data.activeTab)) {
        document.dispatchEvent(new CustomEvent("moa:preview-applied", { detail: { tab: data.activeTab || "" } }));
      }
      return;
    }
    if (data.type === PREVIEW.request) {
      if (state.config) postToParent({ type: PREVIEW.applied, ok: true, at: Date.now(), version: VERSION, resent: true });
      return;
    }
  }, false);

  /* 로더가 살아 있다는 것을 어드민에 알린다(iframe 로딩 완료 안내). */
  function announceReady() {
    postToParent({ type: PREVIEW.ready, version: VERSION, site: (state.config && state.config.site) || "" });
  }

  /* ───────────── 자동 연결 ───────────── */
  function selfScript() {
    if (document.currentScript) return document.currentScript;
    const list = Array.prototype.slice.call(document.scripts).filter((s) => /site-config-loader\.js/.test(s.src || ""));
    return list.length ? list[list.length - 1] : null;
  }

  function autoInit() {
    const script = selfScript();
    if (!script) return;
    const path = script.getAttribute("data-config");
    if (!path) return;
    const options = {
      host: document.querySelector(script.getAttribute("data-banner-host") || ".site-header") ||
        document.querySelector("header") || document.body,
      place: "afterbegin",
      tabContainer: document.querySelector(script.getAttribute("data-tab-container") || ".main-nav")
    };
    state.path = path;
    state.apiPath = script.getAttribute("data-config-api") || "";
    state.options = options;
    startTracking(script);
    announceReady();
    const finish = (cfg, source) => {
      if (!cfg) return;
      // 어드민이 보낸 draft 를 이미 적용했다면, 뒤늦게 도착한 저장본으로 덮어쓰지 않는다.
      if (state.preview) { announceReady(); return; }
      state.source = source;
      apply(cfg, options);
      announceReady();
      document.dispatchEvent(new CustomEvent("moa:site-config-applied", { detail: cfg }));
    };
    if (state.apiPath) {
      loadRemote(state.apiPath).then((cfg) => {
        if (cfg) { finish(cfg, "api"); return; }
        load(path).then((local) => finish(local, "file"));
      });
      return;
    }
    load(path).then((cfg) => finish(cfg, "file"));
  }

  /* ───────────── 방문 통계 (v4.1) ─────────────
     포케모아·복지모아가 같이 쓰는 수집기입니다. 화면을 떠날 때(sendBeacon) 이전 화면의
     체류 초와 경로·탭, 유입 도메인, 기기·OS 를 복지모아 서버(/api/analytics/collect)로
     보냅니다. 개인을 알아볼 수 있는 값(IP·쿠키·이메일)은 보내지 않고, 세션은 브라우저가
     만든 익명 ID 하나로만 구분합니다(탭을 닫으면 사라짐).
     - 어드민 미리보기(iframe·?moa_preview=)와 localhost 테스트는 보내지 않습니다.
     - 같은 화면을 다시 보는 경우(탭 숨김 → 복귀)는 체류만 더하고 조회수로 세지 않습니다. */
  const TRACK = {
    endpoint: "https://bokjimoa.onrender.com/api/analytics/collect",
    sessionKey: "moa:analytics:sid",
    maxDuration: 1800,
    tabSelector: "[data-tab],[data-nav]"
  };

  const track = {
    enabled: false,
    site: "",
    sessionId: "",
    path: "",
    tab: "",
    start: 0,
    newView: false,
    device: "etc",
    os: "etc",
    referrer: "direct",
    utm: "",
    sent: 0,
    skipped: ""
  };
  let trackTimer = 0;

  function trackSiteOf(script, cfg) {
    const normalize = (value) => {
      const key = String(value || "").trim().toLowerCase();
      if (key === "pokemoa") return "pokemoa";
      if (key === "bokjimoa" || key === "bokjinabi") return "bokjimoa";
      return "";
    };
    let site = normalize(script && script.getAttribute("data-track-site"));
    if (!site && cfg && cfg.site) site = normalize(cfg.site);
    if (!site) {
      const configPath = String((script && script.getAttribute("data-config")) || "");
      site = configPath.charAt(0) === "/" ? "bokjimoa" : "pokemoa";
    }
    return site;
  }

  /* 미리보기 iframe · 어드민 미리보기 주소 · localhost · 내 기기 제외(moa_notrack) 는 통계에서 뺍니다. */
  const OPTOUT_KEY = "moa:analytics:optout";
  function showOptoutToast(msg) {
    try {
      const run = () => {
        if (!document.body) return;
        const el = document.createElement("div");
        el.textContent = msg;
        el.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:99999;background:#0f172a;color:#ffd400;border:1px solid rgba(255,212,0,.45);padding:10px 16px;border-radius:999px;font-size:13px;font-weight:700;box-shadow:0 8px 24px rgba(0,0,0,.35);pointer-events:none;white-space:nowrap;";
        document.body.appendChild(el);
        setTimeout(() => { try { el.remove(); } catch (e) {} }, 4000);
      };
      if (document.body) run();
      else document.addEventListener("DOMContentLoaded", run, { once: true });
    } catch (e) {}
  }

  function trackingBlocked() {
    try {
      if (window.parent && window.parent !== window) return "preview-iframe";
      const params = new URLSearchParams(location.search || "");
      if (params.has("moa_preview")) return "preview";
      if (params.has("moa_notrack")) {
        const val = params.get("moa_notrack");
        if (val === "0" || val === "off" || val === "false") {
          try { localStorage.removeItem(OPTOUT_KEY); } catch (e) {}
          showOptoutToast("이 기기의 방문 통계 제외가 해제되었습니다");
        } else {
          try { localStorage.setItem(OPTOUT_KEY, "1"); } catch (e) {}
          showOptoutToast("✓ 이 기기는 이제 방문 통계에서 제외됩니다");
          return "optout";
        }
      }
      try {
        if (localStorage.getItem(OPTOUT_KEY) === "1") return "optout";
      } catch (e) {}
      if (location.protocol === "file:") return "local";
      const host = String(location.hostname || "").toLowerCase();
      if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") return "local";
    } catch (err) {
      return "unknown";
    }
    return "";
  }

  function newSessionId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
      if (window.crypto && window.crypto.getRandomValues) {
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        return Array.prototype.map.call(bytes, (b) => ("0" + b.toString(16)).slice(-2)).join("");
      }
    } catch (err) { /* 아래 대체값 */ }
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function ensureSessionId() {
    const valid = (value) => /^[A-Za-z0-9._-]{8,64}$/.test(String(value || ""));
    try {
      const saved = sessionStorage.getItem(TRACK.sessionKey);
      if (valid(saved)) return saved;
    } catch (err) { /* 저장소를 못 쓰면 메모리로 */ }
    const id = newSessionId();
    try { sessionStorage.setItem(TRACK.sessionKey, id); } catch (err) { /* 무시 */ }
    return id;
  }

  function detectDevice() {
    const ua = String((navigator && navigator.userAgent) || "");
    const width = Number(window.innerWidth) || (window.screen && window.screen.width) || 0;
    const touch = ("ontouchstart" in window) || Number(navigator && navigator.maxTouchPoints) > 1;
    const ipad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touch);
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) && width < 700 ? "mobile" : "tablet";
    if (ipad) return "tablet";
    if (/iPhone|iPod/i.test(ua) || /Mobile/i.test(ua)) return "mobile";
    // UA 로 알 수 없는 환경(태블릿 모드·앱 내 웹뷰)은 화면 폭과 손가락 입력으로 고른다.
    let coarse = false;
    try { coarse = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches); } catch (err) { coarse = false; }
    if (width && width <= 640 && (coarse || touch)) return "mobile";
    if (width && width <= 1024 && coarse) return "tablet";
    return "desktop";
  }

  function detectOs() {
    const ua = String((navigator && navigator.userAgent) || "");
    if (/Android/i.test(ua)) return "Android";
    if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
    if (/Windows/i.test(ua)) return "Windows";
    if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
    return "etc";
  }

  function trackReferrer() {
    const raw = String(document.referrer || "");
    if (!raw) return "direct";
    try {
      const url = new URL(raw);
      const host = String(url.hostname || "").replace(/^www\d*\./, "").toLowerCase();
      if (!host || host === String(location.hostname || "").toLowerCase()) return "direct";
      return host;
    } catch (err) {
      return "direct";
    }
  }

  function trackUtmSource() {
    try {
      const params = new URLSearchParams(location.search || "");
      return String(params.get("utm_source") || "").trim().toLowerCase().slice(0, 40);
    } catch (err) {
      return "";
    }
  }

  /* 화면 경로 — 해시 라우터라도 검색어(?q=)는 남기지 않는다. */
  function trackPath() {
    const pathname = String(location.pathname || "");
    const hash = String(location.hash || "").split("?")[0];
    const full = pathname + hash;
    return (full || "/").slice(0, 120);
  }

  /* 지금 열려 있는 탭의 이름 — 화면에 보이는 글자를 우선 쓰고, 없으면 해시 이름을 쓴다. */
  function activeTabInfo() {
    const scope = (state.options && state.options.tabContainer) || document;
    let active = null;
    try {
      active = scope.querySelector('[data-tab].is-active,[data-nav].is-active,[data-tab].active,[data-nav].active');
    } catch (err) { active = null; }
    if (!active) {
      try { active = document.querySelector('[data-tab].is-active,[data-nav].is-active,[data-tab].active,[data-nav].active'); } catch (err) { active = null; }
    }
    if (active) {
      const label = String(active.textContent || "").replace(/\s+/g, " ").trim();
      if (label && label.length <= 40) return { tab: label, id: active.getAttribute("data-tab") || active.getAttribute("data-nav") || "" };
      const id = active.getAttribute("data-tab") || active.getAttribute("data-nav") || "";
      return { tab: (id || label).slice(0, 40), id };
    }
    const hash = String(location.hash || "").replace(/^#\/?/, "").split("?")[0];
    return { tab: (hash || "").slice(0, 40), id: hash || "" };
  }

  /* 이전 화면의 체류를 기록한다. is_view 가 true 인 행만 '조회수'로 센다. */
  function trackFlush(reason) {
    if (!track.enabled || !track.sessionId) return;
    const now = Date.now();
    if (!track.start) { track.start = now; return; }
    const seconds = Math.min(TRACK.maxDuration, Math.max(0, Math.round((now - track.start) / 1000)));
    const isView = Boolean(track.newView);
    if (!isView && seconds < 1) { track.start = now; return; }
    const payload = {
      site: track.site,
      session_id: track.sessionId,
      page_path: track.path || trackPath(),
      tab_name: track.tab || "",
      duration_sec: seconds,
      referrer_host: track.referrer,
      utm_source: track.utm,
      device_type: track.device,
      os_name: track.os,
      is_view: isView
    };
    track.newView = false;
    track.start = 0;
    track.sent += 1;
    trackSend(payload);
    return reason;
  }

  function trackSend(payload) {
    const body = JSON.stringify(payload);
    try {
      if (navigator && typeof navigator.sendBeacon === "function") {
        const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        if (navigator.sendBeacon(TRACK.endpoint, blob)) return;
      }
    } catch (err) { /* fetch 로 다시 시도 */ }
    try {
      fetch(TRACK.endpoint, {
        method: "POST",
        body: body,
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        mode: "cors",
        credentials: "omit",
        keepalive: true
      }).catch(() => {});
    } catch (err) { /* 통계 실패는 화면 동작을 막지 않는다 */ }
  }

  /* 탭·화면이 바뀌었는지 확인 — 바뀌었으면 이전 화면을 마감하고 새 화면을 연다. */
  function trackScreenChanged() {
    if (!track.enabled) return;
    const path = trackPath();
    const info = activeTabInfo();
    if (path === track.path && info.tab === track.tab) return;
    // 화면은 그대로인데 탭 이름만 뒤늦게 채워진 경우(첫 진입 때 내비 강조가 늦게 붙는 사이트) —
    // 같은 화면으로 보고 이름만 바꾼다. 그렇지 않으면 한 번 방문이 두 번으로 세진다.
    if (path === track.path && (!track.tab || !info.tab)) {
      track.tab = info.tab || track.tab;
      return;
    }
    trackFlush("switch");
    track.path = path;
    track.tab = info.tab;
    track.newView = true;
    track.start = Date.now();
  }

  function trackSoon() {
    window.clearTimeout(trackTimer);
    trackTimer = window.setTimeout(trackScreenChanged, 80);
  }

  function startTracking(script) {
    if (track.enabled) return;
    const blocked = trackingBlocked();
    if (blocked) { track.skipped = blocked; return; }
    const endpoint = (script && script.getAttribute("data-track-endpoint")) || TRACK.endpoint;
    if (endpoint) TRACK.endpoint = endpoint;
    track.site = trackSiteOf(script, state.config);
    track.sessionId = ensureSessionId();
    track.device = detectDevice();
    track.os = detectOs();
    track.referrer = trackReferrer();
    track.utm = trackUtmSource();
    track.path = trackPath();
    track.tab = activeTabInfo().tab;
    track.newView = true;
    track.start = Date.now();
    track.enabled = true;

    // 탭 버튼 클릭·주소 변경·화면 다시 그리기
    document.addEventListener("click", (event) => {
      const el = event.target && event.target.closest ? event.target.closest(TRACK.tabSelector) : null;
      if (el) trackSoon();
    }, true);
    window.addEventListener("hashchange", trackSoon);
    window.addEventListener("popstate", trackSoon);
    document.addEventListener("moa:route-rendered", trackSoon);

    // 탭 숨김·복귀, 페이지를 떠날 때
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") trackFlush("hidden");
      else if (track.enabled && !track.start) {
        // 같은 화면으로 돌아왔다 — 체류만 이어 세고 조회수는 늘리지 않는다.
        track.start = Date.now();
        track.newView = false;
      }
    });
    window.addEventListener("pagehide", () => trackFlush("pagehide"));

    // 탭 강조(class)만 바뀌는 사이트를 위해 탭 영역을 지켜본다.
    const nav = state.options && state.options.tabContainer;
    if (nav && window.MutationObserver) {
      try {
        new MutationObserver(trackSoon).observe(nav, { subtree: true, attributes: true, attributeFilter: ["class"] });
      } catch (err) { /* 관측 실패해도 클릭·hashchange 로 동작한다 */ }
    }
  }

  document.addEventListener("moa:route-rendered", () => { refresh(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
  else autoInit();

  window.MoaSiteAnalytics = {
    state: track,
    endpoint: () => TRACK.endpoint,
    flush: trackFlush,
    path: trackPath,
    tab: () => activeTabInfo().tab
  };

  window.MoaSiteConfig = {
    version: VERSION,
    load,
    apply,
    applyPreview,
    activateTab,
    refresh,
    mountBanner,
    mountPopup,
    applyTabs,
    applySections,
    applyCopy,
    orderTabs: applyTabs,
    preview: PREVIEW,
    analytics: track,
    state
  };
  Object.defineProperty(window.MoaSiteConfig, "config", { get: () => state.config });
  /* 이번 화면의 설정을 어디서 받았는지(api|file|"") — 점검용. */
  Object.defineProperty(window.MoaSiteConfig, "source", { get: () => state.source });
})();
