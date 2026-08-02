#!/usr/bin/env python3
"""生成 App 图标：绯红底 + 白色票根 + 中央镂空四角星。

纯几何绘制，4 倍超采样后缩小，边缘干净。产出：
  icon.png       1024 满幅方图（Windows / 通用）
  icon-mac.png   1024 画布内 824 圆角方（macOS 图标网格）
  icon.icns / icon.ico

用法: python3 make_icon.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent
S = 1024          # 成品边长
SS = 4            # 超采样倍数
N = S * SS

CRIMSON = (228, 43, 64, 255)   # 底色
WHITE = (255, 255, 255, 255)

# —— 比例（相对画布边长）——
TICKET_W, TICKET_H = 0.72, 0.435   # 票根尺寸
TICKET_R = 0.047                   # 票根圆角
NOTCH_R = 0.077                    # 两侧半圆缺口半径
STAR_R = 0.110                     # 星星外接半径（中心到尖）


def draw_star(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, fill) -> None:
    """四角星：四个尖点之间用二次贝塞尔向圆心内凹，控制点落在圆心。"""
    tips = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    pts = []
    for i, p0 in enumerate(tips):
        p2 = tips[(i + 1) % 4]
        for t in [j / 48 for j in range(48)]:      # 采样贝塞尔曲线
            u = 1 - t
            pts.append((
                u * u * p0[0] + 2 * u * t * cx + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * cy + t * t * p2[1],
            ))
    draw.polygon(pts, fill=fill)


def render(mac_grid: bool) -> Image.Image:
    """mac_grid=True 时按 Apple 图标网格：824/1024 的圆角方，四周透明。"""
    img = Image.new("RGBA", (N, N), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if mac_grid:
        body = 824 / 1024 * N                      # 图标本体边长
        off = (N - body) / 2
        d.rounded_rectangle([off, off, off + body, off + body],
                            radius=185.4 / 1024 * N, fill=CRIMSON)
        scale, ox, oy = body / N, off, off         # 图形整体缩到本体内
    else:
        d.rectangle([0, 0, N, N], fill=CRIMSON)
        scale, ox, oy = 1.0, 0.0, 0.0

    def X(v: float) -> float: return ox + v * N * scale
    def L(v: float) -> float: return v * N * scale  # 长度换算

    cx, cy = X(0.5), oy + 0.5 * N * scale
    tw, th = L(TICKET_W), L(TICKET_H)
    x0, y0, x1, y1 = cx - tw / 2, cy - th / 2, cx + tw / 2, cy + th / 2

    d.rounded_rectangle([x0, y0, x1, y1], radius=L(TICKET_R), fill=WHITE)

    # 两侧半圆缺口：用底色圆盖掉票根边缘
    nr = L(NOTCH_R)
    notch = CRIMSON if not mac_grid else CRIMSON
    for ncx in (x0, x1):
        d.ellipse([ncx - nr, cy - nr, ncx + nr, cy + nr], fill=notch)

    draw_star(d, cx, cy, L(STAR_R), notch)

    return img.resize((S, S), Image.LANCZOS)


def main() -> None:
    full = render(mac_grid=False)
    full.save(OUT / "icon.png")

    mac = render(mac_grid=True)
    mac.save(OUT / "icon-mac.png")

    # —— .icns：iconutil 需要一个 .iconset 目录 ——
    iconset = OUT / "icon.iconset"
    iconset.mkdir(exist_ok=True)
    for size in (16, 32, 128, 256, 512):
        mac.resize((size, size), Image.LANCZOS).save(iconset / f"icon_{size}x{size}.png")
        mac.resize((size * 2, size * 2), Image.LANCZOS).save(iconset / f"icon_{size}x{size}@2x.png")

    # —— .ico：满幅方图，多尺寸打包 ——
    full.save(OUT / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    print("生成:", ", ".join(p.name for p in sorted(OUT.glob("icon*")) if p.is_file()))


if __name__ == "__main__":
    main()
