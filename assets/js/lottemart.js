/* =========================================================================
 * 포켓몬카드모아 — 롯데마트·토이저러스 점포별 실시간 재고 (2026-11-26 v4.59)
 *
 * · 롯데마트 모바일 도와센터(company.lottemart.com/mobiledowa)는 로그인·토큰 없이
 *   지역·매장·상품명으로 점포별 상품명·가격·재고 수량/품절을 HTML 로 돌려준다.
 *   다만 해외 IP 를 막고(미국 리전 서버에서 타임아웃), 브라우저에서 직접 부르면
 *   CORS 로 막히므로 중계 서버를 거친다.
 *     GET {중계}/api/lottemart/stores?area=서울
 *     GET {중계}/api/lottemart/stock?area=서울&market=2302&q=포켓몬&page=1
 *   중계는 ① 집 태블릿(사용자가 어드민에서 v2.3 으로 올린 경우) ② 회사복지모아
 *   Render 서버 순서로 시도한다. 둘 다 안 되면 '중계 없음'으로 조용히 끝낸다.
 *
 * · 매장 이름은 도와센터 표기(예: 제타플렉스 잠실점)와 카카오 표기
 *   (롯데마트 제타플렉스 잠실점)가 달라서, 앞의 '롯데마트'를 떼고 공백을 지워 비교한다.
 *   토이저러스는 카카오 업종(MT1 대형마트) 검색에 잡히지 않아(업종이 완구점) 지도에 따로 서지 못했다.
 *   그래서 전국 13곳 좌표를 `data.js` `toysrusBranches` 에 넣고 **표를 먼저** 쓴다(검색 실패·오차 없음).
 *   같은 건물에 롯데마트가 있으면(60~160m) 새 마커를 만들지 않고 그 마커에 `hostRowId` 로 붙여
 *   지도에서는 '롯데마트·토이저러스' 한 곳, 매장 카드에서는 두 점포 재고를 나란히 보여 준다.
 *
 * · 상품은 검색어 '포켓몬' 결과를 쓰되, 카드(TCG) 상품은 이름으로 골라낸다.
 *   2026-11-26 실측: 도와센터에는 포켓몬 TCG 부스터 상품이 없고 완구·문구·카드용품만
 *   있어, 카드가 0건이면 그 사실을 그대로 적고 포켓몬 상품 재고 수만 함께 알린다.
 *
 * · 시·도 판정(2026-11-26 v4.59): 지역 선택(드롭다운)은 고른 시·도 하나만 본다.
 *   내 위치·지도 이동·?lat=&lng= 로 찾을 때는 사각 경계(BOXES)가 성겨 서울 끝(광명 등)이
 *   '서울' 하나로만 잡혀 경기 점포를 못 불렀다. 그래서 좌표 조회에서는 사각 경계가 고른
 *   시·도 + 그 좌표 반경+4km 안에 시·군·구 좌표·토이저러스 좌표가 있는 인접 시·도를
 *   가까운 순으로 최대 2개만 함께 조회한다(areasForPoint).
 * ========================================================================= */
window.PokeMoMoaLotte = (function () {
  "use strict";

  var D = window.POKEMOA_DATA || {};
  var QUERY = "포켓몬";
  var TIMEOUT = 12000;
  var MAX_STORES = 6;      /* 한 번에 재고를 조회할 건물 수 상한(같은 건물의 롯데마트·토이저러스는 한 건물) */
  var MAX_STOCK = 10;      /* 재고 요청 상한 — 중계 분당 한도(90) 안에서 여유를 둔다 */
  var MAX_PAGES = 2;       /* 점포당 상품 페이지(20건) 상한 */
  var TOYS = D.toysrusBranches || [];   /* 토이저러스 전국 13곳 — 이름·좌표·같은 건물 롯데마트 코드 */
  var TOY = /^토이저러스/;
  var TOY_HOST_M = 160;    /* 같은 건물로 보는 거리 — 몰·아울렛 안에서 롯데마트와 토이저러스가 떨어진 정도(실측 3~140m) */
  var CARD_RE = /(카드게임|포켓몬\s*카드|부스터|확장팩|스타터|기념팩|하이클래스|스페셜팩|트레이딩\s*카드|TCG)/i;
  var AREAS = ["서울", "경기", "인천", "강원", "충북", "충남", "대전", "경북", "경남", "대구", "부산", "울산", "전북", "전남", "광주", "제주"];
  /* 좌표로 지역을 찾을 때 쓰는 대략 경계(지역 선택 없이 내 위치·지도 이동으로 찾을 때) */
  var BOXES = [
    { area: "서울", la: [37.42, 37.71], ln: [126.76, 127.19] },
    { area: "인천", la: [37.20, 37.85], ln: [126.25, 126.85] },
    { area: "대전", la: [36.20, 36.50], ln: [127.25, 127.60] },
    { area: "대구", la: [35.60, 36.05], ln: [128.25, 128.85] },
    { area: "부산", la: [34.95, 35.35], ln: [128.85, 129.35] },
    { area: "울산", la: [35.35, 35.75], ln: [129.05, 129.55] },
    { area: "광주", la: [35.00, 35.30], ln: [126.60, 127.05] },
    { area: "제주", la: [33.05, 33.65], ln: [126.05, 127.05] },
    { area: "경기", la: [36.85, 38.30], ln: [126.30, 127.95] },
    { area: "강원", la: [37.00, 38.65], ln: [127.40, 129.40] },
    { area: "충북", la: [35.95, 37.25], ln: [127.25, 128.75] },
    { area: "충남", la: [35.85, 37.10], ln: [126.05, 127.45] },
    { area: "경북", la: [35.45, 37.15], ln: [127.95, 129.65] },
    { area: "경남", la: [34.55, 35.65], ln: [127.45, 129.25] },
    { area: "전북", la: [35.25, 36.15], ln: [126.25, 127.95] },
    { area: "전남", la: [34.15, 35.45], ln: [125.85, 127.85] }
  ];

  var MAX_AREAS = 2;       /* 좌표 조회에서 함께 볼 시·도 수 상한(경계 지역만 인접 시·도 추가) */
  var AREA_MARGIN_M = 4000; /* 인접 시·도를 함께 볼 여유 — 시·군·구 좌표가 반경보다 이만큼 밖이어도 포함 */

  var baseState = { tried: {}, ok: null };   /* 이번 세션에서 확인한 중계 주소 */
  var storeCache = {};                        /* area -> { at, list } */
  var stockCache = {};                        /* code -> { at, val } */
  var geoCache = {};                          /* 이름 -> 좌표 */
  var geoPending = {};

  function noop() {}
  function now() { return Date.now(); }

  function relayBase() {
    var saved = "";
    try { saved = localStorage.getItem("pokemoa.relayUrl") || ""; } catch (e) { saved = ""; }
    return String(saved || (D.relayPreset && D.relayPreset.url) || "").replace(/\/+$/, "");
  }

  function candidates() {
    var out = [];
    var relay = relayBase();
    if (relay) out.push(relay + "/api/lottemart");
    out.push("https://bokjimoa.onrender.com/api/lottemart");
    return out;
  }

  function getJson(url) {
    return new Promise(function (resolve) {
      var ctl = typeof AbortController === "function" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (e) {} } }, TIMEOUT);
      function done(v) { clearTimeout(timer); resolve(v); }
      try {
        fetch(url, { mode: "cors", credentials: "omit", cache: "no-store", signal: ctl ? ctl.signal : undefined })
          .then(function (res) {
            return res.text().then(function (text) {
              var data = null;
              try { data = JSON.parse(text); } catch (e) { data = null; }
              done({ ok: res.ok && !!data && data.ok !== false, status: res.status, data: data, text: text });
            });
          })
          .catch(function (err) { done({ ok: false, status: 0, data: null, error: String((err && err.message) || err) }); });
      } catch (err) {
        done({ ok: false, status: 0, data: null, error: String((err && err.message) || err) });
      }
    });
  }

  /* 중계 주소를 한 번만 확인한다 — stores 요청 하나로 어느 쪽이 살아 있는지 본다.
     확인하며 받은 점포 목록은 그대로 캐시에 넣어, 같은 시·도를 다시 부르지 않는다. */
  function pickBase(area) {
    if (baseState.ok) return Promise.resolve(baseState.ok);
    var list = candidates().filter(function (b) { return !baseState.tried[b]; });
    if (!list.length) return Promise.resolve(null);
    var base = list[0];
    baseState.tried[base] = true;
    return getJson(base + "/stores?area=" + encodeURIComponent(area)).then(function (res) {
      if (res.ok) {
        baseState.ok = base;
        if (res.data && res.data.stores && res.data.stores.length) {
          storeCache[area] = { at: now(), list: res.data.stores };
        }
        return base;
      }
      return pickBase(area);
    });
  }

  /* 지역 id → 시·도 (없거나 도와센터가 모르는 시·도면 "") */
  function provinceOfRegion(regionId) {
    if (!regionId || !D.regions) return "";
    for (var i = 0; i < D.regions.length; i++) {
      if (D.regions[i].id !== regionId) continue;
      var prov = String(D.regions[i].province || "");
      return AREAS.indexOf(prov) >= 0 ? prov : "";
    }
    return "";
  }

  function areaOfRegion(regionId, center) {
    return provinceOfRegion(regionId) || areaOfPoint(center);
  }

  function areaOfPoint(center) {
    if (!center || !isFinite(center.lat) || !isFinite(center.lng)) return "";
    for (var i = 0; i < BOXES.length; i++) {
      var b = BOXES[i];
      if (center.lat >= b.la[0] && center.lat <= b.la[1] && center.lng >= b.ln[0] && center.lng <= b.ln[1]) return b.area;
    }
    return "";
  }

  /* 주소 앞머리로 시·도 — data.js 에 넣어 둔 토이저러스 좌표를 어느 시·도로 볼지 정한다 */
  function areaOfAddress(addr) {
    var a = String(addr || "").replace(/^\s+/, "");
    if (/^전남광주/.test(a)) return "광주";   /* 통합 표기(토이저러스 수완점) */
    for (var i = 0; i < AREAS.length; i++) if (a.indexOf(AREAS[i]) === 0) return AREAS[i];
    return "";
  }

  /* 그 시·도에서 가장 가까운 시·군·구 좌표(data.js regions)까지 거리(m) */
  function regionDistance(center, area) {
    var best = Infinity;
    var list = D.regions || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].province || "") !== area) continue;
      if (!isFinite(list[i].lat) || !isFinite(list[i].lng)) continue;
      var d = meters(center, list[i]);
      if (d < best) best = d;
    }
    return best;
  }

  /* 그 시·도에서 가장 가까운 내장 점포 좌표(토이저러스 13곳)까지 거리(m) */
  function branchDistance(center, area) {
    var best = Infinity;
    for (var i = 0; i < TOYS.length; i++) {
      var t = TOYS[i];
      if (!isFinite(t.lat) || !isFinite(t.lng)) continue;
      if (areaOfAddress(t.addr) !== area) continue;
      var d = meters(center, t);
      if (d < best) best = d;
    }
    return best;
  }

  /* 좌표 조회에서 함께 볼 시·도 목록 — 가까운 순, 최대 MAX_AREAS.
     첫 자리는 지금까지처럼 사각 경계(BOXES)가 고른 시·도다. 두 번째부터는 그 좌표에서
     반경+4km 안에 시·군·구 좌표나 확인된 점포 좌표가 있는 시·도만 고른다 — 전국을 다
     부르지 않고, 경계에 붙은 좌표(광명·부천·계양 등)에서 인접 시·도 점포를 놓치지 않는다. */
  function areasForPoint(center, radius) {
    if (!center || !isFinite(center.lat) || !isFinite(center.lng)) return [];
    var reach = (Number(radius) || 0) + AREA_MARGIN_M;
    var primary = areaOfPoint(center);
    var cand = [];
    for (var i = 0; i < AREAS.length; i++) {
      var area = AREAS[i];
      if (area === primary) continue;
      var near = Math.min(regionDistance(center, area), branchDistance(center, area));
      if (near > reach) continue;
      cand.push({ area: area, near: near, order: i });
    }
    cand.sort(function (x, y) {
      if (x.near !== y.near) return x.near - y.near;
      return x.order - y.order;
    });
    var out = primary ? [primary] : [];
    for (var j = 0; j < cand.length && out.length < MAX_AREAS; j++) out.push(cand[j].area);
    return out;
  }

  /* 이번 조회에서 볼 시·도 — 지역 선택이면 고른 시·도 하나, 좌표면 경계 보완까지 */
  function areasForQuery(regionId, center, radius) {
    var one = provinceOfRegion(regionId);
    if (one) return [one];
    return areasForPoint(center, radius);
  }

  function normName(name) {
    return String(name || "")
      .replace(/^롯데마트\s*/i, "")
      .replace(/^롯데\s*/i, "")
      .replace(/\s+/g, "")
      .replace(/점$/, "");
  }

  function chainOf(name) {
    var n = String(name || "");
    if (TOY.test(n)) return "토이저러스";
    if (/^맥스/.test(n)) return "롯데마트 맥스";
    if (/^그랑그로서리/.test(n)) return "그랑그로서리";
    if (/^보틀벙커/.test(n)) return "보틀벙커";
    return "롯데마트";
  }

  function isToy(name) { return TOY.test(String(name || "")); }

  /* 도와센터 점포 이름으로 토이저러스 좌표표(data.js)를 찾는다 — 코드가 같거나 이름이 같으면 그 점포 */
  function toyInfo(name, code) {
    if (!TOYS.length) return null;
    var key = normName(name);
    for (var i = 0; i < TOYS.length; i++) {
      var t = TOYS[i];
      if (code && String(t.code) === String(code)) return t;
    }
    for (var j = 0; j < TOYS.length; j++) {
      var b = TOYS[j];
      var bk = normName(b.name);
      if (!bk || !key) continue;
      if (bk === key || key.indexOf(bk) >= 0 || bk.indexOf(key) >= 0) return b;
    }
    return null;
  }

  /* 토이저러스와 같은 건물의 롯데마트 마커를 찾는다(같은 이름 조각 우선 → 가까운 순) */
  function hostRowFor(toy, geo, rows) {
    var place = normName((toy && toy.place) || "");
    var best = null;
    var bestScore = -1;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.martChain === "토이저러스") continue;
      var d = meters(r, geo);
      if (d > TOY_HOST_M) continue;
      var rk = normName(r.name);
      var score = 0;
      if (place && rk) {
        if (place.indexOf(rk) >= 0) score = 2;          /* 롯데마트 제타플렉스 잠실점 ⊂ 장소명 */
        else {
          var tokens = place.split(/[\s()]+/).filter(function (t) { return t.length >= 3; });
          tokens.forEach(function (t) { if (rk.indexOf(t) >= 0) score += 1; });
        }
      }
      /* 점수 → 가까운 순. 점수가 없어도 160m 안이면 그 건물로 본다 */
      var cand = { row: r, score: score, d: d };
      if (!best || score > bestScore || (score === bestScore && d < best.d)) {
        best = cand;
        bestScore = score;
      }
    }
    return best ? best.row : null;
  }

  function meters(a, b) {
    var R = 6371008.8, p = Math.PI / 180;
    var dLat = (b.lat - a.lat) * p, dLng = (b.lng - a.lng) * p;
    var la1 = a.lat * p, la2 = b.lat * p;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /* 도와센터 점포 목록 — 6시간 캐시 */
  function loadStores(base, area) {
    var hit = storeCache[area];
    if (hit && now() - hit.at < 6 * 60 * 60 * 1000) return Promise.resolve(hit.list);
    return getJson(base + "/stores?area=" + encodeURIComponent(area)).then(function (res) {
      var list = (res.ok && res.data && res.data.stores) || [];
      storeCache[area] = { at: now(), list: list };
      return list;
    });
  }

  /* 점포 재고 — 3분 캐시. page 1 이 20건을 넘으면 page 2 까지만 더 읽는다.
     캐시 열쇠에 시·도를 넣는다 — 인접 시·도 목록을 함께 보므로 코드가 겹쳐도 섞이지 않게. */
  function loadStock(base, area, code) {
    var cacheKey = (area || "") + ":" + code;
    var hit = stockCache[cacheKey];
    if (hit && now() - hit.at < 3 * 60 * 1000) return Promise.resolve(hit.val);
    var url = base + "/stock?market=" + encodeURIComponent(code) +
      (area ? "&area=" + encodeURIComponent(area) : "") +
      "&q=" + encodeURIComponent(QUERY) + "&page=1";
    return getJson(url).then(function (res) {
      if (!res.ok || !res.data) return { ok: false, items: [], total: 0, error: res.error || "stock-failed" };
      var items = res.data.items || [];
      var total = Number(res.data.total) || items.length;
      var pages = Number(res.data.pages) || 1;
      if (total > items.length && pages > 1) {
        return getJson(base + "/stock?market=" + encodeURIComponent(code) +
          (area ? "&area=" + encodeURIComponent(area) : "") +
          "&q=" + encodeURIComponent(QUERY) + "&page=2").then(function (res2) {
            if (res2.ok && res2.data && res2.data.items) items = items.concat(res2.data.items);
            return finish(total, items);
          });
      }
      return finish(total, items);
    });

    function finish(total, items) {
      var cardItems = items.filter(function (it) { return CARD_RE.test(it.name || ""); }).map(function (it) {
        return { name: it.name, price: it.price, priceText: it.priceText, stock: it.stock, soldOut: !!it.soldOut };
      });
      var stockCount = items.filter(function (it) { return Number(it.stock) > 0; }).length;
      var val = {
        ok: true,
        items: items,
        cardItems: cardItems,
        total: total,
        totalCount: total || items.length,
        stockCount: stockCount,
        cardStock: cardItems.filter(function (c) { return Number(c.stock) > 0; }).length,
        at: now()
      };
      stockCache[cacheKey] = { at: now(), val: val };
      return val;
    }
  }

  /* 카카오 키워드 검색으로 점포 좌표 확인 — 토이저러스는 data.js 표를 먼저 쓴다(표에 없는 이름만 검색) */
  function geocode(name) {
    if (geoCache[name]) return Promise.resolve(geoCache[name]);
    if (geoPending[name]) return geoPending[name];
    var toy = toyInfo(name);
    if (toy && isFinite(toy.lat) && isFinite(toy.lng)) {
      var fixed = { lat: Number(toy.lat), lng: Number(toy.lng), street: toy.addr || "", fixed: true };
      geoCache[name] = fixed;
      return Promise.resolve(fixed);
    }
    if (!window.kakao || !window.kakao.maps || !window.kakao.maps.services) return Promise.resolve(null);
    geoPending[name] = new Promise(function (resolve) {
      var query = String(name || "").trim();
      /* 이름에 브랜드가 없으면 ‘롯데마트’를 붙여 찾는다(토이저러스·그랑그로서리는 그대로) */
      if (!/^(토이저러스|롯데마트|그랑그로서리|맥스|보틀벙커)/.test(query)) query = "롯데마트 " + query;
      try {
        new window.kakao.maps.services.Places().keywordSearch(query, function (data, status) {
          var hit = null;
          if (status === window.kakao.maps.services.Status.OK && data && data.length) {
            var lat = Number(data[0].y), lng = Number(data[0].x);
            if (isFinite(lat) && isFinite(lng)) hit = { lat: lat, lng: lng, street: data[0].road_address_name || data[0].address_name || "" };
          }
          if (hit) geoCache[name] = hit;
          resolve(hit);
        }, { size: 3, sort: window.kakao.maps.services.SortBy.ACCURACY });
      } catch (err) { resolve(null); }
    }).then(function (v) { delete geoPending[name]; return v; });
    return geoPending[name];
  }

  /* 시·도별로 번갈아 고른다 — 두 시·도 목록을 함께 볼 때 한쪽 목록이 위치 확인 자리를
     다 차지하지 않게(위치 확인은 8곳까지만 한다) */
  function interleaveByArea(list, cap) {
    var order = [];
    var byArea = {};
    list.forEach(function (st) {
      var k = st.area || "";
      if (!byArea[k]) { byArea[k] = []; order.push(k); }
      byArea[k].push(st);
    });
    var out = [];
    for (var round = 0; out.length < cap; round++) {
      var added = false;
      for (var i = 0; i < order.length && out.length < cap; i++) {
        var bucket = byArea[order[i]];
        if (round < bucket.length) { out.push(bucket[round]); added = true; }
      }
      if (!added) break;
    }
    return out;
  }

  /* 카카오 대형마트 마커(rows)와 도와센터 점포 이름을 맞춘다 */
  function matchRows(stores, rows) {
    var used = {};
    var out = [];
    stores.forEach(function (st) {
      var key = normName(st.name);
      if (!key) return;
      var hit = null;
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i];
        if (used[r.id]) continue;
        var rk = normName(r.name);
        if (!rk) continue;
        if (rk === key || rk.indexOf(key) >= 0 || (key.indexOf(rk) >= 0 && rk.length >= 3)) { hit = r; break; }
      }
      if (hit) { used[hit.id] = true; out.push({ store: st, row: hit }); }
      else out.push({ store: st, row: null });
    });
    return out;
  }

  /* 공개 API — center·radius·regionId·rows 를 받아 점포별 재고를 돌려준다 */
  function query(opts) {
    var center = opts.center || null;
    var radius = Number(opts.radius) || 3000;
    var rows = (opts.rows || []).filter(function (r) { return r && isFinite(r.lat) && isFinite(r.lng); });
    var areas = areasForQuery(opts.regionId, center, radius);
    var emit = typeof opts.progress === "function" ? opts.progress : noop;
    if (!areas.length) return Promise.resolve({ ok: false, stores: [], reason: "area-unknown" });

    emit({ phase: "stores", done: 0, total: areas.length });
    return pickBase(areas[0]).then(function (base) {
      if (!base) return { ok: false, stores: [], reason: "no-relay" };
      /* 시·도 목록은 6시간 캐시라, 인접 시·도를 더 봐도 요청은 처음 한 번씩만 늘어난다 */
      var areaDone = 0;
      var listJobs = areas.map(function (area) {
        return loadStores(base, area).then(function (list) {
          areaDone += 1;
          emit({ phase: "stores", done: areaDone, total: areas.length });
          return { area: area, list: list || [] };
        }).catch(function () {
          areaDone += 1;
          emit({ phase: "stores", done: areaDone, total: areas.length });
          return { area: area, list: [] };
        });
      });
      return Promise.all(listJobs).then(function (parts) {
        /* 시·도마다 점포에 그 시·도를 붙여 하나로 합친다(같은 코드는 한 번만) */
        var list = [];
        var seenCode = {};
        parts.forEach(function (part) {
          (part.list || []).forEach(function (st) {
            var code = String((st && st.code) || "");
            if (!code || seenCode[code]) return;
            seenCode[code] = 1;
            list.push({ code: code, name: st.name, area: part.area });
          });
        });
        if (!list.length) return { ok: false, stores: [], reason: "no-store-list" };
        var pairs = matchRows(list, rows);
        var taken = {};
        pairs.forEach(function (p) { if (p.row) taken[p.row.id] = 1; });
        var near = [];
        pairs.forEach(function (p) {
          if (p.row && center) {
            var d = meters(center, p.row);
            if (d <= radius + 1) near.push({ store: p.store, row: p.row, distance: d });
          }
        });
        /* 마커가 없는 점포는 위치를 확인해 반경 안이면 따로 세운다.
           토이저러스는 좌표표(data.js)를 쓰므로 카카오 호출이 없다 — 반경 안 13곳을 다 본다.
           표에 없는 점포는 카카오 키워드 검색이 필요해 8곳까지만 본다(세션 캐시). */
        var unmatched = pairs.filter(function (p) { return !p.row; }).map(function (p) { return p.store; });
        var others = interleaveByArea(unmatched.filter(function (st) { return !isToy(st.name); }), 8);
        var geoJobs = unmatched.filter(function (st) { return isToy(st.name); })
          .concat(others)
          .map(function (st) {
          return geocode(st.name).then(function (geo) {
            if (!geo || !center) return null;
            var d = meters(center, geo);
            if (d > radius + 1) return null;
            if (isToy(st.name)) {
              var host = hostRowFor(toyInfo(st.name, st.code), geo, rows);
              return { store: st, row: null, geo: geo, distance: d, kind: "toy", hostRowId: host ? host.id : "" };
            }
            /* 같은 자리에 이미 마트 마커가 있으면 새 마커를 만들지 않고 그 마커에 붙인다
               (예: 카카오 ‘토이저러스 롯데마트 제타플렉스 잠실점’ ↔ 도와센터 ‘토이저러스 제타플렉스’) */
            var nearRows = rows.filter(function (r) { return !taken[r.id] && meters(r, geo) <= 60; });
            var shared = function (r) {
              var a = normName(r.name), b = normName(st.name);
              if (!a || !b) return 0;
              if (a.indexOf(b) >= 0 || b.indexOf(a) >= 0) return 2;
              var tokens = b.split(/[\s()]+/).filter(function (t) { return t.length >= 2; });
              var hit = 0;
              tokens.forEach(function (t) { if (a.indexOf(t) >= 0) hit += 1; });
              return hit;
            };
            nearRows.sort(function (x, y) { return shared(y) - shared(x); });
            var twin = nearRows.length && shared(nearRows[0]) > 0 ? nearRows[0] : (nearRows.length === 1 ? nearRows[0] : null);
            if (twin) {
              taken[twin.id] = 1;
              return { store: st, row: twin, distance: meters(center, twin), kind: "mart" };
            }
            return { store: st, row: null, distance: d, geo: geo, kind: "mart" };
          });
        });
        return Promise.all(geoJobs).then(function (extra) {
          extra.forEach(function (x) { if (x) near.push(x); });
          near.sort(function (a, b) { return a.distance - b.distance; });
          /* 건물 단위로 묶는다 — 같은 건물의 롯데마트와 토이저러스는 한 건물로 세고 재고는 둘 다 조회한다 */
          var groups = [];
          var groupBy = {};
          near.forEach(function (item) {
            var key = item.hostRowId || (item.row && item.row.id) || item.store.code;
            var g = groupBy[key];
            if (!g) {
              g = groupBy[key] = { key: key, items: [], distance: item.distance };
              groups.push(g);
            }
            g.items.push(item);
            if (item.distance < g.distance) g.distance = item.distance;
          });
          groups.sort(function (a, b) { return a.distance - b.distance; });
          var picked = [];
          groups.slice(0, MAX_STORES).forEach(function (g) {
            g.items.forEach(function (it) { if (picked.length < MAX_STOCK) picked.push(it); });
          });
          emit({ phase: "stock", done: 0, total: picked.length });
          var done = 0;
          var jobs = picked.map(function (item) {
            return loadStock(base, item.store.area || areas[0], item.store.code).then(function (val) {
              done += 1;
              emit({ phase: "stock", done: done, total: picked.length });
              return { item: item, val: val };
            });
          });
          return Promise.all(jobs).then(function (all) {
            var stores = all.filter(function (x) { return x.val && x.val.ok; }).map(function (x) {
              var it = x.item;
              var toy = isToy(it.store.name) ? toyInfo(it.store.name, it.store.code) : null;
              return {
                code: it.store.code,
                name: it.store.name,
                chain: chainOf(it.store.name),
                lat: it.row ? it.row.lat : it.geo.lat,
                lng: it.row ? it.row.lng : it.geo.lng,
                street: it.row ? it.row.street : (it.geo ? it.geo.street : ""),
                distance: it.distance,
                rowId: it.row ? it.row.id : "",
                hostRowId: it.hostRowId || "",
                place: toy ? (toy.place || "") : "",
                total: x.val.totalCount,
                stockCount: x.val.stockCount,
                cardItems: x.val.cardItems,
                cardStock: x.val.cardStock,
                at: x.val.at
              };
            });
            return { ok: true, area: areas[0], areas: areas, base: base, stores: stores, checked: picked.length };
          });
        });
      });
    });
  }

  return { query: query, areaOfPoint: areaOfPoint, areasForPoint: areasForPoint, areasForQuery: areasForQuery,
    maxAreas: MAX_AREAS, areaMarginM: AREA_MARGIN_M, normName: normName, chainOf: chainOf, reset: function () {
    baseState = { tried: {}, ok: null };
    storeCache = {}; stockCache = {}; geoCache = {};
  } };
})();
