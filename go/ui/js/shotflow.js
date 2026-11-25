// go/ui/js/shotflow.js — 截图捕获与监控文件夹（P11）从 app.js 搬出来（P14 S6 步骤 29）。
//
// 为什么搬：app.js 已经 1957 行，截图这一簇（扫描 → 横幅 → 多选 → 导入 → 进度层 → 文件夹
// 白名单）是自成一体的功能，app.js 里剩下的只有「把它们的函数名挂进 HOST / HOST_KEYS」。
//
// 循环依赖是安全的：app.js 是入口，本模块先被求值，模块顶层只碰 vue.js 的 Vue 与自己
// 与自己新建的 reactive 盒子，app.js 那边（S / tab / toast / closeSheet …）全部只在函数体
// 里读，求值时不会碰到 TDZ。这条契约是这次搬迁的前提，写在这里防止以后有人在顶层加
// `var x = S.foo` 这种求值期读取。
import { Vue, mountSheet, unmountAllSheets, sheetPaint } from './vue.js'
import { CLIP } from './clipflow.js'   /* 步骤 30：CLIP 搬去 clipflow.js 了 */
import { S, tab, q, $, esc, dialog, closeSheet, pageSheetVue, setTab, refresh, paneDirty, statsNow } from './app.js'
import { api, toast } from './netflow.js'
import { now } from './timeflow.js'

// ---- 截图捕获（P11）：扫描监控文件夹 → 横幅 → 多选 → 导入笔记 ----
var SHOTFLAGS = Vue.reactive({ v: null });    // {enabled, granted, folders:n, watermark}  便宜的状态，每次 refresh 都行
/* 步骤 17d：截图页的四份状态收进一个 reactive 对象（同 17b CLIP / 17c FOLD）。
   SHOTFLAGS.v 不进来：它是 Android.shotFlags() 的整包返回，读它的是「我的」页（还没迁），
   整对象 reactive 化要连 shotFlags() 的回调一起动，留到 stats 那片。 */
var SHOTS = Vue.reactive({ sel: {}, list: [], loading: false, error: '' });
// 暂存区里被勾选的截图 id / /api/shots/list 的结果（sheet 用）
/* 步骤 17c：文件夹页的三份状态收进一个 reactive 对象（同 17b 的 CLIP）。
   勾中集合是「整体替换 + 逐键改」两种写法都有，所以整对象 reactive，逐键改也能被追踪。 */
var FOLD = Vue.reactive({ sel: {}, all: [], q: '' });
// 文件夹选择里勾中的路径 / MediaStore 枚举出来的所有目录
var shotTimer = 0, shotStartAt = 0;
/* 步骤 8：Vue 路径的加载态。今天 #shotGrid 的「加载中…」与「加载失败」是 innerHTML 直写，
   组件拿不到这个信息，所以提升成状态位（契约：shotSheet() 置 loading，loadShots() 收尾）。
   遗留路径不读它们，步骤 11 随遗留 DOM 写入一起消失。 */
// SHOTS.loading / SHOTS.error 在 SHOTS 里
// 搜索框的当前值（在 FOLD.q）
/* 导入进度层的状态（契约 (c)）：必须是 reactive，因为 shotOvlSub 是 Java 侧回调写的
   全局函数，状态放组件里 Java 写不到；组件（views/shots.js 的 ShotProgress）是纯渲染器。
   what 存 esc 过的串：今天写的是 sub.textContent = esc(txt)，DOM 文本里就是字面 &amp;，
   组件用 {{ }} 插值才逐字等价。 */
var SHOTPROG = Vue.reactive({ on: false, total: 0, what: '', secs: 0 });

function shotFlags(cb){
  if(!(window.Android && Android.shotFlags)){ SHOTFLAGS.v = {enabled:false, granted:false, folders:0}; if(cb) cb(); return }
  try{
    var d = JSON.parse(Android.shotFlags() || '{}');
    SHOTFLAGS.v = d && typeof d === 'object' ? d : null;
  }catch(e){ SHOTFLAGS.v = null }
  if(cb) cb();
}
/* 截图横幅四种状态点下去各去哪：Vue 模板里写成 H.shotGo(kind) 而不是 H[text.go]()，
   闸门⑮ 才能静态验函数名存在（动态成员访问抓不到，typo 就是「点了没反应」）。 */
function shotGo(kind){
  if(kind==='off') shotSetup();
  else if(kind==='perm') askShotPerm();
  else if(kind==='nofolder') folderSheet();
  else shotSheet();
}
/** 首次开启：开开关 → 要权限 → 选文件夹 */
function shotSetup(){
  if(!(window.Android && Android.setShotEnabled)) return toast('截图捕获只在 app 内可用');
  Android.setShotEnabled(true);
  if(window.Android && Android.shotGranted && Android.shotGranted()){ folderSheet(); return }
  askShotPerm();
}
function askShotPerm(){
  if(!(window.Android && Android.askMedia)) return toast('授权只能在 app 内完成');
  Android.askMedia();
}
window.shotPermResult = function(ok){
  shotFlags(function(){
    if(ok){ toast('已授权，选一下要盯的文件夹'); folderSheet(); }
    else toast('没授权就发现不了新截图，可以稍后在「我的 → 截图捕获」里再开');
    refresh();
  });
};
/** Java 扫完一轮（前台回来时自动扫）→ 有新东西就刷新指标和横幅 */
window.shotsScanned = function(n){
  shotFlags(function(){ if(n > 0) refresh(); });
};
// ---- 截图暂存页：3 列网格 + 多选 ----
/** 计数条的 HTML（loadShots 后的形态；shotSheet() 写壳时是「已选 0 张」纯文本） */
/** VDIFF 的遗留侧：一次调用给出「加载完之后 .pbody 里应该长什么样」。
   按钮的内联 style 要按「一张时只留创建笔记」那条规则写（见 views/shots.js 的
   one / goText / goStyle），否则比出来的是「未同步」的 DOM，真机红。 */
function shotSheet(){
  // 步骤 11：只剩 Vue 一条路径（ShotsView），字符串渲染器与它的 pageSheet 分支一起删了
  SHOTS.loading = true; SHOTS.error = '';
  pageSheetVue('shots', '新截图');
  loadShots();
}
async function loadShots(){
  try{
    var r = await api('/api/shots/list');
    SHOTS.list = (r && r.shots) || [];
    if(S.info) S.info.shot = SHOTS.list.length;
    var keep = {};
    SHOTS.list.forEach(function(x){ keep[x.id] = SHOTS.sel[x.id] !== undefined ? SHOTS.sel[x.id] : true });
    SHOTS.sel = keep;
    SHOTS.loading = false; SHOTS.error = '';
    return Promise.resolve();   /* 步骤 17d：SHOTS 是 reactive，Vue 自己重画 */
  }catch(e){
    SHOTS.loading = false; SHOTS.error = 'fail';
    return Promise.resolve();
  }
}
function fmtClock(sec){
  if(!sec) return '';
  var d = new Date(sec * 1000);
  return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}
function shotPick(id, el){
  SHOTS.sel[id] = !SHOTS.sel[id];   /* 步骤 17d：class 由 computed 重算，不用 bump tick */
}
function shotSelAll(on){
  SHOTS.list.forEach(function(x){ SHOTS.sel[x.id] = !!on });
}
/* 步骤 22 删掉 syncShotBtns(n)：它是字符串渲染器时代「命令式改按钮」的那笔 ——
   一张时只留「创建笔记」（用户反馈：一张时「合并」与「各存」是同一件事）。
   这条规则现在住在 views/shots.js 的 one / goText / goStyle 三个 computed 里，
   闸门⑩ 的「定义了没人用」半边扫出来的就是它：函数活着、0 个调用者。 */
function shotPicked(){
  return SHOTS.list.filter(function(x){ return !!SHOTS.sel[x.id] });
}
/**
 * 导入。merge = 一条笔记多附件（一次 AI），split = 每张一条，raw = 不调 AI 原样存。
 * split 超过 5 张要先确认：那是 N 次 AI 调用，几分钟起步。
 */
function doImportShots(mode){
  var picks = shotPicked();
  if(!picks.length) return toast('先勾选要导入的截图');
  if(mode === 'split' && picks.length > 5){
    dialog({
      title: '生成 ' + picks.length + ' 条笔记？',
      body: '每张截图单独一条笔记，会调用 ' + picks.length + ' 次 AI，可能要等好几分钟。想快一点就选「合并成一条笔记」，那样只调用一次。',
      ok: '继续',
      onOk: function(){ runImportShots('split', false, picks) }
    });
    return;
  }
  runImportShots(mode === 'raw' ? 'merge' : mode, mode === 'raw', picks);
}
function runImportShots(mode, raw, picks){
  if(!(window.Android && Android.importShots)) return toast('导入只在 app 内可用');
  var shots = picks.map(function(x){ return {path:x.path, name:x.name, mime:x.mime} });
  shotOverlay(true, picks.length, raw ? '原样保存' :
    (mode === 'merge' ? '合并成一条笔记' : picks.length + ' 条笔记'));
  keepShotsLight(true);
  Android.importShots(JSON.stringify({mode:mode, raw:!!raw, shots:shots}));
}
/* 进度层：不可点掉，配一句醒目的"别黑屏/别退出"（用户明确要求）。
   组件是 views/shots.js 的 ShotProgress（纯渲染器），状态写进 SHOTPROG（reactive：
   shotOvlSub 是 Java 回调写的全局函数，状态放组件里 Java 写不到）。
   步骤 17j：这里不再 mount/unmount 任何 app —— ShotProgress 是外壳组件 SheetHost 里的
   <teleport to="#shotOvlRoot"> 子组件，常驻外壳树，开关就是 SHOTPROG.on 上的 v-if。
   以前它是 mountSheet 挂的第四个 app（名字 progress），因此 unmountAllSheets 要给它列
   例外名单（进度层要活过 closeSheet：shotsImported 之后 AI 解析还在跑）；现在它是
   弹层树的兄弟，弹层开合与它无关，例外名单整个没用了。
   计时器一直在这里（它是行为，不是视图）。 */
function shotOverlay(on, total, what){
  if(!on){
    if(shotTimer){ clearInterval(shotTimer); shotTimer = 0 }
    SHOTPROG.on = false; SHOTPROG.what = ''; SHOTPROG.secs = 0;
    return;
  }
  SHOTPROG.on = true; SHOTPROG.total = total; SHOTPROG.what = esc(what || ''); SHOTPROG.secs = 0;
  shotStartAt = Date.now();
  if(shotTimer) clearInterval(shotTimer);
  /* 步骤 17h：SHOTPROG 是 reactive 的，secs 逐键赋值即触发进度层重算，
     不再 sheetPaint() bump tick 全量失效。 */
  shotTimer = setInterval(function(){
    SHOTPROG.secs = Math.round((Date.now() - shotStartAt) / 1000);
  }, 1000);
}
/** 更新进度层副标题（OCR 完 → 进入 AI 解析，或 3/7 这种进度） */
function shotOvlSub(txt){
  if(!SHOTPROG.on) return;
  SHOTPROG.what = esc(txt);
  SHOTPROG.secs = Math.round((Date.now() - shotStartAt) / 1000);
}
/** Java 导完（OCR + 入队）的回调：清暂存 → 进度层继续盯着 AI 解析 → 全部结束才收 */
window.shotsImported = function(res){
  if(!res || !res.ok){
    if(window.Android && Android.keepScreenOn) Android.keepScreenOn(false);
    shotOverlay(false);
    toast((res && res.error) || '导入失败');
    return;
  }
  var staged = shotPicked().map(function(x){ return x.id });
  SHOTS.sel = {};
  Promise.resolve(staged.length ? api('/api/shots/remove', {ids: staged}) : null)
    .catch(function(){}).then(function(){
      closeSheet();
      refresh();
      if(res.ocrFailed) toast(res.ocrFailed + ' 张没识别到文字，已按原文保存');
      waitShotsDone(res.noteIds || [], res.notes || 0);
    });
};
/**
 * AI 解析才是"要等好几分钟"的那段，所以在它结束前不收起进度层、不放开屏幕常亮。
 * 每 1.5 秒看一次 /api/state，直到这批笔记都不是 queued/parsing。
 */
function waitShotsDone(ids, total){
  if(!ids.length){ keepShotsLight(false); shotOverlay(false); refresh(); return }
  shotOvlSub('AI 正在解析（' + ids.length + ' 条）');
  var t0 = Date.now(), iv = 0, stopped = false;
  function finish(msg){
    if(stopped) return;
    stopped = true;
    if(iv) clearInterval(iv);
    keepShotsLight(false);
    shotOverlay(false);
    refresh();
    if(msg) toast(msg);
  }
  iv = setInterval(function(){
    api('/api/state').then(function(st){
      var map = {};
      ((st && st.notes) || []).forEach(function(n){ map[n.id] = n.status });
      var done = 0;
      ids.forEach(function(id){
        var s = map[id];
        if(s && s !== 'queued' && s !== 'parsing') done++;
      });
      shotOvlSub('AI 正在解析：' + done + ' / ' + ids.length + ' 条完成');
      if(done >= ids.length) finish('解析完成，' + (total || ids.length) + ' 条笔记');
    }).catch(function(){});
    if(Date.now() - t0 > 20 * 60 * 1000) finish('等太久了，先回列表看看（解析还在后台继续）');
  }, 1500);
}
function keepShotsLight(on){
  if(window.Android && Android.keepScreenOn){ try { Android.keepScreenOn(!!on) } catch(e){} }
}
async function shotIgnoreSel(){
  var picks = shotPicked();
  if(!picks.length) return toast('先勾选要忽略的截图');
  var ids = picks.map(function(x){ return x.id });
  await api('/api/shots/ignore', {ids: ids});
  SHOTS.sel = {};
  loadShots();
  refresh();
  toast('已忽略 ' + ids.length + ' 张，以后不再提醒');
}
// ---- 文件夹选择（首次向导 + 设置页共用）----
/* 行与计数的字符串渲染器（步骤 8 抽出，给 loadFolders/folderRender 与 VDIFF 共用）。
   排序规则只有一份：已选（且未消失）的排最前，组内按张数多的优先，再按路径字典序。
   views/folders.js 里的 sortRows 是同一规则的 JS 版 —— 两处都要改才能不漂移，
   VDIFF 的 folder 用例（含已选 / 含 missing）就是钉住这件事的。 */
/** 计数与主按钮文案（missing 的行既不进「共 M 个」也不进「已选 N 个」） */
/** VDIFF 的遗留侧：加载完之后 .pbody 应该长什么样（一次给出最终 DOM） */
function folderSheet(){
  // 步骤 11：只剩 Vue 一条路径（FoldersView）。确定按钮放底部固定条里的契约搬进了模板
  FOLD.q = '';
  pageSheetVue('folders', '选择监控文件夹');
  loadFolders();
}
function loadFolders(){
  var raw = '[]';
  try{ raw = (window.Android && Android.shotFolders) ? Android.shotFolders() : '[]' }catch(e){}
  try{ FOLD.all = JSON.parse(raw) || [] }catch(e){ FOLD.all = [] }
  var want = {};
  ((SHOTFLAGS.v && SHOTFLAGS.v.list) || []).forEach(function(p){ want[p] = 1 });
  FOLD.sel = {};
  FOLD.all.forEach(function(f){
    // 首次：默认勾上名字像截图目录的；已经有配置的按配置来
    if(Object.keys(want).length) FOLD.sel[f.path] = !!want[f.path];
    else FOLD.sel[f.path] = !!f.shot;
  });
  return Promise.resolve();   /* 步骤 17c：FOLD 是 reactive，Vue 自己重画 */
}
/* folderRender() 与 folderCountLabel() 随步骤 16d 删除：它们是选文件夹页的字符串渲染器，
   步骤 8 起页面归 views/folders.js（FOLDER 的 Vue 组件），这两个函数只剩「调得到就抛」的
   空壳（folderRows / folderCountHTML 已经不存在），是全项目最后一处内联 onclick 的所在地。
   全项目内联 onclick 归零。 */
/** 已选数量实时显示在底部固定条上（勾一个变一次） */
function folderLabel(path){
  var seg = String(path||'').replace(/\/$/,'').split('/');
  var last = seg[seg.length-1] || path;
  var map = {'Screenshots':'截图','screenshots':'截图','Screenshot':'截图','截图':'截图','截屏':'截屏'};
  return map[last] || last;
}
function folderPick(path){
  FOLD.sel[path] = !FOLD.sel[path];
  // v-for 带 :key，勾选只是移动已有节点，滚动位置天然不动（遗留路径那套「记住 scrollTop
  // 再放回」随字符串渲染器一起删了）
  /* 步骤 17c：FOLD.sel 是 reactive，重排与计数由 Vue 自己算，sheetPaint() 摘掉。 */
}
function folderSelAll(on){
  FOLD.all.forEach(function(f){ if(!f.missing) FOLD.sel[f.path] = !!on });
}
function folderPickShots(){
  FOLD.all.forEach(function(f){ FOLD.sel[f.path] = !!f.shot && !f.missing });
}
function folderFilter(t){
  FOLD.q = String(t || '');   /* 步骤 17c：过滤在 computed 里，节点直接不渲染 */
}
function folderSave(){
  var want = FOLD.all.filter(function(f){ return FOLD.sel[f.path] && !f.missing })
    .map(function(f){ return f.path });
  if(!want.length) return toast('至少选一个文件夹');
  if(!(window.Android && Android.setShotFolders)) return toast('只在 app 内可用');
  Android.setShotFolders(JSON.stringify(want));
  Android.setShotEnabled(true);
  closeSheet();
  // 回到「我的」要马上看到新的文件夹数和权限状态：清掉签名强制重画一次
  // 我的页/首页横幅都要立刻反映新的文件夹数与权限状态：强制重建当前页
  shotFlags(function(){
    paneDirty[tab] = 1;
    setTab();
    if(tab === 'mine') statsNow();
  });
  toast('已开始监控 ' + want.length + ' 个文件夹，只看之后的新图');
}
/**
 * 第一次打开 app 时问一次"要不要盯着截图文件夹"（用户要求：初次运行就让用户选文件夹）。
 * 只问一次，两个分支都记下来；选「选择文件夹」直接串起 权限 → 文件夹多选 的向导。
 */
function shotIntroOnce(){
  if(!(window.Android && Android.shotFlags)) return;
  var f = SHOTFLAGS.v || {};
  if(f.enabled) return;
  var asked = false;
  try{ asked = localStorage.getItem('shotIntro') === '1' }catch(e){}
  if(asked) return;
  setTimeout(function(){
    if(SHOTFLAGS.v && SHOTFLAGS.v.enabled) return;   // 这期间用户已经自己开了
    dialog({
      title: '要不要自动收集截图？',
      body: '选几个文件夹盯着（默认就是截图目录），之后新截图会先排队，你勾选后一次性变成笔记。随时可以在「我的 → 截图捕获」里改。',
      ok: '选择文件夹', cancel: '以后再说',
      onOk: function(){
        try{ localStorage.setItem('shotIntro','1') }catch(e){}
        shotSetup();
      },
      onCancel: function(){
        try{ localStorage.setItem('shotIntro','1') }catch(e){}
        toast('随时可以在「我的 → 截图捕获」里打开');
      }
    });
  }, 2400);
}
function scanShotsNow(){
  if(!(window.Android && Android.scanShots)) return toast('只在 app 内可用');
  if(!(SHOTFLAGS.v && SHOTFLAGS.v.granted)) return askShotPerm();
  toast('正在扫描监控文件夹…');
  Android.scanShots(true);
}
function rescanShots(days){
  if(!(window.Android && Android.rescanShots)) return toast('只在 app 内可用');
  if(!(SHOTFLAGS.v && SHOTFLAGS.v.granted)) return askShotPerm();
  dialog({
    title: '回捞最近 ' + days + ' 天的截图？',
    body: '会重新扫一遍监控文件夹，可能一次冒出上百张。已经见过的不会重复收，觉得太多可以先去文件夹里只保留一个目录。',
    ok: '开始',
    onOk: function(){
      toast('正在回捞最近 ' + days + ' 天…');
      Android.rescanShots(days);
    }
  });
}
async function clearShots(){
  var n = (S.info && S.info.shot) || 0;
  if(!n) return toast('暂存区是空的');
  dialog({
    title: '清空截图暂存', danger: true, ok: '清空',
    body: '会删掉暂存区里的 ' + n + ' 张副本（系统相册里的原图不受影响）。',
    onOk: function(){
      api('/api/shots/list').then(function(r){
        var ids = ((r && r.shots) || []).map(function(x){ return x.id });
        return api('/api/shots/remove', {ids: ids});
      }).then(function(){ SHOTS.sel = {}; refresh(); toast('已清空截图暂存') });
    }
  });
}

/* 步骤 29：app.js 把下面这些名字挂进 HOST / HOST_KEYS / 探针缝，views 通过 H.xxx 读它们。
   模块内部互相调用的（shotTimer / shotPicked / runImportShots / waitShotsDone /
   keepShotsLight / loadFolders）也一并导出，闸门⑩ 的「定义了没人用」才看得见引用侧。 */
export { SHOTFLAGS, SHOTS, FOLD, SHOTPROG, shotFlags, shotGo, shotSetup, askShotPerm,
  shotSheet, fmtClock, shotPick, shotSelAll, shotPicked, doImportShots, runImportShots,
  shotOverlay, shotOvlSub, waitShotsDone, keepShotsLight, folderSheet, loadFolders,
  folderLabel, folderPick, folderSelAll, folderPickShots, folderFilter, folderSave,
  shotIntroOnce, scanShotsNow, rescanShots,
  loadShots, shotIgnoreSel, clearShots }
/* 最后三个是 async function：第一次扫 app.js 顶层声明的正则只认 `^function`，
   `^async function` 被漏掉，于是搬迁时漏了它们的 import —— 症状是页面空白 +
   `ReferenceError: shotIgnoreSel is not defined`。闸门㉒ 本来能抓 import 侧，
   但 export 列表里插一段块注释就会把它自己的解析器打瞎（踩过，记在这里），
   所以注释写在列表外面 —— 注释里也不许写块注释的收尾那两个字符，它会提前结束本注释。 */
