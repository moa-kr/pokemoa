/* =========================================================================
 * 포켓몬카드모아 — 롯데마트·토이저러스 점포별 실시간 재고 (2026-11-26 v4.57)
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
 *   카카오 대형마트 마커에 없는 점포(토이저러스 등)는 카카오 키워드 검색으로 위치를
 *   확인해 따로 그린다(세션 동안 캐시).
 *
 * · 상품은 검색어 '포켓몬' 결과를 쓰되, 카드(TCG) 상품은 이름으로 골라낸다.
 *   2026-11-26 실측: 도와센터에는 포켓몬 TCG 부스터 상품이 없고 완구·문구·카드용품만
 *   있어, 카드가 0건이면 그 사실을 그대로 적고 포켓몬 상품 재고 수만 함께 알린다.
 * ========================================================================= */
window.PokeMoMoaLotte = (function () {
  "use strict";

  var D = window.POKEMOA_DATA || {};
  var QUERY = "포켓몬";
  var TIMEOUT = 12000;
  var MAX_STORES = 6;      /* 한 번에 재고를 조회할 점포 수 상한 */
  var MAX_PAGES = 2;       /* 점포당 상품 페이지(20건) 상한 */
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

  /* 중계 주소를 한 번만 확인한다 — stores 요청 하나로 어느 쪽이 살아 있는지 본다. */
  function pickBase(area) {
    if (baseState.ok) return Promise.resolve(baseState.ok);
    var list = candidates().filter(function (b) { return !baseState.tried[b]; });
    if (!list.length) return Promise.resolve(null);
    var base = list[0];
    baseState.tried[base] = true;
    return getJson(base + "/stores?area=" + encodeURIComponent(area)).then(function (res) {
      if (res.ok) { baseState.ok = base; return base; }
      return pickBase(area);
    });
  }

  function areaOfRegion(regionId, center) {
    if (regionId && D.regions) {
      for (var i = 0; i < D.regions.length; i++) {
        if (D.regions[i].id !== regionId) continue;
        var prov = String(D.regions[i].province || "");
        if (AREAS.indexOf(prov) >= 0) return prov;
      }
    }
    return areaOfPoint(center);
  }

  function areaOfPoint(center) {
    if (!center || !isFinite(center.lat) || !isFinite(center.lng)) return "";
    for (var i = 0; i < BOXES.length; i++) {
      var b = BOXES[i];
      if (center.lat >= b.la[0] && center.lat <= b.la[1] && center.lng >= b.ln[0] && center.lng <= b.ln[1]) return b.area;
    }
    return "";
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
    if (/^토이저러스/.test(n)) return "토이저러스";
    if (/^맥스/.test(n)) return "롯데마트 맥스";
    if (/^그랑그로서리/.test(n)) return "그랑그로서리";
    if (/^보틀벙커/.test(n)) return "보틀벙커";
    return "롯데마트";
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

  /* 점포 재고 — 3분 캐시. page 1 이 20건을 넘으면 page 2 까지만 더 읽는다. */
  function loadStock(base, area, code) {
    var hit = stockCache[code];
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
      stockCache[code] = { at: now(), val: val };
      return val;
    }
  }

  /* 카카오 키워드 검색으로 점포 좌표 확인(토이저러스처럼 대형마트 마커에 없는 점포) */
  function geocode(name) {
    if (geoCache[name]) return Promise.resolve(geoCache[name]);
    if (geoPending[name]) return geoPending[name];
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
    var area = areaOfRegion(opts.regionId, center);
    var emit = typeof opts.progress === "function" ? opts.progress : noop;
    if (!area) return Promise.resolve({ ok: false, stores: [], reason: "area-unknown" });

    emit({ phase: "stores", done: 0, total: 1 });
    return pickBase(area).then(function (base) {
      if (!base) return { ok: false, stores: [], reason: "no-relay" };
      return loadStores(base, area).then(function (list) {
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
        /* 마커가 없는 점포(토이저러스 등)는 위치를 확인해 반경 안이면 따로 표시한다 */
        var unmatched = pairs.filter(function (p) { return !p.row; }).map(function (p) { return p.store; });
        var geoJobs = unmatched.slice(0, 8).map(function (st) {
          return geocode(st.name).then(function (geo) {
            if (!geo || !center) return null;
            var d = meters(center, geo);
            if (d > radius + 1) return null;
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
              return { store: st, row: twin, distance: meters(center, twin) };
            }
            return { store: st, row: null, distance: d, geo: geo };
          });
        });
        return Promise.all(geoJobs).then(function (extra) {
          extra.forEach(function (x) { if (x) near.push(x); });
          near.sort(function (a, b) { return a.distance - b.distance; });
          var picked = near.slice(0, MAX_STORES);
          emit({ phase: "stock", done: 0, total: picked.length });
          var done = 0;
          var jobs = picked.map(function (item) {
            return loadStock(base, area, item.store.code).then(function (val) {
              done += 1;
              emit({ phase: "stock", done: done, total: picked.length });
              return { item: item, val: val };
            });
          });
          return Promise.all(jobs).then(function (all) {
            var stores = all.filter(function (x) { return x.val && x.val.ok; }).map(function (x) {
              var it = x.item;
              return {
                code: it.store.code,
                name: it.store.name,
                chain: chainOf(it.store.name),
                lat: it.row ? it.row.lat : it.geo.lat,
                lng: it.row ? it.row.lng : it.geo.lng,
                street: it.row ? it.row.street : (it.geo ? it.geo.street : ""),
                distance: it.distance,
                rowId: it.row ? it.row.id : "",
                total: x.val.totalCount,
                stockCount: x.val.stockCount,
                cardItems: x.val.cardItems,
                cardStock: x.val.cardStock,
                at: x.val.at
              };
            });
            return { ok: true, area: area, base: base, stores: stores, checked: picked.length };
          });
        });
      });
    });
  }

  return { query: query, areaOfPoint: areaOfPoint, normName: normName, chainOf: chainOf, reset: function () {
    baseState = { tried: {}, ok: null };
    storeCache = {}; stockCache = {}; geoCache = {};
  } };
})();
