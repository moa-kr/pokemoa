/* =========================================================================
 * 포켓몬카드모아 — 이마트(대형마트) 점포별 실시간 재고 조회
 *
 * · 이마트 앱이 쓰는 점포 재고 API(api-eapp.emart.com)를 브라우저에서 직접 부른다.
 *   (비로그인·무토큰, access-control-allow-origin 이 요청 도메인을 그대로 돌려준다 —
 *    2026-11-22 moa-kr.github.io 에서 실측 확인)
 * · 상품명 검색은 앱 토큰(xlog_key)이 있어야 해서 막혀 있으므로, 상품은 SKU(상품 바코드)
 *   목록으로 고정한다. 아래 SKUS 는 전부 `GET /product/api/v1/info/1100/{SKU}` 가
 *   HTTP 200 + 실제 포켓몬카드 상품명으로 응답하는 것을 확인한 바코드만 넣었다.
 * · 요청량을 줄이려고 전 점포 재고(한 상품 71KB)를 받지 않고,
 *   점포 목록(1회) → 반경 안 점포만 → 점포×상품(각 0.6KB) 순서로 조회한다.
 *   점포 목록은 30분, 점포별 재고는 3분 동안 메모리에 캐시한다(이마트 앱도 약 10분 갱신).
 * · 상태 정규화(이마트 앱 표기와 같게):
 *     stockStatus=LOW_STOCK·stockQty>0        → 재고 있음 (N개)
 *     stockStatus=NO_STOCK 또는 stockQty<=0   → 품절 (0개)
 *     stockStatus=UNDISCLOSED                 → 수량 비공개 (매장 문의)
 *     jijumStatus=OFF(휴점일이 오늘)          → 오늘 휴무
 *     jijumStatus=CLOSED                      → 영업시간 외(영업 전·종료)
 *   자세한 근거는 work/emart/findings.md.
 * ========================================================================= */
window.PokeMoaEmart = (function () {
  "use strict";

  var BASE = "https://api-eapp.emart.com";
  var STORE_URL = BASE + "/search/api/v1/store/branch?storeType=E&page=1";
  var STOCK_URL = function (storeId, sku) {
    return BASE + "/search/api/v1/store/stock/branch/" + encodeURIComponent(storeId) +
      "?storeType=E&skuCode=" + encodeURIComponent(sku);
  };

  var TIMEOUT = 9000;              /* 요청 1건 상한 */
  var STORE_TTL = 30 * 60 * 1000;  /* 점포 목록 캐시 */
  var STOCK_TTL = 3 * 60 * 1000;   /* 점포별 재고 캐시 */
  var CONCURRENCY = 8;             /* 동시에 보내는 요청 수 */
  var MAX_STORES = 12;             /* 한 번에 조회할 반경 안 이마트 점포 상한(요청 폭주 방지) */

  /* 검증된 포켓몬 카드 SKU (상품 바코드 = 이마트 앱 skuCode)
     name·price 는 2026-11-22 `product/api/v1/info/1100/{SKU}` 응답값. */
  var SKUS = [
    { sku: "8800286279990", name: "포켓몬카드게임 30주년 기념팩", short: "30주년 기념팩", price: 69900, unit: "박스(20팩)" },
    { sku: "8800286279532", name: "포켓몬카드게임 어비스아이", short: "어비스아이", price: 44900, unit: "박스(30팩)" },
    { sku: "8800286278528", name: "포켓몬카드게임 인페르노X", short: "인페르노X", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286279365", name: "포켓몬카드게임 닌자스피너", short: "닌자스피너", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286279136", name: "포켓몬카드게임 니힐제로", short: "니힐제로", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286278108", name: "포켓몬카드게임 메가심포니아", short: "메가심포니아", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286278078", name: "포켓몬카드게임 메가브레이브", short: "메가브레이브", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286277736", name: "포켓몬카드게임 로켓단의영광", short: "로켓단의 영광", price: 29900, unit: "박스(30팩)" },
    { sku: "8800286277347", name: "포켓몬카드게임 열풍의아레나", short: "열풍의 아레나", price: 29900, unit: "박스(30팩)" }
  ];
  var SKU_BY_CODE = {};
  SKUS.forEach(function (p) { SKU_BY_CODE[p.sku] = p; });

  var storeCache = { at: 0, list: null, promise: null };
  var stockCache = {};   /* "storeId:sku" -> { at, val, promise } */

  function noop() {}

  /* --------------------------------------------------------------- 유틸 */
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

  function timeLabel(d) {
    var x = d || new Date();
    return String(x.getHours()).padStart(2, "0") + ":" + String(x.getMinutes()).padStart(2, "0");
  }

  /* 오늘 날짜를 이마트 표기(11/22)로 — 휴점일 목록과 맞춘다 */
  function todayLabel(d) {
    var x = d || new Date();
    return (x.getMonth() + 1) + "/" + x.getDate();
  }

  /* 휴점일 목록("11/22(일), 12/13(일)")에 오늘이 있는지 — '12/1' 이 '12/13' 에
     걸리지 않도록 날짜 뒤 '(' 까지 맞춰 비교한다. */
  function holidayHasToday(hol, d) {
    var t = todayLabel(d);
    return String(hol || "").split(",").some(function (part) {
      var x = part.trim();
      return x === t || x.indexOf(t + "(") === 0 || x.indexOf(t + " ") === 0;
    });
  }

  function getJson(url) {
    return new Promise(function (resolve, reject) {
      var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctl) { try { ctl.abort(); } catch (e) {} } }, TIMEOUT);
      var opt = { headers: { "Accept": "application/json" }, cache: "no-store", credentials: "omit" };
      if (ctl) opt.signal = ctl.signal;
      fetch(url, opt).then(function (res) {
        if (res.status === 204) return "";
        if (!res.ok) throw new Error("http-" + res.status);
        return res.text();
      }).then(function (text) {
        clearTimeout(timer);
        if (!text) { resolve({}); return; }
        try { resolve(JSON.parse(text)); }
        catch (e) { reject(new Error("bad-json")); }
      }).catch(function (err) {
        clearTimeout(timer);
        reject(err && err.name === "AbortError" ? new Error("timeout") : err);
      });
    });
  }

  /* 동시 실행 수를 제한한 작업 풀 */
  function pool(jobs, limit, worker) {
    var i = 0;
    function next() {
      if (i >= jobs.length) return Promise.resolve();
      var job = jobs[i++];
      return Promise.resolve(worker(job)).then(next, next);
    }
    var runners = [];
    var n = Math.min(limit, jobs.length);
    for (var k = 0; k < n; k++) runners.push(next());
    return Promise.all(runners);
  }

  /* ------------------------------------------------------- 점포 목록 */
  /* mapX = 위도(lat), mapY = 경도(lng) — 이마트 API 표기가 뒤집혀 있다(실측). */
  function loadStores() {
    var now = Date.now();
    if (storeCache.list && now - storeCache.at < STORE_TTL) return Promise.resolve(storeCache.list);
    if (storeCache.promise) return storeCache.promise;
    storeCache.promise = getJson(STORE_URL).then(function (d) {
      var rows = (d && d.data) || [];
      var list = [];
      rows.forEach(function (r) {
        var lat = Number(r.mapX);
        var lng = Number(r.mapY);
        if (!isFinite(lat) || !isFinite(lng)) return;
        list.push({
          id: String(r.storeId || ""),
          name: String(r.storeNm || "").trim(),
          lat: lat,
          lng: lng,
          address: String(r.address1 || ""),
          phone: String(r.jijumTel || ""),
          jijum: String(r.jijumStatus || "").toUpperCase(),
          hours: String(r.shoppingTime || ""),
          holiday: String(r.holidayList || "")
        });
      });
      storeCache.list = list;
      storeCache.at = Date.now();
      storeCache.promise = null;
      return list;
    }).catch(function (err) {
      storeCache.promise = null;
      throw err;
    });
    return storeCache.promise;
  }

  /* ------------------------------------------------------- 점포 재고 */
  function normalizeRow(r) {
    var status = String(r.stockStatus || "").toUpperCase();
    var qty = Number(r.stockQty);
    if (!isFinite(qty)) qty = 0;
    var state;
    if (status === "UNDISCLOSED") state = "undisclosed";
    else if (status === "NO_STOCK" || qty <= 0) state = "soldout";
    else state = "in";
    return {
      sku: String(r.skuCode || ""),
      state: state,
      qty: state === "in" ? qty : 0,
      stockStatus: status,
      jijum: String(r.jijumStatus || "").toUpperCase(),
      hours: String(r.shoppingTime || ""),
      holiday: String(r.holidayList || ""),
      phone: String(r.jijumTel || "")
    };
  }

  function loadStock(storeId, sku) {
    var key = storeId + ":" + sku;
    var now = Date.now();
    var c = stockCache[key];
    if (c && c.val !== undefined && now - c.at < STOCK_TTL) return Promise.resolve(c.val);
    if (c && c.promise) return c.promise;
    var promise = getJson(STOCK_URL(storeId, sku)).then(function (d) {
      var row = d && d.data;
      if (Array.isArray(row)) row = row[0];
      var val = row ? normalizeRow(row) : null;   /* null = 그 점포가 이 상품을 취급하지 않음 */
      stockCache[key] = { at: Date.now(), val: val };
      return val;
    }).catch(function (err) {
      delete stockCache[key];
      throw err;
    });
    stockCache[key] = { at: now, promise: promise, val: undefined };
    return promise;
  }

  /* ------------------------------------------------------------ 상태 */
  /* 이마트 정보 한 건을 사이트 공통 매장 상태로 정규화한다. */
  function buildStore(base, rows, at) {
    var products = [];
    var inQty = 0, inN = 0, unN = 0, soldN = 0, naN = 0;
    SKUS.forEach(function (p) {
      var row = rows[p.sku];
      var state = row ? row.state : "na";
      var qty = row && state === "in" ? row.qty : 0;
      if (state === "in") { inQty += qty; inN += 1; }
      else if (state === "undisclosed") unN += 1;
      else if (state === "soldout") soldN += 1;
      else naN += 1;
      products.push({
        id: p.sku,
        sku: p.sku,
        name: p.name,
        short: p.short,
        unit: "개",
        kind: p.unit,
        price: p.price,
        qty: qty,
        state: state,
        stateLabel: state === "in" ? qty + "개"
          : state === "undisclosed" ? "수량 비공개"
          : state === "soldout" ? "0개" : "취급 안 함"
      });
    });
    /* 이 점포가 우리 SKU 를 하나도 취급하지 않으면 지도에 올리지 않는다 */
    if (naN === SKUS.length) return null;

    /* 휴점일이 오늘이거나 jijumStatus=OFF → 오늘 휴무. CLOSED 는 영업시간 외. */
    var hol = String(base.holiday || "");
    var closedToday = base.jijum === "OFF" || holidayHasToday(hol, at);
    var outside = base.jijum === "CLOSED" && !closedToday;

    var state = inN > 0 ? "in" : (unN > 0 ? "undisclosed" : "soldout");
    var status = state === "in" ? "in" : state === "undisclosed" ? "check" : "none";
    var label = state === "in" ? "재고 있음 · " + inQty + "개"
      : state === "undisclosed" ? "수량 비공개" : "품절";
    var hour = timeLabel(at);
    var hoursBits = [];
    if (base.hours) hoursBits.push(base.hours);

    return {
      id: "emart:" + base.id,
      brand: "emart",
      brandLabel: "이마트",
      shop: "mart",
      name: base.name || "이마트",
      lat: base.lat,
      lng: base.lng,
      street: base.address || "",
      distance: base.distance || 0,
      status: status,
      observed: hour,
      unit: "개",
      note: "",
      products: products,
      phone: base.phone || "",
      placeUrl: "https://map.naver.com/p/search/" + encodeURIComponent(base.name || "이마트"),
      source: "emart",
      offline: false,
      emart: true,
      emartState: state,
      emartQty: inQty,
      emartInN: inN,
      emartUnN: unN,
      emartSoldN: soldN,
      emartLabel: label,
      emartClosed: closedToday,
      emartOutside: outside,
      emartHours: base.hours || "",
      emartHoliday: hol,
      jijum: base.jijum,
      emartAt: hour
    };
  }

  /* ------------------------------------------------------------- 조회 */
  /* query(center, radius, { progress }) → { ok, at, stores:[...], stat:{...} } */
  function query(center, radius, opts) {
    opts = opts || {};
    var progress = typeof opts.progress === "function" ? opts.progress : noop;
    var at = new Date();
    progress({ phase: "stores", done: 0, total: 1, ok: true });
    return loadStores().then(function (all) {
      var near = [];
      all.forEach(function (s) {
        var d = meters(center, s);
        if (d <= radius + 1) { s.distance = d; near.push(s); }
      });
      near.sort(function (a, b) { return a.distance - b.distance; });
      if (near.length > MAX_STORES) near = near.slice(0, MAX_STORES);
      progress({ phase: "stores", done: 1, total: 1, stores: near.length, ok: true });
      if (!near.length) {
        return { ok: true, at: at, stores: [], stat: { stores: 0, skus: 0, jobs: 0, failed: 0 } };
      }
      var jobs = [];
      near.forEach(function (s) {
        SKUS.forEach(function (p) { jobs.push({ store: s, sku: p.sku }); });
      });
      var done = 0, failed = 0;
      var results = {};
      return pool(jobs, CONCURRENCY, function (job) {
        return loadStock(job.store.id, job.sku).then(function (val) {
          (results[job.store.id] || (results[job.store.id] = {}))[job.sku] = val;
        }).catch(function () {
          failed += 1;
        }).then(function () {
          done += 1;
          progress({ phase: "stock", done: done, total: jobs.length, stores: near.length, ok: true });
        });
      }).then(function () {
        var stores = [];
        near.forEach(function (s) {
          var row = buildStore(s, results[s.id] || {}, at);
          if (row) stores.push(row);
        });
        return {
          ok: true,
          at: at,
          stores: stores,
          stat: { stores: near.length, skus: SKUS.length, jobs: jobs.length, failed: failed }
        };
      });
    });
  }

  /* ------------------------------------------------------- 표기 도우미 */
  function statusText(s) {
    if (!s) return "";
    if (s.emartClosed) return "오늘 휴무";
    return s.emartState === "in" ? "재고 있음"
      : s.emartState === "undisclosed" ? "수량 비공개" : "품절";
  }

  function stockText(s) {
    if (!s) return "";
    return s.emartState === "in" ? "실시간 " + s.emartQty + "개"
      : s.emartState === "undisclosed" ? "수량 비공개 · 매장 문의" : "품절";
  }

  function summaryText(list) {
    var n = list.length, inN = 0, closedN = 0, unN = 0;
    list.forEach(function (s) {
      if (s.emartState === "in") inN += 1;
      else if (s.emartState === "undisclosed") unN += 1;
      if (s.emartClosed) closedN += 1;
    });
    if (!n) return "이마트 점포 없음";
    var bits = ["이마트 " + n + "곳"];
    if (inN) bits.push("재고 " + inN);
    if (unN) bits.push("비공개 " + unN);
    if (closedN) bits.push("휴무 " + closedN);
    return bits.join(" · ");
  }

  return {
    SKUS: SKUS,
    query: query,
    loadStores: loadStores,
    clearCache: function () {
      storeCache = { at: 0, list: null, promise: null };
      stockCache = {};
    },
    statusText: statusText,
    stockText: stockText,
    summaryText: summaryText,
    todayLabel: todayLabel
  };
})();
