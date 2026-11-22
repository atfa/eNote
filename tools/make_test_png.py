#!/usr/bin/env python3
"""生成 P11 截图用例要的测试图（纯标准库，Termux 没有 PIL）。

以前这段是 `from PIL import Image, ImageDraw`，而这台设备装不上 Pillow：
test.sh 跑到「P11 截图捕获」直接 ModuleNotFoundError，整条验收红在最后一步。
现在只用 zlib + struct 自己写 PNG：底色 + 一个色块 + 一条随机噪点带。

噪点带是必需的，不是装饰：Go 侧按 sha1 去重，图字节完全一样的话第二次跑就
「新增 0 张」，测试会假红（这个坑踩过，原来的 PIL 版本用随机文字达到同样效果）。
断言只看"扫到几张 / 合并成几条 / 幂等 / 忽略"，不读图里的文字，所以不需要字体。

用法: make_test_png.py <out.png> [w] [h]
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from crop_png import write_png  # noqa: E402


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    out = sys.argv[1]
    w = int(sys.argv[2]) if len(sys.argv) > 2 else 360
    h = int(sys.argv[3]) if len(sys.argv) > 3 else 640
    px = bytearray()
    for y in range(h):
        row = bytearray()
        for x in range(w):
            if 20 <= x <= 340 and 20 <= y <= 120:
                row += bytes((47, 107, 255))          # 色块：让两张图肉眼可辨
            elif y >= h - 12:
                row += os.urandom(3)                  # 噪点带：保证每次字节都不同（只 12 行，
                # 整图纯噪点的话 PNG 45KB 不可压缩，OCR 会拖慢下一步 hook）
            else:
                row += bytes((250, 250, 252))
        px += row
    d = os.path.dirname(os.path.abspath(out))
    os.makedirs(d, exist_ok=True)
    write_png(out, w, h, 3, px)
    print(f"wrote {out} {w}x{h}")


if __name__ == "__main__":
    main()
