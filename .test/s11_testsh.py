#!/usr/bin/env python3
# 步骤 11：test.sh 删掉 VDIFF（逐字一致对比）+ 合并两个 node 闸门步骤
import io, re
p = "test.sh"
s = io.open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    assert s.count(old) == 1, "MISS %d: %s" % (s.count(old), old[:90].replace("\n", "\\n"))
    s = s.replace(old, new)
def droplines(start, end_marker):
    """删掉从 start 行到 end_marker 行（含）之间的整段"""
    global s
    i = s.index(start)
    j = s.index(end_marker, i) + len(end_marker)
    return s[:i] + s[j:]

# ---------- 1) 两个 node 闸门合并成一步 ----------
rep('''step "ui: 轮询只在数据变化时重绘（不闪）"
if command -v node >/dev/null 2>&1; then
  node "$HERE/tools/ui_sig_test.js" | sed 's/^/  /' || fail "轮询指纹回归失败"
else
  say "  跳过（没有 node）"
fi

step "ui: 静态闸门（内联 handler 存在性 / 调色板一致性 / hex·px 棘轮）"
# P12 那类「点了没反应」在真机上测不出来：onclick 里调一个不存在的函数，页面不报错、
# 端到端全绿。只能静态抓，所以放在这里，跟 ui_sig_test.js 一样是必跑项。
if command -v node >/dev/null 2>&1; then
  node "$HERE/tools/ui_test.js" | sed 's/^/  /' || fail "界面静态闸门失败"
else
  say "  跳过（没有 node）"
fi''',
'''step "ui: 静态闸门（轮询指纹 / 内联 handler 存在性 / 调色板一致性 / hex·px 棘轮）"
# P12 那类「点了没反应」在真机上测不出来：onclick 里调一个不存在的函数，页面不报错、
# 端到端全绿。只能静态抓，所以放在这里，是必跑项。
# 步骤 11：原来分两步跑 ui_sig_test.js（轮询指纹）与 ui_test.js（结构闸门）。步骤 11 把
# 签名那 84 项并进 ui_test.js（它要读的源码文件与结构闸门完全一样），两步合成一步。
if command -v node >/dev/null 2>&1; then
  node "$HERE/tools/ui_test.js" | sed 's/^/  /' || fail "界面静态闸门失败"
else
  say "  跳过（没有 node）"
fi''')

# ---------- 2) 删掉 VDIFF 整段（两个 step + 两个函数 + 全部调用）----------
i = s.index('step "Vue 产出的 DOM 与字符串渲染器逐字一致（迁移期硬验收）"')
j = s.index('''asroot_global "rm -f '$VDS_EXT/vds-a.png' '$VDS_EXT/vds-b.png'"''', i)
j = s.index("\n", j) + 1
s = s[:i] + '''# 步骤 11：VDIFF（Vue DOM 与遗留字符串渲染器逐字一致，迁移期硬验收）整段删除。
# 它比的是「Vue 产出的 DOM」对「遗留字符串渲染器产出的 HTML」；步骤 10 之后四个 tab +
# 四个弹层全走 Vue，遗留渲染器只剩没人调用的死代码，步骤 11 把它们整批删了，这个命题
# 就没有对象了。删掉之后 Vue 的 DOM 契约由这些用例守着：各页交互用例（真点击 + 真 DOM
# 断言）、tools/ui_test.js 闸门⑮（模板里的 class/id 与 CSS 逐字对）、以及 shots 截图对比。
# 截图页交互夹具要用的暂存目录（原来定义在 VDIFF 段里）。
VDS_EXT="/data/user/0/$APP_PACKAGE/files/enote/inbox"
''' + s[j:]

# ---------- 3) 剪贴板夹具：step 头去掉「与遗留渲染逐字一致」----------
rep('# ---- 步骤 9：剪贴板暂存页（clipSheet）的 VDIFF + 真点击交互 ----',
    '# ---- 步骤 9：剪贴板暂存页（clipSheet）的夹具 + 真点击交互 ----')
rep('step "剪贴板页 Vue 与遗留渲染逐字一致（有内容 / 空态）"\n', '')
rep('for t in "VDIFF 甲 $CLIPFIX" "VDIFF 乙 $CLIPFIX" "VDIFF 丙 $CLIPFIX"; do',
    'for t in "夹具甲 $CLIPFIX" "夹具乙 $CLIPFIX" "夹具丙 $CLIPFIX"; do')
rep('''print("  ok (剪贴板夹具 %d 条)" % len(clips))
' || fail "造剪贴板暂存夹具失败（剪贴板页网格那一遍没条目可比）"
vdiff_sheet clip grid
# 步骤 10：设置页（弹层）。它是唯一带表单的弹层，六个输入框的 value 属性、三个主题
# 按钮的 class、两个开关的 .on 都是字符串路径与 Vue 最容易漂移的地方（:value 写 DOM
# property 时序列化出来根本没有 value 属性，:value.attr 才有）。
vdiff_sheet settings form
''',
'''print("  ok (剪贴板夹具 %d 条)" % len(clips))
' || fail "造剪贴板暂存夹具失败（剪贴板页交互用例没条目可点）"
''')
rep('''# 删光之后的空态那一遍：先把系统剪贴板清成空白（Go 侧 TrimSpace 后为空 → clipAdd 直接
# 拒），否则前台轮询会立刻把剪贴板上那条旧文本重新暂存，空态那一遍比的是 1 条列表。
am_start "$ACTIVITY" "--es hook clipset --es arg ' '" >/dev/null 2>&1 || true
sleep 2
api_post clip/clear '' >/dev/null 2>&1 || true
vdiff_sheet clip empty
''',
'''# 删光之后的空态：先把系统剪贴板清成空白（Go 侧 TrimSpace 后为空 → clipAdd 直接拒），
# 否则前台轮询会立刻把剪贴板上那条旧文本重新暂存，空态那一遍比的是 1 条列表。
am_start "$ACTIVITY" "--es hook clipset --es arg ' '" >/dev/null 2>&1 || true
sleep 2
api_post clip/clear '' >/dev/null 2>&1 || true
''')
rep('''# 未覆盖的一支：clipError（#clipList 里的「加载失败」）要 /api/clip/list 抛错才进得去，
# 测试侧没有让 Go 报错的通道（fetch 在 WebView 里，钩子改不了它）。这一支目前只由
# clipListHTML() 与 Vue 模板共用同一份字符串保证一致（VDIFF 的 empty 那遍比的是空态，
# 不是失败态）；步骤 11 删掉遗留路径后要用「注入假 fetch」补。''',
'''# 未覆盖的一支（步骤 11 记账）：clipError（#clipList 里的「加载失败」）要 /api/clip/list
# 抛错才进得去，测试侧没有让 Go 报错的通道（fetch 在 WebView 里，钩子改不了它）。以前
# 这一支靠「遗留字符串渲染器与 Vue 模板共用一份字符串」间接保证，步骤 11 删掉遗留渲染器
# 之后连这层间接保证都没了 —— 要补得先做「注入假 fetch」。''')
rep('# skip 算红（同 vdiff_*）：clip 页没挂 Vue 或夹具没到位，这一遍就是空跑',
    '# skip 算红：clip 页没挂 Vue 或夹具没到位，这一遍就是空跑')
rep('# skip 算红（同 vdiff_*）：shots 页没挂 Vue 或夹具没到位，这一遍就是空跑',
    '# skip 算红：shots 页没挂 Vue 或夹具没到位，这一遍就是空跑')

# ---------- 4) 设置页载荷：遗留基准断言随缝一起删 ----------
rep('    L("legacy="+(E.legacy&&E.legacy.settings?1:0));\n', '')
rep('assert d.get("legacy") == "1", "设置页的遗留基准不在（__enote.legacy.settings）"\n', '')
rep('       先关掉上一用例留下的弹层（clip 的 VDIFF 会把剪贴板页开着走），否则 S() 读到的',
    '       先关掉上一用例留下的弹层（剪贴板页交互那一遍会把剪贴板页开着走），否则 S() 读到的')

# ---------- 5) 附件页：两次 vdiff_tab files ----------
rep('''# 夹具到位之后再比一次 files 的 DOM：上面那次（步骤 7 的 vdiff_tab files）跑在空库上，
# FA.loaded=false → 两条路径都画骨架屏（实测 hasSkel=1 hasEmpty=0，145 字节），比的是
# 「骨架对骨架」，卡片网格这条主路径根本没进比较（上一版注释写「比到 strip + 空态」
# 是错的，步骤 7 审查指出）。vdiff_tab 只调 render()，而 render() 不会去拉附件，
# 所以先用 filesNow() 把 FA 真加载好。''',
'''# 夹具到位之后再刷新一次附件页：render() 不会去拉附件（filesNow() 才会），不先加载好
# FA，下面的交互用例比的是骨架屏，没有真卡片可点。''')
rep('print("  ok (FA 已加载 %s 条，下面的 VDIFF 比的是真卡片)" % d["fa"])\n\'\nvdiff_tab files\n',
    'print("  ok (FA 已加载 %s 条，下面的交互用例有真卡片可点)" % d["fa"])\n\'\n')
rep('''# vdiff_tab 末尾会删 .devmode（jseval 钩子只在它存在时干活），不重新 touch 就是
# 「载荷根本没跑，日志里一条 FINT 也没有」。''',
'''# 上一块末尾会删 .devmode（jseval 钩子只在它存在时干活），不重新 touch 就是
# 「载荷根本没跑，日志里一条 FINT 也没有」。''')
rep('''# 第三遍 VDIFF：空态（FA.loaded=true 且 items=[]）。前两遍比的是骨架屏（loaded=false）
# 和网格（items 非空），空态这条分支从没进过比较 —— 步骤 7 审查就是在这里抓到真 DOM
# 漂移：<empty-state> 收了 :tick，而 EmptyState 的 props 只有 icon/title/sub，透传成
# <div class="empty" tick="27">（遗留路径是 <div class="empty">）。FINT 末尾刚把夹具附件
# 删掉，FA 正好是 loaded + 空；下面先断言页面真的是空态（.empty 在、.skel 不在），
# 免得像前两遍那样「比的是另一种状态」。''',
'''# 空态那一遍（FA.loaded=true 且 items=[]）：步骤 7 的审查在这里抓到过真 DOM 漂移 ——
# <empty-state> 收了 :tick，而 EmptyState 的 props 只有 icon/title/sub，透传成
# <div class="empty" tick="27">。FINT 末尾刚把夹具附件删掉，FA 正好是 loaded + 空；
# 下面先断言页面真的是空态（.empty 在、.skel 不在），免得「断言的是另一种状态」。''')
rep('print("  ok (FA 已加载且为空，下面的 VDIFF 比的是空态)")\n\'\nvdiff_tab files\n',
    'print("  ok (FA 已加载且为空，空态 DOM 形状正确（无 tick 属性）)")\n\'\n')
rep('assert d.get("tickAttr") == "none", \\\n  "空态根元素上多了 tick 属性（%s）：组件没声明的 prop 透传成 DOM 属性，与遗留渲染漂移" % d.get("tickAttr")',
    'assert d.get("tickAttr") == "none", \\\n  "空态根元素上多了 tick 属性（%s）：组件没声明的 prop 透传成 DOM 属性" % d.get("tickAttr")')

# ---------- 6) 其余提到 VDIFF / 字符串渲染器的注释 ----------
rep('''  // 正向断言「真的走了 Vue 路径」：VDIFF 结构上分不出两条路径（DOM 按设计逐字相同），
  // 只靠它的话，VUE_SHEETS 注册了但分发没接上也是绿的。''',
'''  // 正向断言「真的走了 Vue 路径」：只看 DOM 分不出谁画的（Vue 的产出按设计就和字符串
  // 渲染器逐字一致），只靠 DOM 的话，VUE_SHEETS 注册了但分发没接上也是绿的。''')
rep('''#   1) Vue 路径是活的（__enote.vue.isVue('todos') 且视图真挂载了）—— 步骤 5 的用例结构上
#      区分不了渲染路径（VDIFF 比 DOM，而两条路径的 DOM 按设计逐字相同），这条是补的正向断言；''',
'''#   1) Vue 路径是活的（__enote.vue.isVue('todos') 且视图真挂载了）—— 只看 DOM 结构上
#      区分不了渲染路径（Vue 的产出按设计就和字符串渲染器逐字一致），这条是补的正向断言；''')
rep('# 步骤 7 的 FilesView 转 Vue。VDIFF 只证明「画出来一样」，这条用真点击钉住四件事：',
    '# 步骤 7 的 FilesView 转 Vue。这条用真点击钉住四件事：')
rep('# 同 VDIFF 夹具那个坑：jseval 钩子只在 .devmode 存在时干活，上一块刚把它删了。',
    '# jseval 钩子只在 .devmode 存在时干活，上一块刚把它删了；不重新 touch 就是空跑。')
for f in ("todos", "files"):
    rep('"__enote.vue.isVue(%s) 不是 true：Vue 装配掉了或注册表没 %s，本步测的是字符串渲染器"' % (f, f),
        '"__enote.vue.isVue(%s) 不是 true：Vue 装配掉了或注册表没 %s，本步测的不是 Vue 路径"' % (f, f))
rep('    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 files 时，本步测的是字符串渲染器',
    '    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 files 时，本步测的不是 Vue 路径')
rep('    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 todos 时，本步测的是字符串渲染器',
    '    // 1) Vue 路径必须是活的：装配掉了 / 注册表没 todos 时，本步测的不是 Vue 路径')

io.open(p, "w", encoding="utf-8").write(s)
print("test.sh 完成", len(s.split("\n")), "行")
