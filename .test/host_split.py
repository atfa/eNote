#!/usr/bin/env python3
# 步骤 17m 调研：算出每个 app 根（4 视图 + 10 弹层 + 外壳）的组件闭包，
# 以及这个闭包里读到的全部 H.xxx —— 这就是那一个 app 的 provider 需要的 key 集合。
import re, glob, json, sys, collections

FILES = sorted(glob.glob('go/ui/js/*.js') + glob.glob('go/ui/js/views/*.js')
               + glob.glob('go/ui/js/components/*.js'))

def strip_comments(t):
    t = re.sub(r'/\*.*?\*/', '', t, flags=re.S)
    t = re.sub(r'(?m)^\s*//.*$', '', t)
    return t

defs = {}          # Name -> set(H.xxx)
children = {}      # Name -> set(child component names)
where = {}
for f in FILES:
    src = open(f, encoding='utf-8').read()
    for chunk in re.split(r'\n(?=export const )', src):
        m = re.match(r'export const (\w+)', chunk)
        if not m:
            continue
        name = m.group(1)
        defs[name] = set(re.findall(r'\bH\.(\w+)', strip_comments(chunk)))
        cm = re.search(r'components:\s*\{([^}]*)\}', chunk)
        kids = set()
        if cm:
            kids = {k.strip() for k in re.split(r'[,;\s]+', cm.group(1)) if re.match(r'^[A-Z]\w*$', k.strip())}
        children[name] = kids
        where[name] = f

ROOTS = {
  'view:notes': 'NotesView', 'view:todos': 'TodosView', 'view:files': 'FilesView',
  'view:mine': 'StatsView',
  'sheet:shots': 'ShotsView', 'sheet:folders': 'FoldersView', 'sheet:clip': 'ClipSheetView',
  'sheet:settings': 'SettingsSheetView', 'sheet:sort': 'SortSheetView',
  'sheet:missed': 'MissedSheetView', 'sheet:add': 'AddSheetView',
  'sheet:addtodo': 'AddTodoSheetView', 'sheet:log': 'LogSheetView', 'sheet:debug': 'DebugSheetView',
}

def closure(root):
    seen, stack = set(), [root]
    while stack:
        n = stack.pop()
        if n in seen:
            continue
        seen.add(n)
        stack.extend(children.get(n, ()))
    return seen

out = {}
for app, root in ROOTS.items():
    if root not in defs:
        print('!! 根组件没找到:', app, root); continue
    cl = closure(root)
    keys = set()
    for n in cl:
        keys |= defs.get(n, set())
    out[app] = sorted(keys)
    print(f"{app:16} 组件 {len(cl):2}  keys {len(keys):3}  {sorted(cl)}")

allk = set()
for v in out.values():
    allk |= set(v)
print('\n全部 app 用到的 key 去重:', len(allk))
json.dump(out, open('.test/host_keys.json', 'w'), ensure_ascii=False, indent=1)

# 共享度：一个 key 被多少个 app 用到
cnt = collections.Counter()
for app, ks in out.items():
    for k in ks:
        cnt[k] += 1
print('被 >=8 个 app 共享的 key（这些进 SHARED）:')
print(sorted(k for k, c in cnt.items() if c >= 8))
print('只被 1 个 app 用的 key 数:', sum(1 for k, c in cnt.items() if c == 1))

# ---- --emit：打印 app.js 里那张 HOST_KEYS 表的 JS 文本 ----
SHELL = {'shell:topbar': 'TopBar', 'shell:tabbar': 'TabBar', 'shell:sheetRoot': 'SheetHost',
         'shell:dlgRoot': 'DialogHost', 'shell:toastRoot': 'ToastHost'}
if '--emit' in sys.argv:
    ROOTS.update(SHELL)
    lines = []
    for app, root in ROOTS.items():
        keys = sorted(set().union(*[defs.get(n, set()) for n in closure(root)]) if closure(root) else [])
        lines.append((app, root, keys))
    for app, root, keys in lines:
        q = ', '.join("'%s'" % k for k in keys)
        # 每行最多 ~92 列，超了折行
        out, cur = [], '  ' + repr(app).replace('"', "'") + ': ['
        for part in re.findall(r"'[^']+'", q) or []:
            if len(cur) + len(part) + 2 > 100:
                out.append(cur); cur = '    '
            cur += part + ', '
        cur = cur.rstrip(', ')
        out.append(cur + '],')
        print('/* %-14s 组件根 %s，%d 个 key */' % (app, root, len(keys)))
        print('\n'.join(out))
