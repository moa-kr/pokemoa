#!/usr/bin/env python3
"""포켓몬카드모아 PWA 아이콘 생성기 (2026-11-25)

브랜드 마크는 index.html 파비콘·헤더 로고와 같은 '벤토 그리드' 4칸입니다
(남색 #101f3c 바탕 + 노랑 #ffcb05 네 칸, 두 칸은 70% 불투명).

    python3 tools/make-pwa-icons.py

결과: assets/img/icons/
  icon-192.png · icon-512.png                (purpose: any — 둥근 모서리)
  icon-maskable-192.png · icon-maskable-512.png  (purpose: maskable — 꽉 찬 바탕)
  apple-touch-icon-180.png                   (iOS 홈 화면 — 꽉 찬 바탕, 투명 없음)
"""
from PIL import Image, ImageDraw

NAVY = (16, 31, 60)        # #101f3c
NAVY_TOP = (26, 44, 82)    # #1a2c52 — 위쪽에 아주 옅은 하이라이트
YELLOW = (255, 203, 5)     # #ffcb05
OUT = "assets/img/icons"

# index.html 파비콘과 같은 좌표계: viewBox 32 안에서 7~25 (18칸) 영역
MARKS = [  # (x, y, w, h, rx, alpha)
    (7.0, 7.0, 7.5, 7.5, 2.2, 1.0),
    (17.5, 7.0, 7.5, 7.5, 2.2, 0.7),
    (7.0, 17.5, 7.5, 7.5, 2.2, 0.7),
    (17.5, 17.5, 7.5, 7.5, 2.2, 1.0),
]
MARK_CENTER = 16.0
MARK_SPAN = 18.0           # 7 → 25


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (1, size), bottom)
    px = img.load()
    for y in range(size):
        t = y / max(size - 1, 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size))


def draw_marks(img, size, span_ratio):
    """span_ratio: 마크 4칸이 차지하는 폭(화면 대비)."""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    s = size * span_ratio / MARK_SPAN
    off = size / 2 - MARK_CENTER * s
    for x, y, w, h, rx, a in MARKS:
        fill = (
            round(NAVY[0] + (YELLOW[0] - NAVY[0]) * a),
            round(NAVY[1] + (YELLOW[1] - NAVY[1]) * a),
            round(NAVY[2] + (YELLOW[2] - NAVY[2]) * a),
            255,
        )
        d.rounded_rectangle(
            [off + x * s, off + y * s, off + (x + w) * s, off + (y + h) * s],
            radius=rx * s,
            fill=fill,
        )
    return layer


def round_corners(img, radius_ratio=0.225):
    size = img.size[0]
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, size - 1, size - 1], radius=round(size * radius_ratio), fill=255
    )
    out = img.copy()
    out.putalpha(mask)
    return out


def make(size, maskable=False, span=0.66):
    bg = vertical_gradient(size, NAVY_TOP, NAVY).convert("RGBA")
    bg.alpha_composite(draw_marks(bg, size, span))
    return bg if maskable else round_corners(bg)


def main():
    import os
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("icon-192.png", make(192, False, 0.66)),
        ("icon-512.png", make(512, False, 0.66)),
        ("icon-maskable-192.png", make(192, True, 0.50)),
        ("icon-maskable-512.png", make(512, True, 0.50)),
        ("apple-touch-icon-180.png", make(180, True, 0.62)),
    ]
    for name, img in jobs:
        path = os.path.join(OUT, name)
        img.save(path, "PNG", optimize=True)
        print(path, img.size)


if __name__ == "__main__":
    main()
