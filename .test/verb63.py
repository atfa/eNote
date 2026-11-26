import subprocess, re, collections, sys

def lines_of(path, src, names):
    L = src.split('\n')
    out, d, keep = [], 0, False
    for l in L:
        sig = any(re.search(r'\b'+n+r'\b', l) and ('{' in l or 'class' in l) for n in names)
        if not keep and sig and d in (0,1,2):
            keep = True
        if keep:
            out.append(l)
        d += l.count('{') - l.count('}')
        if keep and d <= 0 and '{' in ''.join(out):
            keep = False; d = 0
    return out

def eff(ls):
    r=[]
    for l in ls:
        t=l.strip()
        if not t or t.startswith('//') or t.startswith('*') or t.startswith('/*'): continue
        r.append(re.sub(r'\s+',' ',t))
    return r

f=sys.argv[1]; old_names=sys.argv[2].split(','); new_names=sys.argv[3].split(',')
old=subprocess.run(['git','show','HEAD:'+f],capture_output=True,text=True).stdout
new=open(f,encoding='utf-8').read()
def grab(src, names):
    L=src.split('\n'); res=[]; d=0; i=0
    while i<len(L):
        l=L[i]
        d+=l.count('{')-l.count('}')
        for n in names:
            if (re.search(r'\b'+re.escape(n)+r'\s*\(', l) or re.search(r'\bclass\s+'+re.escape(n)+r'\b', l)) and not l.strip().startswith('//'):
                st=i; dd=0; started=False
                for k in range(i,len(L)):
                    if not started and '{' not in L[k]: continue
                    started=True
                    dd+=L[k].count('{')-L[k].count('}')
                    if dd<=0:
                        res+=L[st:k+1]; i=k; break
                break
        i+=1
    return res
RW=[(x.split('=>')[0].strip(), x.split('=>')[1].strip()) for x in sys.argv[4:]]
def rw(ls):
    out=[]
    for x in ls:
        for a,b in RW:
            x=re.sub(r'(?<![\w.])'+re.escape(a), b, x)
        out.append(x)
    return out
o=collections.Counter(eff(grab(old, old_names)))
n=collections.Counter(rw(eff(grab(new, new_names))))
print('%s 原 %d 有效行 → 新 %d 有效行' % (f, sum(o.values()), sum(n.values())))
miss=sorted((o-n).elements())
extra=sorted((n-o).elements())
print('--- 原句没找到（%d 行）' % len(miss))
for x in miss: print('  -', x[:150])
print('--- 新句无原句对应（%d 行）' % len(extra))
for x in extra: print('  +', x[:150])
