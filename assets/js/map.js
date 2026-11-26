/* =========================================================================
 * 포켓몬카드모아 — 실제 지도 엔진 (카카오맵 JavaScript SDK + 카카오 장소 검색)
 *
 * · 지도 타일: 카카오맵 JavaScript SDK (라이트·저채도 느낌은 카카오 기본 스타일 그대로)
 * · 주변 매장: 카카오 장소 검색(Places) — 편의점 카테고리(CS2) 병렬 조회 +
 *   결과에 없는 브랜드는 브랜드별 키워드 검색으로 보충한다(편의점 4사만:
 *   GS25·CU·세븐일레븐·이마트24). 해외 Overpass API 왕복이 없어 1초 안팎에 끝난다.
 *   카카오 장소 검색은 한 번에 최대 45건이라, 3km 이하는 중심 1곳에서 3페이지를,
 *   5km·20km는 중심 + 방위 오프셋 격자로 여러 번 나눠 조회해 외곽 매장까지 받는다.
 * · 동네·역 이름 검색도 카카오 장소 검색(keywordSearch)으로 즉시 조회한다.
 * · 지도를 드래그해 놓으면 그 자리(지도 중심)를 새 중심으로 주변 매장을 다시 찾는다.
 *   코드로 옮기는 이동(지역 선택·반경 맞춤·클러스터 확대·매장 이동)은 900ms 가드로,
 *   연속 드래그는 450ms 디바운스와 '진행 중 조회는 끝난 뒤 한 번만' 으로 묶어
 *   중계 서버에 불필요한 요청이 쌓이지 않는다.
 * · 매장 마커는 둥근 핀 대신 상태가 바로 읽히는 말풍선(알약) 마커
 *   (kakao.maps.CustomOverlay): 재고 있음 = 브랜드 색 말풍선(`CU · 입고 2종`),
 *   확인/없음 = 화이트·그레이 알약. 매장마다 보유·취급 카드 상품명을 함께 표시한다.
 * · 실시간 조회가 끝나지 않거나 응답 제한(쿼터·차단)이면 내장된 실제 좌표
 *   스냅샷으로 부드럽게 대체하고 배지에 상태를 표기한다. 카카오 SDK는 등록된
 *   도메인(https://moa-kr.github.io)에서만 지도를 그리므로, 그 밖의 주소
 *   (file://·미등록 프리뷰)에서는 안내 문구와 함께 스냅샷 목록으로 동작한다.
 * · 재고 수량은 편의점 앱에서 실시간으로 조회한 실제 값만 쓰고,
 *   받지 못한 매장은 「미조회」로 표시한다(샘플·추정 수량 없음).
 * ========================================================================= */
window.PokeMoaMap = (function () {
  "use strict";

  var D = window.POKEMOA_DATA;
  /* 카카오디벨로퍼스 앱 `포켓몬카드모아`(ID 1655851) JavaScript 키.
     JS SDK 도메인에 https://moa-kr.github.io 가 등록되어 있다. */
  var KAKAO_KEY = "63b35e228dacdcc4d0e31f83a7738f22";
  var KAKAO_SDK = "https://dapi.kakao.com/v2/maps/sdk.js?appkey=" + KAKAO_KEY +
    "&libraries=services&autoload=false";
  var SDK_TIMEOUT = 9000;        /* SDK·지도 초기화를 이 시간까지 기다린다 */
  var SEARCH_TIMEOUT = 8000;     /* 다점 격자 조회가 늦으면 내장 좌표로 먼저 표시 */
  /* 사용자가 지도를 드래그해 놓았을 때 — 그 자리를 새 중심으로 다시 찾는다 */
  var DRAG_WAIT = 450;           /* 드래그를 놓은 뒤 이만큼 조용하면 한 번만 조회한다 */
  var DRAG_MIN_M = 150;          /* 중심이 이보다 덜 움직였으면 같은 자리로 본다(헛 조회 방지) */
  var PROGRAM_GUARD = 900;       /* 코드로 지도를 옮긴 직후 들어온 dragend 는 무시한다 */
  var MAX_MARKERS = 450;         /* 1km·3km — v1.8: 중계가 최대 470곳을 주므로 400~500곳까지 그린다 */
  var MAX_MARKERS_5 = 500;       /* 5km — 내링·외링 17점 격자로 받은 외곽 매장까지 */
  var MAX_MARKERS_20 = 500;      /* 20km — 반경 전역(포항 남구·양덕·유강·오천 등) */
  /* 5km·20km 격자 조회의 방위(도, 북=0·동=90) */
  var DIRS4 = [0, 90, 180, 270];
  var DIRS8 = [0, 45, 90, 135, 180, 225, 270, 315];
  var BRAND_QUERY = { gs25: "GS25", cu: "CU", seven: "세븐일레븐", emart24: "이마트24" };
  var BRAND_ORDER_LIST = ["gs25", "cu", "seven", "emart24"];
  /* 세븐일레븐 정책상 매장 위치만 안내하는 브랜드 — 세븐일레븐은 자사 앱·점포 API 가 외부 조회를 403 으로
     막아(2026-11-20 집 태블릿 IP·앱 UA 로 재확인) 재고는 받을 수 없다. 매장 위치·핀·길찾기는
     그대로 두고, 재고는 세븐앱에서 확인하도록 안내한다(실패가 아니라 세븐일레븐 정책 안내). */
  var POLICY_LOCATION_ONLY = { seven: 1 };
  var POLICY_NOTICE = "세븐일레븐 앱에서 확인";
  function isPolicyBrand(b) { return !!POLICY_LOCATION_ONLY[b]; }
  /* 오프라인 판매처(마트·아트박스·공식 자판기·공인 카드샵) — 편의점 4사와 함께 지도에 올린다.
     재고 공개 데이터가 없어 모두 '매장 확인' 또는 '공식 설치 지점'으로만 표시한다. */
  var OFFLINE_IDS = ["mart", "artbox", "vending", "cardshop"];
  var OFFLINE_LABEL = { mart: "이마트·롯데마트 등", artbox: "아트박스", vending: "공식 자판기", cardshop: "공인 카드샵" };
  /* 마트는 업종이 아니라 체인이 이름에 드러난다(이마트·롯데마트·홈플러스·토이저러스).
     지도 말풍선·매장 배지에는 '대형마트' 대신 그 매장의 실제 체인명을 적는다. */
  var MART_CHAIN_RE = [
    ["이마트", /^이마트/],
    ["롯데마트", /^롯데마트/],
    ["홈플러스", /^홈플러스/],
    ["토이저러스", /^토이저러스/]
  ];
  function martChainOf(name) {
    var n = String(name || "").trim();
    for (var i = 0; i < MART_CHAIN_RE.length; i++) {
      if (MART_CHAIN_RE[i][1].test(n)) return MART_CHAIN_RE[i][0];
    }
    return "";
  }
  var OFFLINE_CAP = 26;      /* 마트·아트박스 실시간 검색 결과 상한(편의점 마커를 밀어내지 않게) */

  /* 도심(allow20:false) 지역 좌표 — 내 위치가 이 근처면 20km를 막는다 */
  function metroRegions() {
    return D.regions.filter(function (r) { return r.allow20 === false; });
  }
  var METRO_RADIUS_M = 12000;   /* 내 위치가 대도시 도심 반경 12km 안이면 도심으로 본다 */

  var st = {
    map: null,
    ready: false,
    sdkError: false,
    layer: [],        /* 현재 지도에 올린 CustomOverlay 목록 */
    ring: null,
    meMarker: null,
    markers: {},      /* id -> { ov, node } */
    all: [],          /* 현재 중심 기준 조회 결과(반경 밖 포함) */
    visible: [],
    brand: "all",
    product: "all",
    stockOnly: false,
    showOffline: true,
    cardShopGeo: null,   /* 공인 카드샵 좌표 캐시(카카오 장소 검색으로 한 번만 확인) */
    compact: false,
    cluster: false,
    radius: 3000,
    regionId: "seoul-gwanghwamun",
    origin: "region",  /* region | geo | search */
    center: null,
    source: "snapshot",/* live | snapshot */
    fetchedAt: null,
    loading: { tiles: true, data: true },
    selectedId: null,
    seq: 0,
    geoBusy: false,
    lastError: null,
    fetchedRadius: 0,
    fetchedBand: "",   /* 마지막으로 조회한 반경 구분(3 / 5 / 20) */
    snapshotLabel: "",
    snapshotEmpty: false,  /* 이 지역에 내장 좌표 스냅샷이 한 곳도 없는지(확장 지역) */
    pendingLive: false,
    badgeWasSnapshot: false,
    metro: false,
    allow20: true,
    relay: null,        /* 실시간 재고 조회 요약 { ok, sources, at, count } */
    relayPayload: null, /* 마지막 조회 응답 — 지도 매장을 새로 그린 뒤에도 다시 얹는다 */
    relayAt: "",
    emart: null,        /* 이마트 실시간 재고 요약 { ok, count, at, stat } */
    emartPayload: null, /* 마지막 이마트 조회 결과 — 지도 매장을 새로 그린 뒤에도 다시 얹는다 */
    emartSeq: 0,        /* 이마트 조회 순번 — 늦게 도착한 이전 응답을 버린다 */
    started: false,     /* 첫 자동 조회를 했는지 — 첫 화면은 진행률 패널을 띄우지 않는다 */
    programAt: 0,       /* 코드로 지도를 마지막으로 옮긴 시각(setView·fitRing·panTo·확대) */
    dragTimer: null,    /* 드래그 후 재조회 대기 타이머 */
    dragPoint: null     /* 드래그로 들어온 가장 최근 중심(조용해지면 이 자리로 조회) */
  };

  var el = {};

  /* ------------------------------------------------------------- 유틸 */
  function emit(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
  }

  function region(id) {
    for (var i = 0; i < D.regions.length; i++) if (D.regions[i].id === id) return D.regions[i];
    return D.regions[0];
  }

  /* id 로 정확히 찾는다(없으면 null) — 저장해 둔 지역 id 검사용 */
  function findRegion(id) {
    if (!id) return null;
    for (var i = 0; i < D.regions.length; i++) if (D.regions[i].id === id) return D.regions[i];
    return null;
  }

  function meters(a, b) {
    var R = 6371008.8;
    var dLat = (b.lat - a.lat) * Math.PI / 180;
    var dLng = (b.lng - a.lng) * Math.PI / 180;
    var la1 = a.lat * Math.PI / 180;
    var la2 = b.lat * Math.PI / 180;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* 중심에서 dist(m) 떨어진 방위각(도, 북=0·동=90) 좌표 */
  function offsetPoint(center, dist, angleDeg) {
    var R = 6371008.8;
    var a = angleDeg * Math.PI / 180;
    var dLat = (dist * Math.cos(a)) / R * 180 / Math.PI;
    var dLng = (dist * Math.sin(a)) / (R * Math.cos(center.lat * Math.PI / 180)) * 180 / Math.PI;
    return { lat: center.lat + dLat, lng: center.lng + dLng };
  }

  /* 고리 위 방위 지점들 — 중심에서 dist(m) 떨어진 곳을 ringRadius(m)로 pages페이지씩 */
  function pushRing(pts, center, dist, ringRadius, pages, dirs) {
    dirs.forEach(function (a) {
      var o = offsetPoint(center, dist, a);
      for (var p = 1; p <= pages; p++) {
        pts.push({ lat: o.lat, lng: o.lng, radius: ringRadius, page: p });
      }
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0);
  }

  /* 매장 재고 상태: 편의점 앱 API 를 대신 조회해 주는 실시간 조회(relay)에서
     실제 수량을 받은 매장만 「재고 있음/없음」으로 표시하고, 받지 못한 매장은
     수량을 지어내지 않고 「미조회」로 둔다. (샘플 재고는 쓰지 않는다) */
  function unknownStatus() {
    return "check";
  }

  /* ------------------------------------------------------- 브랜드 분류 */
  /* 편의점 4사만 분류한다. 그 밖의 업종·브랜드는 null로 돌려 화면에 올리지 않는다.
     카카오 장소 검색 결과의 상호(place_name)·업종(category_name)을 함께 본다. */
  var NAME_RULES = [
    ["gs25", /gs\s*25|지에스\s*25/],
    ["seven", /세븐일레븐|7\s*-?\s*eleven|seven\s*eleven/],
    ["emart24", /emart\s*24|이마트\s*24|emart24/]
  ];
  function classify(tags) {
    tags = tags || {};
    var n = [tags.name, tags["name:ko"], tags.brand, tags["brand:ko"], tags.operator, tags.category]
      .filter(Boolean).join(" ").toLowerCase();
    /* CU는 짧아서 부분 일치하면 오탐이 나므로 토큰 단위로 확인 */
    var tokens = n.split(/[^a-z0-9가-힣]+/);
    if (tokens.indexOf("cu") !== -1) return "cu";
    for (var i = 0; i < NAME_RULES.length; i++) {
      if (NAME_RULES[i][1].test(n)) return NAME_RULES[i][0];
    }
    return null;
  }

  function displayName(name, brand) {
    var meta = D.brandMeta[brand] || { label: brand };
    var nm = (name || "").trim();
    if (!nm) return meta.label + " (명칭 미등록)";
    var norm = nm.replace(/\s+/g, "").toLowerCase();
    var base = meta.label.replace(/\s+/g, "").toLowerCase();
    if (norm === base) return meta.label;
    return nm;
  }

  /* --------------------------------------------- 장소 → 매장 객체 */
  function toStore(o) {
    var id = o.type + "-" + o.id;
    var offline = !!o.place;
    return {
      id: id,
      name: displayName(o.name, o.brand),
      brand: o.brand,
      brandLabel: (D.brandMeta[o.brand] || {}).label || o.brand,
      shop: o.shop || (offline ? "offline" : ""),
      lat: o.lat,
      lng: o.lng,
      street: o.street || "",
      distance: 0,
      status: unknownStatus(), /* 실시간 재고를 받기 전에는 수량 미확인 */
      observed: "",
      unit: "",
      note: o.note || "",
      products: [],
      phone: o.phone || "",
      placeUrl: o.placeUrl || "",
      source: o.source,
      offline: offline,
      official: !!o.official,
      placeKind: o.place || "",
      /* 마트 매장의 체인명(이마트·롯데마트·홈플러스·토이저러스) — 화면 표기용 */
      martChain: o.martChain || ""
    };
  }

  function prepare(list, center, source) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var s = toStore(list[i]);
      s.source = source;
      s.distance = meters(center, s);
      /* 매장 위치만 받은 상태 — 취급 상품·수량은 지어내지 않는다.
         실시간 재고 조회가 그 매장의 실재고를 주면 그때 실제 상품만 붙는다. */
      s.products = [];
      out.push(s);
    }
    return out;
  }

  /* ------------------------------------------------------ 카카오 SDK 로드 */
  /* index.html이 SDK 스크립트를 미리 넣어 두지만(autoload=false), 미리보기·
     스크립트 지연에 대비해 없으면 직접 불러온 뒤 kakao.maps.load를 부른다. */
  function ensureKakao(cb) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      cb(false);
    }, SDK_TIMEOUT);
    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      cb(ok);
    }
    function boot() {
      if (!window.kakao || !window.kakao.maps) { finish(false); return; }
      try {
        window.kakao.maps.load(function () { finish(!!window.kakao.maps.Map); });
      } catch (e) {
        finish(false);
      }
    }
    if (window.kakao && window.kakao.maps) { boot(); return; }
    var s = document.createElement("script");
    s.async = true;
    s.src = KAKAO_SDK;
    s.onload = boot;
    s.onerror = function () { finish(false); };
    document.head.appendChild(s);
  }

  /* ---------------------------------------------------------- 지도 생성 */
  /* 카카오 지도는 level 1(가까이)~14(멀리)를 쓴다. 기존 Leaflet 줌(9~19)과
     같은 느낌이 나도록 level = 20 - zoom 으로 맞춘다(줌 15 → level 5). */
  function levelForZoom(z) {
    return Math.max(1, Math.min(14, 20 - (z || 15)));
  }

  function latlng(lat, lng) { return new window.kakao.maps.LatLng(lat, lng); }

  /* --------------------------------------- 지도 드래그 → 중심 기준 재검색 */
  /* 사용자가 지도를 끌어 놓은 자리(지도 중심)를 새 검색 중심으로 삼아 주변 매장을
     다시 찾는다. 코드로 지도를 옮기는 동작(setView·fitRing·클러스터 확대·매장 이동)은
     `programMove()`로 시각을 남겨 두고, 그 직후 들어온 dragend 는 재조회하지 않는다
     (지도 이동 → 재조회 → 다시 지도 이동 같은 무한 루프 방지). */
  function programMove() {
    st.programAt = Date.now();
    /* 코드로 중심을 옮겼으면 드래그로 대기하던 재조회는 취소한다(지역 선택을 되돌리지 않게) */
    clearTimeout(st.dragTimer);
    st.dragTimer = null;
    st.dragPoint = null;
  }

  function mapCenterPoint() {
    if (!st.map) return null;
    try {
      var c = st.map.getCenter();
      if (!c) return null;
      var lat = typeof c.getLat === "function" ? c.getLat() : c.lat;
      var lng = typeof c.getLng === "function" ? c.getLng() : c.lng;
      if (!isFinite(lat) || !isFinite(lng)) return null;
      return { lat: Number(lat), lng: Number(lng) };
    } catch (e) { return null; }
  }

  /* 드래그를 다시 시작하면 아직 대기 중인 재조회를 버린다(끌던 중간 좌표로 찾지 않게) */
  function onMapDragStart() {
    clearTimeout(st.dragTimer);
    st.dragTimer = null;
    st.dragPoint = null;
  }

  /* 드래그를 놓을 때마다 마지막 자리만 기억하고, 잠잠해지면(DRAG_WAIT) 한 번만 조회한다.
     여러 번 끌어도 조회는 한 번이고, 새 자리가 마지막 것이 된다. */
  function onMapDragEnd() {
    if (!st.ready || !st.map) return;
    if (Date.now() - st.programAt < PROGRAM_GUARD) return;   /* 코드로 옮긴 직후 */
    var c = mapCenterPoint();
    if (!c) return;
    st.dragPoint = c;
    clearTimeout(st.dragTimer);
    st.dragTimer = setTimeout(runDragSearch, DRAG_WAIT);
  }

  function runDragSearch() {
    clearTimeout(st.dragTimer);
    st.dragTimer = null;
    var c = st.dragPoint;
    st.dragPoint = null;
    if (!c) return;
    if (st.center && meters(st.center, c) < DRAG_MIN_M) return;  /* 같은 자리 — 그대로 둔다 */
    /* 앞선 조회가 아직 도는 중이면 버리지 않고, 끝난 뒤 이 자리로 한 번만 다시 찾는다 */
    if (st.loading.data) { st.dragPoint = c; return; }
    searchAtCenter(c);
  }

  /* 지도 중심 기준 재조회 — 지역 선택과 같은 초기화 경로를 쓰되,
     사용자가 끌어 놓은 화면은 되돌리지 않는다(fitRing·setView 없음). */
  function searchAtCenter(point) {
    st.origin = "map";
    st.regionId = "";
    st.center = { lat: point.lat, lng: point.lng };
    st.metro = metroRegions().some(function (r) {
      return meters(st.center, { lat: r.lat, lng: r.lng }) < METRO_RADIUS_M;
    });
    st.allow20 = !st.metro;
    if (!st.allow20 && st.radius > 5000) st.radius = 5000;
    resetStateForNewCenter();
    /* 반경 원이 곧 '검색 중심' 표시 — 새 중심으로 옮겨 어디를 기준으로 찾는지 보이게 한다 */
    if (st.ring) {
      try {
        st.ring.setPosition(latlng(st.center.lat, st.center.lng));
        st.ring.setRadius(st.radius);
      } catch (e) {}
    }
    st.loading.tiles = false;
    renderMarkers();
    emit("pokemoa:center-changed", {
      lat: st.center.lat,
      lng: st.center.lng,
      radius: st.radius,
      origin: "map"
    });
    load();
  }

  function buildMap() {
    if (st.map) return;
    var K = window.kakao.maps;
    var r = region(st.regionId);
    /* 마지막 검색 위치를 복원했으면 서울로 그렸다가 옮기지 않고 그 자리에서 지도를 연다 */
    var at = st.origin !== "region" && st.center ? st.center : { lat: r.lat, lng: r.lng };
    var zoom = st.origin !== "region" && st.center
      ? (st.radius >= 20000 ? 12 : 15)
      : (r.zoom || 15);
    st.map = new K.Map(el.container, {
      center: latlng(at.lat, at.lng),
      level: levelForZoom(zoom),
      draggable: true,
      scrollwheel: true,
      disableDoubleClickZoom: false
    });
    st.ready = true;

    try {
      st.map.addControl(new K.ZoomControl(), K.ControlPosition.RIGHT);
    } catch (e) {}

    /* 타일이 그려지면 로딩 오버레이의 1단계를 내린다(이벤트가 없으면 2.5초 뒤) */
    function tilesReady() {
      if (!st.loading.tiles) return;
      st.loading.tiles = false;
      emit("pokemoa:loading", loadingState());
    }
    try {
      K.event.addListener(st.map, "tilesloaded", tilesReady);
    } catch (e) {}
    setTimeout(tilesReady, 2500);

    st.ring = new K.Circle({
      center: latlng(at.lat, at.lng),
      radius: st.radius,
      strokeWeight: 1.5,
      strokeColor: "#2f6df6",
      strokeOpacity: 0.55,
      strokeStyle: "dashed",
      fillColor: "#2f6df6",
      fillOpacity: 0.05
    });
    st.ring.setMap(st.map);

    applyZoomMode();
    try {
      K.event.addListener(st.map, "zoom_changed", function () {
        if (applyZoomMode()) renderMarkers();
      });
    } catch (e) {}
    /* 사용자가 지도를 끌어 놓으면 그 중심으로 다시 찾는다(코드 이동은 programMove로 제외) */
    try {
      K.event.addListener(st.map, "dragstart", onMapDragStart);
      K.event.addListener(st.map, "dragend", onMapDragEnd);
    } catch (e) {}
  }

  /* ------------------------------------------------------------- 마커 */
  /* 줌 단계에 따라 마커 모양을 바꾼다.
     · 가까이(level < 7): 브랜드 색 말풍선(알약) + 보유 상품
     · 5km 보기(level 7~9): 작은 브랜드 칩·점 — 매장이 많아도 고르게 퍼진다
     · 20km 보기(level >= 10): 구역별 `N곳` 묶음 */
  var CHIP_LEVEL = 7;
  var CLUSTER_LEVEL = 10;
  var CHIP_CELL = 34;          /* 5km 보기에서 칩이 겹치는지 판단하는 칸 크기(px) — 브랜드명 칩 폭에 맞춰 조금 넓혔다 */
  function applyZoomMode() {
    var lv = st.map ? st.map.getLevel() : 0;
    var compact = lv >= CHIP_LEVEL;
    var cluster = lv >= CLUSTER_LEVEL;
    var changed = compact !== st.compact || cluster !== st.cluster;
    st.compact = compact;
    st.cluster = cluster;
    return changed;
  }

  function stockProductCount(s) {
    var n = 0;
    (s.products || []).forEach(function (p) {
      if (p.state === "in" || p.state === "low") n += 1;
    });
    return n;
  }

  function pillHtml(s) {
    var b = D.brandMeta[s.brand] || { short: "?", color: "#1b2a4a", ink: "#ffffff" };
    var brandVar = '--brand:' + b.color + ';--brand-ink:' + (b.ink || "#ffffff");
    var html;
    if (st.compact) {
      /* 넓게 볼 때는 점·칩만 남긴다 — 세븐일레븐 점은 '미조회(빈 원)'가 아닌 중립 회청색 */
      var compactPolicy = isPolicyBrand(s.brand) ? " is-policy" : "";
      html = s.status === "in"
        ? '<span class="pm-pill is-chip status-in' + compactPolicy + '" style="' + brandVar + '">' +
          '<i class="pm-dot is-in"></i>' + b.short + "</span>"
        : '<span class="pm-pill is-dot status-' + s.status + compactPolicy + '"></span>';
    } else if (s.status === "in" && s.relay) {
      /* 실제 조회에서 수량 1개 이상 확인 — 브랜드 색 + 초록 점으로 "재고 있음"을 한눈에 */
      var q = s.relayQty || 0;
      html = '<span class="pm-pill status-in is-relay" style="' + brandVar + '">' +
        '<i class="pm-dot is-in"></i>' +
        "<b>" + b.short + "</b><span>재고 있음" + (q ? " · " + q + "개" : "") + "</span></span>";
    } else if (s.status === "in") {
      var n = stockProductCount(s);
      html = '<span class="pm-pill status-in" style="' + brandVar + '">' +
        '<i class="pm-dot is-in"></i>' +
        "<b>" + b.short + "</b><span>재고 있음" + (n ? " · " + n + "종" : "") + "</span></span>";
    } else if (s.offline && (s.brand === "mart" || s.brand === "artbox")) {
      /* 오프라인 판매처는 재고 조회 대상이 아니다 — 방문 확인. 마트는 체인명을 그대로 적는다 */
      var offName = (s.brand === "mart" && s.martChain) ? s.martChain : b.short;
      html = '<span class="pm-pill status-' + s.status + ' is-offline" style="--brand:' + b.color + '">' +
        '<i class="pm-dot" style="background:' + b.color + '"></i>' +
        "<span>" + offName + " · 매장확인</span></span>";
    } else if (isPolicyBrand(s.brand)) {
      /* 세븐일레븐 — 재고는 세븐일레븐 정책상 안내하지 않고 매장 위치만 (실패 색 아님) */
      html = '<span class="pm-pill status-check is-policy" style="--brand:' + b.color + '">' +
        '<i class="pm-dot" style="background:#8aa0bd"></i>' +
        "<span>" + b.short + " · 위치 안내</span></span>";
    } else if (s.emart) {
      /* 이마트(대형마트) — 이마트 앱 점포 재고를 직접 조회한 값. 상태 점 색으로 재고/비공개/품절을 가른다. */
      var eDot = s.emartState === "in" ? '<i class="pm-dot is-in"></i>'
        : s.emartState === "undisclosed" ? '<i class="pm-dot" style="background:#c9a227"></i>'
        : '<i class="pm-dot" style="background:#9aa7b8"></i>';
      var eTail = s.emartClosed ? " · 휴무" : (s.emartOutside ? " · 영업시간 외" : "");
      html = '<span class="pm-pill status-' + s.status + ' is-emart" style="' + brandVar + '">' +
        eDot + "<b>" + b.short + "</b><span>" + s.emartLabel + eTail + "</span></span>";
    } else if (s.relay) {
      /* 실제 조회가 성공했고 재고 0으로 확인 — 차분한 회색 '없음' */
      html = '<span class="pm-pill status-none is-relay-none" style="--brand:' + b.color + '">' +
        '<i class="pm-dot" style="background:#9aa7b8"></i>' +
        "<span>" + b.short + " · 없음</span></span>";
    } else {
      /* 아직 재고 조회가 닿지 않은 브랜드 — '미조회' (모호한 '확인' 금지).
         브랜드 색·노란 점과 겹치지 않도록 '빈 원(○)'으로 구분한다. */
      html = '<span class="pm-pill status-check is-unchecked" style="--brand:' + b.color + ';--brand-ink:' + (b.ink || "#ffffff") + '">' +
        '<i class="pm-dot is-hollow"></i>' +
        "<span>" + b.short + " · 미조회</span></span>";
    }
    return html;
  }

  function pillNode(s, label) {
    var node = document.createElement("div");
    node.className = "pm-marker status-" + s.status + (st.compact ? " is-compact" : "");
    node.innerHTML = pillHtml(s);
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", label);
    node.title = label;
    node.addEventListener("click", function (e) {
      e.stopPropagation();
      select(s.id, true);
    });
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select(s.id, true);
      }
    });
    return node;
  }

  function addOverlay(node, lat, lng, opts) {
    var o = opts || {};
    var ov = new window.kakao.maps.CustomOverlay({
      position: latlng(lat, lng),
      content: node,
      xAnchor: o.xAnchor != null ? o.xAnchor : 0.5,
      yAnchor: o.yAnchor != null ? o.yAnchor : 1,
      zIndex: o.zIndex || 100,
      clickable: !!o.clickable
    });
    ov.setMap(st.map);
    st.layer.push(ov);
    return ov;
  }

  function clearOverlays() {
    st.layer.forEach(function (ov) { try { ov.setMap(null); } catch (e) {} });
    st.layer = [];
    st.markers = {};
  }

  function brandOrder(b) {
    return ({ gs25: 0, cu: 1, seven: 2, emart24: 3, emart: 4 })[b] || 9;
  }

  /* 같은 화면 칸(px)에 들어온 매장을 한 묶음으로 모은다 — proj가 없으면 좌표 스케일로 대신한다 */
  function groupStores(list, cell) {
    var groups = {};
    var proj = null;
    try { proj = st.map.getProjection(); } catch (e) {}
    list.forEach(function (s) {
      var pt;
      try { pt = proj.containerPointFromCoords(latlng(s.lat, s.lng)); } catch (e) { pt = null; }
      if (!pt) { pt = { x: s.lng * 1000, y: s.lat * 1000 }; }
      var key = Math.floor(pt.x / cell) + ":" + Math.floor(pt.y / cell);
      var g = groups[key] || (groups[key] = { lat: 0, lng: 0, px: 0, py: 0, n: 0, in: 0, names: [], items: [] });
      g.lat += s.lat;
      g.lng += s.lng;
      g.px += pt.x;
      g.py += pt.y;
      g.n += 1;
      if (s.status === "in") g.in += 1;
      if (g.names.length < 3) g.names.push(s.name);
      g.items.push(s);
    });
    return groups;
  }

  /* 배지·점이 거의 같은 자리에 겹칠 때만 두 묶음을 하나로 합친다(큰 묶음부터 자리 잡기).
     간격을 너무 크게 잡으면 밀집 지역 묶음이 한 덩어리로 다시 뭉치므로
     가로·세로 기준을 따로 두고 작게 잡는다. */
  function mergeNearby(list, gapX, gapY) {
    list.sort(function (a, b) { return b.n - a.n; });
    var out = [];
    list.forEach(function (g) {
      var cx = g.px / g.n;
      var cy = g.py / g.n;
      for (var i = 0; i < out.length; i++) {
        var q = out[i];
        if (Math.abs(cx - q.px / q.n) < gapX && Math.abs(cy - q.py / q.n) < gapY) {
          q.lat += g.lat;
          q.lng += g.lng;
          q.px += g.px;
          q.py += g.py;
          q.n += g.n;
          q.in += g.in;
          q.items = q.items.concat(g.items);
          if (q.names.length < 3 && g.names.length) q.names.push(g.names[0]);
          return;
        }
      }
      out.push(g);
    });
    return out;
  }

  /* 구역 묶음 배지 — 누르면 그 자리로 확대한다(step 단계).
     mini=true는 5km 보기의 작은 원(숫자만) */
  function drawClusterBadge(g, step, mini) {
    var ll = { lat: g.lat / g.n, lng: g.lng / g.n };
    var node = document.createElement("div");
    node.className = "pm-marker-cluster";
    node.innerHTML = mini
      ? '<span class="pm-cluster is-mini' + (g.in ? " has-stock" : "") + '">' + g.n + "</span>"
      : '<span class="pm-cluster' + (g.in ? " has-stock" : "") + '">' +
        g.n + "곳" + (g.in ? "<small>재고 " + g.in + "</small>" : "") + "</span>";
    node.title = g.names.join(", ") + (g.n > 3 ? " 외" : "");
    node.setAttribute("role", "button");
    node.setAttribute("tabindex", "0");
    node.setAttribute("aria-label", g.n + "곳 (" + node.title + ")");
    function zoomIn() {
      programMove();
      st.map.setLevel(Math.max(1, st.map.getLevel() - (step || 3)));
      st.map.setCenter(latlng(ll.lat, ll.lng));
    }
    node.addEventListener("click", zoomIn);
    node.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); zoomIn(); }
    });
    addOverlay(node, ll.lat, ll.lng, { xAnchor: 0.5, yAnchor: 0.5, zIndex: 60, clickable: true });
  }

  /* 넓게 보는 저줌(20km)에서는 같은 구역의 매장을 `N곳` 한 덩이로 표시한다 */
  function renderClusters(list) {
    var level = st.map.getLevel();
    /* 줌이 낮을수록 넓은 칸으로 묶되, 20km(level 10)에서는 칸을 줄여
       반경 전역이 지역별 여러 묶음으로 나뉘어 보이게 한다 */
    var cell = level >= 11 ? 85 : level >= 10 ? 58 : 40;
    var groups = groupStores(list, cell);
    var arranged = mergeNearby(Object.keys(groups).map(function (k) { return groups[k]; }), 42, 20);
    arranged.forEach(function (g) { drawClusterBadge(g, 3); });
  }

  /* 5km 보기(브랜드 칩 모드): 칩이 겹치는 자리는 숫자만 담은 작은 원,
     외딴 매장은 브랜드 칩·점 그대로 */
  function renderChipGroups(list) {
    var groups = groupStores(list, CHIP_CELL);
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.n === 1) drawPill(g.items[0]);
      else drawClusterBadge(g, 2, true);
    });
  }

  /* 매장 하나 = 말풍선(알약) 또는 저줌에서는 브랜드 칩·점 */
  function drawPill(s) {
    var stocked = stockedProducts(s);
    var label = s.name + " · " + (isPolicyBrand(s.brand) ? POLICY_NOTICE : placeLabel(s)) +
      (stocked.length
        ? " · " + stocked.map(function (p) { return p.short + " " + p.stateLabel; }).join(", ")
        : "");
    var node = pillNode(s, label);
    var ov = addOverlay(node, s.lat, s.lng, {
      xAnchor: 0.5,
      yAnchor: 1,
      zIndex: s.status === "in" ? 300 : 100,
      clickable: true
    });
    st.markers[s.id] = { ov: ov, node: node };
    if (st.selectedId === s.id) {
      node.classList.add("is-selected");
      try { ov.setZIndex(900); } catch (e) {}
    }
  }

  function renderMarkers() {
    applyZoomMode();
    if (st.ready) clearOverlays();
    var cap = st.radius >= 20000 ? MAX_MARKERS_20 : st.radius >= 5000 ? MAX_MARKERS_5 : MAX_MARKERS;
    var list = st.all.filter(match).slice().sort(function (a, b) {
      return a.distance - b.distance;
    });
    /* 가까운 순으로 상한 적용 (20km는 최대 100곳) */
    if (list.length > cap) list = list.slice(0, cap);
    /* 마커는 브랜드가 고르게 보이도록 브랜드 → 거리 순으로 그린다 */
    list.sort(function (a, b) {
      var d = brandOrder(a.brand) - brandOrder(b.brand);
      return d !== 0 ? d : a.distance - b.distance;
    });
    st.visible = list.map(function (s) { return s; });
    st.visible.sort(function (a, b) { return a.distance - b.distance; });

    /* 카카오맵을 그릴 수 없는 주소: 마커 대신 목록·집계만 그대로 산출한다 */
    if (!st.ready) {
      emit("pokemoa:visible", { stores: st.visible });
      return;
    }

    if (st.cluster) {
      renderClusters(st.visible);
      if (st.selectedId) closeCard();
    } else if (st.compact) {
      renderChipGroups(st.visible);
      if (st.selectedId && !st.markers[st.selectedId]) closeCard();
    } else {
      st.visible.forEach(drawPill);
      if (st.selectedId && !st.markers[st.selectedId]) closeCard();
    }
    emit("pokemoa:visible", { stores: st.visible });
  }

  function placeLabel(s) {
    if (s.emart) return s.emartLabel;
    if (s.brand === "vending") return "공식 설치 지점";
    if (s.brand === "cardshop") return "공인 카드샵";
    if (s.brand === "mart" || s.brand === "artbox") return "매장 확인 (방문·문의)";
    /* 세븐일레븐은 재고를 확인하지 않는다 — '미조회'가 아니라 위치 안내로 표기 */
    if (isPolicyBrand(s.brand)) return "위치 안내";
    if (s.relay) return statusLabel(s.status);
    if (s.status === "none") return "미조회";
    return statusLabel(s.status);
  }

  function isOfflineBrand(b) { return OFFLINE_IDS.indexOf(b) >= 0; }

  /* 팜사이즈 원더 피규어(GS25 단독) 모드 — 지도에 GS25 만 그리므로 상태 문구도 GS25 기준으로 쓴다 */
  function figureOnlyMode() {
    return !!(document.body && document.body.classList && document.body.classList.contains("figure-mode"));
  }

  function match(s) {
    /* 피규어(GS25 단독) 모드에서는 이마트 카드·배지가 절대 나오지 않게 한다 */
    if (s.emart && figureOnlyMode()) return false;
    /* 이마트 실시간 재고 카드와 같은 자리의 대형마트 마커는 감춘다(중복 표시 방지) */
    if (s.hiddenByEmart) return false;
    if (!st.showOffline && isOfflineBrand(s.brand)) return false;
    if (st.brand !== "all" && s.brand !== st.brand) return false;
    if (s.distance > st.radius) return false;
    if (st.stockOnly && s.status !== "in") return false;
    if (st.product !== "all") {
      /* 그 상품을 취급했거나 입고·확인 중인 매장만 (한 번도 입고 안 된 '미입고'는 제외) */
      var hit = (s.products || []).some(function (p) {
        return p.id === st.product && p.state !== "none";
      });
      if (!hit) return false;
    }
    return true;
  }

  /* --------------------------------------------------------- 정보 카드 */
  function select(id, fromMap) {
    var s = null;
    for (var i = 0; i < st.visible.length; i++) if (st.visible[i].id === id) s = st.visible[i];
    if (!s) return;
    st.selectedId = id;
    Object.keys(st.markers).forEach(function (k) {
      var m = st.markers[k];
      if (!m) return;
      m.node.classList.toggle("is-selected", k === id);
      try { m.ov.setZIndex(k === id ? 900 : (m.node.classList.contains("status-in") ? 300 : 100)); } catch (e) {}
    });
    renderCard(s);
    el.container.classList.add("is-card-open");
    emit("pokemoa:store-selected", { id: id });
    if (fromMap && window.innerWidth < 980) {
      /* 모바일: 카드가 지도 하단에 고정되므로 지도만 보이도록 스크롤 유지 */
      el.container.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  function closeCard() {
    st.selectedId = null;
    if (el.card) el.card.hidden = true;
    if (el.container) el.container.classList.remove("is-card-open");
    emit("pokemoa:store-cleared");
  }

  function statusLabel(s) {
    return s === "in" ? "재고 있음" : s === "none" ? "없음" : "미조회";
  }

  /* 실제 재고가 있는 카드만 — 수량 0개(품절) 태그는 목록·팝업 어디에도 그리지 않는다.
     그래서 모든 카드가 0개인 매장은 태그 줄 없이 상태 배지만 남는다. */
  function stockedProducts(s) {
    return (s.products || []).filter(function (p) {
      var q = Number(p.qty);
      if (isFinite(q)) return q > 0;
      return p.state === "in" || p.state === "low";
    });
  }

  /* 취급·재고 카드 상품명 태그 (목록·팝업 공용) */
  function productTagsHtml(s, cls, withHead) {
    var list = stockedProducts(s);
    if (!list.length) return "";
    var head = withHead ? '<span class="p-head p-head-label">보유 카드</span>' : "";
    var tags = list.map(function (p) {
      return '<span class="p-tag is-' + p.state + '" title="' + p.name + " · " + p.stateLabel + '">' +
        p.short + ' <i>· ' + p.stateLabel + "</i></span>";
    }).join("");
    return '<div class="store-products ' + (cls || "") + '">' + head + tags + "</div>";
  }

  function offlineNote(s) {
    if (s.brand === "vending") {
      return "포켓몬코리아 <b>공식 자판기 안내</b>(2026-11-18 확인)에 올라온 설치 지점입니다. 공식 안내는 설치 장소만 알려 주고 재고는 보여 주지 않으므로, 원하는 팩은 현장 화면에서 확인하세요.";
    }
    if (s.brand === "cardshop") {
      return "포켓몬코리아 <b>공식 카드샵 목록</b>(2026-11-18 확인)의 공인 매장입니다. 정가 판매·재고·영업시간은 매장에 문의하세요.";
    }
    var label = s.brand === "artbox" ? "아트박스" : (s.martChain || "이마트·롯데마트·홈플러스·토이저러스");
    return "카카오맵 장소 검색으로 찾은 <b>" + label + (s.brand === "artbox" ? "" : " 매장") + "</b>입니다. 완구코너 포켓몬 카드 정가 판매와 재고는 매장에 문의해 확인하세요.";
  }

  /* ------------------------------------------------ 이마트(대형마트) 카드 */
  /* 이마트 앱 점포 재고를 상품별로 그대로 보여 준다 — 수량 비공개·미취급도 숨기지 않는다. */
  function emartStockRows(s) {
    return (s.products || []).map(function (p) {
      var cls = p.state === "in" ? "is-in"
        : p.state === "undisclosed" ? "is-undisclosed"
        : p.state === "soldout" ? "is-none" : "is-na";
      var sub = [p.kind || "", p.price ? "정가 " + Number(p.price).toLocaleString("ko-KR") + "원" : ""]
        .filter(Boolean).join(" · ");
      return '<li class="es-row ' + cls + '">' +
        '<span class="es-name">' + escapeHtml(p.short) +
          (sub ? '<i>' + escapeHtml(sub) + "</i>" : "") + "</span>" +
        '<span class="es-qty">' + escapeHtml(p.stateLabel) + "</span></li>";
    }).join("");
  }

  function renderEmartCard(s) {
    if (!el.card) return;
    var meta = D.brandMeta.emart || { label: "이마트", short: "이마트", color: "#ffc400", ink: "#2b2200" };
    var dist = s.distance < 1000 ? Math.round(s.distance) + "m" : (s.distance / 1000).toFixed(1) + "km";
    var subBits = [];
    if (s.name.indexOf(meta.label) !== 0) subBits.push(meta.label);
    if (s.street) subBits.push(s.street);
    subBits.push(dist);
    var navLink = "https://map.naver.com/p/search/" + encodeURIComponent(s.name);
    var chips = ['<span class="chip chip-relay">이마트 앱 실시간</span>'];
    if (s.emartClosed) {
      chips.push('<span class="chip chip-closed">오늘 휴무</span>');
    } else if (s.emartOutside) {
      chips.push('<span class="chip chip-hours">영업시간 외</span>');
    }
    if (s.emartHours) chips.push('<span class="chip">' + escapeHtml(s.emartHours) + '</span>');
    if (s.observed) chips.push('<span class="chip">조회 ' + escapeHtml(s.observed) + '</span>');
    if (s.phone) chips.push('<span class="chip">' + escapeHtml(s.phone) + '</span>');
    el.card.hidden = false;
    el.card.innerHTML =
      '<div class="pm-card-head">' +
      '<span class="pm-card-brand" style="background:' + meta.color + ';color:' + (meta.ink || "#2b2200") + '">' + meta.short + '</span>' +
      '<div class="pm-card-title"><strong>' + escapeHtml(s.name) + '</strong>' +
      '<span>' + escapeHtml(subBits.join(" · ")) + '</span></div>' +
      '<button type="button" class="pm-card-close" aria-label="닫기">×</button>' +
      '</div>' +
      '<div class="pm-card-meta">' +
      '<span class="status-badge ' + s.status + '">' + escapeHtml(placeLabel(s)) + '</span>' +
      chips.join("") +
      '</div>' +
      '<ul class="emart-stock">' + emartStockRows(s) + '</ul>' +
      '<p class="pm-card-note">이마트 앱이 보여 주는 <b>점포 전산 재고</b>를 같은 API로 직접 조회했습니다(조회 ' +
        escapeHtml(s.observed) + '). 이마트 앱도 수량을 약 10분 단위로 갱신하니 방문 전 앱·매장 전화로 한 번 더 확인하세요.' +
        (s.emartClosed ? ' 오늘은 <b>휴점일(' + escapeHtml(s.emartHoliday || "오늘") + ')</b>이라 매장에서 살 수 없습니다.' : "") +
        (s.emartOutside ? ' 지금은 영업시간(' + escapeHtml(s.emartHours || "매장 문의") + ')이 아닙니다.' : "") +
        '</p>' +
      '<a class="btn btn-sm btn-dark pm-card-link" target="_blank" rel="noopener" href="' + navLink + '">네이버 지도에서 보기</a>';
    el.card.querySelector(".pm-card-close").addEventListener("click", function (e) {
      e.stopPropagation();
      closeCard();
    });
  }

  function renderCard(s) {
    if (s && s.emart) { renderEmartCard(s); return; }
    if (!el.card) return;
    var meta = D.brandMeta[s.brand] || { label: s.brand, color: "#1b2a4a", short: "?" };
    var dist = s.distance < 1000 ? Math.round(s.distance) + "m" : (s.distance / 1000).toFixed(1) + "km";
    var navLink = "https://map.naver.com/p/search/" + encodeURIComponent(s.name);
    /* 매장명이 브랜드명뿐이면 부제에서 브랜드를 한 번 더 쓰지 않는다.
       마트는 '대형마트' 대신 그 매장의 체인명을 적는다(이마트 포항점 → 이마트). */
    var cardBrand = (s.brand === "mart" && s.martChain) ? s.martChain : meta.short;
    var cardLabel = (s.brand === "mart" && s.martChain) ? s.martChain : meta.label;
    var subBits = [];
    if (s.name.indexOf(cardLabel) !== 0) subBits.push(cardLabel);
    if (s.street) subBits.push(s.street);
    subBits.push(dist);
    var subLine = subBits.join(" · ");
    el.card.hidden = false;
    el.card.innerHTML =
      '<div class="pm-card-head">' +
      '<span class="pm-card-brand" style="background:' + meta.color + ';color:' + (meta.ink || "#ffffff") + '">' + cardBrand + "</span>" +
      '<div class="pm-card-title"><strong>' + s.name + "</strong>" +
      "<span>" + subLine + "</span></div>" +
      '<button type="button" class="pm-card-close" aria-label="닫기">×</button>' +
      "</div>" +
      '<div class="pm-card-meta">' +
      '<span class="status-badge ' + (isPolicyBrand(s.brand) ? "policy" : s.status) + '">' + placeLabel(s) + "</span>" +
      (s.offline
        ? '<span class="chip chip-offline">재고 미확인</span>'
        : (isPolicyBrand(s.brand)
          ? '<span class="chip chip-policy">' + POLICY_NOTICE + "</span>"
          : (s.relay
            ? '<span class="chip chip-relay">실시간 재고</span>'
            : '<span class="chip chip-check">수량 미확인</span>'))) +
      (s.observed ? '<span class="chip">' + s.observed + "</span>" : "") +
      (s.phone ? '<span class="chip">' + escapeHtml(s.phone) + "</span>" : "") +
      "</div>" +
      productTagsHtml(s, "pm-card-products", true) +
      (s.offline
        ? '<p class="pm-card-note">' + offlineNote(s) + "</p>"
        : (isPolicyBrand(s.brand)
          ? '<p class="pm-card-note">세븐일레븐은 앱에서만 재고를 확인할 수 있습니다. 매장 위치·상호는 카카오맵 장소 정보이고, <b>재고는 세븐일레븐 앱</b>에서 확인해 주세요.</p>'
          : (s.relay
            ? '<p class="pm-card-note">편의점 앱에서 <b>실시간으로 조회한 실제 재고</b>입니다(조회 ' + escapeHtml(s.observed) + '). 수량은 조회 시점 기준이므로 방문 전 매장 전화로 한 번 더 확인하세요.</p>'
            : '<p class="pm-card-note">매장 위치·상호는 카카오맵 장소 정보입니다. 이 매장은 <b>재고 수량을 확인하지 못해</b> 「미조회」로 표시합니다. 조회가 되면 실제 재고가 자동으로 채워지고, 그 전에는 방문 전 앱·매장 전화로 확인하세요.</p>'))) +
      '<a class="btn btn-sm btn-dark pm-card-link" target="_blank" rel="noopener" href="' + navLink + '">네이버 지도에서 보기</a>';
    el.card.querySelector(".pm-card-close").addEventListener("click", function (e) {
      e.stopPropagation();
      closeCard();
    });
  }

  /* ------------------------------------------------------- 상태 표기 */
  function loadingState() {
    var msg, phase, progress;
    if (st.loading.tiles) {
      phase = "tiles";
      msg = "카카오맵 지도를 불러오는 중...";
      progress = 34;
    } else if (st.loading.data) {
      phase = "data";
      msg = figureOnlyMode()
        ? "주변 GS25 매장을 찾는 중... (최대 매장 조회 중 · 최대 25~30초 걸릴 수 있어요)"
        : "주변 편의점 4사·오프라인 매장을 찾는 중... (최대 매장 조회 중 · 최대 25~30초 걸릴 수 있어요)";
      progress = 72;
    } else {
      phase = "done";
      msg = "불러오기 완료";
      progress = 100;
    }
    return {
      active: st.loading.tiles || st.loading.data,
      phase: phase,
      message: msg,
      progress: progress
    };
  }

  function pushLoading() {
    emit("pokemoa:loading", loadingState());
  }

  function badge() {
    if (st.geoBusy) {
      return { kind: "busy", text: "내 위치 확인 중 · 브라우저 위치 권한을 허용해 주세요", action: false };
    }
    if (st.sdkError) {
      return {
        kind: "snapshot",
        text: st.snapshotEmpty
          ? "지도를 불러오지 못했습니다. 이 지역은 미리 저장한 매장 목록도 없어 매장 정보를 보여 드리기 어렵습니다"
          : "지도를 불러오지 못해 미리 저장한 매장 목록으로 표시합니다",
        action: true
      };
    }
    if (st.loading.data && !(st.relay && st.relay.count)) {
      return { kind: "busy", text: figureOnlyMode()
        ? "주변 GS25 매장을 찾는 중입니다 (최대 매장 조회 중 · 최대 25~30초 걸릴 수 있어요)"
        : "주변 편의점 4사·오프라인 매장을 찾는 중입니다 (최대 매장 조회 중 · 최대 25~30초 걸릴 수 있어요)", action: false };
    }
    /* 이마트 실시간 재고 — 편의점 조회(relay) 설정과 상관없이 이 점포 값은 늘 직접 조회한다 */
    var emartNote = (st.emart && st.emart.count && !figureOnlyMode())
      ? "이마트 " + st.emart.count + "곳" : "";
    /* 실시간 재고 조회로 실제 수량을 받았으면 그 사실을 먼저 알린다 */
    if (st.relay && st.relay.count) {
      var names = [];
      RELAY_ORDER.forEach(function (k) {
        var src = (st.relay.sources || {})[k];
        /* 세븐일레븐은 재고 조회 대상이 아니다 — 배지 이름에도 넣지 않는다 */
        if (src && src.ok && src.count && !isPolicyBrand(k)) names.push(RELAY_LABEL[k]);
      });
      return {
        kind: "relay",
        text: "실시간 재고 · " + (names.length ? names.join("·") + " " : "") + st.relay.count +
          "곳 확인" + (emartNote ? " · " + emartNote : "") +
          " · 조회 " + relayTimeLabel(st.relayAt),
        action: false
      };
    }
    if (st.emart && st.emart.count && !figureOnlyMode()) {
      return {
        kind: "relay",
        text: "이마트 실시간 점포 재고 " + st.emart.count + "곳 · 조회 " + relayTimeLabel(st.emart.at),
        action: false
      };
    }
    if (st.source === "live") {
      var cap = st.radius >= 20000 ? MAX_MARKERS_20 : st.radius >= 5000 ? MAX_MARKERS_5 : MAX_MARKERS;
      var convN = 0, offN = 0, emartN = 0;
      (st.all || []).forEach(function (s) {
        if (s.distance > st.radius) return;
        if (s.emart) emartN += 1;
        else if (isOfflineBrand(s.brand)) offN += 1;
        else convN += 1;
      });
      if (figureOnlyMode()) {
        /* 피규어 모드에서는 GS25 만 그리므로 CU·세븐·이마트24·오프라인 곳수를 세지 않는다 */
        var gsN = 0;
        (st.all || []).forEach(function (s) {
          if (s.brand === "gs25" && s.distance <= st.radius) gsN += 1;
        });
        return { kind: "live", text: "매장 위치 · GS25 " + gsN + "곳 · 재고는 ‘재고 조회’ 후", action: false };
      }
      var txt = st.all.length > cap
        ? "매장 위치 · 카카오맵 주변 매장 " + st.all.length + "곳 중 가까운 " + cap + "곳 표시"
        : "매장 위치 · 편의점 4사 " + convN + "곳";
      if (offN) txt += " · 오프라인 " + offN + "곳";
      if (emartN) txt += " · 이마트 " + emartN + "곳";
      txt += " · 재고는 ‘선택 지역 찾기’ 후";
      return { kind: "live", text: txt, action: false };
    }
    var snapKm = Math.round(((D.osmSnapshot || {}).radius || 3000) / 1000);
    var wideNote = st.radius >= 20000 ? " · 넓은 반경은 실시간 조회에서만 표시" : "";
    /* 전국 시·군·구 확장 지역 — 스냅샷이 없어도 오류가 아니라 ‘표시할 스냅샷이 없음’으로 알린다 */
    if (st.snapshotEmpty) {
      return {
        kind: "snapshot",
        text: "실시간 재고 조회는 되지 않아 이 지역은 매장 위치만 표시합니다" + wideNote,
        action: true
      };
    }
    return {
      kind: "snapshot",
      text: (st.pendingLive
        ? "지도 검색이 늦어 미리 저장한 매장 목록(반경 " + snapKm + "km)으로 먼저 표시 (조금 더 기다리는 중 · " + st.snapshotLabel + ")"
        : "미리 저장한 매장 목록으로 표시 중 (반경 " + snapKm + "km · " + st.snapshotLabel + ")" + wideNote),
      action: true
    };
  }

  /* 브랜드별 현황 (반경·재고 필터를 반영한 집계) */
  function blankCount() { return { total: 0, in: 0, check: 0, none: 0 }; }
  function brandCounts() {
    var out = { all: blankCount(), gs25: blankCount(), cu: blankCount(), seven: blankCount(), emart24: blankCount(),
      emart: blankCount(), mart: blankCount(), artbox: blankCount(), vending: blankCount(), cardshop: blankCount() };
    (st.all || []).forEach(function (s) {
      if (s.distance > st.radius) return;
      if (s.hiddenByEmart) return;
      if (st.stockOnly && s.status !== "in") return;
      if (!st.showOffline && isOfflineBrand(s.brand)) return;
      /* 이마트는 자기 칸에만 세고 편의점 4사 '전체' 집계에는 넣지 않는다(재고 기준이 다르다) */
      if (s.emart) {
        if (figureOnlyMode()) return;
        var erow = out.emart;
        erow.total += 1;
        erow[s.status] += 1;
        return;
      }
      /* 오프라인 판매처는 자기 칩 카운트에만 넣고 편의점 '전체' 집계에는 넣지 않는다 */
      if (isOfflineBrand(s.brand)) {
        var orow = out[s.brand];
        if (!orow) return;
        orow.total += 1;
        orow[s.status] += 1;
        return;
      }
      var row = out[s.brand];
      if (!row) return;
      out.all.total += 1;
      out.all[s.status] += 1;
      row.total += 1;
      row[s.status] += 1;
    });
    return out;
  }

  function pushData() {
    st.snapshotLabel = (D.osmSnapshot && D.osmSnapshot.fetchedAt) || "";
    emit("pokemoa:data", {
      stores: st.visible,
      loading: st.loading.data || st.loading.tiles,
      source: st.source,
      badge: badge(),
      regionId: st.regionId,
      origin: st.origin,
      center: st.center,
      radius: st.radius,
      total: st.all.length,
      product: st.product,
      stockOnly: st.stockOnly,
      showOffline: st.showOffline,
      brand: st.brand,
      brandCounts: brandCounts(),
      allow20: allow20(),
      markerCap: st.radius >= 20000 ? MAX_MARKERS_20 : MAX_MARKERS,
      snapshotAt: (D.osmSnapshot || {}).fetchedAt || "",
      error: st.lastError
    });
  }

  /* --------------------------------------------------- 데이터 조회 */
  function snapshotList() {
    var snap = (D.osmSnapshot && D.osmSnapshot.items) || [];
    if (st.origin === "region") {
      return snap.filter(function (s) { return s.regionId === st.regionId; });
    }
    /* 내 위치·장소 검색 기준일 때는 25km 안에 있는 스냅샷만 후보로 둔다 */
    var c = st.center;
    return snap.filter(function (s) { return meters(c, s) <= 25000; });
  }

  /* ------------------------------------------- 카카오 장소 검색 (Places) */
  function placesService() {
    var K = window.kakao.maps.services;
    return new K.Places();
  }

  /* 카카오 업종 코드 한 페이지 — 편의점 CS2 · 대형마트 MT1 · 키워드 보축용. 15건씩, 페이지를 넘기면 최대 45건 */
  function categoryPage(code, center, radius, page) {
    return new Promise(function (resolve) {
      var P = window.kakao.maps.services;
      placesService().categorySearch(code, function (data, status) {
        resolve({ ok: status === P.Status.OK, data: data || [] });
      }, {
        location: latlng(center.lat, center.lng),
        radius: Math.min(20000, Math.max(100, Math.round(radius))),
        sort: P.SortBy.DISTANCE,
        page: page || 1,
        size: 15
      });
    });
  }

  /* 브랜드별 키워드 검색 — 카테고리 조회 45건에 없는 브랜드를 보충한다 */
  function keywordPage(query, center, radius, page) {
    return new Promise(function (resolve) {
      var P = window.kakao.maps.services;
      placesService().keywordSearch(query, function (data, status) {
        resolve({ ok: status === P.Status.OK, data: data || [] });
      }, {
        location: latlng(center.lat, center.lng),
        radius: Math.min(20000, Math.max(100, Math.round(radius))),
        sort: P.SortBy.DISTANCE,
        page: page || 1,
        size: 15
      });
    });
  }

  function placeToRow(p) {
    var brand = classify({ name: p.place_name, category: p.category_name });
    if (!brand) return null;
    var lat = Number(p.y);
    var lng = Number(p.x);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      id: p.id || (p.place_name + ":" + lat + ":" + lng),
      type: "kakao",
      name: p.place_name || "",
      brand: brand,
      shop: "convenience",
      lat: lat,
      lng: lng,
      street: p.road_address_name || p.address_name || "",
      phone: p.phone || "",
      placeUrl: p.place_url || ""
    };
  }

  /* 오프라인 판매처(마트·아트박스) 판별
     · 대형마트: 카카오 업종 코드 MT1(대형마트) 결과에서 체인명으로 시작하는 매장만
       (이마트24·이마트에브리데이·노브랜드·익스프레스·매장 안 문화센터/임점 매장은 제외)
     · 아트박스: 전용 업종 코드가 없어 키워드 검색 결과에서 이름으로 추린다 */
  function isMartPlace(p) {
    var n = String(p.place_name || "");
    if (/이마트\s*24|에브리데이|노브랜드|익스프레스/.test(n)) return false;
    if (!/대형마트/.test(String(p.category_name || ""))) return false;
    return /^(이마트|롯데마트|홈플러스|토이저러스)/.test(n);
  }

  function offlineRow(p, brand) {
    var lat = Number(p.y);
    var lng = Number(p.x);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    return {
      id: p.id || p.place_name + ":" + lat + ":" + lng,
      type: "offline",
      name: p.place_name || "",
      brand: brand,
      shop: "offline",
      place: brand,
      martChain: brand === "mart" ? martChainOf(p.place_name) : "",
      lat: lat,
      lng: lng,
      street: p.road_address_name || p.address_name || "",
      phone: p.phone || "",
      placeUrl: p.place_url || ""
    };
  }

  function collectOffline(pages, brand, keep) {
    var out = [];
    var seen = {};
    pages.forEach(function (pg) {
      (pg.data || []).forEach(function (p) {
        if (!keep(p)) return;
        var row = offlineRow(p, brand);
        if (!row || seen[row.id]) return;
        seen[row.id] = 1;
        out.push(row);
      });
    });
    return out;
  }

  /* 마트·아트박스는 카카오 장소 검색으로 실시간 조회한다(편의점 4사와 같이) */
  function searchOffline(center, radius) {
    /* 대형마트: 업종 MT1을 편의점과 같은 격자로 나눠 조회 */
    var martReq = Promise.all(searchPlan(center, radius).map(function (pt) {
      return categoryPage("MT1", pt, pt.radius, pt.page);
    })).then(function (pages) {
      return collectOffline(pages, "mart", isMartPlace);
    }).catch(function () { return []; });

    /* 아트박스: 키워드 1페이지 + 이름 필터 */
    var artReq = keywordPage("아트박스", center, radius, 1).then(function (pg) {
      return collectOffline([pg], "artbox", function (p) {
        var n = String(p.place_name || "");
        if (!/아트박스|artbox/i.test(n)) return false;
        /* 본사·물류센터는 매장이 아니다 */
        return !/본사|물류|사무소/.test(n);
      });
    }).catch(function () { return []; });

    return Promise.all([martReq, artReq]).then(function (res) {
      var rows = res[0].concat(res[1]).filter(function (r) { return meters(center, r) <= radius + 1; });
      rows.sort(function (a, b) { return meters(center, a) - meters(center, b); });
      return rows.slice(0, OFFLINE_CAP);
    });
  }

  /* 공식 자료로 내장한 오프라인 지점 — 자판기(좌표 포함 176곳)와 공인 카드샵 16곳 */
  function builtinOffline(center, radius) {
    var rows = [];
    (D.vendingPoints || []).forEach(function (v) {
      var row = {
        id: "vending:" + v.n + ":" + v.la + ":" + v.ln,
        type: "vending",
        name: v.n,
        brand: "vending",
        shop: "offline",
        place: "vending",
        official: true,
        lat: v.la,
        lng: v.ln,
        street: v.a || "",
        placeUrl: "https://www.pokemonkorea.co.kr/card_vending_machine"
      };
      if (meters(center, row) <= radius + 1) rows.push(row);
    });
    var geo = st.cardShopGeo || {};
    (D.cardShops || []).forEach(function (s) {
      var g = geo[s.id];
      if (!g) return;
      var row = {
        id: "cardshop:" + s.id,
        type: "cardshop",
        name: s.name,
        brand: "cardshop",
        shop: "offline",
        place: "cardshop",
        official: true,
        lat: g.lat,
        lng: g.lng,
        street: g.street || s.addr || "",
        phone: g.phone || "",
        placeUrl: s.url
      };
      if (meters(center, row) <= radius + 1) rows.push(row);
    });
    /* 가까운 순으로 자판기는 최대 40곳까지만 — 넓은 반경에서 마커가 넘치지 않게 */
    var vending = rows.filter(function (r) { return r.brand === "vending"; });
    var shops = rows.filter(function (r) { return r.brand !== "vending"; });
    vending.sort(function (a, b) { return meters(center, a) - meters(center, b); });
    return shops.concat(vending.slice(0, 40));
  }

  /* 공인 카드샵 좌표를 카카오 장소 검색으로 한 번만 확인해 두는 함수 */
  function resolveCardShops() {
    if (st.cardShopGeo) return Promise.resolve(st.cardShopGeo);
    var list = D.cardShops || [];
    if (!list.length || !st.ready) return Promise.resolve({});
    var P = window.kakao.maps.services;
    var jobs = list.map(function (s) {
      return new Promise(function (resolve) {
        try {
          placesService().keywordSearch(s.q || s.name, function (data, status) {
            if (status !== P.Status.OK || !data || !data.length) { resolve(null); return; }
            var hit = data[0];
            var lat = Number(hit.y);
            var lng = Number(hit.x);
            if (!isFinite(lat) || !isFinite(lng)) { resolve(null); return; }
            resolve({ id: s.id, lat: lat, lng: lng, street: hit.road_address_name || hit.address_name || s.addr || "", phone: hit.phone || "" });
          }, { size: 3, sort: P.SortBy.ACCURACY });
        } catch (e) {
          resolve(null);
        }
      });
    });
    return Promise.all(jobs).then(function (res) {
      var geo = {};
      res.forEach(function (g) { if (g) geo[g.id] = g; });
      st.cardShopGeo = geo;
      return geo;
    });
  }

  function rowsFrom(pages) {
    var out = [];
    var seen = {};
    pages.forEach(function (pg) {
      (pg.data || []).forEach(function (p) {
        var row = placeToRow(p);
        if (!row || seen[row.id]) return;
        seen[row.id] = 1;
        out.push(row);
      });
    });
    return out;
  }

  /* 반경별 조회 계획 — {lat,lng,radius,page} 목록
     · 1km: 중심 1곳에서 3페이지(최대 45건) — 1km 안은 45건이면 대개 다 담긴다
     · 3km: 중심 3페이지 + 8방위 1.7km 지점(반경 1.7km·1p) = 11회
       → 카카오는 한 번에 45건·가까운 순이라, 중심 한 곳만 조회하면 1km 안이 45건으로
         가득 차 1~3km 외곽 매장이 통째로 빠진다(도심일수록 심함).
         1.7km 고리·반경 1.7km 8방위는 3km 원판을 빈틈없이 덮는다.
     · 5km: 중심(반경 3km·2p) + 동·서·남·북 2.8km 지점(반경 2.6km·2p)
     · 20km: 중심(반경 5km·2p) + 반경 5km 고리(8방위 · 4km · 1p) + 반경 13km 고리(8방위 · 7km · 1p)
       → 중심만 조회하면 45건 상한에 가까운 매장이 차서 외곽이 통째로 빠지므로,
         여러 지점에서 나눠 받아 합친 뒤 반경으로 다시 거른다. */
  function searchPlan(center, radius) {
    var pts = [];
    var p;
    if (radius >= 20000) {
      for (p = 1; p <= 2; p++) pts.push({ lat: center.lat, lng: center.lng, radius: 5000, page: p });
      pushRing(pts, center, 5000, 4000, 1, DIRS8);
      pushRing(pts, center, 13000, 7000, 1, DIRS8);
      return pts;
    }
    if (radius >= 5000) {
      for (p = 1; p <= 2; p++) pts.push({ lat: center.lat, lng: center.lng, radius: 3000, page: p });
      pushRing(pts, center, 2800, 2600, 2, DIRS4);
      return pts;
    }
    if (radius >= 3000) {
      for (p = 1; p <= 3; p++) pts.push({ lat: center.lat, lng: center.lng, radius: radius, page: p });
      pushRing(pts, center, 1700, 1700, 1, DIRS8);
      return pts;
    }
    for (p = 1; p <= 3; p++) pts.push({ lat: center.lat, lng: center.lng, radius: radius, page: p });
    return pts;
  }

  /* 격자 조회 → id 중복 제거 → 반경 필터 → 빠진 브랜드는 브랜드별 키워드 1페이지로 보충
     tick({resolved,total,found}) 은 장소 검색 한 페이지가 끝날 때마다 부른다 —
     화면의 편의점 4사 진행률(0~40%)이 이 실제 응답 수로 움직인다. */
  function searchNearby(center, radius, tick) {
    var plan = searchPlan(center, radius);
    var total = plan.length;
    var done = 0;
    var found = { gs25: 0, cu: 0, seven: 0, emart24: 0 };
    function step(pg) {
      done += 1;
      rowsFrom([pg]).forEach(function (r) {
        if (found[r.brand] != null) found[r.brand] += 1;
      });
      if (tick) tick({ resolved: done, total: total, found: found });
    }
    var reqs = plan.map(function (pt) {
      return categoryPage("CS2", pt, pt.radius, pt.page).then(function (pg) {
        step(pg);
        return pg;
      });
    });
    return Promise.all(reqs).then(function (pages) {
      var anyOk = pages.some(function (p) { return p.ok; });
      if (!anyOk) throw new Error("place-search-failed");
      var rows = rowsFrom(pages).filter(function (r) { return meters(center, r) <= radius + 1; });
      var missing = BRAND_ORDER_LIST.filter(function (b) {
        return !rows.some(function (r) { return r.brand === b; });
      });
      if (!missing.length) return rows;
      total += missing.length;
      var extra = missing.map(function (b) {
        return keywordPage(BRAND_QUERY[b], center, radius, 1).then(function (pg) {
          step(pg);
          return pg;
        });
      });
      return Promise.all(extra).then(function (pages2) {
        var more = rowsFrom(pages2).filter(function (r) {
          return missing.indexOf(r.brand) >= 0 && meters(center, r) <= radius + 1;
        });
        return rows.concat(more);
      });
    });
  }

  function load() {
    var seq = ++st.seq;
    st.loading.data = true;
    st.lastError = null;
    st.pendingLive = false;
    pushLoading();
    pushData();
    /* 진행률 패널용 — 첫 자동 조회인지 알려 주고, 조회 시작을 알린다 */
    var initial = !st.started;
    st.started = true;
    emit("pokemoa:search-start", {
      initial: initial,
      center: st.center,
      radius: st.radius,
      regionId: st.regionId,
      origin: st.origin
    });

    if (!st.ready) {
      /* 지도가 없으면(SDK 미등록 도메인·차단) 스냅샷으로 조용히 표시한다 */
      applySnapshot(seq, st.sdkError ? "kakao-sdk-unavailable" : "map-not-ready");
      return;
    }

    var center = st.center;
    var radius = st.radius;
    st.fetchedRadius = radius;
    st.fetchedBand = radiusBand(radius);

    /* 이마트 점포 재고 — 카카오 지도와 무관하게 브라우저가 직접 조회한다(스냅샷·지도 실패에도 동작).
       피규어(GS25 단독) 모드에서는 아예 부르지 않는다(v=125). */
    loadEmart(seq);

    var softTimer = setTimeout(function () {
      if (seq !== st.seq) return;
      if (st.source === "live") return;
      st.pendingLive = true;
      applySnapshot(seq, "timeout");
    }, SEARCH_TIMEOUT);

    /* 편의점 4사(카테고리+키워드 보축) · 오프라인 마트·아트박스 · 공인 카드샵 좌표를 함께 받아 합친다 */
    var convReq = searchNearby(center, radius, function (p) {
      if (seq !== st.seq) return;
      emit("pokemoa:search-progress", p);
    });
    var offReq = searchOffline(center, radius).catch(function () { return []; });
    var shopReq = resolveCardShops().catch(function () { return {}; });

    Promise.all([convReq, offReq, shopReq]).then(function (res) {
      clearTimeout(softTimer);
      if (seq !== st.seq) return;
      st.all = prepare(res[0].concat(res[1] || []), center, "live")
        .concat(prepare(builtinOffline(center, radius), center, "live"));
      st.source = "live";
      st.lastError = null;
      st.pendingLive = false;
      st.loading.data = false;
      finishLoad(seq, true);
    }).catch(function (err) {
      clearTimeout(softTimer);
      if (seq !== st.seq) return;
      if (st.source === "live") return;
      st.pendingLive = false;
      applySnapshot(seq, String((err && err.message) || err));
    });
  }

  function applySnapshot(seq, reason) {
    var center = st.center;
    var rows = snapshotList();
    /* 새로 추가한 시·군·구는 스냅샷이 없다 — 빈 배열이어도 그대로 두고(오류 아님) 안내만 바꾼다 */
    st.snapshotEmpty = rows.length === 0;
    st.all = prepare(rows, center, "snapshot")
      .concat(prepare(builtinOffline(center, st.radius), center, "snapshot"));
    st.source = "snapshot";
    st.lastError = reason;
    st.loading.data = false;
    st.loading.tiles = false;
    finishLoad(seq, false);
  }

  function finishLoad(seq, liveNow) {
    if (seq !== st.seq) return;
    renderMarkers();
    pushLoading();
    pushData();
    emit("pokemoa:loaded", {
      source: st.source,
      total: st.all.length,
      allow20: allow20(),
      markerCap: st.radius >= 20000 ? MAX_MARKERS_20 : st.radius >= 5000 ? MAX_MARKERS_5 : MAX_MARKERS,
      error: st.lastError,
      late: !!liveNow && st.badgeWasSnapshot
    });
    /* 지도 매장을 새로 그리면 이전 조회 결과가 사라지므로, 마지막 응답을 곧바로 다시 얹는다.
       (새 조회가 오면 그 값이 이 자리를 대신한다) */
    if (st.relayPayload) applyRelay(st.relayPayload);
    /* 이마트 재고도 같은 이유로 지도 매장을 새로 그린 뒤 다시 얹는다 */
    if (st.emartPayload) applyEmart(st.emartPayload);
    /* 진행률 패널용 — 매장 탐색 단계가 끝났고, 이제 재고 조회 단계로 넘어간다 */
    emit("pokemoa:search-done", {
      source: st.source,
      total: st.all.length,
      radius: st.radius,
      regionId: st.regionId,
      brandCounts: brandCounts(),
      error: st.lastError
    });
    st.badgeWasSnapshot = st.source === "snapshot";
    /* 드래그로 미뤄 둔 중심이 있으면 이 조회가 끝난 뒤 그 자리로 한 번만 다시 찾는다 */
    if (st.dragPoint && !st.dragTimer) runDragSearch();
  }

  /* ------------------------------------ 실시간 재고 조회(relay) 반영 */
  /* 조회 서버는 편의점 앱 재고를 대신 조회해 { stores: [{ brand, name, address,
     lat, lng, distanceM, status, items:[{name,qty,code}], updatedAt }] } 로 준다.
     이 값은 실제 재고이므로 같은 자리의 지도 매장이 있으면 그 매장 카드에 얹고,
     없으면 그 점포를 새로 그린다. 응답이 끊기면 「미조회」로 되돌린다. */
  var RELAY_ORDER = ["gs25", "emart24", "cu", "seven"];
  var RELAY_LABEL = { gs25: "GS25", emart24: "이마트24", cu: "CU", seven: "세븐일레븐" };

  function relayTimeLabel(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }

  function relayProducts(items) {
    return (items || []).map(function (it) {
      var qty = Number(it.qty);
      if (!isFinite(qty)) qty = 0;
      var state = qty > 0 ? "in" : "soldout";
      return {
        id: String(it.code || it.name || ""),
        name: String(it.name || it.code || ""),
        short: String(it.name || it.code || ""),
        unit: "개",
        qty: qty,
        state: state,
        stateLabel: qty > 0 ? qty + "개" : "0개"
      };
    });
  }

  function toRelayStore(s) {
    var brand = RELAY_ORDER.indexOf(s.brand) >= 0 ? s.brand : null;
    if (!brand) return null;
    var lat = Number(s.lat);
    var lng = Number(s.lng);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var meta = D.brandMeta[brand] || { label: RELAY_LABEL[brand] || brand };
    var products = relayProducts(s.items);
    var total = 0;
    products.forEach(function (p) { total += p.qty; });
    return {
      id: "relay-" + (s.id || brand + ":" + (s.name || "") + ":" + lat + ":" + lng),
      brand: brand,
      brandLabel: meta.label || brand,
      shop: "convenience",
      name: (s.name || "").trim() || (RELAY_LABEL[brand] || brand),
      lat: lat,
      lng: lng,
      street: s.address || "",
      distance: 0,
      status: s.status === "in_stock" ? "in" : "none",
      observed: relayTimeLabel(s.updatedAt),
      unit: "개",
      note: "",
      products: products,
      relay: true,
      relayQty: total,
      source: "relay"
    };
  }

  /* 브랜드 이름 표기 흔들림(emart24 / 이마트24 / 7-ELEVEN …)을 하나로 맞춘다 */
  function normBrandKey(b) {
    var k = String(b || "").toLowerCase().replace(/[\s_-]/g, "");
    /* 'emart'(대형마트)는 'emart24'(편의점)와 다른 브랜드다 — 'emart' 를 편의점으로 묶으면
       대형마트 매장과 이마트24 매장이 같은 점포로 잘못 이어진다(v=125). */
    if (k === "emart24" || k === "이마트24") return "emart24";
    if (k === "seven" || k === "7eleven" || k === "7-eleven" || k === "세븐일레븐") return "seven";
    if (k === "gs25" || k === "지에스25") return "gs25";
    if (k === "cu") return "cu";
    return k;
  }

  /* 점포명 비교용 — 브랜드 접두어·공백·괄호·'점' 꼬리를 떼고 같으면 같은 매장으로 본다.
     ("이마트24 포항양덕공원점" ↔ "포항양덕공원점") */
  function normStoreName(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[\s\-_.,()\[\]{}·'"`]/g, "")
      .replace(/^(이마트24|emart24|세븐일레븐|7 ?eleven|seven ?eleven|gs25|지에스25|cu)/, "")
      .replace(/(지점|점)$/, "");
  }

  /* 카카오맵 매장과 조회 응답 점포를 잇는다.
     ① 80m 안의 같은 브랜드 ② 점포명이 같거나 한쪽이 다른 쪽을 포함(같은 반경 안)
     ③ 같은 브랜드 300m 안에서 가장 가까운 매장 — 앱 좌표와 지도 좌표가 조금 어긋나도 붙는다. */
  function findTwin(base, r) {
    var i, b, d;
    var rName = normStoreName(r.name);
    for (i = 0; i < base.length; i++) {
      b = base[i];
      if (b.relay || normBrandKey(b.brand) !== normBrandKey(r.brand)) continue;
      if (meters(b, r) < 80) return b;
    }
    if (rName && rName.length >= 2) {
      var nameHit = null, nameDist = Infinity;
      for (i = 0; i < base.length; i++) {
        b = base[i];
        if (b.relay || normBrandKey(b.brand) !== normBrandKey(r.brand)) continue;
        var bName = normStoreName(b.name);
        if (!bName || bName.length < 2) continue;
        if (bName === rName || bName.indexOf(rName) >= 0 || rName.indexOf(bName) >= 0) {
          d = meters(b, r);
          if (d < nameDist) { nameDist = d; nameHit = b; }
        }
      }
      if (nameHit && nameDist <= Math.max(2500, st.radius || 0)) return nameHit;
    }
    var near = null, nearDist = Infinity;
    for (i = 0; i < base.length; i++) {
      b = base[i];
      if (b.relay || normBrandKey(b.brand) !== normBrandKey(r.brand)) continue;
      d = meters(b, r);
      if (d <= 300 && d < nearDist) { nearDist = d; near = b; }
    }
    return near;
  }

  function applyRelay(payload) {
    if (!st.center) return 0;
    st.relayPayload = payload || null;
    var raw = ((payload && payload.stores) || []).map(toRelayStore).filter(Boolean);
    /* 세븐일레븐은 세븐일레븐 정책상 재고를 안내하지 않는다 — 응답에 섞여 와도 위치만 쓰고 수량은 버린다 */
    raw = raw.filter(function (r) { return !isPolicyBrand(r.brand); });
    /* 같은 점포가 두 번 실려 오면 하나만 남긴다 */
    var seen = {};
    var list = [];
    raw.forEach(function (r) {
      var k = normBrandKey(r.brand) + ":" + normStoreName(r.name);
      if (seen[k]) return;
      seen[k] = 1;
      list.push(r);
    });
    /* 이전 조회 결과는 원래 상태로 되돌리고 새로 얹는다 */
    restoreRelayBase();
    var base = st.all;
    list.forEach(function (r) {
      r.distance = meters(st.center, r);
      var twin = findTwin(base, r);
      if (twin && !twin.relay) {
        /* 지도로 그려둔 같은 매장 — 원래 값을 저장해 두고 조회 값으로 잠시 바꿔 쓴다 */
        twin.relayBase = {
          name: twin.name, status: twin.status, observed: twin.observed,
          products: twin.products, street: twin.street, source: twin.source, relayQty: null
        };
        twin.name = r.name || twin.name;
        twin.status = r.status;
        twin.observed = r.observed;
        twin.products = r.products;
        twin.relay = true;
        twin.relayQty = r.relayQty;
        twin.source = "relay";
        if (r.street) twin.street = r.street;
      } else if (!twin) {
        r.distance = meters(st.center, r);
        base.push(r);
      }
    });
    st.relayAt = (payload && payload.generatedAt) || new Date().toISOString();
    st.relay = {
      ok: !!(payload && payload.ok),
      sources: (payload && payload.sources) || {},
      at: Date.now(),
      count: list.length
    };
    renderMarkers();
    pushData();
    return list.length;
  }

  function restoreRelayBase() {
    if (!st.all) return;
    st.all = st.all.filter(function (s) {
      if (s.relay && s.relayBase) {
        s.name = s.relayBase.name;
        s.status = s.relayBase.status;
        s.observed = s.relayBase.observed;
        s.products = s.relayBase.products;
        s.street = s.relayBase.street;
        s.relay = false;
        delete s.relayQty;
        s.source = s.relayBase.source || "live";
        delete s.relayBase;
        return true;
      }
      return !s.relay;   /* 조회로만 추가된 매장은 빼고 지도·스냅샷 매장만 남깁니다 */
    });
  }

  function clearRelay() {
    if (!st.relay) return;
    restoreRelayBase();
    st.relayPayload = null;
    st.relay = null;
    st.relayAt = "";
    if (st.selectedId && !st.all.some(function (s) { return s.id === st.selectedId; })) closeCard();
    renderMarkers();
    pushData();
  }

  /* ---------------------------------------- 이마트(대형마트) 실시간 재고 반영 */
  /* 이마트 점포 재고는 브라우저가 api-eapp.emart.com 을 직접 부른다(relay 불필요).
     응답 점포를 지도 매장 목록에 brand="emart" 로 얹고, 상품별 상태(재고 있음/품절/
     수량 비공개/취급 안 함)와 휴무·영업시간을 그대로 보존한다. */
  function applyEmart(payload) {
    clearEmart();
    if (!payload) return 0;
    st.emartPayload = payload;
    var list = (payload.stores || []).slice();
    list.forEach(function (s) {
      s.source = "emart";
      s.distance = st.center ? meters(st.center, s) : s.distance;
      st.all.push(s);
    });
    /* 카카오 장소 검색이 잡은 '대형마트' 마커가 같은 이마트 점포일 수 있다 — 같은 자리에
       마커를 두 개 그리면 목록·클러스터에 같은 이름이 두 번 나오므로, 이마트 실시간 재고
       카드가 있는 자리의 대형마트 마커는 감춘다(카카오 마커가 없는 점포는 그대로 표시). */
    (st.all || []).forEach(function (s) {
      if (s.emart || s.brand !== "mart") return;
      s.hiddenByEmart = list.some(function (e) { return meters(s, e) <= 250; });
    });
    st.emart = {
      ok: !!payload.ok,
      count: list.length,
      at: payload.at || new Date(),
      stat: payload.stat || null
    };
    renderMarkers();
    pushData();
    return list.length;
  }

  function clearEmart() {
    if (st.all && st.all.length) {
      st.all = st.all.filter(function (s) { return !s.emart; });
      st.all.forEach(function (s) { delete s.hiddenByEmart; });
    }
    st.emartPayload = null;
    st.emart = null;
  }

  /* 이마트 조회 시작 — 늦게 도착한 이전 응답은 seq 로 버린다 */
  function loadEmart(seq) {
    if (!window.PokeMoaEmart || !window.PokeMoaEmart.query || !st.center) return;
    if (figureOnlyMode()) { clearEmart(); return; }
    var my = ++st.emartSeq;
    var center = { lat: st.center.lat, lng: st.center.lng };
    var radius = st.radius;
    emit("pokemoa:emart-progress", { phase: "stores", done: 0, total: 1 });
    window.PokeMoaEmart.query(center, radius, {
      progress: function (p) {
        if (my !== st.emartSeq || seq !== st.seq || figureOnlyMode()) return;
        emit("pokemoa:emart-progress", p);
      }
    }).then(function (res) {
      if (my !== st.emartSeq || seq !== st.seq || figureOnlyMode()) return;
      applyEmart(res);
      emit("pokemoa:emart-done", res);
    }).catch(function (err) {
      if (my !== st.emartSeq || seq !== st.seq) return;
      applyEmart({ ok: false, stores: [], at: new Date(), error: String((err && err.message) || err) });
      emit("pokemoa:emart-done", { ok: false, stores: [], error: String((err && err.message) || err) });
    });
  }

  /* 모드 전환 등으로 다시 조회가 필요할 때(피규어 → 카드) 현재 중심·반경으로 재조회 */
  function refreshEmart() {
    if (!st.center) return;
    if (figureOnlyMode()) { clearEmart(); renderMarkers(); pushData(); return; }
    loadEmart(st.seq);
  }

  /* ---------------------------------------------------------- 공개 API */
  function setView(center, zoom) {
    if (!st.ready) return;
    programMove();
    st.map.setCenter(latlng(center.lat, center.lng));
    st.map.setLevel(levelForZoom(zoom || 15));
    if (st.ring) {
      st.ring.setPosition(latlng(center.lat, center.lng));
      st.ring.setRadius(st.radius);
    }
  }

  function allow20() { return st.allow20 !== false; }

  /* 반경 구간 — 구간마다 장소 검색 계획이 달라 그 구분이 바뀌면 다시 조회한다 */
  function radiusBand(r) {
    return r >= 20000 ? "20" : r > 3000 ? "5" : "3";
  }

  function fitRing() {
    if (!st.ready || !st.ring) return;
    programMove();
    try { st.map.setBounds(st.ring.getBounds()); } catch (e) {}
  }

  function setRadius(radius) {
    if (radius > 5000 && !allow20()) radius = 5000;
    var before = st.radius;
    st.radius = radius;
    if (st.ring) st.ring.setRadius(radius);
    /* 5km·20km는 반경 원 전체가 화면에 들어오도록 지도를 맞춘다 */
    if (radius >= 5000) {
      fitRing();
    } else if (before >= 5000 && st.ready && st.center) {
      /* 넓게 보던 지도에서 1km·3km로 좁힐 때는 기본 확대(줌 15)로 되돌린다 */
      setView(st.center, 15);
    }
    renderMarkers();
    pushData();
    /* 반경 구분(3·5·20km)이 바뀌었거나 조회 범위보다 넓어졌으면(스냅샷 포함)
       그 반경으로 다시 조회한다 — 격자 조회 방식이 달라 20km 결과를 5km에 그대로 쓰면
       실제 5km 매장보다 적게 보인다. */
    if (radius !== before && (radiusBand(radius) !== st.fetchedBand || radius > st.fetchedRadius)) {
      renderMarkers();
      load();
    }
  }

  function setBrand(brand) {
    st.brand = brand;
    renderMarkers();
    pushData();
  }

  function setProduct(id) {
    st.product = id || "all";
    renderMarkers();
    pushData();
  }

  function setStockOnly(on) {
    st.stockOnly = !!on;
    renderMarkers();
    pushData();
  }

  function setShowOffline(on) {
    st.showOffline = !!on;
    renderMarkers();
    pushData();
  }

  function resetStateForNewCenter() {
    st.fetchedRadius = st.radius;
    st.fetchedBand = radiusBand(st.radius);
    st.source = "snapshot";
    st.all = [];
    st.visible = [];
    closeCard();
  }

  function setRegion(id) {
    var r = region(id);
    st.regionId = r.id;
    st.origin = "region";
    st.allow20 = r.allow20 !== false;
    st.metro = !st.allow20;
    if (!st.allow20 && st.radius > 5000) st.radius = 5000;
    st.center = { lat: r.lat, lng: r.lng };
    resetStateForNewCenter();
    if (st.ready) {
      st.loading.tiles = false;
      setView(st.center, st.radius >= 20000 ? (r.zoom || 12) : (r.zoom || 15));
      if (st.ring) st.ring.setRadius(st.radius);
      /* 20km 반경을 고른 상태에서 지역만 바꾸면 반경 전체가 보이도록 맞춘다 */
      if (st.radius >= 20000) fitRing();
    }
    renderMarkers();
    load();
  }

  /* 동네·역 이름 검색 결과(카카오 장소 검색)로 임의 좌표를 볼 때.
     origin 을 넘기면 그 값으로 남긴다 — 마지막 검색 위치 복원(geo=내 위치, map=지도 중심)에도 쓴다. */
  function setPoint(point, origin) {
    if (!point || !isFinite(point.lat) || !isFinite(point.lng)) return;
    st.origin = origin === "geo" || origin === "map" ? origin : "search";
    st.regionId = "";
    st.center = { lat: Number(point.lat), lng: Number(point.lng) };
    st.metro = metroRegions().some(function (r) {
      return meters(st.center, { lat: r.lat, lng: r.lng }) < METRO_RADIUS_M;
    });
    st.allow20 = !st.metro;
    if (!st.allow20 && st.radius > 5000) st.radius = 5000;
    resetStateForNewCenter();
    if (st.ready) {
      st.loading.tiles = false;
      setView(st.center, st.radius >= 20000 ? 12 : 15);
      if (st.ring) st.ring.setRadius(st.radius);
      if (st.radius >= 20000) fitRing();
    }
    renderMarkers();
    load();
  }

  /* 동네·역 이름 → 좌표 (카카오 장소 검색). 결과는 callback(list)로 돌려준다. */
  function searchPlaces(query, cb) {
    if (!query || !window.kakao || !window.kakao.maps || !window.kakao.maps.services) {
      if (cb) cb([]);
      return;
    }
    var P = window.kakao.maps.services;
    try {
      placesService().keywordSearch(query, function (data, status) {
        if (!cb) return;
        if (status !== P.Status.OK || !data) { cb([]); return; }
        cb(data.slice(0, 6).map(function (p) {
          return {
            name: p.place_name,
            address: p.road_address_name || p.address_name || "",
            category: p.category_name || "",
            lat: Number(p.y),
            lng: Number(p.x)
          };
        }).filter(function (p) { return isFinite(p.lat) && isFinite(p.lng); }));
      }, { size: 6, sort: P.SortBy.ACCURACY });
    } catch (e) {
      if (cb) cb([]);
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      emit("pokemoa:geo-error", { message: "이 브라우저는 위치 정보를 지원하지 않습니다. 지역을 선택해 주세요." });
      return;
    }
    st.geoBusy = true;
    pushData();
    emit("pokemoa:geo-start", {});
    navigator.geolocation.getCurrentPosition(function (pos) {
      st.geoBusy = false;
      st.origin = "geo";
      st.center = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      st.metro = metroRegions().some(function (r) {
        return meters(st.center, { lat: r.lat, lng: r.lng }) < METRO_RADIUS_M;
      });
      st.allow20 = !st.metro;
      if (!st.allow20 && st.radius > 5000) st.radius = 5000;
      st.fetchedRadius = st.radius;
      st.fetchedBand = radiusBand(st.radius);
      st.regionId = "";
      if (st.ready) {
        st.loading.tiles = false;
        setView(st.center, 15);
        if (st.meMarker) { try { st.meMarker.setMap(null); } catch (e) {} }
        var node = document.createElement("div");
        node.className = "pm-me";
        node.innerHTML = '<span class="pm-me-dot"></span><span class="pm-me-label">내 위치</span>';
        st.meMarker = new window.kakao.maps.CustomOverlay({
          position: latlng(st.center.lat, st.center.lng),
          content: node,
          xAnchor: 0.5,
          yAnchor: 0.5,
          zIndex: 950
        });
        st.meMarker.setMap(st.map);
      }
      emit("pokemoa:geo-done", { lat: st.center.lat, lng: st.center.lng });
      load();
    }, function (err) {
      st.geoBusy = false;
      var msg = "위치를 가져오지 못했습니다.";
      if (err && err.code === 1) msg = "브라우저 위치 권한이 차단되어 있습니다. 주소창의 위치 권한을 허용하거나 아래 지역을 선택해 주세요.";
      else if (err && err.code === 2) msg = "현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도하거나 지역을 선택해 주세요.";
      else if (err && err.code === 3) msg = "위치 확인 시간이 초과되었습니다. 다시 시도하거나 지역을 선택해 주세요.";
      pushData();
      emit("pokemoa:geo-error", { message: msg });
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  function retry() {
    load();
  }

  function focusStore(id) {
    var s = null;
    for (var i = 0; i < st.visible.length; i++) if (st.visible[i].id === id) s = st.visible[i];
    if (!s) return;
    if (st.ready) {
      programMove();
      st.map.setLevel(Math.min(st.map.getLevel(), 4));
      st.map.panTo(latlng(s.lat, s.lng));
    }
    select(id, false);
  }

  /* 지도를 못 쓰는 주소(미등록 도메인·차단)에서 지도 자리에 남기는 안내 */
  function sdkNoticeHtml() {
    return '<div class="pm-sdk-note" role="status">' +
      '<strong>지도를 불러오지 못했습니다</strong>' +
      '<p>지도 표시가 안 되는 주소에서는 매장 목록과 위치만 보여 드립니다. ' +
      '<a href="https://moa-kr.github.io/pokemoa/" target="_blank" rel="noopener">moa-kr.github.io/pokemoa</a>에서 열면 지도가 함께 나옵니다.</p>' +
      '</div>';
  }

  function showSdkNotice() {
    if (!el.container) return;
    var old = el.container.querySelector(".pm-sdk-note-wrap");
    if (old) old.parentNode.removeChild(old);
    var wrap = document.createElement("div");
    wrap.className = "pm-sdk-note-wrap";
    wrap.innerHTML = sdkNoticeHtml();
    el.container.appendChild(wrap);
  }

  /* 첫 조회를 어디서 시작할지 — 마지막 검색 위치(localStorage)·?region= 쿼리로 넘어온 값.
     { mode: "region", regionId, radius } 또는 { mode: "point", lat, lng, radius, origin }
     좌표·지역이 잘못됐으면 null 을 돌려주고 부르는 쪽이 기본값(서울 광화문)을 쓴다. */
  function applyStart(start) {
    if (!start || typeof start !== "object") return null;
    var radius = Number(start.radius);
    if (isFinite(radius) && radius >= 500 && radius <= 50000) st.radius = radius;
    if (start.mode === "point") {
      var plat = Number(start.lat), plng = Number(start.lng);
      if (!isFinite(plat) || !isFinite(plng) || plat < -90 || plat > 90 || plng < -180 || plng > 180) return null;
      var origin = start.origin === "geo" || start.origin === "map" ? start.origin : "search";
      /* 지도(SDK)는 아직 없으므로 중심·반경·도심 여부만 먼저 맞춰 두고,
         실제 지도 이동·조회는 SDK 가 준비된 뒤 setPoint 로 한다 */
      st.origin = origin;
      st.regionId = "";
      st.center = { lat: plat, lng: plng };
      st.metro = metroRegions().some(function (r) {
        return meters(st.center, { lat: r.lat, lng: r.lng }) < METRO_RADIUS_M;
      });
      st.allow20 = !st.metro;
      if (!st.allow20 && st.radius > 5000) st.radius = 5000;
      return { mode: "point", lat: plat, lng: plng, origin: origin };
    }
    var r = findRegion(start.regionId);
    if (!r) return null;
    st.regionId = r.id;
    st.origin = "region";
    st.allow20 = r.allow20 !== false;
    st.metro = !st.allow20;
    if (!st.allow20 && st.radius > 5000) st.radius = 5000;
    st.center = { lat: r.lat, lng: r.lng };
    return { mode: "region", regionId: r.id };
  }

  function init(opts) {
    el.container = opts.container;
    el.card = opts.card;
    var start = applyStart(opts.start);
    /* 첫 조회 — 복원한 위치가 있으면 그 자리에서, 없으면 기본 지역(서울 광화문)에서 */
    function firstSearch() {
      if (start && start.mode === "point") setPoint({ lat: start.lat, lng: start.lng }, start.origin);
      else setRegion(st.regionId);
    }

    ensureKakao(function (ok) {
      if (!ok) {
        st.sdkError = true;
        st.ready = false;
        st.loading.tiles = false;
        showSdkNotice();
        emit("pokemoa:loading", { active: false, phase: "error", message: "지도를 불러오지 못했습니다", progress: 0 });
        emit("pokemoa:sdk-error", {
          message: "지도를 불러오지 못해 미리 저장한 매장 목록으로 표시합니다."
        });
        firstSearch();
        return;
      }
      buildMap();
      firstSearch();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && st.selectedId) closeCard();
    });

    return API;
  }

  var API = {
    init: init,
    setRegion: setRegion,
    setPoint: setPoint,
    searchPlaces: searchPlaces,
    setBrand: setBrand,
    setProduct: setProduct,
    setStockOnly: setStockOnly,
    setShowOffline: setShowOffline,
    setRadius: setRadius,
    locate: locate,
    retry: retry,
    focusStore: focusStore,
    closeCard: closeCard,
    getState: function () { return st; },
    getVisible: function () { return st.visible.slice(); },
    applyRelay: applyRelay,
    clearRelay: clearRelay,
    applyEmart: applyEmart,
    clearEmart: clearEmart,
    refreshEmart: refreshEmart,
    invalidate: function () { if (st.ready && st.map.relayout) { try { st.map.relayout(); } catch (e) {} } }
  };
  return API;
})();
