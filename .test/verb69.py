import subprocess, re, collections, sys

def method_span(L, i, name):
    """从 L[i] 开始找名字的声明：签名结束于第一个 `{`（参数括号归零时）；
    若在 `{` 之前遇到 `;`（openp==0）→ 调用点，返回 -1。返回签名结束行或 -1。"""
    l = L[i]
    m = re.search(r'\b' + re.escape(name) + r'\s*\(', l)
    if not m or l.strip().startswith(('//', '*', '/*')):
        return -2
    openp = 0; j = i
    while j < len(L):
        seg = L[j][m.end():] if j == i else L[j]
        for ch in seg:
            if ch == '(':
                openp += 1
            elif ch == ')':
                openp = max(0, openp - 1)
            elif ch == '{':
                if openp == 0:
                    return j
            elif ch == ';' and openp == 0:
                return -1
        m = None
        j += 1
    return -2

def grab(src, name):
    L = src.split('\n')
    for i, l in enumerate(L):
        if l.strip().startswith(('//', '*', '/*')): continue
        if not re.search(r'\b' + re.escape(name) + r'\s*\(', l): continue
        if not re.search(r'[A-Za-z_][\w.<>\[\]]*\s+' + re.escape(name) + r'\s*\(', l): continue
        if re.search(r'=\s*' + re.escape(name) + r'\s*\(', l): continue   # 赋值调用
        j = method_span(L, i, name)
        if j is None or j < i: continue
        # 签名结束行之后的 `{` 属于同一行：本行已含 `{`
        d = 0; started = False
        for k in range(j, len(L)):
            d += L[k].count('{') - L[k].count('}')
            if '{' in L[k]: started = True
            if started and d <= 0:
                return L[i:k + 1]
    return []

def eff(ls):
    out = []
    for l in ls:
        t = l.strip()
        if not t or t.startswith(('//', '*', '/*')): continue
        out.append(re.sub(r'\s+', ' ', t))
    return out

def rw(ls, pairs):
    out = []
    for x in ls:
        for a, b in pairs:
            x = re.sub(r'(?<![\w.])' + re.escape(a), b, x)
        out.append(x)
    return out

f, old_names, new_names = sys.argv[1], sys.argv[2].split(','), sys.argv[3].split(',')
pairs = [(x.split('=>')[0].strip(), x.split('=>')[1].strip()) for x in sys.argv[4:]]
old = subprocess.run(['git', 'show', 'HEAD:' + f], capture_output=True, text=True).stdout
new = open(f, encoding='utf-8').read()
o = collections.Counter(rw(eff(grab(old, old_names[0])), pairs))
n = collections.Counter(rw(sum((eff(grab(new, x)) for x in new_names), []), pairs))
miss = sorted((o - n).elements()); extra = sorted((n - o).elements())
print('%s %s 原 %d 有效行 → 新 %d 有效行；旧句缺失 %d；新句多余 %d' % (
    f.rsplit('/', 1)[-1], '+'.join(new_names), sum(o.values()), sum(n.values()), len(miss), len(extra)))
for x in miss: print('   -', x[:120])
for x in extra: print('   +', x[:120])