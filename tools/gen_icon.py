#!/usr/bin/env python3
"""Draw the 懒得记 launcher icon: a minimal geometric harp on the app's blue->green gradient.

Everything is drawn at 4x and downscaled (Lanczos) so the curves stay smooth at 48px.
Outputs legacy mipmaps, adaptive-icon layers (background + foreground), round icons and
docs/icon-master.png.  Run:  python3 tools/gen_icon.py
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MASTER = 1024
SS = 4                      # supersampling factor
TOP = (47, 107, 255)        # --acc   #2f6bff
BOTTOM = (15, 174, 136)     # --acc2  #0fae88
DENS = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
# the adaptive foreground keeps its art inside the middle 66% (66dp of a 108dp canvas)
SAFE = 0.66


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def gradient(size, top=TOP, bottom=BOTTOM):
    """Diagonal (top-left -> bottom-right) linear gradient."""
    img = Image.new("RGB", (size, size), top)
    d = ImageDraw.Draw(img)
    for y in range(size):
        d.line([(0, y), (size, y)], fill=lerp(top, bottom, y / max(1, size - 1)))
    # a touch of the second hue in from the right so it reads as a gradient, not a stripe
    overlay = Image.new("RGBA", (size, size))
    od = ImageDraw.Draw(overlay)
    for x in range(size):
        od.line([(x, 0), (x, size)], fill=(*lerp(top, bottom, x / max(1, size - 1)), 90))
    return Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")


def bezier(p0, p1, p2, n):
    """Quadratic bezier points, p1 is the control point."""
    out = []
    for i in range(n + 1):
        t = i / n
        x = (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t ** 2 * p2[0]
        y = (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t ** 2 * p2[1]
        out.append((x, y))
    return out


def seg(d, a, b, w, col):
    d.line([a, b], fill=col, width=w)
    for p in (a, b):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=col)


def harp(size, white=(255, 255, 255, 255), strings=7, frame=0.046, string_w=0.0075):
    """The harp on a transparent layer: pillar, neck, soundbox, strings.

    Drawn in a centred box of `size` px; the box is what must fit the launcher safe zone.
    `strings` / `frame` / `string_w` are tuned per output size: at 48px seven hairlines
    blur into a grey mass, so the small icons get fewer, thicker strings.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    s = size
    w = max(2, int(s * frame))       # frame thickness
    sw = max(1, int(s * string_w))   # string thickness

    # frame corners (normalised, y down)
    pillar_top = (0.13 * s, 0.13 * s)
    pillar_bot = (0.13 * s, 0.90 * s)
    neck_end = (0.90 * s, 0.55 * s)
    neck_ctl = (0.60 * s, 0.02 * s)

    # soundbox: the diagonal from the foot of the pillar to the end of the neck
    seg(d, pillar_bot, neck_end, w, white)
    # pillar: the vertical front column
    seg(d, pillar_top, pillar_bot, w, white)
    # neck: the sweeping curve, drawn as a thick polyline
    neck = bezier(pillar_top, neck_ctl, neck_end, 120)
    d.line(neck, fill=white, width=w, joint="curve")
    for p in (neck[0], neck[-1]):
        d.ellipse([p[0] - w / 2, p[1] - w / 2, p[0] + w / 2, p[1] + w / 2], fill=white)

    # strings: vertical lines from the neck down to the soundbox
    def on_neck(t):
        x, y = neck[int(t * 120)]
        return x, y

    def on_box(x):
        # y of the soundbox line at a given x
        t = (x - pillar_bot[0]) / max(1.0, neck_end[0] - pillar_bot[0])
        t = min(1.0, max(0.0, t))
        return pillar_bot[1] + (neck_end[1] - pillar_bot[1]) * t

    step = 0.74 / max(1, strings - 1)
    for i in range(strings):
        t = 0.13 + i * step
        x, y = on_neck(t)
        yb = on_box(x)
        if yb - y < s * 0.06:
            continue
        d.line([(x, y + w * 0.55), (x, yb - w * 0.55)], fill=white, width=sw)
    return img


def rounded(im, radius):
    """Mask an image into a squircle-ish rounded square."""
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, im.size[0] - 1, im.size[1] - 1],
                                           radius=radius, fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def circle(im):
    mask = Image.new("L", im.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, im.size[0] - 1, im.size[1] - 1], fill=255)
    out = im.convert("RGBA")
    out.putalpha(mask)
    return out


def make_icon(px, strings=7, frame=0.046, string_w=0.0075, art=None, bg=None):
    """One launcher icon at `px`, drawn at 4x and downscaled."""
    big = px * SS
    bg = bg if bg is not None else gradient(big)
    art = art if art is not None else harp(big, strings=strings, frame=frame,
                                           string_w=string_w)
    icon = bg.convert("RGBA")
    icon.alpha_composite(art)
    return rounded(icon, int(big * 0.215)).resize((px, px), Image.LANCZOS)


# the smaller the icon, the fewer and thicker the strings, or they blur into a mass
LEGACY = {48: (3, 0.075, 0.026), 72: (4, 0.062, 0.019), 96: (5, 0.055, 0.015),
          144: (6, 0.050, 0.011), 192: (7, 0.046, 0.008)}


def main():
    big = MASTER * SS
    bg = gradient(big)
    master = make_icon(MASTER, art=harp(big), bg=bg)
    os.makedirs(os.path.join(ROOT, "docs"), exist_ok=True)
    master.save(os.path.join(ROOT, "docs", "icon-master.png"))

    # adaptive layers: full-bleed background, art scaled into the 66% safe zone. The
    # launcher masks the 108dp canvas down to ~66%, so the art lands on 48-72 real px.
    bg_master = bg.resize((MASTER, MASTER), Image.LANCZOS)
    fg_art = harp(MASTER, strings=5, frame=0.052, string_w=0.011)
    fg_master = Image.new("RGBA", (MASTER, MASTER), (0, 0, 0, 0))
    inner = int(MASTER * SAFE)
    fg_master.alpha_composite(fg_art.resize((inner, inner), Image.LANCZOS),
                              ((MASTER - inner) // 2, (MASTER - inner) // 2))

    for d, px in DENS.items():
        out = os.path.join(ROOT, "res", "mipmap-" + d)
        os.makedirs(out, exist_ok=True)
        s, fr, sw = LEGACY.get(px, (7, 0.046, 0.008))
        im = make_icon(px, strings=s, frame=fr, string_w=sw)
        im.save(os.path.join(out, "ic_launcher.png"))
        circle(im).save(os.path.join(out, "ic_launcher_round.png"))
    for d, px in ADAPTIVE.items():
        out = os.path.join(ROOT, "res", "mipmap-" + d)
        os.makedirs(out, exist_ok=True)
        bg_master.resize((px, px), Image.LANCZOS).save(
            os.path.join(out, "ic_launcher_background.png"))
        fg_master.resize((px, px), Image.LANCZOS).save(
            os.path.join(out, "ic_launcher_foreground.png"))

    # a contact sheet so the small sizes can be eyeballed in one screenshot
    sheet = Image.new("RGBA", (6 * 200, 200), (245, 247, 251, 255))
    x = 8
    for px in (192, 108, 72, 48, 32):
        s, fr, sw = LEGACY.get(px, (5, 0.055, 0.015))
        im = make_icon(px, strings=s, frame=fr, string_w=sw)
        sheet.alpha_composite(im, (x, (200 - px) // 2))
        x += 200
    sheet.save(os.path.join(ROOT, "docs", "icon-sizes.png"))
    print("wrote docs/icon-master.png, docs/icon-sizes.png, res/mipmap-*/ic_launcher*.png")


if __name__ == "__main__":
    main()
