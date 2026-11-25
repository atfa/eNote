#!/usr/bin/env python3
"""步骤 17l：删掉 tick prop 管道（17h 之后它没人读了）。
用法：python3 .test/drop_tick.py [--apply]
"""
import re, sys, glob, os

FILES = sorted(glob.glob("go/ui/js/*.js") + glob.glob("go/ui/js/views/*.js") + glob.glob("go/ui/js/components/*.js"))
FILES = [f for f in FILES if not f.endswith("vue.js")]
rep = []
for f in FILES:
    src = open(f, encoding="utf-8").read()
    o = src
    n = {}
    # 1) 模板里的 :tick="tick"
    src, n['tpl'] = re.subn(r' ?:tick="tick"', '', src)
    # 2) props 数组里的 'tick'
    src, n['props'] = re.subn(r"^(\s*)props: \['tick', ([^\]]*)\],\n", r"\1props: [\2],\n", src, flags=re.M)
    src, n['propsOnly'] = re.subn(r"^\s*props: \['tick'\],\n", '', src, flags=re.M)
    # 3) setup 返回里的 tick
    src, n['retLine'] = re.subn(r"^\s*tick: computed\(\(\) => V\.tick\),\n", '', src, flags=re.M)
    src, n['retInline'] = re.subn(r", tick: computed\(\(\) => V\.tick\) \}", ' }', src)
    src, n['const'] = re.subn(r"^\s*const tick = computed\(\(\) => V\.tick\);\n", '', src, flags=re.M)
    src, n['bare'] = re.subn(r"^(\s*)tick, ([A-Za-z])", r"\1\2", src, flags=re.M)
    src, n['bare2'] = re.subn(r"^(\s*)tick,\n", '', src, flags=re.M)
    src, n['bare3'] = re.subn(r"return \{ H, tick, ", 'return { H, ', src)
    # 4) 文件里不再读 V.tick → import 去掉 V
    code = re.sub(r'/\*[^*]*\*+(?:[^/*][^*]*\*+)*/|//[^\n]*', '', src)
    if not re.search(r'\bV\.tick', code):
        src, n['imp'] = re.subn(r"^import \{ V, ([^}]*)\} from ('\.?\.?/vue\.js')", r"import { \1} from \2", src, flags=re.M)
    else:
        n['imp'] = (src, 0)[1]
    tot = sum(v for v in n.values() if isinstance(v, int))
    rep.append('%-32s tpl=%2d props=%2d ret=%d/%d const=%d bare=%d/%d/%d import=%d' % (
        f, n['tpl'], n['props'], n['retLine'], n['retInline'], n['const'],
        n['bare'], n['bare2'], n['bare3'], n['imp']))
    if '--apply' in sys.argv and src != o:
        open(f, 'w', encoding='utf-8').write(src)
print('\n'.join(rep))
