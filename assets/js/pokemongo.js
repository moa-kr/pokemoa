/* =========================================================================
 * 포켓몬카드모아 — 포켓몬 GO 일정·소식 칸 (달력 + 목록)
 * 데이터: assets/data/pokemongo.json  (이 파일만 고치면 화면이 갱신됩니다)
 *   - 새 일정은 items 배열에 한 건 추가하면 달력·목록에 함께 반영됩니다.
 *   - 달력은 startDate / endDate 만 보고 그립니다(시각은 startTime·endTime).
 *     · 두 날짜가 같으면 하루 일정(칩), 8일 이상 이어지면 기간 일정(막대)입니다.
 *     · startDate 가 비어 있으면 endDate 하루에 "~종료"로 표시합니다.
 *     · 둘 다 비어 있는 안내성 항목(매주 루틴 등)은 달력에 넣지 않고 목록에만 둡니다.
 *   - 기간이 지나면 날짜로 상태가 자동으로 바뀝니다(진행 중 / 예정 / 종료).
 *   - 시각은 모두 한국시간(KST)이고, startTime·endTime 이 비어 있으면 날짜만 비교합니다.
 *   - sourceLabel: "공식" = pokemongo.com/ko 공지, "게임 내 공지" = 게임 안에서 안내되는 일정.
 * ========================================================================= */
(function () {
  "use strict";

  var sectionEl = document.getElementById("pgoSection");
  var listEl = document.getElementById("pgoList");
  if (!sectionEl || !listEl) return;

  var summaryEl = document.getElementById("pgoSummary");
  var statusRow = document.getElementById("pgoStatusRow");
  var typeRow = document.getElementById("pgoTypeRow");
  var srcEl = document.getElementById("pgoSrc");
  var calGrid = document.getElementById("pgoCalGrid");
  var calWrap = document.getElementById("pgoCalWrap");
  var dayPanel = document.getElementById("pgoDayPanel");
  var monthLabel = document.getElementById("pgoMonthLabel");
  var monthNav = document.getElementById("pgoMonthNav");
  var listView = document.getElementById("pgoListView");
  var viewBtns = sectionEl.querySelectorAll("[data-pgo-view]");
  var navBtns = sectionEl.querySelectorAll("[data-pgo-nav]");

  var DATA_URL = "assets/data/pokemongo.json";
  var DOW = ["일", "월", "화", "수", "목", "금", "토"];
  var TYPE_KEYS = { season: 1, event: 1, weekly: 1, raid: 1, max: 1, pass: 1, news: 1 };
  var LONG_SPAN_DAYS = 7; /* 8일 이상 이어지면 기간(막대) 일정 */
  var MAX_CHIPS = 3; /* 날짜 칸에 넣는 짧은 일정 칩 수 */

  var STATUS_LABEL = { ongoing: "진행 중", upcoming: "예정", ended: "종료" };
  var STATUS_ORDER = { ongoing: 0, upcoming: 1, ended: 2 };

  var state = {
    status: "all",
    type: "all",
    data: null,
    view: "calendar",
    month: "", /* YYYY-MM */
    day: "" /* YYYY-MM-DD */
  };

  /* ------------------------------------------------------------ 날짜 도구 */
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayKey() { return ymd(new Date()); }
  function nowMinutes() {
    var d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  }
  function timeToMinutes(v) {
    if (typeof v !== "string" || v.indexOf(":") < 0) return null;
    var p = v.split(":");
    var h = Number(p[0]);
    var m = Number(p[1]);
    if (!isFinite(h) || !isFinite(m)) return null;
    return h * 60 + m;
  }
  function dateOnly(v) {
    return typeof v === "string" && v.length >= 10 ? v.slice(0, 10) : "";
  }
  function stamp(date, time) {
    var d = dateOnly(date);
    if (!d) return "";
    return d + "T" + (time || "00:00");
  }
  function addDays(key, n) {
    var d = new Date(key + "T00:00:00");
    d.setDate(d.getDate() + n);
    return ymd(d);
  }
  function daysBetween(fromKey, toKey) {
    var a = new Date(fromKey + "T00:00:00");
    var b = new Date(toKey + "T00:00:00");
    return Math.round((b - a) / 86400000);
  }
  function mmdd(key) {
    return key ? key.slice(5, 7) + "/" + key.slice(8, 10) : "";
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------------------------------------------- 상태 */
  function statusOf(item, today, nowMin) {
    if (item.statusOverride) return item.statusOverride;
    var start = dateOnly(item.startDate);
    var end = dateOnly(item.endDate);
    if (end && end < today) return "ended";
    if (end && end === today) {
      var endMin = timeToMinutes(item.endTime);
      if (endMin != null && nowMin > endMin) return "ended";
    }
    if (start && start > today) return "upcoming";
    if (start && start === today) {
      var startMin = timeToMinutes(item.startTime);
      if (startMin != null && nowMin < startMin) return "upcoming";
    }
    return "ongoing";
  }

  function isToday(item, today) {
    var start = dateOnly(item.startDate);
    var end = dateOnly(item.endDate) || start;
    return start && start <= today && today <= end;
  }

  function statusChip(item, status, today) {
    var cls = "pgo-badge is-" + status;
    var label = STATUS_LABEL[status] || "진행 중";
    var tail = "";
    var start = dateOnly(item.startDate);
    var end = dateOnly(item.endDate);
    if (status === "ongoing" && end) {
      var left = daysBetween(today, end);
      tail = left > 0 ? '<span class="pgo-dday">D-' + left + "</span>" : '<span class="pgo-dday">오늘 종료</span>';
    } else if (status === "upcoming" && start) {
      var soon = daysBetween(today, start);
      if (soon > 0) tail = '<span class="pgo-dday">D-' + soon + "</span>";
    } else if (status === "ended" && end) {
      tail = '<span class="pgo-dday">' + escapeHtml(mmdd(end)) + " 종료</span>";
    }
    return '<span class="' + cls + '">' + escapeHtml(label) + tail + "</span>";
  }

  /* ------------------------------------------------------- 달력 범위 계산 */
  /* 달력에 그릴 기간(시작·끝). 날짜가 하나도 없으면 null(달력 제외). */
  function rangeOf(item) {
    var s = dateOnly(item.startDate);
    var e = dateOnly(item.endDate);
    if (!s && !e) return null;
    if (!s) s = e;
    if (!e) e = s;
    if (e < s) { var t = s; s = e; e = t; }
    return { start: s, end: e };
  }
  function spanDays(item) {
    var r = rangeOf(item);
    return r ? daysBetween(r.start, r.end) : 0;
  }
  function inRange(item, key) {
    var r = rangeOf(item);
    return !!r && r.start <= key && key <= r.end;
  }
  function typeClass(item) {
    var t = String(item.type || "");
    return TYPE_KEYS[t] ? "pgc-" + t : "pgc-news";
  }

  /* 날짜 칸에 넣을 짧은 이름 — 제목에서 꼬리 설명을 덜어냅니다.
     (데이터에 short 필드가 있으면 그것을 먼저 씁니다) */
  function shortLabel(item) {
    if (item.short) return String(item.short);
    var s = String(item.title || "");
    s = s.replace(/\s*\([^()]*\)\s*$/, "");
    s = s.replace(/\s*\([^()]*\)\s*$/, "");
    var dash = s.split(/\s+—\s+/);
    if (dash.length > 1) s = dash[dash.length - 1];
    var seg = s.split(/\s+·\s+/)[0];
    if (seg) s = seg;
    return s.trim();
  }

  /* ---------------------------------------------------------- 필터 칩 */
  function chipRow(rowEl, items, current, onPick) {
    if (!rowEl) return;
    var label = rowEl.getAttribute("data-label") || "";
    rowEl.innerHTML = (label ? '<span class="pgo-filter-label">' + escapeHtml(label) + "</span>" : "") +
      items.map(function (it) {
        var on = it.key === current;
        return '<button type="button" class="pgo-chip' + (it.soft ? " is-soft" : "") + (on ? " is-on" : "") +
          '" data-pick="' + escapeHtml(it.key) + '" aria-pressed="' + on + '">' + escapeHtml(it.label) + "</button>";
      }).join("");
    rowEl.querySelectorAll("[data-pick]").forEach(function (b) {
      b.addEventListener("click", function () {
        onPick(b.getAttribute("data-pick"));
      });
    });
  }

  function buildFilters() {
    chipRow(statusRow, [
      { key: "all", label: "전체" },
      { key: "ongoing", label: "진행 중" },
      { key: "upcoming", label: "예정" },
      { key: "ended", label: "종료" }
    ], state.status, function (key) {
      state.status = key;
      buildFilters();
      render();
      track("pgo_status", { status: key });
    });

    var types = [{ key: "all", label: "전체", soft: true }].concat((state.data.categories || []).map(function (c) {
      return { key: c.key, label: c.label, soft: true };
    }));
    chipRow(typeRow, types, state.type, function (key) {
      state.type = key;
      buildFilters();
      render();
      track("pgo_type", { type: key });
    });
  }

  /* ------------------------------------------------------------ 필터 적용 */
  function filteredItems(today, nowMin) {
    return (state.data.items || []).filter(function (it) {
      var s = statusOf(it, today, nowMin);
      if (state.status !== "all" && s !== state.status) return false;
      if (state.type !== "all" && it.type !== state.type) return false;
      return true;
    });
  }
  function itemsOnDay(items, key) {
    return items.filter(function (it) { return inRange(it, key); });
  }

  /* ------------------------------------------------------------ 카드(목록) */
  function cardHtml(item, today, nowMin) {
    var status = statusOf(item, today, nowMin);
    var highlights = (item.highlights || []).map(function (h) {
      return "<li>" + escapeHtml(h) + "</li>";
    }).join("");
    var links = (item.links || []).map(function (l) {
      return '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + " ↗</a>";
    }).join("");
    var todayTag = isToday(item, today) && status !== "ended" ? '<span class="pgo-today">오늘</span>' : "";
    return '<li class="pgo-card is-' + status + '" data-status="' + status + '" data-type="' + escapeHtml(item.type || "") + '">' +
      '<div class="pgo-top">' +
        '<span class="pgo-type">' + escapeHtml(item.typeLabel || "") + "</span>" +
        todayTag +
        '<span class="pgo-src is-' + (item.sourceLabel === "공식" ? "official" : "notice") + '">' +
          escapeHtml(item.sourceLabel || "공식") + "</span>" +
        statusChip(item, status, today) +
      "</div>" +
      '<h3 class="pgo-title">' + escapeHtml(item.title) + "</h3>" +
      '<p class="pgo-period">' + escapeHtml(item.periodLabel || "") + "</p>" +
      (item.summary ? '<p class="pgo-summary-text">' + escapeHtml(item.summary) + "</p>" : "") +
      (highlights ? '<ul class="pgo-points">' + highlights + "</ul>" : "") +
      (links ? '<div class="pgo-links">' + links + "</div>" : "") +
      "</li>";
  }

  function sortKey(item, today, nowMin) {
    var status = statusOf(item, today, nowMin);
    var start = stamp(item.startDate, item.startTime) || "9999-99-99T99:99";
    var end = stamp(item.endDate, item.endTime) || "9999-99-99T99:99";
    return { status: status, start: start, end: end };
  }

  function renderList(list, today, nowMin) {
    if (!list.length) {
      listEl.innerHTML = '<li class="pgo-empty">조건에 맞는 일정이 없습니다. 다른 필터를 눌러 보세요.</li>';
    } else {
      listEl.innerHTML = list.map(function (it) { return cardHtml(it, today, nowMin); }).join("");
    }
    listEl.querySelectorAll(".pgo-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        track("pgo_outbound", { link: a.getAttribute("href") });
      });
    });
  }

  function renderSummary(all, today, nowMin) {
    if (!summaryEl || !state.data) return;
    var counts = { ongoing: 0, upcoming: 0, ended: 0 };
    all.forEach(function (it) {
      var s = statusOf(it, today, nowMin);
      counts[s] = (counts[s] || 0) + 1;
    });
    var weekEnd = addDays(today, 7);
    var thisWeek = 0;
    all.forEach(function (it) {
      if (statusOf(it, today, nowMin) !== "upcoming") return;
      var s = dateOnly(it.startDate);
      if (s >= today && s <= weekEnd) thisWeek++;
    });
    summaryEl.innerHTML = "진행 중 <b>" + counts.ongoing + "</b>건 · 예정 <b>" + counts.upcoming +
      "</b>건 (이번 주 시작 <b>" + thisWeek + "</b>건) · 종료 <b>" + counts.ended + "</b>건 <span>기준 " +
      escapeHtml(mmdd(state.data.basisDate || today)) + " · 한국시간</span>";
  }

  /* -------------------------------------------------------------- 달력 */
  function monthKeyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function shiftMonth(key, delta) {
    var y = Number(key.slice(0, 4));
    var m = Number(key.slice(5, 7)) - 1 + delta;
    return monthKeyOf(new Date(y, m, 1));
  }
  function monthDays(key) {
    var y = Number(key.slice(0, 4));
    var m = Number(key.slice(5, 7)) - 1;
    var first = new Date(y, m, 1);
    var startDow = first.getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var total = Math.ceil((startDow + daysInMonth) / 7) * 7;
    var out = [];
    for (var i = 0; i < total; i++) {
      var d = new Date(y, m, 1 - startDow + i);
      out.push({ key: ymd(d), day: d.getDate(), dow: d.getDay(), inMonth: d.getMonth() === m });
    }
    return out;
  }
  function monthTitle(key) {
    return Number(key.slice(0, 4)) + "년 " + Number(key.slice(5, 7)) + "월";
  }

  function firstDayWithEvents(key, items) {
    var days = monthDays(key);
    for (var i = 0; i < days.length; i++) {
      if (days[i].inMonth && itemsOnDay(items, days[i].key).length) return days[i].key;
    }
    return "";
  }
  function pickDay(key, items, today) {
    if (key === today.slice(0, 7)) return today;
    return firstDayWithEvents(key, items) || key + "-01";
  }

  /* 그날 "경계"인지 — 하루 일정 0, 시작 1, 마지막 날 2, 종료만 있는 항목 3, 기간 중 4. */
  function dayRank(item, key) {
    var r = rangeOf(item);
    if (!r) return 4;
    var hasStart = !!dateOnly(item.startDate);
    if (!hasStart) return 3;
    if (r.start === r.end) return 0;
    if (r.start === key) return 1;
    if (r.end === key) return 2;
    return 4;
  }
  function isBoundary(item, key) {
    return dayRank(item, key) < 4;
  }
  function dayItemsSorted(items, key) {
    var list = itemsOnDay(items, key);
    list.sort(function (a, b) {
      var ra = dayRank(a, key), rb = dayRank(b, key);
      if (ra !== rb) return ra - rb;
      var ta = timeToMinutes(a.startTime);
      var tb = timeToMinutes(b.startTime);
      if (ta != null && tb != null && ta !== tb) return ta - tb;
      if (ta == null && tb != null) return -1;
      if (ta != null && tb == null) return 1;
      var ga = rangeOf(a), gb = rangeOf(b);
      if (ga.start !== gb.start) return ga.start < gb.start ? -1 : 1;
      return 0;
    });
    return list;
  }

  function cellHtml(cell, items, today) {
    var active = dayItemsSorted(items, cell.key);
    /* 그날 시작·종료·하루짜리 일정은 글자 칩으로, 계속 이어지는 일정은 칸 아래 막대로. */
    var chipsSrc = active.filter(function (it) { return isBoundary(it, cell.key); });
    var barsSrc = active.filter(function (it) { return !isBoundary(it, cell.key); });
    barsSrc.sort(function (a, b) {
      var ea = rangeOf(a).end, eb = rangeOf(b).end;
      return ea < eb ? -1 : ea > eb ? 1 : 0;
    });
    var shown = chipsSrc.slice(0, MAX_CHIPS);
    var rest = chipsSrc.length - shown.length;
    var isTodayCell = cell.key === today;
    var isSel = cell.key === state.day;

    var chips = shown.map(function (it) {
      var lab = shortLabel(it);
      return '<span class="pgcal-chip ' + typeClass(it) + '" title="' + escapeHtml(it.title) + '">' +
        '<i class="pgcal-dot"></i><span class="pgcal-chip-t">' + escapeHtml(lab) + "</span></span>";
    }).join("");

    var bars = barsSrc.slice(0, 4).map(function (it) {
      return '<i class="' + typeClass(it) + '" title="' + escapeHtml(it.title) + '"></i>';
    }).join("");

    var label = Number(cell.key.slice(5, 7)) + "월 " + Number(cell.key.slice(8, 10)) + "일 " +
      DOW[cell.dow] + "요일" + (isTodayCell ? ", 오늘" : "") +
      (active.length ? ", 일정 " + active.length + "건" : ", 일정 없음");

    return '<button type="button" class="pgcal-cell' +
      (cell.inMonth ? "" : " is-out") +
      (cell.dow === 0 ? " is-sun" : cell.dow === 6 ? " is-sat" : "") +
      (isTodayCell ? " is-today" : "") +
      (isSel ? " is-sel" : "") +
      (active.length ? " has-ev" : "") +
      '" data-day="' + cell.key + '" aria-pressed="' + (isSel ? "true" : "false") + '" aria-label="' +
      escapeHtml(label) + '">' +
      '<span class="pgcal-daynum">' + cell.day + "</span>" +
      (chips ? '<span class="pgcal-chips">' + chips + (rest > 0 ? '<span class="pgcal-more">+' + rest + "</span>" : "") + "</span>" : "") +
      (bars ? '<span class="pgcal-bars">' + bars + "</span>" : "") +
      "</button>";
  }

  function renderCalendar(items, today) {
    if (!calGrid) return;
    if (monthLabel) monthLabel.textContent = monthTitle(state.month);
    calGrid.innerHTML = monthDays(state.month).map(function (cell) {
      return cellHtml(cell, items, today);
    }).join("");
  }

  /* ---------------------------------------------------- 선택한 날짜 상세 */
  function whenLabel(item, key) {
    var r = rangeOf(item);
    if (!r) return escapeHtml(item.periodLabel || "");
    var st = item.startTime || "";
    var et = item.endTime || "";
    if (r.start === r.end) {
      if (st && et) return st + " ~ " + et;
      if (st) return st + " 시작";
      if (et) return et + " 종료";
      return "시간 미정";
    }
    if (key === r.start) return mmdd(r.start) + " " + (st || "") + " 시작";
    if (key === r.end) return mmdd(r.end) + " " + (et || "") + " 종료";
    return mmdd(r.start) + " ~ " + mmdd(r.end) + " 진행 중";
  }

  function eventHtml(item, key, today, nowMin, compact) {
    var status = statusOf(item, today, nowMin);
    var r = rangeOf(item);
    var points = (item.highlights || []).map(function (h) {
      return "<li>" + escapeHtml(h) + "</li>";
    }).join("");
    var links = (item.links || []).map(function (l) {
      return '<a href="' + escapeHtml(l.url) + '" target="_blank" rel="noopener">' + escapeHtml(l.label) + " ↗</a>";
    }).join("");
    var dayTag = "";
    if (r && r.start === r.end) dayTag = "하루";
    else if (r && key === r.start) dayTag = "시작일";
    else if (r && key === r.end) dayTag = "마지막 날";
    else dayTag = "기간 중";

    return '<article class="pgcal-ev ' + typeClass(item) + (compact ? " is-compact" : "") + '">' +
      '<div class="pgcal-ev-top">' +
        '<span class="pgcal-ev-type">' + escapeHtml(item.typeLabel || "") + "</span>" +
        '<span class="pgcal-ev-state is-' + status + '">' + escapeHtml(STATUS_LABEL[status] || "") + "</span>" +
        '<span class="pgcal-ev-when">' + whenLabel(item, key) + "</span>" +
      "</div>" +
      '<h4 class="pgcal-ev-title">' + escapeHtml(item.title) + "</h4>" +
      '<p class="pgcal-ev-meta">' + escapeHtml(item.periodLabel || "") + " · " + escapeHtml(dayTag) +
        " · " + escapeHtml(item.sourceLabel || "공식") + "</p>" +
      (item.summary ? '<p class="pgcal-ev-sum">' + escapeHtml(item.summary) + "</p>" : "") +
      (!compact && points ? '<ul class="pgcal-ev-points">' + points + "</ul>" : "") +
      (links ? '<div class="pgcal-ev-links">' + links + "</div>" : "") +
      "</article>";
  }

  function nextEventFor(items, key) {
    var best = null;
    items.forEach(function (it) {
      var r = rangeOf(it);
      if (!r || r.start <= key) return;
      if (!best || r.start < best.start) best = { start: r.start, item: it };
    });
    return best;
  }

  function renderDayPanel(items, today, nowMin) {
    if (!dayPanel) return;
    var key = state.day;
    if (!key) {
      dayPanel.innerHTML = "";
      return;
    }
    var list = dayItemsSorted(items, key);
    var d = new Date(key + "T00:00:00");
    var head = Number(key.slice(5, 7)) + "월 " + Number(key.slice(8, 10)) + "일 (" + DOW[d.getDay()] + ")";
    if (d.getFullYear() !== new Date().getFullYear()) head = d.getFullYear() + "년 " + head;

    var html = '<div class="pgcal-day-head">' +
      '<strong>' + escapeHtml(head) + "</strong>" +
      (key === today ? '<span class="pgcal-day-today">오늘</span>' : "") +
      '<span class="pgcal-day-count">' + (list.length ? "일정 " + list.length + "건" : "일정 없음") + "</span>" +
      "</div>";

    if (!list.length) {
      html += '<p class="pgcal-empty">이 날짜에 등록된 일정이 없습니다.</p>';
      var next = nextEventFor(items, key);
      if (next) {
        html += '<div class="pgcal-next"><span>다음 일정</span> ' + escapeHtml(mmdd(next.start)) +
          "(" + DOW[new Date(next.start + "T00:00:00").getDay()] + ") " +
          escapeHtml(shortLabel(next.item)) +
          ' <button type="button" class="pgcal-goto" data-goto="' + next.start + '">그날 보기</button></div>';
      }
    } else {
      var boundary = list.filter(function (it) { return isBoundary(it, key); });
      var ongoing = list.filter(function (it) { return !isBoundary(it, key); });
      html += boundary.map(function (it) { return eventHtml(it, key, today, nowMin, false); }).join("");
      if (ongoing.length) {
        html += '<div class="pgcal-sub">이 날 이어서 진행 중 · ' + ongoing.length + "건</div>";
        html += ongoing.map(function (it) { return eventHtml(it, key, today, nowMin, true); }).join("");
      }
    }
    dayPanel.innerHTML = html;
  }

  /* --------------------------------------------------------------- 보기 전환 */
  function applyView() {
    var isCal = state.view !== "list";
    viewBtns.forEach(function (b) {
      var on = b.getAttribute("data-pgo-view") === (isCal ? "calendar" : "list");
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    if (calWrap) calWrap.hidden = !isCal;
    if (monthNav) monthNav.hidden = !isCal;
    if (listView) listView.hidden = isCal;
  }

  /* ---------------------------------------------------------------- 전체 렌더 */
  function render() {
    var data = state.data;
    if (!data) return;
    var today = todayKey();
    var nowMin = nowMinutes();
    var all = data.items || [];
    var items = filteredItems(today, nowMin);

    if (!state.month) state.month = today.slice(0, 7);
    if (!state.day) state.day = pickDay(state.month, items, today);
    if (state.day.slice(0, 7) !== state.month) state.day = pickDay(state.month, items, today);

    renderSummary(all, today, nowMin);

    renderCalendar(items, today);
    renderDayPanel(items, today, nowMin);

    var list = items.slice();
    list.sort(function (a, b) {
      var ka = sortKey(a, today, nowMin);
      var kb = sortKey(b, today, nowMin);
      var r = (STATUS_ORDER[ka.status] || 0) - (STATUS_ORDER[kb.status] || 0);
      if (r) return r;
      if (ka.status === "ongoing") return ka.end < kb.end ? -1 : ka.end > kb.end ? 1 : 0;
      if (ka.status === "upcoming") return ka.start < kb.start ? -1 : ka.start > kb.start ? 1 : 0;
      return ka.end > kb.end ? -1 : ka.end < kb.end ? 1 : 0;
    });
    renderList(list, today, nowMin);

    if (srcEl) {
      srcEl.innerHTML = "출처: Pokémon GO 공식 알림(pokemongo.com/ko)과 게임 내 공지. 시각은 한국시간 기준이며 " +
        "이벤트는 사정에 따라 변경·중단될 수 있습니다. 달력은 데이터의 시작·종료 날짜만 보고 그리며, " +
        "날짜가 없는 안내성 항목은 목록 보기에서 확인할 수 있습니다. " +
        (data.updatedAt ? "데이터 갱신 " + escapeHtml(String(data.updatedAt).slice(0, 10)) + "." : "");
    }
  }

  function track(name, params) {
    if (window.gtag) window.gtag("event", name, params);
  }

  /* ------------------------------------------------------------ 이벤트 연결 */
  viewBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      state.view = b.getAttribute("data-pgo-view") || "calendar";
      applyView();
      track("pgo_view", { view: state.view });
    });
  });

  navBtns.forEach(function (b) {
    b.addEventListener("click", function () {
      if (!state.data) return;
      var act = b.getAttribute("data-pgo-nav");
      var today = todayKey();
      var items = filteredItems(today, nowMinutes());
      if (act === "today") {
        state.month = today.slice(0, 7);
        state.day = today;
      } else {
        state.month = shiftMonth(state.month || today.slice(0, 7), act === "prev" ? -1 : 1);
        state.day = pickDay(state.month, items, today);
      }
      renderCalendar(items, today);
      renderDayPanel(items, today, nowMinutes());
      track("pgo_month", { month: state.month });
    });
  });

  if (calGrid) {
    calGrid.addEventListener("click", function (e) {
      var cell = e.target.closest ? e.target.closest("[data-day]") : null;
      if (!cell || !state.data) return;
      var key = cell.getAttribute("data-day");
      if (!key) return;
      state.day = key;
      if (key.slice(0, 7) !== state.month) state.month = key.slice(0, 7);
      var today = todayKey();
      var items = filteredItems(today, nowMinutes());
      renderCalendar(items, today);
      renderDayPanel(items, today, nowMinutes());
      track("pgo_day", { day: key });
    });
  }

  if (dayPanel) {
    dayPanel.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-goto]") : null;
      if (t && state.data) {
        var key = t.getAttribute("data-goto");
        state.month = key.slice(0, 7);
        state.day = key;
        var today = todayKey();
        var items = filteredItems(today, nowMinutes());
        renderCalendar(items, today);
        renderDayPanel(items, today, nowMinutes());
        return;
      }
      var a = e.target.closest ? e.target.closest("a[href]") : null;
      if (a) track("pgo_outbound", { link: a.getAttribute("href") });
    });
  }

  /* ------------------------------------------------------------ 로드 */
  function load() {
    // 하루 단위 캐시 무효화 — 데이터만 바꿔도 다음 날 새로 받습니다.
    var d = new Date();
    var bust = "" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
    fetch(DATA_URL + "?d=" + bust, { cache: "no-cache" })
      .then(function (res) { if (!res.ok) throw new Error("HTTP " + res.status); return res.json(); })
      .then(function (data) {
        state.data = data;
        buildFilters();
        applyView();
        render();
      })
      .catch(function () {
        sectionEl.setAttribute("data-pgo-error", "1");
        listEl.innerHTML = '<li class="pgo-empty">포켓몬 GO 일정을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</li>';
        if (calGrid) calGrid.innerHTML = '<p class="pgcal-empty">달력을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</p>';
        if (dayPanel) dayPanel.innerHTML = "";
      });
  }

  load();
})();
