#!/usr/bin/env python3
# 步骤 11：app.js 去遗留（对 HEAD 的原始文件重放）
import io, re
p = "go/ui/js/app.js"
s = io.open(p, encoding="utf-8").read()
def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, "MISS %d: %s" % (n, old[:80].replace("\n", "\\n"))
    s = s.replace(old, new)

# ---------- 1) render()：唯一渲染路径 ----------
rep('''  if(VUE_VIEWS[tab]){
    if(!apps[tab]) mountView(tab, p, VUE_VIEWS[tab]);
    paneBuilt[tab] = 1; paneDirty[tab] = 0;
    /* D13/D14：Vue 的 DOM 在 nextTick 之后才落地，所以 DOM 测量与 markReady 都得摄到那一拍。
       done 同时挂在 then 和 catch 两条分支上，done 内部用 try/finally：链上任何一环 reject、
       某个副作用抛了，也要把首屏记号打出去，否则 index.html 的看门狗（D16，12s）会把
       「画完了但某个副作用抛了」误判成白屏，症状从「一处没刷新」升级成「整页重建」。 */
    var done = function(){ try { afterPaint() } finally { markReady() } };
    return vuePaint().then(done, done);
  }
  p.innerHTML = buildPage(tab);
  paneBuilt[tab] = 1; paneDirty[tab] = 0;
  afterPaint();
  markReady();
  /* D13：render 的契约是 Promise。遗留路径是同步 innerHTML，return 时 DOM 已经更新完，
     所以 Promise.resolve() 就是真语义；Vue 路径返回 nextTick().then(...)，调用点一行不用改。
     app.js 内部 16 处调用点一律不 await（Tony 逐条核过：没有一处紧跟读新 DOM），
     只有 test.sh 的 3 处 jseval 载荷 await —— 那里是「点完立刻断言 DOM」的场景。 */
  return Promise.resolve();
}''',
'''  /* 步骤 11 起这是唯一一条渲染路径：四个 tab 全在 VUE_VIEWS 里，字符串渲染器（页面级
     *HTML() 与页面级 render*()）整批删掉了。注册表缺 tab 时不静默回退——回退到已经不
     存在的渲染器只会白屏，直接 console.error 报出来（SELFCHECK 与「没有运行时报错」那
     两步会抓到）。 */
  if(!VUE_VIEWS[tab]){
    console.error('VUE_VIEWS 注册表缺 tab：' + tab);
    markReady();
    return Promise.resolve();
  }
  if(!apps[tab]) mountView(tab, p, VUE_VIEWS[tab]);
  paneBuilt[tab] = 1; paneDirty[tab] = 0;
  /* D13/D14：Vue 的 DOM 在 nextTick 之后才落地，所以 DOM 测量与 markReady 都得摄到那一拍。
     done 同时挂在 then 和 catch 两条分支上，done 内部用 try/finally：链上任何一环 reject、
     某个副作用抛了，也要把首屏记号打出去，否则 index.html 的看门狗（D16，12s）会把
     「画完了但某个副作用抛了」误判成白屏，症状从「一处没刷新」升级成「整页重建」。
     D13：render 的契约是 Promise（调用点一律不 await，只有 test.sh 的 jseval 载荷 await
     —— 那里是「点完立刻断言 DOM」的场景），所以返回 nextTick 那条链。 */
  var done = function(){ try { afterPaint() } finally { markReady() } };
  return vuePaint().then(done, done);
}''')
rep('''/* render() 在 buildPage() 旁边（步骤 5 加了 Vue 分发，往上看）：这里不能再有一份同名函数，
   函数声明提升会让后一份覆盖前一份，Vue 分发会静默失效。web_test.go 钉了「全文只有一个 render 定义」。 */''',
'''/* 这里不能再有一份同名 render 函数：函数声明提升会让后一份覆盖前一份，Vue 分发会静默失效。
   web_test.go 钉了「全文只有一个 render 定义」。 */''')

# ---------- 2) 截图页 ----------
rep('''function shotSheet(){
  if(VUE_SHEETS.shots){
    shotLoading = true; shotError = '';
    pageSheetVue('shots', '新截图');
    loadShots();
    return;
  }
  // 缩略图最多 50 张，操作按钮同样固定在底部条里（跟文件夹页一致）
  pageSheet('新截图', '<div class="cliptop">'
    + '<button class="btn sm" id="shotSelAll" onclick="shotSelAll(true)">全选</button>'
    + '<button class="btn sm" id="shotSelNone" onclick="shotSelAll(false)">全不选</button>'
    + '<div class="sp"></div>'
    + '<button class="btn sm dg" onclick="shotIgnoreSel()">忽略所选</button></div>'
    + '<div id="shotGrid" class="clipload">加载中…</div>'
    + '<div class="pfoot" style="display:block">'
    + '<div class="count" id="shotFoot" style="margin-bottom:8px">已选 0 张</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn pri" id="shotGo" style="flex:1.6" onclick="doImportShots(\\'merge\\')">合并成一条笔记</button>'
    + '<button class="btn" id="shotSplit" style="flex:1" onclick="doImportShots(\\'split\\')">各存一条</button>'
    + '<button class="btn" id="shotRaw" style="flex:1" onclick="doImportShots(\\'raw\\')">原样存</button>'
    + '</div></div>');
  loadShots();
}''',
'''function shotSheet(){
  // 步骤 11：只剩 Vue 一条路径（ShotsView），字符串渲染器与它的 pageSheet 分支一起删了
  shotLoading = true; shotError = '';
  pageSheetVue('shots', '新截图');
  loadShots();
}''')
rep('''    shotLoading = false; shotError = '';
    if(sheetApps.shots){ return sheetPaint() }   // Vue 路径：数据写完 bump tick 就够
    var g = $('#shotGrid');
    if(g) g.innerHTML = shotGridHTML();
    shotCountLabel();
  }catch(e){
    shotLoading = false; shotError = 'fail';
    if(sheetApps.shots){ return sheetPaint() }
    var g2 = $('#shotGrid'); if(g2) g2.innerHTML = '<div class="empty">加载失败</div>';
  }''',
'''    shotLoading = false; shotError = '';
    return sheetPaint();   // 数据写完 bump tick 就够
  }catch(e){
    shotLoading = false; shotError = 'fail';
    return sheetPaint();
  }''')
rep('''function shotPick(id, el){
  shotSel[id] = !shotSel[id];
  if(sheetApps.shots){ return sheetPaint() }   // Vue：class 由 computed 重算，el 不传
  if(el) el.classList.toggle('on', !!shotSel[id]);
  shotCountLabel();
}
function shotSelAll(on){
  shotList.forEach(function(x){ shotSel[x.id] = !!on });
  if(sheetApps.shots){ return sheetPaint() }
  var g = $('#shotGrid');
  if(g){
    var items = g.querySelectorAll('.shotitem');
    for(var i=0;i<items.length;i++) items[i].classList.toggle('on', !!on);
  }
  shotCountLabel();
}''',
'''function shotPick(id, el){
  shotSel[id] = !shotSel[id];
  return sheetPaint();   // class 由 computed 重算，el 不传
}
function shotSelAll(on){
  shotList.forEach(function(x){ shotSel[x.id] = !!on });
  return sheetPaint();
}''')

# ---------- 3) 文件夹页 ----------
rep('''function folderSheet(){
  if(VUE_SHEETS.folders){
    folderQ = '';
    pageSheetVue('folders', '选择监控文件夹');
    loadFolders();
    return;
  }
  // 确定按钮放底部固定条里：文件夹可能有几十个，滚到底才能点确定太难用了（用户反馈）
  var h = '<div class="cliptop">'
    + '<button class="btn sm" id="folderSelAll" onclick="folderSelAll(true)">全选</button>'
    + '<button class="btn sm" id="folderSelNone" onclick="folderSelAll(false)">全不选</button>'
    + '<button class="btn sm" onclick="folderPickShots()">只选截图目录</button></div>'
    + '<div style="margin:8px 0 4px"><input id="folderQ" class="fin" placeholder="搜索文件夹" '
    + 'oninput="folderFilter(this.value)"></div>'
    + '<div id="folderList" class="clipload">加载中…</div>'
    + '<div class="pfoot"><div class="count" id="folderCount">已选 0 个</div>'
    + '<div class="sp"></div>'
    + '<button class="btn pri" onclick="folderSave()">开始监控</button></div>';
  pageSheet('选择监控文件夹', h);
  loadFolders();
}''',
'''function folderSheet(){
  // 步骤 11：只剩 Vue 一条路径（FoldersView）。确定按钮放底部固定条里的契约搬进了模板
  folderQ = '';
  pageSheetVue('folders', '选择监控文件夹');
  loadFolders();
}''')
rep('''    else folderSel[f.path] = !!f.shot;
  });
  if(sheetApps.folders){ return sheetPaint() }
  folderRender();
}''','''    else folderSel[f.path] = !!f.shot;
  });
  return sheetPaint();
}''')
rep('''function folderPick(path){
  folderSel[path] = !folderSel[path];
  // Vue：v-for 带 :key，勾选只是移动已有节点，滚动位置天然不动，不需要 folderRender 那套
  // 「记住 scrollTop 再放回」；遗留路径要，因为它是整段 innerHTML 重建。
  if(sheetApps.folders){ return sheetPaint() }
  folderRender();          // 重排 + 刷新计数：选中的浮到最上面
}
function folderSelAll(on){
  folderAll.forEach(function(f){ if(!f.missing) folderSel[f.path] = !!on });
  if(sheetApps.folders){ return sheetPaint() }
  folderRender();
}
function folderPickShots(){
  folderAll.forEach(function(f){ folderSel[f.path] = !!f.shot && !f.missing });
  if(sheetApps.folders){ return sheetPaint() }
  folderRender();
}
function folderFilter(t){
  folderQ = String(t || '');
  if(sheetApps.folders){ return sheetPaint() }   // Vue：computed 里过滤，节点直接不渲染
  var q = folderQ.toLowerCase();
  var rows = document.querySelectorAll('#folderList .frow');
  for(var i=0;i<rows.length;i++){
    var p = (rows[i].getAttribute('data-path')||'').toLowerCase();
    rows[i].style.display = (!q || p.indexOf(q) >= 0) ? '' : 'none';
  }
}''',
'''function folderPick(path){
  folderSel[path] = !folderSel[path];
  // v-for 带 :key，勾选只是移动已有节点，滚动位置天然不动（遗留路径那套「记住 scrollTop
  // 再放回」随字符串渲染器一起删了）
  return sheetPaint();     // 重排 + 刷新计数：选中的浮到最上面
}
function folderSelAll(on){
  folderAll.forEach(function(f){ if(!f.missing) folderSel[f.path] = !!on });
  return sheetPaint();
}
function folderPickShots(){
  folderAll.forEach(function(f){ folderSel[f.path] = !!f.shot && !f.missing });
  return sheetPaint();
}
function folderFilter(t){
  folderQ = String(t || '');
  return sheetPaint();     // computed 里过滤，节点直接不渲染
}''')

# ---------- 4) 剪贴板页 ----------
rep('''function clipSheet(){
  // 暂存条数可能很多：操作按钮固定到底部，别让人滚到底才看得见（跟文件夹页一致）
  if(VUE_SHEETS.clip){
    clipLoading = true; clipError = ''
    pageSheetVue('clip', '剪贴板暂存')
    loadClips()
    return
  }
  pageSheet('剪贴板暂存', '<div class="cliptop">'
    +'<button class="btn sm" id="clipSelAll" onclick="clipSelAll(true)">全选</button>'
    +'<button class="btn sm" id="clipSelNone" onclick="clipSelAll(false)">全不选</button>'
    +'</div>'
    +'<div id="clipList" class="clipload">加载中…</div>'
    +'<div class="pfoot" style="display:block">'
    +'<div class="count" id="clipFoot" style="margin-bottom:8px"></div>'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn" style="flex:1" id="clipDelSel" onclick="clipDelSel()">删除所选</button>'
    +'<button class="btn" style="flex:1.2" id="clipRaw" onclick="clipParse(false)">原样存为笔记</button>'
    +'<button class="btn pri" style="flex:1.2" id="clipParseBtn" onclick="clipParse(true)">一键解析</button>'
    +'</div></div>');
  loadClips();
}''',
'''function clipSheet(){
  // 步骤 11：只剩 Vue 一条路径（ClipSheetView）；条数很多时操作按钮固定在底部的契约在模板里
  clipLoading = true; clipError = ''
  pageSheetVue('clip', '剪贴板暂存')
  loadClips()
}''')
rep('''    clipLoading = false; clipError = '';
    if(sheetApps.clip){ return sheetPaint() }   // Vue 路径：数据写完 bump tick 就够
    var el2 = $('#clipList'); if(el2) el2.innerHTML = clipListHTML();
    clipCount();
  }catch(e){
    clipError = String(e);
    // Vue 路径：#clipList 的子节点是 Vue 管的，直接写 innerHTML 会与它的虚拟 DOM 抢；
    // bump tick 让 clipListHTML 的三态判定重算就够了。
    if(sheetApps.clip){ return sheetPaint() }
    var el3 = $('#clipList'); if(el3) el3.innerHTML = '<div class="empty">加载失败</div>';
  }''',
'''    clipLoading = false; clipError = '';
    return sheetPaint();   // 数据写完 bump tick 就够
  }catch(e){
    clipError = String(e);
    // #clipList 的子节点是 Vue 管的，直接写 innerHTML 会与它的虚拟 DOM 抢；
    // bump tick 让模板的三态判定重算就够了。
    return sheetPaint();
  }''')
rep('''function clipPick(id, el){
  clipSel[id] = !clipSel[id];
  if(sheetApps.clip){ return sheetPaint() }
  el.classList.toggle('on', !!clipSel[id]);
  clipCount();
}
function clipSelAll(v){
  Object.keys(clipSel).forEach(function(k){ clipSel[k]=v; });
  if(sheetApps.clip){ return sheetPaint() }
  var items = document.querySelectorAll('.clipitem');
  for(var i=0;i<items.length;i++){ items[i].classList.toggle('on', v); }
  clipCount();
}
function clipCount(){
  if(sheetApps.clip){ return sheetPaint() }   // Vue：计数与按钮文案都是 computed，bump tick 即可
  // 以页面上真正列出来的条目为准，不拿全局 map 计数
  var items = document.querySelectorAll('.clipitem');
  var n = 0;
  for(var i=0;i<items.length;i++){ if(items[i].classList.contains('on')) n++; }
  var el = $('#clipFoot') || $('#clipCount');
  if(el) el.innerHTML = '<b>' + n + '</b> 条已选 · 共 ' + items.length + ' 条';
  var b = $('#sheet .pfoot .btn.pri');
  if(b) b.textContent = clipParseText(n);
}''',
'''function clipPick(id, el){
  clipSel[id] = !clipSel[id];
  return sheetPaint();
}
function clipSelAll(v){
  Object.keys(clipSel).forEach(function(k){ clipSel[k]=v; });
  return sheetPaint();   // 计数与按钮文案都是 computed，bump tick 即可
}''')

# ---------- 5) 设置页 ----------
rep('''function settingsSheet(){
  /* 步骤 10：注册表里有 settings 就走 Vue（内容区交给 SettingsSheetView 挂），否则退回
     字符串渲染器。dataset.kind 是 CSS 钩子（css/views/settings.css 靠它定位设置页），
     两条路径都必须写，所以放在分发之前。 */
  $('#panel').dataset.kind = 'settings';
  if(VUE_SHEETS.settings) pageSheetVue('settings', '设置');
  else pageSheet('设置', renderSettings());
}
/* 只重绘设置页本身，并把滚动位置放回去（开关、权限回来后刷新用）*/
function settingsRefresh(){
  var p = $('#panel');
  if(!p || p.dataset.kind !== 'settings' || !$('#sheet').classList.contains('on')) return;
  var top = p.scrollTop;
  /* Vue 路径不重建 DOM：computed 全依赖 tick，sheetPaint()  bump 一次就整页重算。
     重建会把输入框里正在打的字清掉（设置页是全站唯一有六个输入框的页面），
     而遗留路径本来就是 innerHTML 整体重写，没这个顾虑。 */
  if(VUE_SHEETS.settings){
    sheetPaint();
    requestAnimationFrame(function(){ var q = $('#panel'); if(q) q.scrollTop = top });
    return;
  }
  settingsSheet();
  requestAnimationFrame(function(){ $('#panel').scrollTop = top; });
}''',
'''function settingsSheet(){
  /* 步骤 11：只剩 Vue 一条路径（SettingsSheetView）。dataset.kind 是 CSS 钩子
     （css/views/settings.css 靠它定位设置页），pageSheetVue 里写。 */
  $('#panel').dataset.kind = 'settings';
  pageSheetVue('settings', '设置');
}
/* 只重绘设置页本身，并把滚动位置放回去（开关、权限回来后刷新用）*/
function settingsRefresh(){
  var p = $('#panel');
  if(!p || p.dataset.kind !== 'settings' || !$('#sheet').classList.contains('on')) return;
  var top = p.scrollTop;
  /* 不重建 DOM：computed 全依赖 tick，sheetPaint() bump 一次就整页重算。
     重建会把输入框里正在打的字清掉（设置页是全站唯一有六个输入框的页面）。 */
  sheetPaint();
  requestAnimationFrame(function(){ var q = $('#panel'); if(q) q.scrollTop = top });
}''')

# ---------- 6) 轮询指纹：sigOf → stateSig + 排除表 ----------
rep('''var SIG = '', drawn = false;
function sigOf(d){
  var ns = (d && d.notes) || [], i = (d && d.info) || {}, h = 0, k, j, s;
  for(k = 0; k < ns.length; k++){
    var n = ns[k];
    s = (n.id||'') + (n.status||'') + (n.updatedAt||'') + (n.title||'') +
        (n.todos ? n.todos.length : 0) + (n.attachments ? n.attachments.length : 0);
    for(j = 0; j < s.length; j++) h = (h*31 + s.charCodeAt(j)) | 0;
  }
  // 注意：签名里漏了 i.shot 的话，新截图只改变条数时不会重绘，首页横幅就不会出现（踩过）
  var sf = (typeof SHOTFLAGS === 'object' && SHOTFLAGS) || {};   // 启动早期还没有 flags
  return [ns.length, h, i.todos, i.open, i.overdue, i.queue, i.clip, i.shot, i.ocrReady?1:0,
          (d && d.settings && d.settings.theme) || '',
          // 截图开关/文件夹数也进签名：配置改了界面必须跟着变（踩过：选完文件夹我的页还显示旧数字）
          (sf.enabled?1:0) + '' + (sf.folders||0) + (sf.granted?1:0)].join('|');
}''',
'''var SIG = '', drawn = false;
/* 轮询指纹的排除表：/api/state 里每秒都在变、界面又不展示的字段。
   不排掉的话「数据没变就不重绘」这条契约（D8）直接失效——uptimeS 每秒 +1，
   每一轮都算「变了」，四个 tab 每秒全量重绘一次，正是本文件顶部说的闪屏来源。
   排除表就是行为契约，tools/ui_test.js 有断言钉住它（改名 / 删字段即红）。 */
var SIG_SKIP = { uptimeS:1, tz:1, go:1, dir:1 };

/* 整份 /api/state 的指纹。步骤 11 把原来的「逐字段手挑」换成「整份序列化 + 排除表」：
   手挑那份漏一个字段就是静默不重绘（注释里记着 i.shot 踩过），整份序列化把这类漏项
   封掉——新字段默认进签名，只有明确列进排除表的才不参与。
   契约翻转（步骤 11 记录）：笔记正文 content 变化现在会触发重绘（旧签名只取
   id/status/updatedAt/title/子项数，正文改了不重绘）。这是更严的方向，代价是
   「AI 解析写完正文」那一拍多一次重绘。
   shot / server 不能排：截图页的 banner 读 info.shot、设置页显示 info.server，
   排掉就是「外部改了数据界面不更新」。 */
function stateSig(d){
  var i = {}, src = (d && d.info) || {}, k;
  for(k in src){ if(!SIG_SKIP[k]) i[k] = src[k] }
  var sf = (typeof SHOTFLAGS === 'object' && SHOTFLAGS) || {};   // 启动早期还没有 flags
  return JSON.stringify([d && d.notes, i, (d && d.settings) || {},
    [sf.enabled?1:0, sf.folders||0, sf.granted?1:0]]);
}''')
rep('       var dirty = !quiet || !drawn || sigOf(d) !== SIG;',
    '       var dirty = !quiet || !drawn || stateSig(d) !== SIG;')
rep('       SIG = sigOf(d); drawn = true;', '       SIG = stateSig(d); drawn = true;')

# ---------- 7) 观测缝 ----------
rep('''                       /* 夹具注入 folderAll/folderSel 后要重画一次。folderRender 不在导出表
                          （加了会动 handler 基线），走观测缝。两条路径都要能用：Vue 路径 =
                          sheetPaint()，遗留路径 = 真重画。 */
                       folderPaint:function(){ return sheetApps.folders ? sheetPaint() : folderRender() },''',
'''                       /* 夹具注入 folderAll/folderSel 后要重画一次。名字留着 folderPaint
                          是 test.sh 夹具与签名断言写死的契约；四个弹层现在共用 sheetPaint()。 */
                       folderPaint:function(){ return sheetPaint() },''')
rep('''   它是给测试用的，不是生产门禁：render() 走哪条路径只看 VUE_VIEWS[tab]（app.js:1317），
   没这个缝时 Vue 照跑。缺它的代价是「测不出来」：VDIFF 比的是 DOM，而两条路径的 DOM
   按设计就逐字相同，它结构上无法区分走了哪条；真要是 Vue 没跑，VDIFF/NINT 会全绿。
   所以 test.sh 的 TINT 用 isVue(tab) + apps[tab] 正向断言「目标 tab 真的由 Vue 挂载」。''',
'''   它是给测试用的，不是生产门禁：render() 走哪条路径只看 VUE_VIEWS[tab]，没这个缝时
   Vue 照跑。缺它的代价是「测不出来」：DOM 长得一样就分不出谁画的，所以 test.sh 的
   TINT 用 isVue(tab) + apps[tab] 正向断言「目标 tab 真的由 Vue 挂载」。''')

# ---------- 8) 导出表：删掉两个遗留渲染器 ----------
rep('''  refresh, render, renderMineHTML, reocr, reparse, resetPrefs, rescanShots, saveSettings,
  scanShotsNow, settingsHTML, settingsRefresh, settingsSheet, showDebug, showLog, statsNow,''',
'''  refresh, render, reocr, reparse, resetPrefs, rescanShots, saveSettings,
  scanShotsNow, settingsRefresh, settingsSheet, showDebug, showLog, statsNow,''')

# ---------- 9) selfCheck：探针换成 render() ----------
rep('''  probe('renderNotes', renderNotes); probe('renderTodos', renderTodos);
  probe('renderFiles', renderFiles); probe('renderMine', renderMine);''',
'''  /* 步骤 11 起四个 tab 只能走 render()（字符串渲染器已删）：逐个切过去渲染一次，
     组件的 setup / computed 抛异常会直接进 SELFCHECK FAIL。 */
  var tab0 = tab;
  ['notes','todos','files','mine'].forEach(function(t){
    probe('render:' + t, function(){ setTab(t); });
  });
  setTab(tab0);''')

# ---------- 10) 注释里的 ui_sig_test.js ----------
rep('''   （注：这段注释里不能写 onclick="…" 这种字面量，ui_sig_test.js 会把它当成真 handler 扫。）''',
'''   （注：这段注释里不能写 onclick="…" 这种字面量，tools/ui_test.js 闸门① 会把它当成真 handler 扫。）''')


# ---------- 11) D17 的 legacy 夹具缝（VDIFF 基准）随渲染器一起删 ----------
rep("""  /* D17 夹具缝（Tony 提，步骤 5）：DOM 逐字一致对比要在真 WebView 里把两条路径各渲染一次。
     视图转 Vue 后遗留字符串渲染器不再被 render() 调用，但它是「今天长什么样」的唯一真相，
     留着它才谈得上「行为零变化」是可证明的。步骤 6/7/9/10 各加一个 tab，步骤 11 随渲染器一起删。 */
  legacy: { notes: renderNotes, todos: renderTodos, files: renderFiles,
            /* 步骤 8：弹层的遗留侧（VDIFF 的基准）。它们渲染的是「加载完之后」的 DOM，
               因为夹具比的是加载完的状态；shotSheet()/folderSheet() 写壳时是「加载中…」。 */
            shots: shotSheetHTML, folders: folderSheetHTML,
            /* 步骤 9：剪贴板页的遗留侧（同样渲染「加载完之后」的形态）。 */
            clip: clipSheetHTML,
            /* 步骤 10：我的页（tab）与设置页（弹层）的遗留侧。 */
            mine: renderMineHTML, settings: settingsHTML },
  /* 夹具要在插入遗留字符串后跑一遍和 render() 相同的收尾（syncExpand 会按正文高度隐藏
     「展开详情」按钮），否则比的是「raw 字符串」对「收尾后的 DOM」。缝在 D17 上，步骤 11 一起删。 */
  afterPaint: afterPaint,
  /* 步骤 10：入场动画的 seen 是一次性状态（enterCls 首次见到某个 id 才返回 ' enter'）。
     VDIFF 夹具要在两条路径各自开跑前清一次，否则先跑的那条把 id 记进 seen，后跑的那条
     就没有 enter —— 我的页的四张统计卡带 enterCls，正好踩这一条（真机上 tab 切换会清）。 */
  clearSeen: clearSeen""",
"""  /* 步骤 11：D17 的遗留基准缝（VDIFF 用来对比字符串渲染器的 legacy 那组）与 afterPaint
     一起删了 —— 字符串渲染器整批删除之后，「与它逐字一致」这个命题没有对象了。
     clearSeen 留着：切 tab 强制重绘与「外部改数据后立刻刷新」那几个用例都靠它，
     它不是迁移期的临时物。 */
  clearSeen: clearSeen""")

io.open(p, "w", encoding="utf-8").write(s)
print("app.js 去遗留完成", len(s.split("\n")), "行")
