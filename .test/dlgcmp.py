import sys, re
# 用法: python3 .test/dlgcmp.py <基准文件> <新文件>
# 输入是 probe 的 PROBEDLG 输出（标签|选择器 + 缩进的 key=value 行）
KEYS = ("display position top left right bottom width height zIndex opacity transform "
        "borderRadius borderTopLeftRadius borderTopWidth borderTopColor boxShadow fontSize "
        "fontWeight color backgroundColor padding paddingTop paddingLeft lineHeight textAlign "
        "whiteSpace wordBreak overflow margin marginTop textOverflow").split()

def load(p):
    out = {}
    cur = None
    for ln in open(p, encoding='utf-8', errors='replace'):
        ln = ln.rstrip('\n')
        m = re.search(r'PROBEDLG (.*)$', ln)
        if m: ln = m.group(1)
        if not ln.strip(): continue
        if not ln.startswith(' ') and '|' in ln:
            cur = ln.split('|')[0].strip(); out[cur] = {}
        elif cur and '=' in ln:
            k, v = ln.strip().split('=', 1); out[cur][k] = v
    return out

def norm(v):
    v = v.replace('rgb(0, 0, 0, 0)', 'transparent').replace('rgba(0, 0, 0, 0)', 'transparent')
    v = v.replace('start', 'left').replace('normal', '400')
    return ' '.join(v.split())

base, new = load(sys.argv[1]), load(sys.argv[2])
for k in base:
    if k not in new:
        print('MISS ' + k); continue
    diffs = [(kk, base[k][kk], new[k].get(kk, '<无>')) for kk in KEYS
             if kk in base[k] and kk in new[k] and norm(base[k][kk]) != norm(new[k][kk])]
    print(('ok   ' if not diffs else 'DIFF ') + k + ('' if not diffs else ' :: ' + ' ; '.join('%s:%s→%s' % d for d in diffs)))
