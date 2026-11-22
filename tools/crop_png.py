#!/usr/bin/env python3
"""纯标准库的 PNG 裁剪（Termux 上没有 PIL，也没有 ImageMagick）。

用途：从 `docs/shots/` 的截图里裁出 OCR 用例要的 `.test/ocr-test.png`。
以前那张图是某台机器上手工放的文件，没进 git，新设备 / 新 worktree 上
`./test.sh` 直接 die 在开头，1000 行验收一行都跑不到。现在 fixture 进仓库，
要重造就 `./tools/crop_png.py docs/shots/xxx.png .test/ocr-test.png x y w h`。

只支持 8bit、非隔行的 RGB/RGBA PNG（`vd.sh shot` 和 `adb screencap` 出来的就是这种）。
"""
import struct
import sys
import zlib


def read_png(path):
    d = open(path, "rb").read()
    if d[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path}: 不是 PNG")
    pos = 8
    idat = b""
    w = h = bd = ct = None
    while pos < len(d):
        ln, typ = struct.unpack(">I4s", d[pos:pos + 8])
        data = d[pos + 8:pos + 8 + ln]
        if typ == b"IHDR":
            w, h, bd, ct, comp, filt, inter = struct.unpack(">IIBBBBB", data[:13])
            if bd != 8 or inter != 0:
                raise SystemExit(f"{path}: 只支持 8bit 非隔行，实际 bit={bd} interlace={inter}")
        elif typ == b"IDAT":
            idat += data
        elif typ == b"IEND":
            break
        pos += 12 + ln
    chan = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw = zlib.decompress(idat)
    stride = w * chan
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        if f == 1:
            for i in range(chan, stride):
                line[i] = (line[i] + line[i - chan]) & 255
        elif f == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif f == 3:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 255
        elif f == 4:
            for i in range(stride):
                a = line[i - chan] if i >= chan else 0
                b = prev[i]
                c = prev[i - chan] if i >= chan else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        else:
            raise SystemExit(f"{path}: 不支持的 filter {f}")
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, chan, out


def write_png(path, w, h, chan, px):
    stride = w * chan
    raw = b"".join(b"\x00" + bytes(px[y * stride:(y + 1) * stride]) for y in range(h))
    ct = {1: 0, 2: 4, 3: 2, 4: 6}[chan]

    def chunk(typ, data):
        return (struct.pack(">I", len(data)) + typ + data
                + struct.pack(">I", zlib.crc32(typ + data) & 0xffffffff))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, ct, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    open(path, "wb").write(png)


def main():
    if len(sys.argv) != 7:
        raise SystemExit("用法: crop_png.py <in.png> <out.png> <x> <y> <w> <h>")
    src, dst = sys.argv[1], sys.argv[2]
    x, y, cw, ch = map(int, sys.argv[3:7])
    w, h, chan, px = read_png(src)
    if x < 0 or y < 0 or x + cw > w or y + ch > h:
        raise SystemExit(f"裁剪框越界：图是 {w}x{h}，要 {x},{y} {cw}x{ch}")
    out = bytearray(cw * ch * chan)
    stride = w * chan
    for row in range(ch):
        s = (y + row) * stride + x * chan
        out[row * cw * chan:(row + 1) * cw * chan] = px[s:s + cw * chan]
    write_png(dst, cw, ch, chan, out)
    print(f"wrote {dst} {cw}x{ch} from {src} @ {x},{y}")


if __name__ == "__main__":
    main()
