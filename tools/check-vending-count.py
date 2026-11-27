#!/usr/bin/env python3
"""포켓몬카드모아 — 공식 자판기 수 표기 검사기.

`data.js` 의 `vendingPoints` 배열 길이를 기준값으로 두고, 사이트 안에서
자판기 수를 적은 모든 문구(전국 N곳 · 자판기(N곳) · 공식 목록(N곳) …)와
`pokemoa-preview.html` 에 내장된 배열 길이가 같은지 확인합니다.

    python3 tools/check-vending-count.py          # 저장소 안의 표기만 검사
    python3 tools/check-vending-count.py --online # 포켓몬코리아 공식 목록(현재 178곳)과도 대조

숫자가 어긋나면 파일·줄·문구를 그대로 보여 주고 종료 코드 1 로 끝납니다.
검사 대상은 index.html · assets/config/site-config.json · assets/js/data.js ·
assets/js/map.js · pokemoa-preview.html 입니다(README 는 지난 작업 기록이라 제외).
"""
import argparse
import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OFFICIAL_URL = "https://calendar-1ut.pages.dev/scripts/venderlist.json"

# 자판기 수를 적는 자리들(숫자 한 곳만 캡처). 정규식은 파일 종류와 상관없이 같은 규칙을 씁니다.
COUNT_PATTERNS = [
    r"전국 (\d+)곳 위치 안내",
    r"자판기 안내</a>\((?:전국 )?(\d+)곳\)",
    r"(?:공식 )?자판기\((?:전국 |포켓몬코리아 자판기 안내, |좌표 포함 )?(\d+)곳\)",
    r"공식 목록\((\d+)곳\)",
    r"venderlist\.json, (\d+)곳",
]

TEXT_FILES = [
    "index.html",
    "assets/config/site-config.json",
    "assets/js/data.js",
    "assets/js/map.js",
    "pokemoa-preview.html",
]


def array_names(text, var):
    """`var <var> = [ … ];` 안의 `{ n: "…" }` 이름 목록."""
    start = text.index(f"var {var} = [")
    end = text.index("];", start)
    return re.findall(r'\{ n: "([^"]+)"', text[start:end])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--online", action="store_true", help="포켓몬코리아 공식 목록과도 대조")
    args = ap.parse_args()

    data = (ROOT / "assets/js/data.js").read_text(encoding="utf-8")
    base = array_names(data, "vendingPoints")
    base_n = len(base)
    problems = []

    if len(set(base)) != base_n:
        dup = sorted({n for n in base if base.count(n) > 1})
        problems.append(f"assets/js/data.js: vendingPoints 안에 같은 이름이 겹칩니다 → {dup}")

    for rel in TEXT_FILES:
        path = ROOT / rel
        if not path.exists():
            problems.append(f"{rel}: 파일이 없습니다")
            continue
        text = path.read_text(encoding="utf-8")
        for i, line in enumerate(text.splitlines(), 1):
            for pat in COUNT_PATTERNS:
                for m in re.finditer(pat, line):
                    n = int(m.group(1))
                    if n != base_n:
                        problems.append(f"{rel}:{i}: '{m.group(0)}' → 실제 {base_n}곳과 다름")

    # 단일 파일 미리보기는 데이터도 함께 들고 있으므로 배열 길이까지 맞춘다.
    prev = ROOT / "pokemoa-preview.html"
    if prev.exists():
        pnames = array_names(prev.read_text(encoding="utf-8"), "vendingPoints")
        if pnames != base:
            problems.append(
                f"pokemoa-preview.html: 내장 vendingPoints {len(pnames)}곳 · data.js {base_n}곳(순서·이름 불일치)"
            )

    print(f"기준: data.js vendingPoints {base_n}곳(고유 {len(set(base))}곳)")

    if args.online:
        req = urllib.request.Request(OFFICIAL_URL, headers={"User-Agent": "Mozilla/5.0"})
        try:
            official = json.loads(urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore"))
        except Exception as e:  # noqa: BLE001 - 네트워크 실패는 검사 결과로 알린다
            print(f"공식 목록을 받지 못했습니다: {e!r}")
            return 2
        onames = [o.get("name", "") for o in official]
        print(f"공식 목록(venderlist.json): {len(onames)}곳")
        miss = [n for n in onames if n not in base]
        extra = [n for n in base if n not in onames]
        if len(onames) != base_n:
            problems.append(f"공식 목록 {len(onames)}곳 ≠ data.js {base_n}곳")
        if miss:
            problems.append(f"data.js 에 없는 공식 설치 지점 {len(miss)}곳 → {miss}")
        if extra:
            problems.append(f"공식 목록에 없는 data.js 항목 {len(extra)}곳 → {extra}")

    if problems:
        print("\n불일치:")
        for p in problems:
            print(" -", p)
        return 1
    print("모든 표기가 같습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
