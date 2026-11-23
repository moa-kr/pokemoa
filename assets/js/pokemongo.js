/* =========================================================================
 * 포켓몬카드모아 — 포켓몬 GO 일정·소식 칸
 * 데이터: assets/data/pokemongo.json  (이 파일만 고치면 화면이 갱신됩니다)
 *   - 새 일정은 items 배열에 한 건 추가하면 됩니다.
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

  var DATA_URL = "assets/data/pokemongo.json";

  var STATUS_LABEL = { ongoing: "진행 중", upcoming: "예정", ended: "종료" };
  var STATUS_ORDER = { ongoing: 0, upcoming: 1, ended: 2 };

  var state = { status: "all", type: "all", data: null };

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayKey() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
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
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function daysBetween(fromKey, toKey) {
    var a = new Date(fromKey + "T00:00:00");
    var b = new Date(toKey + "T00:00:00");
    return Math.round((b - a) / 86400000);
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
      tail = '<span class="pgo-dday">' + escapeHtml(end.slice(5).replace("-", "/")) + " 종료</span>";
    }
    return '<span class="' + cls + '">' + escapeHtml(label) + tail + "</span>";
  }

  /* ---------------------------------------------------------- 필터 칩 */
  function chipRow(rowEl, items, key, current, onPick) {
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

  /* ------------------------------------------------------------ 카드 */
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
      (item.summary ? '<p class="pgo-summary">' + escapeHtml(item.summary) + "</p>" : "") +
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

  function render() {
    var data = state.data;
    if (!data) return;
    var today = todayKey();
    var nowMin = nowMinutes();
    var all = data.items || [];
    var counts = { ongoing: 0, upcoming: 0, ended: 0 };
    all.forEach(function (it) {
      var s = statusOf(it, today, nowMin);
      counts[s] = (counts[s] || 0) + 1;
    });

    if (summaryEl) {
      var weekEnd = addDays(today, 7);
      var thisWeek = 0;
      all.forEach(function (it) {
        if (statusOf(it, today, nowMin) !== "upcoming") return;
        var s = dateOnly(it.startDate);
        if (s >= today && s <= weekEnd) thisWeek++;
      });
      summaryEl.innerHTML = "진행 중 <b>" + counts.ongoing + "</b>건 · 예정 <b>" + counts.upcoming +
        "</b>건 (이번 주 시작 <b>" + thisWeek + "</b>건) · 종료 <b>" + counts.ended + "</b>건 <span>기준 " +
        escapeHtml((data.basisDate || today).slice(5).replace("-", "/")) + " · 한국시간</span>";
    }

    var list = all.filter(function (it) {
      var s = statusOf(it, today, nowMin);
      if (state.status !== "all" && s !== state.status) return false;
      if (state.type !== "all" && it.type !== state.type) return false;
      return true;
    });

    list.sort(function (a, b) {
      var ka = sortKey(a, today, nowMin);
      var kb = sortKey(b, today, nowMin);
      var r = (STATUS_ORDER[ka.status] || 0) - (STATUS_ORDER[kb.status] || 0);
      if (r) return r;
      if (ka.status === "ongoing") return ka.end < kb.end ? -1 : ka.end > kb.end ? 1 : 0;
      if (ka.status === "upcoming") return ka.start < kb.start ? -1 : ka.start > kb.start ? 1 : 0;
      return ka.end > kb.end ? -1 : ka.end < kb.end ? 1 : 0;
    });

    if (!list.length) {
      listEl.innerHTML = '<li class="pgo-empty">조건에 맞는 일정이 없습니다. 다른 필터를 눌러 보세요.</li>';
    } else {
      listEl.innerHTML = list.map(function (it) { return cardHtml(it, today, nowMin); }).join("");
    }

    if (srcEl) {
      srcEl.innerHTML = "출처: Pokémon GO 공식 알림(pokemongo.com/ko)과 게임 내 공지. 시각은 한국시간 기준이며 " +
        "이벤트는 사정에 따라 변경·중단될 수 있습니다. " +
        (data.updatedAt ? "데이터 갱신 " + escapeHtml(String(data.updatedAt).slice(0, 10)) + "." : "");
    }

    listEl.querySelectorAll(".pgo-links a").forEach(function (a) {
      a.addEventListener("click", function () {
        track("pgo_outbound", { link: a.getAttribute("href") });
      });
    });
  }

  function track(name, params) {
    if (window.gtag) window.gtag("event", name, params);
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
        render();
      })
      .catch(function () {
        sectionEl.setAttribute("data-pgo-error", "1");
        listEl.innerHTML = '<li class="pgo-empty">포켓몬 GO 일정을 불러오지 못했습니다. 잠시 뒤 새로고침해 주세요.</li>';
      });
  }

  load();
})();
