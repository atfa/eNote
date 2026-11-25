#!/usr/bin/env python3
"""步骤 17k：组件里的模块级 H 依赖 → provide/inject。
用法：python3 .test/to_inject.py [--apply]
"""
import re, sys

FILES = [f for f in ["go/ui/js/components.js", "go/ui/js/components/leaf.js", "go/ui/js/components/blocks.js",
         "go/ui/js/shell.js", "go/ui/js/views/clip.js", "go/ui/js/views/files.js",
         "go/ui/js/views/folders.js", "go/ui/js/views/notes.js", "go/ui/js/views/settings.js",
         "go/ui/js/views/sheets.js", "go/ui/js/views/shots.js", "go/ui/js/views/stats.js",
         "go/ui/js/views/todos.js"] if __import__("os").environ.get("ONLY","x") == "x" or __import__("os").environ["ONLY"] in f]

def mask(src):
    """注释与字符串内容替换成空格（位置不变），代码字符保留。"""
    out = list(src); i = 0; n = len(src)
    def blank(a, b):
        for k in range(a, b):
            if out[k] != '\n': out[k] = ' '
    while i < n:
        c = src[i]
        if c == '/' and src[i:i+2] == '//':
            j = src.find('\n', i); j = n if j < 0 else j; blank(i, j); i = j; continue
        if c == '/' and src[i:i+2] == '/*':
            j = src.find('*/', i + 2); j = n if j < 0 else j + 2; blank(i, j); i = j; continue
        if c in '"\'`':
            j = i + 1
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == c: break
                j += 1
            blank(i + 1, min(j, n)); i = min(j, n) + 1; continue
        i += 1
    return ''.join(out)

def match(src, i):
    """i 指向 ( [ { ，返回配对下标（在 src 上扫，字符串/注释已在外层 mask 掉时才可调用）。"""
    pairs = {'{': '}', '(': ')', '[': ']'}
    close = pairs[src[i]]; depth = 0; j = i
    while j < len(src):
        c = src[j]
        if c in '"\'`':
            q = c; j += 1
            while j < len(src):
                if src[j] == '\\': j += 2; continue
                if src[j] == q: break
                j += 1
            j += 1; continue
        if c == '/' and src[j:j+2] == '//':
            k = src.find('\n', j); j = len(src) if k < 0 else k; continue
        if c == '/' and src[j:j+2] == '/*':
            k = src.find('*/', j + 2); j = len(src) if k < 0 else k + 2; continue
        if c in pairs: depth += 1
        elif c in '})]':
            depth -= 1
            if depth == 0:
                assert src[j] == close, (src[i:j+20], src[j])
                return j
        j += 1
    raise SystemExit('unbalanced at %d %r' % (i, src[i:i+40]))

report = []
for f in FILES:
    src = open(f, encoding='utf-8').read()
    m = mask(src)
    inserts = []
    nsetup = 0
    for mm in re.finditer(r'\bsetup\s*\(', m):
        nsetup += 1
        p0 = mm.end() - 1
        p1 = match(m, p0)
        b0 = m.index('{', p1 + 1)
        b1 = match(m, b0)
        body = m[b0:b1+1]
        if re.search(r'\bH\b', body):
            if "inject('H')" in body: report.append(f + '：setup 已有 inject，跳过')
            else: inserts.append(b0)
    for b0 in sorted(inserts, reverse=True):
        tail = src[b0+1:]
        nl = tail.find('\n'); rb = tail.find('}')
        if nl >= 0 and (rb < 0 or nl < rb):
            indent = re.match(r'[ \t]*', tail[nl+1:]).group(0)
            src = src[:b0+1] + '\n' + indent + "const H = inject('H');" + src[b0+1:]
        else:
            src = src[:b0+1] + " const H = inject('H');" + src[b0+1:]
    src2, n1 = re.subn(r"^import \{([^}]*)\} from '(\.\.?/)vue\.js'$",
        lambda a: "import { %s } from '%svue.js'" % (', '.join([x.strip() for x in a.group(1).split(',')
                     if x.strip() and x.strip() != 'H']), a.group(2)),
        src, count=1, flags=re.M)
    src2, n2 = re.subn(r"^const \{([^}]*)\} = Vue$",
        lambda a: 'const { %s } = Vue' % (', '.join([x.strip() for x in a.group(1).split(',')
                     if x.strip()] + ['inject'])),
        src2, count=1, flags=re.M)
    report.append('%-34s setups=%2d 注入=%2d import=%d 解构=%d' % (f, nsetup, len(inserts), n1, n2))
    if '--apply' in sys.argv:
        open(f, 'w', encoding='utf-8').write(src2)
print('\n'.join(report))
