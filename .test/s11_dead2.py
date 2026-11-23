#!/usr/bin/env python3
# 步骤 11：删掉遗留字符串渲染器（被 HOST / 注释「假活」的那批）+ 同步剪掉 HOST 里指向它们的条目
import io, re
p = "go/ui/js/app.js"
s = io.open(p, encoding="utf-8").read()

DEAD = ["clipItemHTML","clipListHTML","clipMetaHTML","clipPrevHTML","clipSheetHTML",
        "clipThumbHTML","folderCountHTML","folderListHTML","folderRows","folderSaveText",
        "folderSheetHTML","renderMine","renderSettings","settingsHTML","shotCountHTML",
        "shotGridHTML","shotSheetHTML","folderSelCount","fileStrip","filesSkeleton",
        "attachCardHTML","statsHeroHTML","statsRunCardHTML","chartHTML","statHTML"]

lines = s.split("\n")
def decl(name):
    hits = [i for i, l in enumerate(lines) if re.match(r"^function\s+" + re.escape(name) + r"\s*\(", l)]
    assert len(hits) <= 1, (name, hits)
    return hits[0] if hits else None
def end(i):
    # 逐字符数括号：整行计数会把「同一行内配平」的函数（function f(){ return x }）判成
    # 「还没开始」，一路吞到下一个函数的结尾，把邻居一起删掉（踩过）。
    depth = 0; started = False
    for j in range(i, len(lines)):
        for ch in lines[j]:
            if ch == "{": depth += 1; started = True
            elif ch == "}": depth -= 1
        if started and depth == 0: return j
    raise AssertionError("unbalanced " + lines[i])
DEAD = [n for n in DEAD if decl(n) is not None]
for n in sorted(DEAD, key=lambda n: -decl(n)):
    i = decl(n); j = end(i); k = i
    while k > 0 and lines[k-1].strip().startswith("//"): k -= 1
    del lines[k:j+1]
s = "\n".join(lines)
for n in DEAD:
    assert not re.search(r"^function " + n + r"\(", s, re.M), n
print("实删", len(DEAD), " ".join(DEAD))

def rep(old, new):
    global s
    assert s.count(old) == 1, "MISS: " + old[:70].replace("\n", "\\n")
    s = s.replace(old, new)

# HOST 里指向已删函数的右值必须一起删：module 求值到那一行就是 ReferenceError（整页白屏）
rep("  statCls: statCls, kvHTML: kvHTML, liHTML: liHTML, chartHTML: chartHTML,",
    "  statCls: statCls, kvHTML: kvHTML, liHTML: liHTML,")
rep("  statsRunRowsHTML: statsRunRowsHTML, statsRunCardHTML: statsRunCardHTML,",
    "  statsRunRowsHTML: statsRunRowsHTML,")

# 注释里指向已删渲染器的说明
rep("""/* 网格的字符串渲染器（步骤 8 抽出）：loadShots() 与 VDIFF 的遗留侧 shotSheetHTML() 共用
   这一份。夹具比的是真代码，不是另拄一遍 —— 另拄一份的写法会在下一次改网格时静默分叉，
   而 VDIFF 依旧绿（它比的是那一份拄件）。 */
""", "")
rep("""/** VDIFF 的遗留侧：一次调用给出「加载完之后 .pbody 里应该长什么样」（同 shotSheetHTML） */
""", "")
rep("""/* VDIFF 的遗留基准（步骤 10）：我的页是 tab，基准就是 renderMine()；设置页是弹层，
   基准是「加载完之后」的正文（壳由 pageSheet 写，所以不拼壳）。两个函数同时进导出表：
   test.sh 的载荷跑在 module 外面，只能经 window.__enoteActions 拿到它们。
   步骤 11 删遗留路径时一起删。 */
""", "")
rep("""/* ---------- 步骤 10：我的页 / 设置页的叶子片段 ----------
   两条渲染路径（遗留字符串 / Vue 模板）共用同一份，VDIFF 才逐字比得过；Vue 侧经 setHost""",
"""/* ---------- 步骤 10：我的页 / 设置页的叶子片段 ----------
   这些片段函数是 Vue 模板的渲染帮手（经 setHost 暴露给组件）；步骤 11 删掉遗留字符串
   渲染器之后它们只剩一个调用者，留着是因为模板里拼 HTML 的写法与它们逐字一致；Vue 侧经 setHost""")

io.open(p, "w", encoding="utf-8").write(s)
print("删完", len(s.split("\n")), "行")
