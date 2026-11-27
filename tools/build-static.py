#!/usr/bin/env python3
"""포켓몬카드모아 — 정적 상세 페이지(확장팩 도감·가이드)와 sitemap.xml 생성기.

단일 페이지 앱(assets/js/data.js)의 실제 데이터만 읽어 HTML을 만듭니다.
새 값(시세·카드·정가)을 data.js에서 고친 뒤 이 스크립트를 다시 돌리면
도감 페이지와 sitemap.xml이 같은 값으로 갱신됩니다.

    python3 tools/build-static.py          # 생성 + sitemap 갱신
    python3 tools/build-static.py --check  # 생성 결과를 쓰지 않고 검사만

출력 경로
    sets/index.html, sets/{set_id}.html
    guides/index.html, guides/{guide}.html
    sitemap.xml
"""
import argparse
import html
import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from jsparse import extract  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = "https://moa-kr.github.io/pokemoa"
SITE_NAME = "포켓몬카드모아"
KREAM_CHECKED = "2026-11-17"      # KREAM 리셀 시세 확인일 — data.js SITE.kreamCheckedAt 과 같아야 한다
KREAM_CHECKED_KO = "11월 17일"     # 위 날짜의 화면 표기
LAST_MOD = "2026-11-27"           # 이번에 생성한 정적 페이지의 lastmod
GA_ID = "G-LWRMBRD0X9"
CSS_V = "2"

# 구조화 데이터에 쓰는 실제 자산 URL(라이브에서 200으로 열리는 파일만)
SITE_HOME = BASE + "/"
OG_IMAGE = BASE + "/assets/img/og-image.png"       # 1200x630 대표 이미지
SITE_LOGO = BASE + "/assets/img/icons/icon-512.png"  # 512x512 로고
PUBLISHED_AT = "2026-11-26T10:16:00+09:00"   # 최초 생성 시각(KST, 파일 타임스탬프)
MODIFIED_AT = "2026-11-27T14:35:00+09:00"    # 이번 생성 시각(KST)

FAVICON = (
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='9' fill='%23101f3c'/%3E"
    "%3Crect x='7' y='7' width='7.5' height='7.5' rx='2.2' fill='%23ffcb05'/%3E"
    "%3Crect x='17.5' y='7' width='7.5' height='7.5' rx='2.2' fill='%23ffcb05' opacity='.7'/%3E"
    "%3Crect x='7' y='17.5' width='7.5' height='7.5' rx='2.2' fill='%23ffcb05' opacity='.7'/%3E"
    "%3Crect x='17.5' y='17.5' width='7.5' height='7.5' rx='2.2' fill='%23ffcb05'/%3E%3C/svg%3E"
)

e = html.escape


# ------------------------------------------------------------------ 유틸
def won(n):
    return f"{n:,}원"


def pct(base, value):
    if not base:
        return ""
    d = (value - base) / base * 100
    sign = "+" if d > 0 else ""
    return f"{sign}{d:.1f}%"


def rel(path):
    """페이지 위치(path)에서 사이트 안 다른 경로로 가는 상대 링크."""
    depth = path.count("/")
    return "../" * depth


def head(title, desc, path, og_title=None, og_desc=None, extra_head="", og_type="article"):
    r = rel(path)
    url = BASE + "/" + ("" if path == "index.html" else path)
    return f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<meta name="robots" content="index, follow">
<meta name="author" content="{SITE_NAME}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="{og_type}">
<meta property="og:site_name" content="{SITE_NAME}">
<meta property="og:title" content="{e(og_title or title)}">
<meta property="og:description" content="{e(og_desc or desc)}">
<meta property="og:url" content="{url}">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(og_title or title)}">
<meta name="twitter:description" content="{e(og_desc or desc)}">
<meta name="twitter:image" content="{OG_IMAGE}">
<meta property="og:image" content="{OG_IMAGE}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="{SITE_NAME} — 포켓몬 카드 정가 구매처·편의점 재고·확장팩 도감">
<meta name="theme-color" content="#101f3c">
<meta name="application-name" content="{SITE_NAME}">
<link rel="icon" href="{FAVICON}">
<link rel="stylesheet" href="{r}assets/css/static.css?v={CSS_V}">
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id={GA_ID}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', '{GA_ID}');
</script>
{extra_head}</head>
<body>
<header class="site-head">
  <div class="wrap">
    <a class="brand" href="{r}">
      <svg viewBox="0 0 32 32" width="24" height="24" aria-hidden="true"><rect x="7" y="7" width="7.5" height="7.5" rx="2.2" fill="#ffcb05"/><rect x="17.5" y="7" width="7.5" height="7.5" rx="2.2" fill="#ffcb05" opacity=".7"/><rect x="7" y="17.5" width="7.5" height="7.5" rx="2.2" fill="#ffcb05" opacity=".7"/><rect x="17.5" y="17.5" width="7.5" height="7.5" rx="2.2" fill="#ffcb05"/></svg>
      <span><strong>{SITE_NAME}</strong><span>POKEMON CARD MOA</span></span>
    </a>
    <nav class="site-nav" aria-label="주 메뉴">
      <a href="{r}#map">동네에서 찾기</a>
      <a href="{r}#home">정가 구매처</a>
      <a href="{r}#schedule">일정·소식</a>
      <a href="{r}sets/">확장팩 도감</a>
      <a href="{r}guides/">가이드</a>
    </nav>
  </div>
</header>
<main>
  <div class="wrap">
"""


def crumbs(items):
    """items: [(label, href or None)]"""
    parts = []
    for label, href in items:
        if href:
            parts.append(f'<a href="{href}">{e(label)}</a>')
        else:
            parts.append(f'<span aria-current="page">{e(label)}</span>')
    return '<nav class="crumbs" aria-label="현재 위치">' + '<span class="sep">›</span>'.join(parts) + "</nav>\n"


def foot(path):
    r = rel(path)
    set_links = "".join(
        f'<li><a href="{r}sets/{s["id"]}.html">{e(s["short"])}</a></li>' for s in SETS
    )
    guide_links = "".join(
        f'<li><a href="{r}guides/{g["slug"]}.html">{e(g["nav"])}</a></li>' for g in GUIDES
    )
    return f"""  </div>
</main>
<footer class="site-foot">
  <div class="wrap">
    <h5>확장팩 도감</h5>
    <ul>{set_links}<li><a href="{r}sets/">전체 보기</a></li></ul>
    <h5>가이드</h5>
    <ul>{guide_links}</ul>
    <p class="fine">
      {SITE_NAME}는 포켓몬·포켓몬코리아와 무관한 비공식 정보 사이트입니다. 가격·일정은 공개 자료를 정리한 값이고, 리셀 시세는 확인 시점을 기준으로 적었습니다.
      매장 위치는 카카오맵, 편의점 재고는 각 사 앱 조회값입니다. 구매 판단과 결과는 이용자에게 있습니다.<br>
      <a href="{r}">홈</a> · <a href="{r}privacy.html">개인정보처리방침</a> · <a href="{r}terms.html">이용약관</a> · <a href="{r}sitemap.xml">사이트맵</a>
    </p>
  </div>
</footer>
</body>
</html>
"""


def page(path, title, desc, crumb_items, body, jsonld=None, og_type="article"):
    extra = ""
    if jsonld:
        extra = (
            '<script type="application/ld+json">'
            + json.dumps(jsonld, ensure_ascii=False, separators=(",", ":"))
            + "</script>\n"
        )
    return (
        head(title, desc, path, extra_head=extra, og_type=og_type)
        + crumbs(crumb_items)
        + body
        + foot(path)
    )


def page_url(path):
    return BASE + "/" + ("" if path == "index.html" else path)


def publisher_ld():
    return {
        "@type": "Organization",
        "@id": SITE_HOME + "#organization",
        "name": SITE_NAME,
        "url": SITE_HOME,
        "logo": {"@type": "ImageObject", "url": SITE_LOGO, "width": 512, "height": 512},
    }


def article_ld(path, headline, description, section=None):
    """가이드·도감 페이지의 글 정보.

    포켓몬카드모아는 직접 판매하지 않는 정보 사이트이므로 Product/Offer 스키마와
    평점·리뷰·배송·반품 같은 판매 조건은 넣지 않는다.
    """
    url = page_url(path)
    d = {
        "@context": "https://schema.org",
        "@type": "Article",
        "@id": url + "#article",
        "headline": headline,
        "description": description,
        "url": url,
        "image": [OG_IMAGE],
        "datePublished": PUBLISHED_AT,
        "dateModified": MODIFIED_AT,
        "inLanguage": "ko-KR",
        "author": {"@type": "Organization", "name": SITE_NAME, "url": SITE_HOME},
        "publisher": publisher_ld(),
        "isPartOf": {
            "@type": "WebSite",
            "@id": SITE_HOME + "#website",
            "url": SITE_HOME,
            "name": SITE_NAME,
        },
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
    }
    if section:
        d["articleSection"] = section
    return d


def collection_ld(path, name, description, list_items, about_name=None):
    """목록·도감 페이지 정보. list_items는 ListItem dict 목록."""
    url = page_url(path)
    d = {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        "@id": url + "#collection",
        "url": url,
        "name": name,
        "description": description,
        "inLanguage": "ko-KR",
        "isPartOf": {
            "@type": "WebSite",
            "@id": SITE_HOME + "#website",
            "url": SITE_HOME,
            "name": SITE_NAME,
        },
        "primaryImageOfPage": {
            "@type": "ImageObject",
            "url": OG_IMAGE,
            "width": 1200,
            "height": 630,
        },
        "datePublished": PUBLISHED_AT,
        "dateModified": MODIFIED_AT,
        "publisher": publisher_ld(),
        "mainEntity": {
            "@type": "ItemList",
            "name": name,
            "numberOfItems": len(list_items),
            "itemListElement": list_items,
        },
    }
    if about_name:
        d["about"] = {"@type": "Thing", "name": about_name}
    return d


def breadcrumb_ld(path, crumb_items):
    items = []
    for i, (label, href) in enumerate(crumb_items, start=1):
        url = BASE + "/" + path if href is None else (
            BASE + "/" if href == "../" else BASE + "/" + href.replace("../", "")
        )
        items.append({"@type": "ListItem", "position": i, "name": label, "item": url})
    return {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": items}


# ------------------------------------------------------------------ 데이터
def load_data():
    src = (ROOT / "assets/js/data.js").read_text(encoding="utf-8")
    cache = {}
    d = {
        "sets": extract(src, "SETS", cache),
        "channels": extract(src, "channels", cache),
        "weekday": extract(src, "weekdayGuide", cache),
        "faq": extract(src, "faq", cache),
        "facts": extract(src, "facts", cache),
        "shortcuts": extract(src, "shortcuts", cache),
        "pop": extract(src, "popTools", cache),
        "movers": extract(src, "kreamMovers", cache),
        "kream_checked": extract(src, "KREAM_CHECKED", cache),
        "new_releases": extract(src, "newReleases", cache),
        "toysrus": extract(src, "toysrusBranches", cache),
        "site": extract(src, "SITE", cache),
    }
    cfg = json.loads((ROOT / "assets/config/site-config.json").read_text(encoding="utf-8"))
    d["copy"] = cfg["copy"]
    return d


DATA = load_data()
SETS = DATA["sets"]

GUIDES = [
    {
        "slug": "price-channels",
        "nav": "정가 구매처",
        "title": "포켓몬 카드 정가 구매처 비교 — 포켓몬스토어·SSG·G마켓·티씨지박스·마트·편의점",
        "short": "30th CELEBRATION 기준 6개 채널의 가격·배송비·구매 조건과 총액 계산",
    },
    {
        "slug": "cvs-stock",
        "nav": "편의점 재고·입고 요일",
        "title": "편의점 포켓몬 카드 재고 확인법 — GS25·CU·세븐일레븐·이마트24와 참고 입고 요일",
        "short": "4사 앱에서 재고를 확인하는 방법, 숫자의 의미, 채널별 참고 입고 요일",
    },
    {
        "slug": "market-pop",
        "nav": "시세·팝수 읽기",
        "title": "포켓몬 카드 시세·팝수 읽는 법 — KREAM 체결가와 PSA·BRG 팝 리포트",
        "short": "정가 대비 시세 계산, 슈링크·논슈링크 차이, 카드 번호로 팝수 조회하는 순서",
    },
    {
        "slug": "faq",
        "nav": "자주 묻는 질문",
        "title": "포켓몬 카드 자주 묻는 질문 — 정가·구성·추첨·미개봉·리셀 판단 기준",
        "short": "정가와 구성, 추첨 결제, 박스 수집 가능성, 재포장 구별 등 8문 8답",
    },
]
GUIDES_BY_SLUG = {g["slug"]: g for g in GUIDES}


# ------------------------------------------------------------------ 세트 페이지
def set_fact_grid(s):
    box_cards = s["packsPerBox"] * s["cardsPerPack"]
    if s["id"] == "starter":
        rows = [
            ("발매일", s["release"]),
            ("상품 종류", "구축덱(스타터 세트)"),
            ("가격", won(s["packPrice"])),
            ("구성", "카드 60장 + 데미지 카운터·동전·플레이매트"),
            ("수록", s["total"]),
            ("시리즈", s["series"]),
        ]
    else:
        rows = [
            ("발매일", s["release"]),
            ("1팩 정가", f'{won(s["packPrice"])} <small>· {s["cardsPerPack"]}장</small>'),
            ("1박스 정가", f'{won(s["boxPrice"])} <small>· {s["packsPerBox"]}팩</small>'),
            ("박스 수록", f'{box_cards}장 <small>(팩당 {s["cardsPerPack"]}장)</small>'),
            ("총 카드", s["total"]),
            ("시리즈", s["series"]),
        ]
    cells = "".join(
        f'<div><span class="k">{e(k)}</span><span class="v">{v}</span></div>' for k, v in rows
    )
    return f'<div class="facts">{cells}</div>'


def price_section(s):
    out = ['<h2>정가와 현재 시세</h2>']
    if s["id"] == "starter":
        out.append(
            f'<p>구축덱이라 팩 단가 대신 세트 가격으로 비교합니다. 정가 {won(s["packPrice"])} 기준으로 '
            f'KREAM 한글판 최근 체결은 {won(s["kream"][0]["price"])}입니다.</p>'
        )
    else:
        out.append(
            f'<p>1팩 {won(s["packPrice"])}, 1박스({s["packsPerBox"]}팩) {won(s["boxPrice"])}이 정가 기준선입니다. '
            f'박스를 살 때 팩당 단가가 정가와 같은지(={won(s["packPrice"])})로 판단하면 리셀 프리미엄을 바로 알 수 있습니다.</p>'
        )
    rows = [
        f'<tr><td>공식 정가 · 박스</td><td class="num right">{won(s["boxPrice"] if s["id"] != "starter" else s["packPrice"])}</td><td class="num right">기준</td></tr>'
    ]
    for k in s.get("kream", []):
        rows.append(
            f'<tr><td>{e(k["label"])}</td><td class="num right">{won(k["price"])}</td>'
            f'<td class="num right">{pct(s["boxPrice"] if s["id"] != "starter" else s["packPrice"], k["price"])}</td></tr>'
        )
    for x in s.get("extra", []):
        rows.append(
            f'<tr><td>{e(x["label"])}<br><small style="color:var(--muted)">{e(x.get("note",""))}</small></td>'
            f'<td class="num right">{won(x["price"])}</td><td class="num right">—</td></tr>'
        )
    out.append(
        '<div class="table-scroll"><table><caption>미개봉 박스(구축덱은 세트) 기준 · 정가 대비 = 정가를 0%로 본 차이</caption>'
        '<thead><tr><th>채널</th><th class="num right">가격</th><th class="num right">정가 대비</th></tr></thead><tbody>'
        + "".join(rows)
        + "</tbody></table></div>"
    )
    out.append(
        '<p class="note">시세는 KREAM 한글판 공개 최근 체결가(확인 시점 기준)이고 배송비·수수료는 빠진 값입니다. '
        "박스를 뜯을지, 원하는 카드 1장을 싱글카드로 살지 계산할 때 이 표를 기준선으로 쓰세요.</p>"
    )
    return "".join(out)


def card_table(s):
    cards = s["cards"]
    hot_tags = {"fur", "mur", "bwr", "sar", "classic"}
    rows = []
    for c in cards:
        rarity = c.get("rarity", "")
        cls = ' class="chip hot"' if c.get("tag") in hot_tags else ' class="chip"'
        illus = c.get("illus")
        note = c.get("note", "")
        if illus:
            note = f'{note} <small style="color:var(--muted)">일러스트 {e(illus)}</small>'
        rows.append(
            "<tr>"
            f'<td class="num">{e(c.get("num") or "—")}</td>'
            f'<td><strong>{e(c["name"])}</strong></td>'
            f'<td><span{cls}>{e(rarity)}</span></td>'
            f"<td>{note}</td>"
            "</tr>"
        )
    label = "대표 카드" if len(cards) < 15 else "수록 카드"
    return (
        f'<h2>{label} {len(cards)}종 정리</h2>'
        f'<p>{e(s.get("dexNote", ""))}</p>'
        '<div class="table-scroll"><table><caption>번호·이름·레어도·한 줄 설명 · 세트 전체 카드가 아니라 대표 카드만 실었습니다</caption>'
        '<thead><tr><th class="num">번호</th><th>카드</th><th>레어도</th><th>설명</th></tr></thead><tbody>'
        + "".join(rows)
        + "</tbody></table></div>"
    )


def set_page(s, idx):
    sid = s["id"]
    path = f"sets/{sid}.html"
    box_cards = s["packsPerBox"] * s["cardsPerPack"]
    if sid == "starter":
        desc = (
            f'{s["name"]} — {s["release"]} 발매, {won(s["packPrice"])}. 카드 60장 구성과 대표 카드, '
            f'KREAM 한글판 시세({won(s["kream"][0]["price"])})를 정리했습니다.'
        )
        title = f'{s["short"]} (스타터 세트) — 가격 {won(s["packPrice"])}·수록 카드 | {SITE_NAME}'
    else:
        desc = (
            f'{s["short"]}({s["code"]}) — {s["release"]} 발매, 1팩 {won(s["packPrice"])}·1박스 {won(s["boxPrice"])}, '
            f'{s["total"]}. 대표 카드 {len(s["cards"])}종의 레어도와 KREAM 한글판 시세({won(s["kream"][0]["price"])})를 한 페이지에 정리했습니다.'
        )
        title = f'{s["short"]} ({s["code"]}) 정가 {won(s["packPrice"])}·대표 카드 {len(s["cards"])}종 | {SITE_NAME}'

    siblings = [x for x in SETS if x["id"] != sid]
    # 같은 시리즈를 먼저, 그 안에서 최신 발매순
    siblings.sort(key=lambda x: (x["series"] == s["series"], x["release"]), reverse=True)
    rel_cards = "".join(
        f'<a class="card-link" href="{x["id"]}.html"><span class="t">{e(x["short"])} ({e(x["code"])})</span>'
        f'<span class="s">발매 {x["release"]} · 1팩 {won(x["packPrice"])} · KREAM {won(x["kream"][0]["price"])}</span></a>'
        for x in siblings[:3]
    )

    links = []
    if s.get("official"):
        links.append(f'<a class="cta" href="{e(s["official"])}" target="_blank" rel="noopener">공식 카드 목록 보기</a>')
    if s.get("extraLink"):
        links.append(
            f'<a class="cta ghost" href="{e(s["extraLink"]["url"])}" target="_blank" rel="noopener">{e(s["extraLink"]["label"])}</a>'
        )
    for k in s.get("kream", []):
        links.append(
            f'<a class="cta ghost" href="{e(k["url"])}" target="_blank" rel="noopener">{e(k["label"])} 시세</a>'
        )

    body = f"""<h1>{e(s["name"])}<span class="code">{e(s["code"])}</span></h1>
<p class="lead">{e(s["summary"])}</p>
{set_fact_grid(s)}
<div class="panel">
  <h3 style="margin-top:4px">이 세트가 눈에 띄는 이유</h3>
  <p>{e(s["summary"])}</p>
  <p>{e(s.get("dexNote", ""))}</p>
  <p style="margin-bottom:12px">한국어판 기준 <strong>{e(s["total"])}</strong>{"" if sid == "starter" else f", 박스 1개에 {box_cards}장"}이 들어 있습니다.
  정가는 공식 페이지와 정가 구매처에서 같은 값이므로, 이 값보다 비싸게 부르는 곳은 배송비·구성 차이를 확인하세요.</p>
</div>
{price_section(s)}
{card_table(s)}
<h2>확인처와 바로가기</h2>
<p>가격·구성은 아래 공식 페이지에서 다시 확인하세요. 시세는 하루에도 바뀌므로 카드 1장 단가로 계산하는 편이 안전합니다.</p>
<p>{''.join(links)}</p>
<p><a class="cta ghost" href="../guides/price-channels.html">정가 구매처 비교 보기</a>
<a class="cta ghost" href="../guides/market-pop.html">시세·팝수 읽는 법</a>
<a class="cta ghost" href="../#home">홈에서 실시간 정가 보드</a></p>
<h2>함께 보는 확장팩</h2>
<div class="cards">{rel_cards}
<a class="card-link" href="./"><span class="t">확장팩 도감 전체</span><span class="s">9개 세트의 발매일·정가·시세를 한 표로</span></a></div>
<p class="note">이 페이지의 숫자는 공개 자료를 정리한 값이고, 리셀 시세는 확인 시점 기준입니다. 카드 수록 정보는 공식 카드 목록이 최종 기준입니다.</p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("확장팩 도감", "sets/"), (s["short"], None)]),
        collection_ld(
            path,
            f'{s["short"]} 확장팩 도감 — 정가·구성·대표 카드',
            desc,
            [
                {"@type": "ListItem", "position": i, "name": c["name"]}
                for i, c in enumerate(s["cards"], start=1)
            ],
            about_name=s["name"],
        ),
        article_ld(
            path,
            f'{s["short"]} 확장팩 정리 — 발매일·정가·대표 카드·시세',
            desc,
            section="확장팩 도감",
        ),
    ]
    return path, page(
        path,
        title,
        desc,
        [("포켓몬카드모아", "../"), ("확장팩 도감", "./"), (s["short"], None)],
        body,
        jsonld=ld,
    )


def sets_index_page():
    path = "sets/index.html"
    rows = []
    for s in SETS:
        box = s["boxPrice"] if s["id"] != "starter" else s["packPrice"]
        rows.append(
            "<tr>"
            f'<td><a href="{s["id"]}.html" aria-label="{e(s["short"])} 상세 페이지"><strong>{e(s["short"])}</strong></a><br>'
            f'<small style="color:var(--muted)">{e(s["code"])}</small></td>'
            f'<td class="num">{s["release"]}</td>'
            f'<td class="num">{e(s["total"])}</td>'
            f'<td class="num right">{won(s["packPrice"])}</td>'
            f'<td class="num right">{won(box)}</td>'
            f'<td class="num right">{won(s["kream"][0]["price"])}</td>'
            f'<td class="num right">{pct(box, s["kream"][0]["price"])}</td>'
            "</tr>"
        )
    cards = "".join(
        f'<a class="card-link" href="{s["id"]}.html"><span class="t">{e(s["short"])} ({e(s["code"])})</span>'
        f'<span class="s">{e(s["total"])} · 발매 {s["release"]} · 1팩 {won(s["packPrice"])}</span></a>'
        for s in SETS
    )
    body = f"""<h1>포켓몬 카드 확장팩 도감 — 발매일·정가·시세 비교</h1>
<p class="lead">포켓몬카드모아가 정리한 9개 확장팩(30th CELEBRATION·어비스아이·블랙볼트·로켓단의 영광·열풍의 아레나·배틀 파트너즈·테라스탈 페스타 ex·초전 브레이커·스타터 세트)의 발매일, 팩·박스 정가, 수록 카드 수, KREAM 한글판 시세를 한 표에 모았습니다. 세트 이름을 누르면 대표 카드와 레어도, 세트별 특징을 볼 수 있습니다.</p>

<div class="panel">
  <h3 style="margin-top:4px">세트를 고르는 기준 세 가지</h3>
  <ol>
    <li><strong>정가 대비 시세</strong> — 박스 정가와 KREAM 체결가의 차이가 곧 프리미엄입니다. 정가보다 낮으면 뜯을 맛이 있고, 크게 붙었으면 원하는 카드만 싱글카드로 사는 편이 쌉니다.</li>
    <li><strong>수록 카드와 레어도</strong> — SAR·UR·BWR·MUR·FUR처럼 상위 레어도가 몇 종인지에 따라 박스 기대값이 달라집니다.</li>
    <li><strong>팩 구성</strong> — 1팩 5장·1박스 30팩인 세트와 1팩 7장·1박스 20팩인 세트는 팩당 단가가 다릅니다. 아래 표의 1팩 정가로 비교하세요.</li>
  </ol>
</div>

<h2>9개 세트 비교표</h2>
<div class="table-scroll"><table>
<caption>정가 대비 = 박스 정가를 0%로 본 KREAM 한글판 최근 체결 차이 · 좁은 화면에서는 표를 좌우로 넘겨 보세요</caption>
<thead><tr><th>세트</th><th class="num">발매일</th><th class="num">수록</th><th class="num right">1팩 정가</th><th class="num right">1박스 정가</th><th class="num right">KREAM</th><th class="num right">정가 대비</th></tr></thead>
<tbody>{''.join(rows)}</tbody></table></div>
<p class="note">스타터 세트는 팩이 아니라 카드 60장이 고정된 구축덱이라 ‘1박스 정가’ 칸에 세트 가격을 적었습니다.</p>

<h2>세트별 상세 페이지</h2>
<div class="cards">{cards}</div>

<h2>같이 보면 좋은 가이드</h2>
<div class="cards">
<a class="card-link" href="../guides/price-channels.html"><span class="t">정가 구매처 비교</span><span class="s">포켓몬스토어·SSG·G마켓·티씨지박스·마트·편의점</span></a>
<a class="card-link" href="../guides/cvs-stock.html"><span class="t">편의점 재고·입고 요일</span><span class="s">4사 앱에서 재고 확인하는 방법</span></a>
<a class="card-link" href="../guides/market-pop.html"><span class="t">시세·팝수 읽기</span><span class="s">KREAM 체결가와 PSA·BRG 팝 리포트</span></a>
<a class="card-link" href="../guides/faq.html"><span class="t">자주 묻는 질문</span><span class="s">정가·추첨·미개봉·리셀 판단</span></a>
</div>
<p><a class="cta" href="../#map">내 주변 편의점 재고 찾기</a><a class="cta ghost" href="../#guide">홈 도감·시세 탭</a></p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("확장팩 도감", None)]),
        collection_ld(
            path,
            "포켓몬 카드 확장팩 도감 — 발매일·정가·시세 비교",
            "포켓몬카드모아가 정리한 9개 확장팩의 발매일, 팩·박스 정가, 수록 카드 수, KREAM 한글판 시세 비교 목록입니다.",
            [
                {
                    "@type": "ListItem",
                    "position": i,
                    "name": s["name"],
                    "url": f"{BASE}/sets/{s['id']}.html",
                }
                for i, s in enumerate(SETS, start=1)
            ],
            about_name="포켓몬 카드 게임 확장팩",
        ),
    ]
    return path, page(
        path,
        f"포켓몬 카드 확장팩 도감 9종 — 발매일·정가·시세 비교 | {SITE_NAME}",
        "포켓몬 카드 확장팩 9종(30th CELEBRATION·어비스아이·블랙볼트·로켓단의 영광·열풍의 아레나·배틀 파트너즈·테라스탈 페스타 ex·초전 브레이커·스타터 세트)의 발매일, 1팩·1박스 정가, 수록 카드, KREAM 시세를 한 표로 비교합니다.",
        [("포켓몬카드모아", "../"), ("확장팩 도감", None)],
        body,
        jsonld=ld,
        og_type="website",
    )


# ------------------------------------------------------------------ 가이드 페이지
def _region_label(addr):
    """주소 첫 토막을 지역명으로 — 2026년 통합된 전남광주통합특별시는 짧게 광주로 적는다."""
    head = (addr or "").split(" ")[0]
    return "광주" if head.startswith("전남광주") else head


def guide_price():
    path = "guides/price-channels.html"
    ch = DATA["channels"]
    rows = "".join(
        f'<tr><td><strong>{e(c["name"])}</strong><br><small style="color:var(--muted)">{e(c["kindLabel"])} · {e(c["badge"])}</small></td>'
        f'<td class="num">{e(c["price"])}<br><small style="color:var(--muted)">{e(c["priceNote"])}</small></td>'
        f'<td><ul style="margin:0;padding-left:16px">{"".join(f"<li>{e(f)}</li>" for f in c["features"])}</ul></td>'
        "</tr>"
        for c in ch
    )
    def _channel_block(c):
        feats = "".join("<li>%s</li>" % e(f) for f in c["features"])
        links = "".join(
            '<a class="cta ghost" href="%s" target="_blank" rel="noopener">%s</a>'
            % (e(link["url"]), e(link["label"]))
            for link in c["links"]
        )
        return (
            '<h3>%s</h3><p><strong>%s</strong> · %s</p><ul>%s</ul>'
            '<p class="note">%s</p><p>%s</p>'
            % (e(c["name"]), e(c["price"]), e(c["priceNote"]), feats, e(c["tip"]), links)
        )

    detail = "".join(_channel_block(c) for c in ch)
    toys = DATA.get("toysrus") or []
    toy_rows = "".join(
        "<tr><td><strong>%s</strong></td><td>%s</td><td>%s</td><td>%s</td></tr>"
        % (
            _region_label(t.get("addr") or ""),
            e(t["name"]),
            e(t.get("place") or "—"),
            e(t.get("addr") or ""),
        )
        for t in toys
    )
    body = f"""<h1>포켓몬 카드 정가 구매처 비교 — 30th CELEBRATION 기준 6개 채널</h1>
<p class="lead">같은 박스라도 채널마다 배송비·판매 단위·추첨 조건이 다릅니다. 30th CELEBRATION(1팩 3,500원·1박스 70,000원)을 기준으로 포켓몬스토어, SSG, G마켓, 티씨지박스, 이마트·롯데마트 등 마트, 편의점 4사의 조건을 정리했습니다.</p>

<div class="panel">
  <h3 style="margin-top:4px">먼저 정가를 외우세요</h3>
  <p>30th CELEBRATION은 1팩 <strong>3,500원</strong>, 1박스(20팩) <strong>70,000원</strong>이 정가입니다. 1팩에 6장, 1박스에 120장이 들어갑니다. 이 두 숫자만 기억하면 어떤 채널이 비싼지 바로 판단할 수 있습니다.</p>
  <ul>
    <li>박스 73,000원 = 정가 + 배송비 3,000원 (정상)</li>
    <li>낱팩 4,000원 = 팩당 +500원 (편의점·카드샵에서 흔함)</li>
    <li>박스 76,000원 = +8.6% (2026-11 KREAM 미개봉 슈링크 시세 수준)</li>
  </ul>
</div>

<h2>6개 채널 한눈에</h2>
<div class="table-scroll"><table>
<caption>가격은 30th CELEBRATION 박스 1개 기준</caption>
<thead><tr><th>채널</th><th class="num">가격</th><th>조건</th></tr></thead>
<tbody>{rows}</tbody></table></div>

<h2>채널별 자세히</h2>
{detail}

<h2>토이저러스 매장 — 전국 {len(toys)}곳</h2>
<p>토이저러스는 롯데마트 계열이라 매장 목록·재고를 롯데마트 모바일 도와센터에서 같이 볼 수 있습니다. 아래는 도와센터 매장 목록(2026-11-26)과 카카오 장소 검색으로 주소·좌표를 확인한 전국 {len(toys)}곳입니다. 같은 건물에 롯데마트가 있으면 「동네에서 찾기」 지도에서 마커가 하나로 묶이고 매장 카드에 두 점포 재고가 나란히 나오며, 아울렛·몰처럼 롯데마트가 없는 건물은 토이저러스 단독 매장으로 표시됩니다.</p>
<div class="table-scroll"><table>
<caption>도와센터 매장 목록 기준 · 위치는 2026-11-26 확인</caption>
<thead><tr><th>지역</th><th>매장</th><th>같은 건물</th><th>주소</th></tr></thead>
<tbody>{toy_rows}</tbody></table></div>
<p class="note">매장은 생기거나 없어질 수 있고, 같은 건물 표기도 건물 사정에 따라 달라집니다. 방문 전 토이저러스·롯데마트 고객센터로 영업 여부를 확인하세요. 포켓몬 카드 재고는 「동네에서 찾기」 지도에서 점포별로 조회합니다.</p>

<h2>상황별로 고르는 법</h2>
<dl class="defs">
  <dt>박스를 정가로 사고 싶다면</dt>
  <dd>포켓몬스토어 추첨이 1순위입니다. 다만 응모가 끝난 회차는 기다려야 하므로, SSG·G마켓 공식인증샵에서 정가 70,000원 + 배송비 3,000원을 내는 편이 현실적입니다.</dd>
  <dt>오늘 바로 뜯고 싶다면</dt>
  <dd>편의점 낱팩과 이마트·롯데마트·토이저러스가 가장 빠릅니다. 낱팩은 팩당 단가가 정가보다 높으므로 몇 팩 살지 먼저 정하세요.</dd>
  <dt>원하는 카드 1장이 정해져 있다면</dt>
  <dd>박스보다 싱글카드가 쌉니다. 박스 1개 값(70,000원)으로 원하는 SAR 1장을 사는 계산을 먼저 해보고, 남는 예산으로 낱팩을 사는 쪽이 만족도가 높습니다.</dd>
</dl>

<h2>함께 보는 페이지</h2>
<div class="cards">
<a class="card-link" href="../sets/m6a.html"><span class="t">30th CELEBRATION 도감</span><span class="s">정가·구성·수록 카드 34종</span></a>
<a class="card-link" href="../guides/cvs-stock.html"><span class="t">편의점 재고·입고 요일</span><span class="s">GS25·CU·세븐일레븐·이마트24</span></a>
<a class="card-link" href="../guides/market-pop.html"><span class="t">시세·팝수 읽기</span><span class="s">KREAM 체결가와 PSA·BRG</span></a>
<a class="card-link" href="../sets/"><span class="t">확장팩 도감 전체</span><span class="s">9개 세트 정가·시세 비교</span></a>
</div>
<p><a class="cta" href="../#home">홈에서 정가 보드 보기</a><a class="cta ghost" href="../#map">내 주변 매장 찾기</a></p>
<p class="note">판매 조건·가격은 채널 사정에 따라 바뀝니다. 결제 전 장바구니 총액(배송비 포함)과 판매자명을 꼭 확인하세요.</p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("가이드", "guides/"), ("정가 구매처 비교", None)]),
        article_ld(
            path,
            "포켓몬 카드 정가 구매처 비교 — 30th CELEBRATION 기준 6개 채널",
            "30th CELEBRATION 기준 포켓몬스토어 추첨, SSG·G마켓 공식인증샵, 티씨지박스, 이마트·롯데마트 등 마트, 편의점의 가격·배송비·구매 조건과 총액 계산법입니다.",
            section="가이드",
        ),
    ]
    return path, page(
        path,
        f"포켓몬 카드 정가 구매처 비교 — 포켓몬스토어·SSG·G마켓·티씨지박스·마트·편의점 | {SITE_NAME}",
        "30th CELEBRATION(1팩 3,500원·1박스 70,000원) 기준으로 포켓몬스토어 추첨, SSG·G마켓 공식인증샵, 티씨지박스, 이마트·롯데마트 등 마트, 편의점의 가격·배송비·구매 조건과 총액 계산법을 비교합니다.",
        [("포켓몬카드모아", "../"), ("가이드", "./"), ("정가 구매처 비교", None)],
        body,
        jsonld=ld,
    )


def guide_cvs():
    path = "guides/cvs-stock.html"
    copy = DATA["copy"]
    wd = DATA["weekday"]
    wd_rows = "".join(
        f'<tr><td><strong>{e(w["day"])}</strong></td><td>{e(w["focus"])}</td><td>{e(w["place"])}</td><td>{e(w["detail"])}</td></tr>'
        for w in wd
    )
    arrival = [
        ("아트박스", copy["arrivalArtDays"]),
        ("세븐일레븐", copy["arrivalSevenDays"]),
        ("GS25 · 이마트", copy["arrivalMartDays"]),
        ("롯데마트", copy["arrivalLotteDays"]),
        ("공인 카드샵", copy["arrivalShopDays"]),
    ]
    arr_rows = "".join(f"<tr><td><strong>{e(n)}</strong></td><td>{e(d)}</td></tr>" for n, d in arrival)
    toys = DATA.get("toysrus") or []
    mart_rows = "".join(
        f"<tr><td><strong>{e(n)}</strong></td><td>{e(how)}</td><td>{e(shown)}</td></tr>"
        for n, how, shown in [
            (
                "이마트",
                "이마트 앱이 쓰는 점포 재고 API를 같은 방식으로 직접 조회",
                "카드 상품 9종의 점포별 수량·품절·수량 비공개·오늘 휴무",
            ),
            (
                "롯데마트",
                "롯데마트 모바일 도와센터(점포 전산)를 중계 서버로 조회",
                "점포별 포켓몬 상품 재고 — 카드(TCG) 상품이 있으면 이름·가격·수량, 없으면 ‘카드 상품 없음’",
            ),
            (
                "토이저러스",
                f"같은 도와센터(롯데마트 계열) 점포 전산 + 확인한 전국 {len(toys)}곳 좌표",
                "같은 건물에 롯데마트가 있으면 한 마커에 ‘토이저러스 함께’, 없으면 단독 매장으로 표시",
            ),
            (
                "홈플러스",
                "공개된 점포 재고 API 없음",
                "매장 위치만 — 방문 전 매장 고객센터로 확인",
            ),
        ]
    )
    sc = DATA["shortcuts"]
    sc_cards = "".join(
        f'<a class="card-link" href="{e(s["url"])}" target="_blank" rel="noopener"><span class="t">{e(s["label"])}</span>'
        f'<span class="s">{e(s["desc"])}</span></a>'
        for s in sc
    )
    body = f"""<h1>편의점 포켓몬 카드 재고 확인법 — GS25·CU·세븐일레븐·이마트24</h1>
<p class="lead">편의점 재고는 본사 앱에서 매장별로 조회할 수 있습니다. 4사마다 조회 방식과 표시되는 정보가 다르고, 세븐일레븐은 정책상 재고를 제공하지 않습니다. 재고 숫자의 의미와 채널별 참고 입고 요일을 정리했습니다.</p>

<div class="panel">
  <h3 style="margin-top:4px">숫자를 읽는 법</h3>
  <ul>
    <li><strong>재고 있음 N개</strong> — 앱에서 확인된 실제 수량입니다. 조회 시점 기준이므로 방문 전 다시 확인하세요.</li>
    <li><strong>없음</strong> — 조회 결과 0으로 확인된 매장입니다. 품절과 같은 뜻입니다.</li>
    <li><strong>미조회</strong> — 응답을 받지 못한 매장입니다. 품절이 아니라 ‘아직 모른다’는 뜻이니 방문 전 전화로 확인하세요.</li>
  </ul>
  <p style="margin-bottom:12px">포켓몬카드모아는 추정·샘플 수량을 쓰지 않고, 편의점 앱에서 받은 실제 값만 표시합니다.</p>
</div>

<h2>4사별 조회 방식</h2>
<div class="table-scroll"><table>
<thead><tr><th>브랜드</th><th>확인 방법</th><th>표시되는 것</th></tr></thead>
<tbody>
<tr><td><strong>GS25</strong></td><td>우리동네GS 앱 → 상품 검색 → 매장 재고</td><td>매장별 실재고 수량</td></tr>
<tr><td><strong>CU</strong></td><td>포켓CU 앱 → 상품 → 재고 있는 매장</td><td>매장별 실재고 수량</td></tr>
<tr><td><strong>이마트24</strong></td><td>이마트24 앱에서 상품·매장 확인</td><td>재고·품절, 수량 비공개 매장은 ‘매장 문의’</td></tr>
<tr><td><strong>세븐일레븐</strong></td><td>매장 위치만 안내(재고 미지원)</td><td>재고 없음 — 방문 전 매장 전화</td></tr>
</tbody></table></div>
<p class="note">세븐일레븐은 정책상 재고 조회를 제공하지 않아 포켓몬카드모아도 <strong>매장 위치만</strong> 보여 줍니다. 이마트는 30주년 기념팩·어비스아이·인페르노X·닌자스피너·니힐제로·메가심포니아·메가브레이브·로켓단의 영광·열풍의 아레나 9종의 점포별 재고를 확인합니다.</p>

<h2>대형마트·토이저러스는 어떻게 확인하나</h2>
<div class="table-scroll"><table>
<thead><tr><th>채널</th><th>확인 방법</th><th>포켓몬카드모아 표시</th></tr></thead>
<tbody>{mart_rows}</tbody></table></div>
<p class="note">롯데마트·토이저러스는 로그인 없이 열리는 <strong>롯데마트 모바일 도와센터(점포 전산)</strong>를 중계 서버가 대신 읽어 점포별 재고를 보여 줍니다. 도와센터는 해외 IP를 막아 한국 네트워크 중계가 필요하고, 조회한 포켓몬 상품 중 카드(TCG) 상품이 없으면 ‘카드 상품 없음’과 함께 완구·문구 등 재고 수만 적습니다(2026-11-26 서울·경기 점포 실측 — 부스터 상품은 아직 없고 완구·카드용품만 있습니다). 토이저러스는 카카오 업종 검색(대형마트)에 잡히지 않아 <strong>확인한 전국 {len(toys)}곳 좌표</strong>로 표시하고, 롯데마트·롯데몰·아울렛 안에 있으면 같은 건물의 롯데마트 마커에 <strong>‘토이저러스 함께’</strong>로 묶어 하나의 매장 카드에서 두 점포 재고를 나란히 보여 줍니다.</p>

<h2>채널별 참고 입고 요일</h2>
<p>{e(copy["arrivalLead"])} 아래 요일은 현장 제보를 정리한 참고값입니다.</p>
<div class="table-scroll"><table>
<thead><tr><th>채널</th><th>참고 요일</th></tr></thead>
<tbody>{arr_rows}</tbody></table></div>
<p class="note">{e(copy["arrivalNote"])}</p>

<h2>요일별로 움직이는 법</h2>
<div class="table-scroll"><table>
<thead><tr><th>요일</th><th>노릴 곳</th><th>장소</th><th>요령</th></tr></thead>
<tbody>{wd_rows}</tbody></table></div>

<h2>공식 확인처 바로가기</h2>
<div class="cards">{sc_cards}</div>

<h2>함께 보는 페이지</h2>
<div class="cards">
<a class="card-link" href="../sets/m6a.html"><span class="t">30th CELEBRATION 도감</span><span class="s">정가·구성·대표 카드</span></a>
<a class="card-link" href="../guides/price-channels.html"><span class="t">정가 구매처 비교</span><span class="s">6개 채널 가격·배송비</span></a>
<a class="card-link" href="../guides/faq.html"><span class="t">자주 묻는 질문</span><span class="s">박스 판매·재고 표시 기준</span></a>
</div>
<p><a class="cta" href="../#map">내 주변 매장 재고 조회</a><a class="cta ghost" href="../#schedule">입고·발매 일정 보기</a></p>
<p class="note">재고·요일은 조회 시점과 매장 사정에 따라 달라집니다. 방문 전 각 사 앱과 매장 전화로 확인하세요.</p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("가이드", "guides/"), ("편의점 재고·입고 요일", None)]),
        article_ld(
            path,
            "편의점 포켓몬 카드 재고 확인법 — GS25·CU·세븐일레븐·이마트24",
            "GS25·CU·세븐일레븐·이마트24에서 포켓몬 카드 재고를 확인하는 방법과 재고 숫자의 의미, 채널별 참고 입고 요일입니다.",
            section="가이드",
        ),
    ]
    return path, page(
        path,
        f"편의점 포켓몬 카드 재고 확인법 — GS25·CU·세븐일레븐·이마트24 재고·입고 요일 | {SITE_NAME}",
        "GS25·CU·세븐일레븐·이마트24에서 포켓몬 카드 재고를 확인하는 방법과 재고 숫자의 의미(재고 있음·없음·미조회), 채널별 참고 입고 요일을 정리했습니다. 세븐일레븐은 정책상 재고를 제공하지 않습니다.",
        [("포켓몬카드모아", "../"), ("가이드", "./"), ("편의점 재고·입고 요일", None)],
        body,
        jsonld=ld,
    )


def guide_market():
    path = "guides/market-pop.html"
    movers = DATA["movers"]
    kc = DATA["kream_checked"]
    pop = DATA["pop"]
    def _mover_row(m):
        diff = m.get("diff")
        pct_v = m.get("pct")
        if pct_v is None:
            change = "—"
        else:
            sign = "+" if (diff or 0) > 0 else ""
            change = f"{sign}{pct_v}%"
        return (
            f'<tr><td class="num">{e(m.get("num") or "—")}</td>'
            f'<td><strong>{e(m["name"])}</strong><br><small style="color:var(--muted)">{e(m.get("set",""))} · {e(m.get("rarity",""))}</small></td>'
            f'<td class="num right">{won(m["prevPrice"])}</td>'
            f'<td class="num right">{won(m["lastPrice"])}</td>'
            f'<td class="num right">{change}</td>'
            f'<td class="num right">{m.get("trades", 0)}건</td></tr>'
        )

    rows = "".join(_mover_row(m) for m in movers)
    body = f"""<h1>포켓몬 카드 시세·팝수 읽는 법 — KREAM 체결가와 PSA·BRG</h1>
<p class="lead">포켓몬 카드의 ‘현재 값’은 정가와 시세가 다릅니다. 정가는 공식 판매가, 시세는 실제 거래된 값입니다. 카드 1장을 살지 박스를 뜯을지 판단하려면 두 값을 나란히 놓고 봐야 합니다. 시세를 읽는 순서와 팝수(감정 등급별 매수) 조회 방법을 정리했습니다.</p>

<div class="panel">
  <h3 style="margin-top:4px">세 가지만 구분하면 됩니다</h3>
  <dl class="defs">
    <dt>정가</dt>
    <dd>제조사가 정한 판매가. 30th CELEBRATION은 1팩 3,500원·1박스 70,000원입니다. 이 값은 잘 바뀌지 않습니다.</dd>
    <dt>시세(체결가)</dt>
    <dd>KREAM처럼 거래가 기록되는 마켓에서 실제로 체결된 가격입니다. 같은 박스라도 <strong>슈링크(미개봉 비닐 유지)</strong>가 논슈링크보다 비쌉니다.</dd>
    <dt>팝수</dt>
    <dd>PSA·BRG 같은 감정사가 등급별로 몇 장을 감정했는지 센 숫자입니다. 팝수가 적은 카드는 같은 등급에서도 희소성이 높게 평가됩니다.</dd>
  </dl>
</div>

<h2>정가 대비 시세 계산</h2>
<p>박스 가격은 팩 수로 나눠 팩당 단가로 바꾸면 낱팩과 비교하기 쉽습니다.</p>
<ul>
  <li>박스 70,000원 ÷ 20팩 = <strong>팩당 3,500원</strong>(정가)</li>
  <li>슈링크 76,000원 ÷ 20팩 = 팩당 3,800원 (+8.6%)</li>
  <li>논슈링크 72,000원 ÷ 20팩 = 팩당 3,600원 (+2.9%)</li>
</ul>
<p>카드 1장이 목표라면 박스 대신 싱글카드 가격과 비교하세요. 박스 1개 값으로 원하는 SAR 1장이 산다면 싱글카드가 합리적입니다.</p>

<h2>KREAM에서 최근에 많이 움직인 카드</h2>
<div class="table-scroll"><table>
<caption>{e(kc["label"])} · 확인 {e(kc["date"])} {e(kc["time"])} · 직전 체결 대비</caption>
<thead><tr><th class="num">번호</th><th>카드</th><th class="num right">직전</th><th class="num right">최근</th><th class="num right">변동</th><th class="num right">거래</th></tr></thead>
<tbody>{rows}</tbody></table></div>
<p class="note">KREAM 화면의 ‘시세’는 최근 체결값이고, 실제 구매가는 배송비·수수료가 더해집니다. 같은 카드라도 한글판·일본판·영문판이 따로 거래되니 판본을 확인하세요. 직전 체결의 등급 표기가 다른 카드(예: 등급 없음 ↔ Ungraded A)는 변동률을 비워 두었습니다 — 서로 다른 등급을 같은 선으로 비교하지 않기 위해서입니다.</p>

<h2>카드 번호로 팝수 조회하기</h2>
<p>{e(pop["note"])}</p>
<ol>
  <li>카드 아래쪽의 <strong>번호(예: 126/103)</strong>와 세트 이름을 확인합니다.</li>
  <li>PSA Pop Report에서 세트·카드 번호로 검색해 등급별 감정 수량을 봅니다.</li>
  <li>BRG 팝 리포트에서 국내 감정(BRG) 등급별 수량을 함께 봅니다.</li>
  <li>같은 카드의 KREAM 체결가와 비교해, 팝수가 적은데 가격이 낮게 형성됐는지 확인합니다.</li>
</ol>
<div class="cards">
<a class="card-link" href="{e(pop["psa"]["url"])}" target="_blank" rel="noopener"><span class="t">{e(pop["psa"]["label"])}</span><span class="s">공식 팝 리포트 검색</span></a>
<a class="card-link" href="{e(pop["brg"]["url"])}" target="_blank" rel="noopener"><span class="t">{e(pop["brg"]["label"])}</span><span class="s">BRG 등급별 감정 수량</span></a>
<a class="card-link" href="{e(pop["pricecharting"])}" target="_blank" rel="noopener"><span class="t">PriceCharting</span><span class="s">해외 판본 시세 참고</span></a>
</div>

<h2>미개봉 박스를 살 때 확인할 것</h2>
<ul>
  <li>박스 외부 비닐(슈링크)이 원형이고 접힘선이 자연스러운지</li>
  <li>비닐 이중 포장, 테이프 자국, 모서리 눌림 등 재포장 흔적이 없는지</li>
  <li>판매자 평가와 반품 조건, 개봉 후 교환 불가 여부</li>
  <li>한글판·일본판·영문판 중 무엇인지(가격과 수집 수요가 다릅니다)</li>
</ul>

<h2>함께 보는 페이지</h2>
<div class="cards">
<a class="card-link" href="../sets/m6a.html"><span class="t">30th CELEBRATION 도감</span><span class="s">FUR·SAR·AR 수록 카드</span></a>
<a class="card-link" href="../sets/"><span class="t">확장팩 도감 전체</span><span class="s">9개 세트 정가·시세 비교</span></a>
<a class="card-link" href="../guides/price-channels.html"><span class="t">정가 구매처 비교</span><span class="s">정가로 사는 6개 채널</span></a>
<a class="card-link" href="../guides/faq.html"><span class="t">자주 묻는 질문</span><span class="s">리셀가 판단·미개봉 구별</span></a>
</div>
<p><a class="cta" href="../#trends">홈 팝수 조회 탭</a><a class="cta ghost" href="{e(kc["collection"])}" target="_blank" rel="noopener">KREAM 한글판 시세 모음</a></p>
<p class="note">시세·팝수는 확인 시점 기준입니다. 투자 판단의 근거로 쓰기 전에 공식 사이트에서 다시 확인하세요.</p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("가이드", "guides/"), ("시세·팝수 읽기", None)]),
        article_ld(
            path,
            "포켓몬 카드 시세·팝수 읽는 법 — KREAM 체결가와 PSA·BRG 팝 리포트",
            "포켓몬 카드 정가와 시세의 차이, KREAM 슈링크·논슈링크 체결가 읽는 법, 박스 가격을 팩당 단가로 바꾸는 계산, 카드 번호로 팝수를 조회하는 순서입니다.",
            section="가이드",
        ),
    ]
    return path, page(
        path,
        f"포켓몬 카드 시세·팝수 읽는 법 — KREAM 체결가·PSA·BRG 팝 리포트 | {SITE_NAME}",
        "포켓몬 카드 정가와 시세의 차이, KREAM 슈링크·논슈링크 체결가 읽는 법, 박스 가격을 팩당 단가로 바꾸는 계산, 카드 번호로 PSA·BRG 팝수를 조회하는 순서를 정리했습니다.",
        [("포켓몬카드모아", "../"), ("가이드", "./"), ("시세·팝수 읽기", None)],
        body,
        jsonld=ld,
    )


def guide_faq():
    path = "guides/faq.html"
    faq = DATA["faq"]
    facts = DATA["facts"]
    items = "".join(
        f"<details class=\"qa\"{' open' if i < 2 else ''}><summary>{e(q['q'])}</summary><p>{e(q['a'])}</p></details>"
        for i, q in enumerate(faq)
    )
    src = "".join(
        f'<li>{e(f["label"])} — {e(f["text"])} <a href="{e(f["url"])}" target="_blank" rel="noopener">출처</a></li>'
        for f in facts
    )
    body = f"""<h1>포켓몬 카드 자주 묻는 질문 8가지 — 정가·구성·추첨·리셀</h1>
<p class="lead">30th CELEBRATION을 중심으로 정가와 구성, 편의점 구매, 재고 표시 기준, 추첨 결제, 박스 수집, 미개봉 구별, 리셀가 판단에 대해 가장 많이 나오는 질문을 모았습니다.</p>
{items}

<h2>정가·구성 요약</h2>
<div class="table-scroll"><table>
<thead><tr><th>항목</th><th>값</th></tr></thead>
<tbody>
<tr><td>1팩 정가</td><td>3,500원 · 카드 6장</td></tr>
<tr><td>1박스 정가</td><td>70,000원 · 20팩 · 120장</td></tr>
<tr><td>세트 수록</td><td>176종(기본 103종)</td></tr>
<tr><td>확정 봉입</td><td>팩마다 30주년 피카츄 1장 + 기본 에너지 1장</td></tr>
<tr><td>피카츄 30종</td><td>017~046번 · 30명의 일러스트레이터</td></tr>
<tr><td>KREAM 미개봉</td><td>슈링크 76,000원 · 논슈링크 72,000원 ({KREAM_CHECKED_KO} 확인)</td></tr>
</tbody></table></div>

<h2>이 답의 근거</h2>
<ul>{src}</ul>

<h2>함께 보는 페이지</h2>
<div class="cards">
<a class="card-link" href="../sets/m6a.html"><span class="t">30th CELEBRATION 도감</span><span class="s">수록 카드·레어도·정가</span></a>
<a class="card-link" href="../guides/price-channels.html"><span class="t">정가 구매처 비교</span><span class="s">6개 채널 조건과 총액</span></a>
<a class="card-link" href="../guides/cvs-stock.html"><span class="t">편의점 재고·입고 요일</span><span class="s">재고 숫자의 의미</span></a>
<a class="card-link" href="../guides/market-pop.html"><span class="t">시세·팝수 읽기</span><span class="s">리셀가 판단 기준</span></a>
</div>
<p><a class="cta" href="../#home">홈에서 정가 보드 보기</a><a class="cta ghost" href="../#guide">수록 카드 검색</a></p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("가이드", "guides/"), ("자주 묻는 질문", None)]),
        {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "inLanguage": "ko",
            "mainEntity": [
                {
                    "@type": "Question",
                    "name": q["q"],
                    "acceptedAnswer": {"@type": "Answer", "text": q["a"]},
                }
                for q in faq
            ],
        },
    ]
    return path, page(
        path,
        f"포켓몬 카드 자주 묻는 질문 8가지 — 정가·구성·추첨·미개봉·리셀 | {SITE_NAME}",
        "30th CELEBRATION 정가(1팩 3,500원·1박스 70,000원)와 구성, 편의점 박스 판매, 재고 표시 기준, 포켓몬스토어 추첨 결제 기한, 박스로 피카츄 30종 수집 가능성, 미개봉 구별, 리셀가 판단 기준을 정리했습니다.",
        [("포켓몬카드모아", "../"), ("가이드", "./"), ("자주 묻는 질문", None)],
        body,
        jsonld=ld,
    )


def guides_index_page():
    path = "guides/index.html"
    cards = "".join(
        f'<a class="card-link" href="./{g["slug"]}.html"><span class="t">{e(g["nav"])}</span><span class="s">{e(g["short"])}</span></a>'
        for g in GUIDES
    )
    body = f"""<h1>포켓몬 카드 가이드 — 정가·재고·시세를 판단하는 기준</h1>
<p class="lead">포켓몬카드모아가 정리한 4가지 가이드입니다. 정가로 사는 방법, 편의점 재고 확인법, 시세와 팝수 읽는 법, 자주 묻는 질문을 각각 한 페이지에 담았습니다. 30th CELEBRATION을 기준으로 쓰였지만 다른 확장팩에도 같은 기준을 적용할 수 있습니다.</p>
<div class="cards">{cards}</div>

<h2>먼저 읽을 세 줄</h2>
<ul>
  <li><strong>정가는 1팩 3,500원·1박스 70,000원</strong> — 이 값보다 비싸면 배송비인지 프리미엄인지 확인하세요.</li>
  <li><strong>재고는 앱 조회값</strong> — 없음은 품절, 미조회는 ‘모른다’입니다. 세븐일레븐은 재고를 제공하지 않습니다.</li>
  <li><strong>시세는 체결가</strong> — 슈링크·논슈링크, 판본(한글판·일본판·영문판)을 구분해 비교하세요.</li>
</ul>

<h2>확장팩 도감</h2>
<p>세트별 발매일·정가·수록 카드·시세는 도감에서 볼 수 있습니다.</p>
<p><a class="cta" href="../sets/">확장팩 도감 전체 보기</a><a class="cta ghost" href="../">포켓몬카드모아 홈</a></p>
"""
    ld = [
        breadcrumb_ld(path, [("포켓몬카드모아", "../"), ("가이드", None)]),
        collection_ld(
            path,
            "포켓몬 카드 가이드 — 정가·재고·시세·FAQ",
            "포켓몬 카드 정가 구매처 비교, 편의점 4사 재고·입고 요일 확인법, KREAM 시세와 팝수 읽는 법, 자주 묻는 질문을 한곳에 모은 가이드 목록입니다.",
            [
                {
                    "@type": "ListItem",
                    "position": i,
                    "name": g["nav"],
                    "url": f"{BASE}/guides/{g['slug']}.html",
                }
                for i, g in enumerate(GUIDES, start=1)
            ],
            about_name="포켓몬 카드 구매·시세 가이드",
        ),
    ]
    return path, page(
        path,
        f"포켓몬 카드 가이드 — 정가 구매처·편의점 재고·시세·FAQ | {SITE_NAME}",
        "포켓몬 카드 정가 구매처 비교, 편의점 4사 재고·입고 요일 확인법, KREAM 시세와 PSA·BRG 팝수 읽는 법, 자주 묻는 질문을 한곳에 모은 가이드 목록입니다.",
        [("포켓몬카드모아", "../"), ("가이드", None)],
        body,
        jsonld=ld,
        og_type="website",
    )


# ------------------------------------------------------------------ 빌드
def sitemap(paths):
    fixed = [
        ("", "2026-11-27", "daily", "1.0"),
        ("privacy.html", "2026-11-18", "yearly", "0.3"),
        ("terms.html", "2026-11-18", "yearly", "0.3"),
    ]
    entries = []
    for loc, lm, cf, pr in fixed:
        entries.append((BASE + "/" + loc, lm, cf, pr))
    for p in sorted(paths):
        if p in ("sets/index.html", "guides/index.html"):
            pr = "0.8"
        elif p.startswith("sets/m6a"):
            pr = "0.9"
        else:
            pr = "0.7"
        entries.append((BASE + "/" + p, LAST_MOD, "weekly", pr))
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for loc, lm, cf, pr in entries:
        out.append("  <url>")
        out.append(f"    <loc>{loc}</loc>")
        out.append(f"    <lastmod>{lm}</lastmod>")
        out.append(f"    <changefreq>{cf}</changefreq>")
        out.append(f"    <priority>{pr}</priority>")
        out.append("  </url>")
    out.append("</urlset>")
    return "\n".join(out) + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="파일을 쓰지 않고 결과만 확인")
    args = ap.parse_args()

    pages = {}
    pages.update({p: h for p, h in [sets_index_page(), guides_index_page()]})
    for i, s in enumerate(SETS):
        p, h = set_page(s, i)
        pages[p] = h
    for fn in (guide_price, guide_cvs, guide_market, guide_faq):
        p, h = fn()
        pages[p] = h

    sm = sitemap(pages.keys())

    if args.check:
        for p in sorted(pages):
            print(f"{p:34s} {len(pages[p]):>7d} bytes")
        print(f"sitemap.xml                        {len(sm):>7d} bytes, {sm.count('<url>')} urls")
        return

    for p, t in pages.items():
        dest = ROOT / p
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(t, encoding="utf-8")
    (ROOT / "sitemap.xml").write_text(sm, encoding="utf-8")
    print(f"wrote {len(pages)} pages + sitemap.xml ({sm.count('<url>')} urls)")


if __name__ == "__main__":
    main()
