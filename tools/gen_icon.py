#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成启动器图标（自适应图标，纯矢量 XML）+ PIL 预览图。

图标几何只在这里写一次：同一组数字既画预览 PNG，也吐 vector drawable XML，
所以「看到的」和「装到手机上的」一定一致。

用法：python3 tools/gen_icon.py [预览输出路径]
"""
import os
import sys
import math
import xml.etree.ElementTree as ET

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = 108.0                      # viewport，自适应图标固定 108dp


def sc(v, s=8):
    """dp -> px（默认预览倍率 8）。"""
    return v * s
CX = CY = V / 2.0

# ---- 品牌色（与 go/ui.html 的 --grad 保持一致）----
C_BLUE = "#2f6bff"
C_BLUE_D = "#1e4fd6"
C_TEAL = "#12b5a5"
C_TEAL_L = "#5ee0c0"
C_INK = "#131a24"

# ---- 前景几何：全部落在自适应图标安全区内（中心 66dp 圆，半径 33）----
NOTE = dict(x=36.0, y=32.0, w=36.0, h=44.0, r=8.0, rot=-6)          # 纸片
LINES = [(42.0, 42.0, 24.0), (42.0, 50.0, 17.0), (42.0, 58.0, 20.0)]  # x,y,w
LINE_H = 4.0
# 铅笔：笔杆 + 三角笔尖，整体绕自身中心旋转，笔尖落在纸面上
PEN = dict(x=56.5, y=29.0, w=7.5, body=16.0, tip=8.0, r=2.8, rot=42)
SPARKS = [(71.5, 32.5, 4.4), (33.0, 66.0, 3.4)]    # 四角星（灵感/刚写完）


def rounded_rect(x, y, w, h, r):
    """圆角矩形的 pathData（SVG/VDC 通用语法）。"""
    r = min(r, w / 2, h / 2)
    return (f"M{x+r:.2f},{y:.2f} h{w-2*r:.2f} a{r:.2f},{r:.2f} 0 0 1 {r:.2f},{r:.2f} "
            f"v{h-2*r:.2f} a{r:.2f},{r:.2f} 0 0 1 -{r:.2f},{r:.2f} "
            f"h-{w-2*r:.2f} a{r:.2f},{r:.2f} 0 0 1 -{r:.2f},-{r:.2f} "
            f"v-{h-2*r:.2f} a{r:.2f},{r:.2f} 0 0 1 {r:.2f},-{r:.2f} z")


def pen_path():
    """铅笔：圆角笔杆 + 三角笔尖，返回 (笔杆, 笔尖, 旋转中心)。"""
    p = PEN
    body = rounded_rect(p["x"], p["y"], p["w"], p["body"], p["r"])
    y0 = p["y"] + p["body"] - 0.6          # 与笔杆重叠一点，避免接缝
    tip = (f"M{p['x']:.2f},{y0:.2f} h{p['w']:.2f} "
           f"l-{p['w']/2:.2f},{p['tip']:.2f} z")
    return body, tip, p["x"] + p["w"] / 2, p["y"] + p["body"] / 2


def star_points(cx, cy, r):
    """四角星点集（矢量与预览共用）：4 个外尖 + 4 个内收点，尖角干净。"""
    pts = []
    for i in range(8):
        a = math.pi / 4 * i - math.pi / 2
        rr = r if i % 2 == 0 else r * 0.22
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    return pts


def star_path(cx, cy, r):
    pts = star_points(cx, cy, r)
    return "M" + " L".join(f"{x:.2f},{y:.2f}" for x, y in pts) + " Z"


def circle_path(cx, cy, r):
    return (f"M{cx-r:.2f},{cy:.2f} a{r:.2f},{r:.2f} 0 1 0 {2*r:.2f},0 "
            f"a{r:.2f},{r:.2f} 0 1 0 -{2*r:.2f},0 z")


NS = "http://schemas.android.com/apk/res/android"
AAPT = "http://schemas.android.com/aapt"


def _vec(children):
    # 命名空间前缀必须显式声明：aapt2 编译 drawable 时只看 XML 本身，
    # ElementTree 只声明实际用到的前缀，aapt: 会被省略 → "unbound prefix"
    v = ET.Element("vector", {
        "xmlns:android": NS, "xmlns:aapt": AAPT,
        "android:width": "108dp", "android:height": "108dp",
        "android:viewportWidth": "108", "android:viewportHeight": "108"})
    for c in children:
        v.append(c)
    return v


def _grad(colors, x1, y1, x2, y2):
    """<aapt:attr name="android:fillColor"><gradient .../></aapt:attr>（API 24+）。"""
    attr = ET.Element("aapt:attr", {"name": "android:fillColor"})
    g = ET.SubElement(attr, "gradient", {
        "android:type": "linear",
        "android:startX": f"{x1:.1f}", "android:startY": f"{y1:.1f}",
        "android:endX": f"{x2:.1f}", "android:endY": f"{y2:.1f}"})
    n = len(colors)
    for i, c in enumerate(colors):
        ET.SubElement(g, "item", {"android:offset": f"{i/(n-1):.2f}",
                                  "android:color": c})
    return attr



def write_background():
    """背景层：满幅渐变（自适应图标会裁形状，所以必须铺满 108×108）。"""
    v = _vec([])
    p = ET.SubElement(v, "path", {"android:pathData": f"M0,0 h{V:.0f} v{V:.0f} h-{V:.0f} z"})
    p.append(_grad([C_BLUE, "#2a7bf0", C_TEAL], 8, 4, 100, 104))
    # 左上角一层柔光，避免纯色块看起来像贴纸
    glow = ET.SubElement(v, "path", {
        "android:pathData": circle_path(22, 18, 46),
        "android:fillColor": "#ffffff", "android:fillAlpha": "0.14"})
    glow = ET.SubElement(v, "path", {
        "android:pathData": circle_path(96, 100, 34),
        "android:fillColor": "#0b3a5e", "android:fillAlpha": "0.12"})
    return v


def foreground_paths(white_only=False):
    """前景：纸片 + 三行字 + 一支笔 + 几点星光。monochrome 复用同一套几何。"""
    out = []
    n = NOTE
    out.append(("group", n["rot"], n["x"] + n["w"] / 2, n["y"] + n["h"] / 2,
                [(rounded_rect(n["x"], n["y"], n["w"], n["h"], n["r"]),
                  "#ffffff" if not white_only else "#000000", None)]))
    lines = []
    for (x, y, w) in LINES:
        lines.append((rounded_rect(x, y, w, LINE_H, LINE_H / 2),
                      C_BLUE if not white_only else "#ffffff", None))
    out.append(("group", n["rot"], n["x"] + n["w"] / 2, n["y"] + n["h"] / 2, lines))
    body, tip, px, py = pen_path()
    pen_col = "#ffffff" if white_only else C_TEAL_L
    tip_col = "#ffffff" if white_only else "#1d4ed8"   # 笔尖用墨蓝，白纸上才读得出是笔
    out.append(("group", PEN["rot"], px, py, [
        (body, pen_col, None), (tip, tip_col, None)]))
    sparks = [(star_path(x, y, r), "#ffffff", f"{a:.2f}")
              for (x, y, r), a in zip(SPARKS, (0.95, 0.8))]
    out.append(("group", 0, CX, CY, sparks))
    return out


def write_foreground(white_only=False):
    v = _vec([])
    for kind, rot, px, py, items in foreground_paths(white_only):
        attrs = {}
        if rot:
            attrs["android:rotation"] = f"{rot:.1f}"
            attrs["android:pivotX"] = f"{px:.2f}"
            attrs["android:pivotY"] = f"{py:.2f}"
        g = ET.SubElement(v, "group", attrs)
        for d, color, alpha in items:
            a = {"android:pathData": d, "android:fillColor": color}
            if alpha:
                a["android:fillAlpha"] = alpha
            ET.SubElement(g, "path", a)
    return v


def write_adaptive():
    ai = ET.Element("adaptive-icon", {"xmlns:android": NS})
    ET.SubElement(ai, "background", {"android:drawable": "@drawable/ic_launcher_background"})
    ET.SubElement(ai, "foreground", {"android:drawable": "@drawable/ic_launcher_foreground"})
    ET.SubElement(ai, "monochrome", {"android:drawable": "@drawable/ic_launcher_monochrome"})
    return ai


def save(el, rel):
    p = os.path.join(ROOT, rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    body = ET.tostring(el, encoding="unicode")
    with open(p, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n' + body + "\n")
    print("wrote", rel)


# ---------------------------------------------------------------- 渲染（PIL）
def render(scale):
    """按 scale 画整张图标（背景 + 前景），返回 RGBA。预览和 app 内 logo 共用。"""
    from PIL import Image, ImageDraw
    S = scale
    W = int(sc(V, S))
    img = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top, mid, bot = (0x2F, 0x6B, 0xFF), (0x2A, 0x7B, 0xF0), (0x12, 0xB5, 0xA5)
    for y in range(W):
        t = y / W
        if t < 0.5:
            u = t / 0.5
            c = tuple(int(top[i] + (mid[i] - top[i]) * u) for i in range(3))
        else:
            u = (t - 0.5) / 0.5
            c = tuple(int(mid[i] + (bot[i] - mid[i]) * u) for i in range(3))
        d.line([(0, y), (W, y)], fill=c + (255,))
    for (cx, cy, r, col) in [(22, 18, 46, (255, 255, 255, 36)), (96, 100, 34, (11, 58, 94, 31))]:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(layer).ellipse([sc(cx - r, S), sc(cy - r, S), sc(cx + r, S), sc(cy + r, S)], fill=col)
        img = Image.alpha_composite(img, layer)

    def rrect(box, r, fill, rot=0.0, pivot=None):
        im = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ImageDraw.Draw(im).rounded_rectangle(
            [sc(box[0], S), sc(box[1], S), sc(box[2], S), sc(box[3], S)], sc(r, S), fill=fill)
        if rot:
            im = im.rotate(rot, resample=Image.BICUBIC, center=(sc(pivot[0], S), sc(pivot[1], S)))
        img.paste(im, (0, 0), im)

    n = NOTE
    box = (n["x"], n["y"], n["x"] + n["w"], n["y"] + n["h"])
    piv = (n["x"] + n["w"] / 2, n["y"] + n["h"] / 2)
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle(
        [sc(box[0] + 1.5, S), sc(box[1] + 2.5, S), sc(box[2] + 1.5, S), sc(box[3] + 2.5, S)],
        sc(n["r"], S), fill=(6, 20, 40, 70))
    sh = sh.rotate(n["rot"], resample=Image.BICUBIC, center=(sc(piv[0], S), sc(piv[1], S)))
    img.paste(sh, (0, 0), sh)
    rrect(box, n["r"], (255, 255, 255, 255), n["rot"], piv)
    for (x, y, w) in LINES:
        rrect((x, y, x + w, y + LINE_H), LINE_H / 2, (47, 107, 255, 230), n["rot"], piv)
    p = PEN
    ppiv = (p["x"] + p["w"] / 2, p["y"] + p["body"] / 2)
    rrect((p["x"], p["y"], p["x"] + p["w"], p["y"] + p["body"]), p["r"],
          (94, 224, 192, 255), p["rot"], ppiv)
    tip = Image.new("RGBA", img.size, (0, 0, 0, 0))
    y0 = p["y"] + p["body"] - 0.6
    ImageDraw.Draw(tip).polygon(
        [(sc(p["x"], S), sc(y0, S)), (sc(p["x"] + p["w"], S), sc(y0, S)),
         (sc(p["x"] + p["w"] / 2, S), sc(y0 + p["tip"], S))], fill=(29, 78, 216, 255))
    tip = tip.rotate(p["rot"], resample=Image.BICUBIC, center=(sc(ppiv[0], S), sc(ppiv[1], S)))
    img.paste(tip, (0, 0), tip)
    d = ImageDraw.Draw(img)
    for (x, y, r) in SPARKS:
        d.polygon([(sc(px, S), sc(py, S)) for px, py in star_points(x, y, r)],
                  fill=(255, 255, 255, 240))
    return img


def preview(path_out):
    from PIL import Image, ImageDraw
    img = render(8)
    W = img.width
    strip = Image.new("RGBA", (W * 3 + 48, W + 24), (245, 247, 251, 255))
    mask_c = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask_c).ellipse([0, 0, W - 1, W - 1], fill=255)
    strip.paste(img, (12, 12), mask_c)
    mask_s = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask_s).rounded_rectangle([0, 0, W - 1, W - 1], int(W * 0.22), fill=255)
    strip.paste(img, (W + 24, 12), mask_s)
    strip.paste(img, (W * 2 + 36, 12), img)
    dr = ImageDraw.Draw(strip)
    cx0 = W * 2 + 36
    dr.ellipse([cx0 + sc(54 - 33), sc(54 - 33) + 12, cx0 + sc(54 + 33), sc(54 + 33) + 12],
               outline=(255, 60, 60, 200), width=3)
    strip.save(path_out)
    print("preview:", path_out)


def logo(path_out, size=192):
    """app 内顶栏 logo：同一套几何，CSS 会再圆角。"""
    from PIL import Image
    render(size / V).resize((size, size), Image.LANCZOS).save(path_out)
    print("logo:", path_out)


if __name__ == "__main__":
    save(write_background(), "res/drawable/ic_launcher_background.xml")
    save(write_foreground(), "res/drawable/ic_launcher_foreground.xml")
    save(write_foreground(white_only=True), "res/drawable/ic_launcher_monochrome.xml")
    save(write_adaptive(), "res/mipmap-anydpi-v26/ic_launcher.xml")
    out = sys.argv[1] if len(sys.argv) > 1 else ".test/icon-preview.png"
    preview(os.path.join(ROOT, out))
    logo(os.path.join(ROOT, "go/icon.png"))
