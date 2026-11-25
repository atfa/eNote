// go/ui/js/app.js — 由 go/ui.html 684-2523 机械拆分而来（S1a，行为零变化）。
// S3 起是 **ES module**（index.html 的 <script type="module">）。模块顶层声明不再是全局，
// 页面里 69 处 onclick + 1 处 oninput 按 window 作用域解析函数名，所以文件末尾必须有
// window.__enoteActions 导出表 + Object.assign(window, …)（见文件末尾 D12）。
// 转 module 与导出表、tools/ui_test.js 闸门① 同批落地，中间态不能存在：
// 少了任何一环，70 个 handler 会全部静默失效（P12 那一类「点了没反应」）。
/* 诊断缝（步骤 17b）：app.js 被求值几次？两次的话模块状态有两份（CLIP / S / MISSED.v 各一份），
   组件读的那份和测试缝写的那份不是同一个对象，症状是「赋值成功而界面不动」。 */
window.__enoteAppLoads = (window.__enoteAppLoads || 0) + 1;
/* 诊断缝（步骤 17g）：Vue 的 console.error 只给 message，栈才是有用的那半。 */
window.addEventListener('error', function(e){
  if(e.error && e.error.stack) console.log('JS-STACK ' + String(e.error.stack).split('\n').slice(0,6).join(' | '));
});
window.addEventListener('unhandledrejection', function(e){
  var r = e.reason;
  console.log('JS-REJECT ' + (r && r.stack ? String(r.stack).split('\n').slice(0,6).join(' | ') : String(r)));
});
var S = Vue.reactive({notes:[], settings:{}, info:{}});
/* S3（D14）：Vue 装配层与视图注册表。混合期（步骤 5-10）里已迁移的 tab 走 Vue，
   其余走本文件里的遗留字符串渲染器；步骤 11 删掉遗留路径。 */
import { Vue, nextTick, setHost, setHostKeys, mountView, mountSheet, unmountSheet, unmountAllSheets, sheetPaint, vuePaint, apps, sheetApps } from './vue.js'
/* 外壳（步骤 15）：顶栏 / 底栏+fab / 弹层宿主 / 对话框 / toast 的组件与它们读的 reactive 状态表。
   shell.js 只依赖 vue.js，不反向读 app.js 的状态（事件走下面的 setHost），所以没有循环导入。 */
import { shell, mountShell } from './shell.js'
import { NotesView } from './views/notes.js'
import TodosView from './views/todos.js'
import FilesView from './views/files.js'
/* 步骤 8：截图暂存页（进度层步骤 17j 搬进了 shell.js 的 <teleport>） */
import { ShotsView } from './views/shots.js'
import FoldersView from './views/folders.js'
/* 步骤 9：剪贴板暂存页 */
import ClipSheetView from './views/clip.js'
/* 步骤 10：我的页（统计）+ 设置页 */
import StatsView from './views/stats.js'
import SettingsSheetView from './views/settings.js'
/* 步骤 16c：最后六个「字符串弹层」—— 排序筛选 / 错过的提醒 / 记一笔 / 添加待办 /
   运行日志 / AI 调用记录。它们以前是 app.js 里拼 HTML 字符串 + 内联 onclick。 */
/* 步骤 29：截图捕获那一簇（含监控文件夹）搬进 shotflow.js；这里是循环依赖（shotflow.js
   反过来 import app.js 的 S / tab / toast / closeSheet …），只在函数体里读，安全。 */
/* 步骤 30：剪贴板暂存那一簇搬进 clipflow.js（循环依赖，同上，只在函数体里读）。 */
/* 步骤 31：附件页那一簇搬进 filesflow.js（循环依赖，同上）。 */
/* 步骤 32：设置页那一簇搬进 settingsflow.js（循环依赖，同上）。 */
/* 步骤 33：我的页统计那一簇搬进 statsflow.js（循环依赖，同上）。 */
import { ST, statsNow, statCls } from './statsflow.js'
/* 步骤 34：倒计时 / 提醒 / 常驻后台那一簇搬进 remindflow.js（循环依赖，同上）。 */
/* 步骤 35：页签偏好 + 主题那一簇搬进 prefsflow.js（循环依赖，同上）。 */
/* 步骤 36：错过的提醒那一簇搬进 js/missedflow.js（循环依赖，同上）。 */
import { MISSED, loadMissed, missedSheet, missedDone, missedGoTodos, missedDismiss }
         from './missedflow.js'
/* 步骤 37：打开笔记 / 待办 + 系统日历 / 闹钟那一簇搬进 js/openflow.js（循环依赖，同上）。 */
/* 步骤 38：弹层开合（pageSheetVue / sheetVue / closeSheet / sheetLeft）搬进 js/sheetflow.js
   （循环依赖，同上：本模块顶层不碰 app.js，只在函数体里读 $ 与 VUE_SHEETS）。 */
/* 步骤 39：自绘对话框那一簇搬进 js/dlgflow.js（循环依赖，同上）。 */
/* 步骤 40：「记一笔」/「添加待办」那一簇搬进 js/addflow.js（循环依赖，同上）。 */
/* 步骤 41：服务端搜索那一簇搬进 js/searchflow.js（循环依赖，同上）。 */
import { SR, SRK, searchNow, searchInput, searchClear } from './searchflow.js'
import { FORMS, formSet, addSheet, addNote, pickImage, addTodoSheet, addTodo } from './addflow.js'
import { dialog, closeDlg, askDel, uiDialog, uiBackKey } from './dlgflow.js'
import { pageSheetVue, sheetVue, closeSheet, sheetLeft } from './sheetflow.js'
import { openNote, openTodo, openTodoFocus, jump, dueMs, toCalendar, toAlarm }
         from './openflow.js'
import { prefs, P, prefQS, flattenPrefs, savePrefs, CUR, themeOf, applyTheme, setTheme }
         from './prefsflow.js'
import { cdText, cdCls, syncReminders, exactGranted, askExact, notifyGranted, askNotify,
         notifyResult, keepAliveOn, batteryIgnoring, toggleKeepAlive, askBattery } from './remindflow.js'
import { SFORM, formFill, formInput, settingsSheet, settingsRefresh, exportJSON, importJSON,
         clearAllNotes, sortSheet, setPref, resetPrefs } from './settingsflow.js'
import { FA, fmtSize, filesNow, attachCardCls, attachGlyphName, openAttach, delAttach,
         pickFile } from './filesflow.js'
import { CLIP, openClip, importClip, clipItemCls, clipPrevText, clipThumbText, clipMetaText,
         clipParseText, clipSheet, loadClips, clipPick, clipSelAll, clipDel, clipDelSel,
         clipParse } from './clipflow.js'
import { SHOTFLAGS, SHOTS, FOLD, SHOTPROG, shotFlags, shotGo, shotSetup, askShotPerm,
         shotSheet, fmtClock, shotPick, shotSelAll, doImportShots, shotOverlay, shotOvlSub,
         folderSheet, folderLabel, folderPick, folderSelAll, folderPickShots, folderFilter,
         folderSave, shotIntroOnce, scanShotsNow, rescanShots,
         loadShots, shotIgnoreSel, clearShots } from './shotflow.js'
import { SortSheetView, MissedSheetView, AddSheetView, AddTodoSheetView,
         LogSheetView, DebugSheetView } from './views/sheets.js'
/* 步骤 17f：H 暴露的「整包赋值的标量」接上响应式。tab / q 在 app.js 里被引用几十次，
   整词改名风险大于收益，所以用镜像：原变量照旧用，赋值处同步一份进 reactive 盒子，组件读盒子。
   同步只走 syncBox()，不手写第二遍（手写第二遍迟早漏一处，漏了就是「数据换了界面不动」）。
   对象型的（open）让原变量直接指向盒子里的 proxy，逐键改也追踪得到。 */
function syncBox(box, v){ box.v = v; return v }
var TAB = Vue.reactive({ v: 'notes' });
var QB = Vue.reactive({ v: '' });
var OPENB = Vue.reactive({ v: {} });
var REMIND = Vue.reactive({ v: 0 });
var STERR = Vue.reactive({ v: '' });
var SRERR = Vue.reactive({ v: '' });
var SHEETARGB = Vue.reactive({ v: '' });

/* 声明顺序是硬要求：盒子必须在第一次读它之前建好。踩过：盒子放在文件中部，
   而 `var tab = TAB.v` 在第 32 行 —— var 提升让 TAB 在那一刻是 undefined，
   整份 app.js 抛 TypeError，页面全白（真机日志：Cannot read properties of undefined (reading 'v')）。 */
var tab = TAB.v, open = OPENB.v, busy = {};
var seen = {};   // 已经出现过的卡片 id：只有新出现的才带入场动画（P7c）
var expAnim = {}; // 正在播放展开动画的笔记 id（P7c 加动效时忘了声明，展开详情点了没反应就是这个）

var q = QB.v;
/* 页签偏好（排序/筛选/搜索词）那一簇搬进 js/prefsflow.js（P14 S6 步骤 35）。
   这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
/* 图标：ic('search') → 一个 24dp 线性图标，颜色跟着 currentColor */
function ic(n, cls){ return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + n + '"/></svg>' }
/* ---------- 服务端搜索（R3）----------
   列表数据一律来自 /api/search；请求失败时退回本地过滤，断网也能看。 */
var prefsLoaded = false;
/* SR（服务端搜索结果）与 searchSeq（首页搜索序号）搬进 js/searchflow.js（步骤 41）。
   上次搜索结果的指纹 SRK 也在那边。 */
/* q 是 app.js 里的 var，会被重新赋值，别的模块拿到的是只读绑定（同 SRK 装盒那条教训），
   要清它就走这个 setter。shell.q / shell.has 是搜索框的显示状态，这几处赋值一直是连着的。 */
function setQ(v){ q = syncBox(QB, v); shell.q = q; shell.has = !!q }
/* 步骤 41：searchInput 要「只写 q、不动 shell.q」——shell.q 是搜索框 v-model 的源，
   用户正在敲的那串不能被 trim 后的值盖掉；setQ 是「清搜索词」那一路（连 shell.q /
   shell.has 一起写），searchClear 用它。 */
function setQRaw(v){ q = syncBox(QB, v) }
/* tab 同上：`var tab = TAB.v` 会被 `tab = syncBox(TAB, …)` 重新赋值，导入方（missedflow.js）
   只能读，切页签走这个 setter（P14 S6 步骤 36）。只写 tab 本身，页面切换仍走 setTab()。 */
function setTabTo(v){ tab = syncBox(TAB, v) }

/* SRK（上次搜索结果的指纹）与 searchNow 搬进 js/searchflow.js（步骤 41）；
   附件页那边共用 SRK，从 app.js 拿（app.js 再导出）。 */

/* 主题（R8）那一簇（themeOf / applyTheme / setTheme）搬进 js/prefsflow.js（P14 S6 步骤 35）。 */

function $(s){return document.querySelector(s)}
function esc(s){return (s||'').replace(/[&<>"]/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
/* toast（步骤 15）：以前是 innerHTML + classList.add('on') + 把定时器挂在 DOM 节点上
   （t._t）。现在只改 shell.toast 两个字段，显隐与文案由 ToastHost 渲染 —— 定时器是行为，
   留在模块里，不再寄生在 DOM 上。 */
var toastT = 0;
function toast(m){
  shell.toast.msg = String(m);
  shell.toast.on = true;
  clearTimeout(toastT);
  toastT = setTimeout(function(){ shell.toast.on = false }, 2200);
}
/* 测试缝（步骤 14）：`__enote.test.failApi = '/api/clip/parse'` 让含该子串的请求在 fetch 前
   直接抛。需要它是因为「加载失败 / 解析失败」这两支在真机上要 Go 侧真报错才进得去，
   而测试侧没有让 Go 报错的通道（步骤 11 记的账，当时写的是「要补得先做注入假 fetch」）。
   默认空串 = 生产路径零影响；只认显式赋值，见文件末尾 __enote.test。 */
var API_FAIL = '';
async function api(path, body){
  if(API_FAIL && String(path).indexOf(API_FAIL) >= 0)
    throw new Error('injected failure: ' + path);
  var o = body ? {method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify(body)} : {};
  var r = await fetch(path, o);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
/* 步骤 13：给「一页的数据源」用的带超时 api。fetch 没有超时时会永久挂起（真机撞过：
   WebView 进后台再回来，在飞的 fetch 永不 resolve），症状是这一页永久停在骨架屏。
   超时只放弃等待，不取消请求（fetch 的 result 被丢弃即可），所以调用方的序号判定照旧有效。 */
var REQ_TIMEOUT_MS = 12000;
function apiTimeout(path, body, ms){
  return new Promise(function(res, rej){
    var to = setTimeout(function(){ rej(new Error('timeout')) }, ms || REQ_TIMEOUT_MS);
    api(path, body).then(function(v){ clearTimeout(to); res(v) },
                         function(e){ clearTimeout(to); rej(e) });
  });
}
function errText(e){
  return (e && e.message === 'timeout') ? '加载超时' : '加载失败';
}
function now(){var d=new Date(),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function fmtTime(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return iso;
  var p=n=>String(n).padStart(2,'0'), t=new Date();
  var same = d.toDateString()===t.toDateString();
  return (same?'今天':(d.getMonth()+1)+'/'+d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
/* 到期倒计时（R11）+ 自研到期提醒（R13-E）+ 常驻后台（P6.5）整簇搬进 js/remindflow.js
   （P14 S6 步骤 34）。这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
/** 通知点按后打开对应笔记（Java 侧调用）*/
// ---- 剪贴板暂存（R7/P6）：横幅 + 批量勾选 + 一键解析 ----
/* 步骤 9 转 Vue：CLIP.list 是 /api/clip/list 的结果，CLIP.loading / CLIP.error 是加载三态。
   三个都会被整体赋值，进 setHost 必须走 getter（同 SHOTS.list / FA 的教训：传值的话
   Vue 拿的是装配时那份快照，症状是「数据变了界面不动」）。 */
/* 步骤 17b：这四个从「普通模块变量 + V.tick 大锤」换成一个 reactive 对象。
   之前 computed 看不见它们（不是响应式的），所以每个读它们的 computed 都得包 live()、
   每次状态变了都得 sheetPaint() bump 一下才重画 —— 那是全量重绘，不是响应式。
   现在赋值即触发，views/clip.js 的 computed 不再依赖 tick（clipPick 也不再 sheetPaint）。
   整体赋值的地方（loadClips / clipParse / 夹具 setter）写的是属性，别把对象换掉：
   换掉就丢掉 reactive 的代理，症状正是「数据变了界面不动」。 */
/* 步骤 17e：整包赋值的响应式写法。`X = {...}` 对 reactive 对象是换引用，Vue 追踪不到
   （症状：数据换了界面不动）。reassign 在同一个 proxy 上先删键再写键，读侧一个字不用改。 */
function reassign(box, v){
  for(var k in box) delete box[k];
  if(v && typeof v === 'object') Object.assign(box, v);
  return box;
}

/* 剪贴板暂存队列整簇（含 CLIP 盒子）搬进 js/clipflow.js（P14 S6 步骤 30）。 */
/* emptyState() 也一起删：空态块现在是 components/empty-state.js 的 <empty-state> 组件，
   app.js 里最后一个调用方就是上面那个 folderRender。 */
/* 错过的提醒（后台被冻结时到点的那些）整簇搬进 js/missedflow.js（P14 S6 步骤 36）：
   启动时拉一次 /api/missed → 首页横幅 → 清单弹层 → 完成 / 跳转 / 我知道了。
   循环依赖（missedflow.js 反过来 import app.js）安全：那边只在函数体里读。 */
/* 截图捕获与监控文件夹整簇搬进 js/shotflow.js（P14 S6 步骤 29）：扫描 → 横幅 → 多选 →
   导入 → 进度层 → 文件夹白名单，355 行自成一体的功能，这里剩下的只有把它们挂进
   HOST / HOST_KEYS 的几笔。循环依赖安全：shotflow.js 只在函数体里读 app.js 的东西。 */
/* 剪贴板暂存（P7）：顶栏 📋 → 暂存队列 → 勾选 → 存笔记 / 一键解析。整簇搬进
   js/clipflow.js（P14 S6 步骤 30），这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
function relTime(iso){
  if(!iso) return '';
  var d = new Date(iso); if(isNaN(d)) return '';
  var s = Math.floor((Date.now()-d.getTime())/1000);
  if(s < 60) return '刚刚';
  if(s < 3600) return Math.floor(s/60)+' 分钟前';
  if(s < 86400) return Math.floor(s/3600)+' 小时前';
  return Math.floor(s/86400)+' 天前';
}
window.openClip = openClip;
/* 打开一条笔记 / 一条待办（通知点进来定位到那条待办）+ 把到期时间交给系统日历 /
   闹钟那一簇搬进 js/openflow.js（P14 S6 步骤 37）。下面两行是 Java 侧通知的入口桥，
   名字不能动，留在 app.js。 */
window.openNote = openNote; window.notifyResult = notifyResult;
window.openTodo = openTodo;

/* .todo 的类名串：done / pri-high / 入场动画。Vue 模板用 :class 算出来的必须和这里一致。 */
function todoRowCls(n, t){
  return (t.done?' done':'')+(t.priority==='high'?' pri-high':'')+todoEnterCls(n,t);
}

function notesFiltered(){
  if(SR.notes) return SR.notes; // 服务端结果（已排序）
  var p = P(), a = S.notes.filter(function(n){
    if(p.src==='image' && !/image$/.test(n.source||'')) return false;
    if(p.src==='text' && /image$/.test(n.source||'')) return false;
    if(p.status!=='all' && n.status!==p.status) return false;
    return hit([n.title, n.content, (n.tags||[]).join(' '),
                (n.todos||[]).map(function(t){return t.text}).join(' ')].join(' '));
  });
  var s = p.sort||'new';
  a.sort(function(x,y){
    if(s==='title') return (x.title||'').localeCompare(y.title||'', 'zh');
    if(s==='old') return (x.createdAt||'').localeCompare(y.createdAt||'');
    return (y.createdAt||'').localeCompare(x.createdAt||'');
  });
  return a;
}
function groupTodos(){
  var g = {'已逾期':[],'今天':[],'明天':[],'本周':[],'以后':[],'无日期':[],'已完成':[]};
  var t = new Date(), p = n=>String(n).padStart(2,'0');
  var today = now().slice(0,10);
  var weekEnd = new Date(t.getTime()+6*864e5);
  var weekEndS = weekEnd.getFullYear()+'-'+p(weekEnd.getMonth()+1)+'-'+p(weekEnd.getDate());
  S.notes.forEach(function(n){(n.todos||[]).forEach(function(x){
    var o = {t:x, n:n};
    if(x.done) g['已完成'].push(o);
    else if(!x.due) g['无日期'].push(o);
    else if(x.due < now()) g['已逾期'].push(o);
    else if(x.due.slice(0,10)===today) g['今天'].push(o);
    else if(x.due.slice(0,10)===tomorrow()) g['明天'].push(o);
    else if(x.due.slice(0,10)<=weekEndS) g['本周'].push(o);
    else g['以后'].push(o);
  })});
  return g;
}
function tomorrow(){var d=new Date(Date.now()+864e5),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())}
function rank(t){ return ({high:3,normal:2,low:1})[t.priority||'normal'] }
function hit(s){ if(!q) return true; return (s||'').toLowerCase().indexOf(q.toLowerCase())>=0 }
/* 数据卡 / 运行状态卡（步骤 10）：整块（含按钮）交给叶子函数，两条路径共用。
   这两块的文本是「3 / 2」这种三段拼接：模板里写成一个插值就只产生一个文本节点，
   VDIFF 的序列化器逐节点 trim 后拼出来是「3/2」，与遗留的「3 / 2」对不上。
   结构必须逐字一致，所以整块共用而不是拄进模板。 */
/* ---------- 步骤 10：设置页的纯展示块 ----------
   这三块没有 handler，整块交给叶子函数，Vue 侧 v-html 同一份字符串 —— 长段说明文字
   拄进模板的话，模板里多一个换行就少一个空格，VDIFF 比文本节点时很难查。 */
/* 常驻后台那段长说明（无 handler）；电池优化那一段带两个按钮，留在模板里 */
/* 每个 tab 一个常驻面板（R14）：来回切页不重绘整个页面，滚动位置也不会丢。
   数据变了才把「其它页」标记为待重绘，切过去时重建一次。 */
var panes = {}, paneBuilt = {}, paneDirty = {}, tabScroll = {notes:0, todos:0, files:0, mine:0};
var lastTab = 'notes';
function paneFor(t){
  if(!panes[t]){
    var d = document.createElement('div');
    d.className = 'pane'; d.dataset.tab = t; d.style.display = 'none';
    $('#view').appendChild(d);
    panes[t] = d;
  }
  return panes[t];
}
/* 数据变了：其它 tab 的面板下次显示时重建（当前 tab 由 render() 直接重建） */
function invalidatePanes(keep){
  Object.keys(paneBuilt).forEach(function(k){ if(k !== keep) paneDirty[k] = 1 });
}
function showPane(){
  Object.keys(panes).forEach(function(k){
    panes[k].style.display = (k === tab) ? '' : 'none';
  });
}
/* 已迁移到 Vue 的 tab（D14 混合期的唯一开关）：加一行就迁移一个视图，删掉一行就退回字符串路径。
   步骤 5 notes；6 todos；7 files；9 clip；10 stats/mine；步骤 11 删掉遗留路径。 */
var VUE_VIEWS = { notes: NotesView, todos: TodosView, files: FilesView, mine: StatsView };
/* 步骤 8：弹层（sheet）的注册表，与 VUE_VIEWS 同一套开关语义：加一行就迁移一个弹层，
   删掉一行就退回字符串路径。步骤 17j：progress（截图导入进度层）从这张表里没掉了 ——
   它不是弹层，现在住在外壳树的 <teleport> 里，不走 mountSheet 那张表。
   闸门⑮ 会查完整性：views/ 里 export const *View 必须出现在 VUE_VIEWS ∪ VUE_SHEETS。 */
var VUE_SHEETS = { shots: ShotsView, folders: FoldersView, clip: ClipSheetView,
  settings: SettingsSheetView, sort: SortSheetView, missed: MissedSheetView, add: AddSheetView,
  addtodo: AddTodoSheetView, log: LogSheetView, debug: DebugSheetView };
/* DOM 测量类的副作用：必须在 DOM 落地之后跑（遗留路径是同步 innerHTML，Vue 路径是 nextTick 之后） */
function afterPaint(){
  syncReminders();
  syncExpand();
}
function render(){
  var p = paneFor(tab);
  invalidatePanes(tab);
  showPane();
  paintStatus();
  clearEnter();
  /* 步骤 11 起这是唯一一条渲染路径：四个 tab 全在 VUE_VIEWS 里，字符串渲染器（页面级
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
}
/* S3（D17）：首屏画完的记号。两个用途：__enote.ready 的兑现点，也是 index.html 里
   看门狗（D16）的存活信号。声明成函数 + 可空回调是因为时序：refresh() 在模块末尾的
   __enote 装配之前就被调用，render() 可能在 Promise 存好之前就跑到，直接引用会拿到 undefined。 */
var readyResolve = null, firstPainted = false;
function markReady(){
  if(firstPainted) return;
  firstPainted = true;
  if(readyResolve) readyResolve();
}
/* 这里不能再有一份同名 render 函数：函数声明提升会让后一份覆盖前一份，Vue 分发会静默失效。
   web_test.go 钉了「全文只有一个 render 定义」。 */

/* 「展开详情」只在正文真的超过三行时才出现：先去掉 clamp 量整段高度，再加上 clamp 量三行高度，
   两者一样就说明没被截断，按钮没意义，直接藏起来（否则每张短笔记都挂一个点了没反应的按钮）。 */
function syncExpand(){
  var cards = document.querySelectorAll('#view .card');
  for(var i=0;i<cards.length;i++){
    var b = cards[i].querySelector('.body'), btn = cards[i].querySelector('.btn.exp');
    if(!b || !btn) continue;
    var was = b.classList.contains('clamp');
    b.classList.remove('clamp');
    var full = Math.round(b.getBoundingClientRect().height);
    b.classList.add('clamp');
    var three = Math.round(b.getBoundingClientRect().height);
    if(!was) b.classList.remove('clamp');
    btn.style.display = (full - three > 1) ? '' : 'none';
  }
}
function strip(){
  var i = S.info;
  return '<div class="metrics">'
    + '<div class="m"><b>' + (i.open || 0) + '</b><span>' + ic('check-square', 's') + '待办</span></div>'
    + '<div class="m' + (i.overdue ? ' hot' : '') + '"><b>' + (i.overdue || 0) + '</b><span>'
      + ic('alert', 's') + '逾期</span></div>'
    + '<div class="m"><b>' + (i.notes || 0) + '</b><span>' + ic('note', 's') + '笔记</span></div>'
    + '<div class="m wide' + (i.ocrReady ? ' ok' : '') + '">' + ic(i.ocrReady ? 'mic' : 'mic-slash', 's')
      + (i.ocrReady ? '本机 OCR 就绪' : 'OCR 引擎启动中…') + '</div>'
    + '</div>';
}
function paintStatus(){
  var i = S.info;
  shell.dot = (i.server && i.ocrReady) ? '' : 'bad';
}
/* 附件页（R4）整簇搬进 js/filesflow.js（P14 S6 步骤 31）：FA 盒子、抢占判定、大小/图标
   格式化、打开与删除、系统文件选择。这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
/* 我的页（R5）统计那一簇（ST 盒子、stBusy 超时、statsNow、statCls）搬进
   js/statsflow.js（P14 S6 步骤 33）。这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
/* ---------- 步骤 10：我的页 / 设置页的叶子片段 ----------
   这些片段函数是 Vue 模板的渲染帮手（经 setHost 暴露给组件）；步骤 11 删掉遗留字符串
   渲染器之后它们只剩一个调用者，留着是因为模板里拼 HTML 的写法与它们逐字一致；Vue 侧经 setHost
   的 H.xxx 调用。hero 整块是静态结构 + 三处动态值，留在叶子函数里比模板抄一遍少一处漂移面。 */
/* 笔记状态卡（纯展示，无 handler）：整块交给叶子函数，Vue 侧 v-html 同一份字符串。
   卡壳（<div class="card">）由两条路径各自写，内容逐字共用。 */
/* 我的页最底部的运行信息卡。设置页的「运行状态」卡前三行相同、第四行是解析队列，
   所以只共用这三行，第四行各自写。 */
/* 设置页那一簇（SFORM / 表单 / 设置弹层 / 导出导入 / 清空 / 排序偏好）搬进
   js/settingsflow.js（P14 S6 步骤 32）。这里剩下的只有挂进 HOST / HOST_KEYS 的几笔。 */
/* 从系统设置页回来后重新读一次权限/保活状态；顺便重画，让「剪贴板刚有更新」提示立刻出现 */
window.onAppResume = function(){
  shotFlags();
  settingsRefresh();
  if (S && S.notes) render();
};
/* 导出 JSON / 导入 JSON / 清空全部笔记 / 排序浮层 / 偏好读写搬进 js/settingsflow.js
   （P14 S6 步骤 32）。 */
/* ---------- 轮询：只在数据真的变了才重绘（避免秒级闪烁 ----------
   2s 一次的 /api/state 很便宜，但 render() 要重建整个列表、重载缩略图、
   重播入场动画。所以先比指纹，没变就只刷新右上角状态点。 */
var SIG = '', drawn = false;
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
  var sf = (typeof SHOTFLAGS.v === 'object' && SHOTFLAGS.v) || {};   // 启动早期还没有 flags
  return JSON.stringify([d && d.notes, i, (d && d.settings) || {},
    [sf.enabled?1:0, sf.folders||0, sf.granted?1:0]]);
}
async function refresh(quiet){
  if(Date.now() < animLock){ paintStatus(); return }
  try{ var d = await api('/api/state'); reassign(S, d); if(MISSED.v) S.missed = MISSED.v;
       var dirty = !quiet || !drawn || stateSig(d) !== SIG;
       if(!prefsLoaded && S.settings && S.settings.ui){
         prefsLoaded = true;
         var fp = flattenPrefs(S.settings.ui);
         Object.keys(fp).forEach(function(k){
           prefs[k] = Object.assign(prefs[k]||{}, fp[k]);
         });
         q = syncBox(QB, P().q || '');
         shell.q = q; shell.has = !!q;
         dirty = true;
       }
       if(themeOf() !== CUR.v){ CUR.v = themeOf(); applyTheme(); dirty = true; }
       paintStatus();
       if(!dirty) return;
       SIG = stateSig(d); drawn = true;
       searchNow(dirty); }
  catch(e){ shell.dot = 'bad'; if(!drawn) render(); }
}
function expand(id){ open[id]=!open[id]; expAnim[id]=1; render(); setTimeout(function(){ delete expAnim[id] }, 400) }
async function toggle(nid,tid,el){
  // 先就地动画（划线 + 勾选 + 淡出），再提交，再让新位置高亮入场；轮询在动画期间不重绘
  var row = el && el.closest ? el.closest('.todo') : null;
  var done = row ? row.classList.contains('done') : false;
  justDone[nid+'|'+tid] = 1;
  if(row){
    if(!done){
      row.classList.add('justdone');
      var cb = row.querySelector('.cb');
      if(cb){ cb.classList.add('on'); }
      animLock = Date.now() + 900;
      setTimeout(function(){ row.classList.add('leaving') }, 430);
    }else{
      row.classList.add('undone');
      animLock = Date.now() + 520;
    }
  }
  api('/api/todo', {action:'toggle', noteId:nid, todoId:tid}).then(function(){
    setTimeout(function(){ animLock = 0; refresh(true) }, done ? 300 : 780);
  }, function(){ animLock = 0; refresh(true) });
}
var justDone = {}, animLock = 0;
function keyOf(n,t){ return n.id+'|'+t.id }
function todoEnterCls(n,t){ return justDone[keyOf(n,t)] ? ' enter' : '' }
function clearEnter(){ setTimeout(function(){ justDone = {} }, 120) }
/* 入场动画只给“新出现”的元素：tab 切换时清空 seen，轮询重绘就不会反复跳 */
function enterCls(id){
  if(!id) return '';
  if(seen[id]) return '';
  seen[id] = 1;
  return ' enter';
}
function clearSeen(){ seen = {} }
async function delTodo(nid,tid){ await api('/api/todo',{action:'delete',noteId:nid,todoId:tid}); refresh(); }
async function reparse(id){ if(busy[id])return; busy[id]=1; toast('AI 重新解析中…');
  await api('/api/reparse',{id:id}); setTimeout(refresh,600); setTimeout(refresh,4000); }
function delNote(id){
  askDel('这条笔记？删除后不可恢复。', function(){
    api('/api/delete', {id:id}).then(function(){ toast('已删除'); refresh(); });
  });
}
function reocr(id){ if(!window.Android){toast('图片识别只在 app 内可用');return;}
  toast('正在识别图片…'); Android.reocr(id); setTimeout(refresh,1500); setTimeout(refresh,5000); }
/* jump(id)（从弹层 / 附件页跳回那条笔记并展开）搬进 js/openflow.js（P14 S6 步骤 37）。 */
function toggleAI(){ var s=S.settings; s.useAI=!s.useAI; saveSettings(); }
async function saveSettings(){
  /* 步骤 20：六项全部来自 SFORM（输入框是它的纯函数），不再 $('#sUrl').value 读 DOM。
     useAI 是开关，直接读 S.settings（van-switch 的那条线，见 18e）。 */
  var f = SFORM.v || {};
  var s = {baseUrl:String(f.baseUrl||'').trim(), apiKey:String(f.apiKey||'').trim(),
    model:String(f.model||'').trim(), timeoutS:parseInt(f.timeoutS)||90,
    maxTokens:parseInt(f.maxTokens)||2048, useAI:S.settings.useAI,
    temperature:f.temperature===''?0.2:parseFloat(f.temperature)||0.2};
  var r = await api('/api/settings', s);
  toast(r.ok?'已保存':'保存失败');
  if(r.ok){ S.settings=r.settings; formFill(); render(); }
}
/* 步骤 19：这是全项目最后一处「拼字符串 + esc() 写 innerHTML」。换成一个 {v:} 盒子，
   #llmOut 里的 DOM 由 settings.js 的模板画 —— 转义交给 Vue 的插值（textContent），
   「连接中」与结果两态都是状态的纯函数。整包赋值，所以读它的是 getter（同 LOGDATA）。 */
var LLMTEST = Vue.reactive({ v: null });
async function testLLM(){
  LLMTEST.v = {busy:true};
  var r = await api('/api/llm/test',{});
  LLMTEST.v = {busy:false, ok:!!r.ok, ms:r.ms, httpCode:r.httpCode, reply:r.reply, error:r.error};
}
/* 运行日志 / AI 调用记录：步骤 16c 之前是「取完数据才弹」（await api 然内拼字符串），
   组件里自己 fetch 会变成「先弹出一个空的再填」，那是行为改动不是重构，所以数据依旧
   在这里取好，经 HOST 的 logData / debugData 递给组件（弹层每次打开都是新实例）。 */
var LOGDATA = Vue.reactive({ v: null }), DEBUGDATA = Vue.reactive({ v: null });
async function showLog(){
  var r = await api('/api/log?n=150');
  LOGDATA.v = r;
  return sheetVue('log');
}
async function showDebug(){
  var r = await api('/api/llmlog');
  DEBUGDATA.v = r;
  return sheetVue('debug');
}
function clip(s,n){s=s||'';return s.length>n?s.slice(0,n)+'…':s}

/* 步骤 39：自绘对话框那一簇（dialog / closeDlg / askDel）搬进 js/dlgflow.js（循环依赖，
   同上：本模块顶层不碰 app.js，只在函数体里读 tab，写 tab 走 setTabTo）。
   这两行 window 桥留在本文件：Java 的 onJsAlert/onJsConfirm 与手机返回键找的是全局名，
   闸门㉒ 的 APP_BRIDGES 钉住它们不许搬走。 */
window.uiDialog = function(title, msg, id){ uiDialog(title, msg, id) };

window.uiBack = function(){ return uiBackKey() };
/* 「记一笔」与「添加待办」那一簇（FORMS / formSet / addSheet / addNote / pickImage /
   addTodoSheet / addTodo）搬进 js/addflow.js（P14 S6 步骤 40，循环依赖，同上）。
   SHEETARGB 这个盒子留在本文件的盒子区（声明顺序是硬要求），那边写它走 syncBox。 */
/* reset=true 表示明确要回到顶部（打开某条笔记、返回键回首页），否则恢复上次的位置 */
function setTab(reset){
  tab = syncBox(TAB, tab || 'notes');
  if(lastTab !== tab) tabScroll[lastTab] = window.scrollY;   // 记住离开时看到哪儿
  /* 步骤 15：页签高亮、fab 图标/文案、搜索框占位符、顶栏显隐（我的页无顶栏）以前是
     五处命令式 DOM 写，漏一处就是「切了页签按钮没变」。现在只写 shell 这张表，
     顶栏显隐走 body[data-tab] + CSS（它是「当前在哪个页签」的纯函数）。 */
  document.body.dataset.tab = tab;
  shell.tab = tab;
  var f = FABS[tab] || FABS.notes;
  shell.fab = { icon: f.icon, label: f.label, hidden: false };
  shell.placeholder = tab==='todos' ? '搜索待办' : tab==='files' ? '搜索附件' : '搜索笔记与待办';
  q = syncBox(QB, P().q || '');
  shell.q = q;
  shell.has = !!q;
  var fresh = !paneBuilt[tab] || paneDirty[tab];
  if(fresh){
    clearSeen();   // 重建这一页：卡片算“新出现”，入场动画重跑一次
    render();
  } else {
    showPane();    // 只是切过去：DOM 原样保留，不重绘
  }
  searchNow();     // 搜索条件可能变了（服务端结果回来后 render 会再走一次）
  lastTab = tab;
  var y = reset ? 0 : (tabScroll[tab] || 0);
  if(reset) tabScroll[tab] = 0;
  requestAnimationFrame(function(){ window.scrollTo(0, y) });
  if(tab==='mine' && !ST.v) statsNow();
  /* 指示条要量活动页签的真实几何，而 .tab.on 这个类是 Vue 在 nextTick 才落到 DOM 上的，
     所以测量也必须排在 nextTick 之后（同步量会量到上一个页签的位置）。 */
  nextTick(moveInd);
}
/* 页签指示条：宽度/位移是从真实布局量出来的（DOM 测量只能读 DOM），量完写进 shell.ind，
   由 TabBar 渲染成内联 style。 */
function moveInd(){
  var el = document.querySelector('.tabbar .tab.on');
  if(!el) return;
  shell.ind = { w: Math.round(el.offsetWidth*0.46), x: el.offsetLeft + el.offsetWidth*0.27 };
}
/* 步骤 16d：ico 存的是 ic('plus','l') 那串 SVG 字符串（shell.fab 的 v-html 直插），
   现在只存图标名，SVG 由 shell.js 的 <ico> 组件渲染 —— v-html 全项目归零。 */
var FABS = {
  notes:{icon:'plus', label:'记一笔', fn:function(){ addSheet() }},
  todos:{icon:'plus', label:'记待办', fn:function(){ addSheet() }},
  files:{icon:'clip', label:'加附件', fn:function(){ pickFile() }},
  mine:{icon:'plus', label:'记一笔', fn:function(){ addSheet() }}
};
/* 涟漪（R10）：只给“真按钮”——它们自带 position:relative + overflow:hidden。
   列表行 .li 不参与：它不是定位容器，水波会跑到 viewport 上，铺满全屏 = 闪屏 */
document.addEventListener('pointerdown', function(e){
  var el = e.target.closest ? e.target.closest('.btn,.iconbtn,.tab,.fab,.seg button') : null;
  if(!el) return;
  var r = el.getBoundingClientRect(), d = Math.max(r.width, r.height);
  var s = document.createElement('span');
  s.className = 'rip';
  s.style.width = s.style.height = d+'px';
  s.style.left = (e.clientX - r.left - d/2)+'px';
  s.style.top  = (e.clientY - r.top  - d/2)+'px';
  el.appendChild(s);
  setTimeout(function(){ if(s.parentNode) s.parentNode.removeChild(s) }, 320);
});
/* ---------- 外壳的事件（步骤 15）----------
   以前是 querySelector + .onclick / addEventListener 挂在静态标记上；现在顶栏与底栏由
   Vue 渲染，事件写在模板里（@click="H.xxx(...)"），这里只留被调的函数本体。
   这些名字必须同时出现在下面的 setHost 宿主对象里（闸门⑮ 查模板里的 H.xxx ⊆ setHost）。
   剪贴板按钮与排序按钮直接复用 importClip / sortSheet，模板里调的就是它们本名。 */
function tabPick(t){
  if(tab === t){ window.scrollTo({top:0, behavior:'smooth'}); return; }
  tab = syncBox(TAB, t); setTab();
}
function brandGo(){ tab = syncBox(TAB, 'mine'); setTab(true) }
function fabAct(){ (FABS[tab] || FABS.notes).fn() }
/* 搜索框那两个 handler（searchInput / searchClear）搬进 js/searchflow.js（步骤 41，
   循环依赖，同上）；写 app.js 的 q 走 setQ / setQRaw。 */
window.addEventListener('resize', moveInd);
// 安静轮询：数据没变就只刷状态点，不重建 DOM
/* ---------- S3（D14）：Vue 宿主接口 ----------
   组件不持有数据，只通过 H 读模块状态（getter 取当前值，因为 S / MISSED.v / SHOTFLAGS.v
   这些是会被整体赋值的 var）。必须在首次 refresh() 之前装好：render() 会 mount Vue 视图，
   组件 setup() 里就要读 H。 */
var HOST = setHost({
  /* 步骤 17f：tab 是字符串，读原变量追踪不到（整包赋值换的是引用），必须读盒子。 */
  get S(){ return S }, get SR(){ return SR }, get tab(){ return TAB.v },
  get open(){ return open }, get MISSED(){ return MISSED.v }, get SHOTFLAGS(){ return SHOTFLAGS.v },
  notesFiltered: notesFiltered, enterCls: enterCls, ic: ic, esc: esc, fmtTime: fmtTime,
  /* 步骤 16：叶子 HTML 函数（srcChip / statusChip / factsInner / factsBlock / todoRow /
     metaHTML / whereHTML / attachHTML / cbInnerHTML / todoTxHTML / remindBtns）翻成了
     components/leaf.js 里的真组件，这张表里只留组件要读的算法：类名串、倒计时文案、
     时间格式、当前时间串（到期判定）、两个系统 intent 入口。 */
  now: now, cdCls: cdCls, cdText: cdText, toCalendar: toCalendar, toAlarm: toAlarm,
  clipHint: function(){ return !!(window.Android && Android.clipHint && Android.clipHint() === '1') },
  expand: expand, reparse: reparse, reocr: reocr, addTodoSheet: addTodoSheet, delNote: delNote,
  missedSheet: missedSheet, shotSheet: shotSheet, shotSetup: shotSetup, askShotPerm: askShotPerm,
  folderSheet: folderSheet, clipSheet: clipSheet, importClip: importClip, shotGo: shotGo,
  /* 步骤 6 加：TodosView 的宿主函数。漏一个的症状是「Vue 渲染抛错 → render() 静默回退
     字符串渲染器」，肉眼看不出来 —— 闸门⑮（ui_test.js）静态扫模板里的 H.xxx 必须都在
     setHost 的 key 里（Vue 读的是宿主对象，不是 window），test.sh 的 TINT 步骤动态断言
     __enote.vue.isVue(todos) 且 TodosView 真的挂载了。 */
  /* 步骤 22 从宿主里摘掉 todoEnterCls / relTime：模板里没人读 H.它们（闸门⑮ 只查
     「模板用了宿主没有的」，反方向没人查），函数是 app.js 内部用的，挂在宿主上只是
     让 narrowHost 多搬两个没人读的钥匙。 */
  strip: strip, P: P, groupTodos: groupTodos, todoRowCls: todoRowCls,
  /* 步骤 15：外壳（顶栏 / 底栏+fab / 弹层宿主 / 对话框）的事件入口。模板里写的是
     @click="H.xxx(...)"，走的就是这张表（闸门⑮ 逐个查名字在不在）。 */
  brandGo: brandGo, tabPick: tabPick, fabAct: fabAct,
  searchInput: searchInput, searchClear: searchClear,
  closeSheet: closeSheet, sortSheet: sortSheet, sheetLeft: sheetLeft,
  dlgOk: function(){ closeDlg(true) }, dlgCancel: function(){ closeDlg(false) },
  hit: hit, rank: rank,
  toggle: toggle, jump: jump, render: render,
  /* 步骤 7 加：FilesView 的宿主函数（同上，漏一个就是静默回退字符串渲染器）。
     FA / q 是模块状态，必须走 getter：直接传值的话 Vue 拿到的是装配时那份快照，
     2s 轮询换掉 FA 后视图不会动（症状是「附件页永远停在首屏数据」）。 */
  get FA(){ return FA }, get q(){ return QB.v },
  attachCardCls: attachCardCls, attachGlyphName: attachGlyphName,
  openAttach: openAttach, delAttach: delAttach, filesNow: filesNow,
  /* 步骤 8 加：ShotsView / FoldersView / ShotProgress 的宿主接口。漏一个的症状同步骤 6：
     Vue 渲染抛错 → 静默回退字符串渲染器，闸门⑮ 静态扇模板里的 H.xxx 钉住它。
     SHOTS.list / SHOTS.sel / FOLD.all / FOLD.sel / SHOTPROG 会被整体赋值，必须走 getter
     （同 FA / q 的教训：传值的话 Vue 拿的是装配时那份快照）。 */
  get shotList(){ return SHOTS.list }, get shotSel(){ return SHOTS.sel },
  get shotLoading(){ return SHOTS.loading }, get shotError(){ return SHOTS.error },
  get folderAll(){ return FOLD.all }, get folderSel(){ return FOLD.sel },
  get folderQ(){ return FOLD.q }, get SHOTPROG(){ return SHOTPROG },
  fmtClock: fmtClock, folderLabel: folderLabel,
  shotPick: shotPick, shotSelAll: shotSelAll, shotIgnoreSel: shotIgnoreSel,
  doImportShots: doImportShots,
  folderPick: folderPick, folderSelAll: folderSelAll, folderPickShots: folderPickShots,
  folderFilter: folderFilter, folderSave: folderSave,
  /* 步骤 9 加：ClipSheetView 的宿主接口（同上，漏一个就是静默回退字符串渲染器）。
     CLIP.list / CLIP.sel 会被整体赋值（loadClips / clipParse），必须走 getter。 */
  get clipList(){ return CLIP.list }, get clipSel(){ return CLIP.sel },
  get clipLoading(){ return CLIP.loading }, get clipError(){ return CLIP.error },
  clipPick: clipPick, clipSelAll: clipSelAll, clipDel: clipDel,
  clipDelSel: clipDelSel, clipParse: clipParse,
  clipItemCls: clipItemCls, clipPrevText: clipPrevText, clipThumbText: clipThumbText,
  clipMetaText: clipMetaText, clipParseText: clipParseText,
  /* 步骤 10 加：StatsView / SettingsSheetView 的宿主接口（同上，漏一个就是静默回退字符串渲染器，
     闸门⑮ 静态扇模板里的 H.xxx 钉住它）。
     ST.v / remindPending 会被整体赋值（statsNow / refresh），必须走 getter；SHOTFLAGS.v 步骤 8 已有。 */
  get ST(){ return ST.v }, get remindPending(){ return REMIND.v },
  get stErr(){ return STERR.v }, statsNow: statsNow,
  get srErr(){ return SRERR.v },
  /* 步骤 13 加：真机竞态回归用例要能在附件页请求在飞时开一次笔记页搜索（抢占
     searchSeq），没有它只能靠 refresh() 间接抢，抢不中就是空跑。 */
  searchNow: searchNow,
  statCls: statCls,
  /* 步骤 16c 加：最后六个字符串弹层翻成真组件后的宿主接口（同上，漏一个就是静默回退）。
     logData / debugData / sheetArg 是「开弹层时现取的数据」，会被整体赋值，必须走 getter
     （同 FA / q 的教训）；clipText 是 AI 调用记录里的 200 字截断。 */
  setPref: setPref, resetPrefs: resetPrefs,
  missedDone: missedDone, missedGoTodos: missedGoTodos, missedDismiss: missedDismiss,
  addNote: addNote, pickImage: pickImage, addTodo: addTodo, clipText: clip,
  get logData(){ return LOGDATA.v }, get debugData(){ return DEBUGDATA.v },
  get llmTest(){ return LLMTEST.v },
  /* 步骤 20：设置页表单（SFORM.v 整包赋值 + 逐键改，读的是 getter）与输入回写。 */
  get SFORM(){ return SFORM.v }, formInput: formInput,
  /* 步骤 21：记一笔 / 添加待办两个弹层的表单盒子与写回。 */
  get FORMS(){ return FORMS.v }, formSet: formSet,
  get sheetArg(){ return SHEETARGB.v },
  fmtSize: fmtSize, notifyGranted: notifyGranted, exactGranted: exactGranted,
  keepAliveOn: keepAliveOn, batteryIgnoring: batteryIgnoring,
  askNotify: askNotify, askExact: askExact, askBattery: askBattery,
  toggleKeepAlive: toggleKeepAlive, toggleAI: toggleAI, setTheme: setTheme,
  saveSettings: saveSettings, testLLM: testLLM, showLog: showLog, showDebug: showDebug,
  exportJSON: exportJSON, importJSON: importJSON, clearAllNotes: clearAllNotes,
  settingsSheet: settingsSheet, scanShotsNow: scanShotsNow, rescanShots: rescanShots,
  clearShots: clearShots
});

/* 步骤 17m：每个 app 的宿主接口只给「这棵组件树真正读到的那些 key」。
   全量宿主 132 个 key，每个 app 只读 0–27 个，其中 93 个 key 全项目只有一个 app 用。
   以前每个 app 都拿到全量，笔记模板里写 H.clipParse 也能跑（拼错了也撞上别的域的名字），
   运行时没人拦得住；现在越界就是 undefined。
   这张表由 .test/host_split.py --emit 从组件注册表算出来（每个 app 根的组件闭包 ∪ 其中
   出现的 H.xxx），闸门⑮ 独立复核三个方向：表里的 key 必须真在宿主上、树里读到的必须在
   表里、表里不许列这棵树没读的 key。app id 就是挂载点的名字：view:<tab> / sheet:<name> /
   shell:<容器 id>（shell.js 的 mount(id, def)）。 */
var HOST_KEYS = {
  /* view:notes     组件根 NotesView，27 个 key */
  'view:notes': ['MISSED', 'S', 'SHOTFLAGS', 'SR', 'addTodoSheet', 'cdCls', 'cdText', 'clipHint',
    'clipSheet', 'delNote', 'enterCls', 'expand', 'fmtTime', 'importClip', 'missedSheet',
    'notesFiltered', 'now', 'open', 'reocr', 'reparse', 'searchNow', 'shotGo', 'srErr', 'toAlarm',
    'toCalendar', 'todoRowCls', 'toggle'],
  /* view:todos     组件根 TodosView，16 个 key */
  'view:todos': ['P', 'S', 'SR', 'cdCls', 'cdText', 'enterCls', 'fmtTime', 'groupTodos', 'hit',
    'jump', 'now', 'rank', 'toAlarm', 'toCalendar', 'todoRowCls', 'toggle'],
  /* view:files     组件根 FilesView，10 个 key */
  'view:files': ['FA', 'attachCardCls', 'attachGlyphName', 'delAttach', 'filesNow', 'fmtSize',
    'fmtTime', 'jump', 'openAttach', 'q'],
  /* view:mine      组件根 StatsView，18 个 key */
  'view:mine': ['S', 'SHOTFLAGS', 'ST', 'clearAllNotes', 'clearShots', 'exportJSON', 'fmtSize',
    'folderSheet', 'importJSON', 'rescanShots', 'scanShotsNow', 'settingsSheet', 'shotSheet',
    'showDebug', 'showLog', 'stErr', 'statCls', 'statsNow'],
  /* sheet:shots    组件根 ShotsView，9 个 key */
  'sheet:shots': ['doImportShots', 'fmtClock', 'shotError', 'shotIgnoreSel', 'shotList',
    'shotLoading', 'shotPick', 'shotSel', 'shotSelAll'],
  /* sheet:folders  组件根 FoldersView，9 个 key */
  'sheet:folders': ['folderAll', 'folderFilter', 'folderLabel', 'folderPick', 'folderPickShots',
    'folderQ', 'folderSave', 'folderSel', 'folderSelAll'],
  /* sheet:clip     组件根 ClipSheetView，14 个 key */
  'sheet:clip': ['clipDel', 'clipDelSel', 'clipError', 'clipItemCls', 'clipList', 'clipLoading',
    'clipMetaText', 'clipParse', 'clipParseText', 'clipPick', 'clipPrevText', 'clipSel',
    'clipSelAll', 'clipThumbText'],
  /* sheet:settings 组件根 SettingsSheetView，24 个 key（步骤 19 加 llmTest，
     步骤 20 加 SFORM / formInput） */
  'sheet:settings': ['S', 'ST', 'askBattery', 'askExact', 'askNotify', 'batteryIgnoring',
    'clearAllNotes', 'exactGranted', 'exportJSON', 'fmtSize', 'formInput', 'importJSON',
    'keepAliveOn', 'llmTest', 'notifyGranted', 'remindPending', 'SFORM', 'saveSettings',
    'setTheme', 'showDebug', 'showLog', 'testLLM', 'toggleAI', 'toggleKeepAlive'],
  /* sheet:sort     组件根 SortSheetView，5 个 key */
  'sheet:sort': ['P', 'closeSheet', 'resetPrefs', 'setPref', 'tab'],
  /* sheet:missed   组件根 MissedSheetView，10 个 key */
  'sheet:missed': ['MISSED', 'S', 'cdCls', 'cdText', 'closeSheet', 'fmtTime', 'jump',
    'missedDismiss', 'missedDone', 'missedGoTodos'],
  /* sheet:add      组件根 AddSheetView，2 个 key */
  /* sheet:add      组件根 AddSheetView，4 个 key（步骤 21 加 FORMS / formSet） */
  'sheet:add': ['addNote', 'formSet', 'FORMS', 'pickImage'],
  /* sheet:addtodo  组件根 AddTodoSheetView，2 个 key */
  /* sheet:addtodo  组件根 AddTodoSheetView，4 个 key（步骤 21 加 FORMS / formSet） */
  'sheet:addtodo': ['addTodo', 'formSet', 'FORMS', 'sheetArg'],
  /* sheet:log      组件根 LogSheetView，1 个 key */
  'sheet:log': ['logData'],
  /* sheet:debug    组件根 DebugSheetView，2 个 key */
  'sheet:debug': ['clipText', 'debugData'],
  /* shell:topbar   组件根 TopBar，5 个 key */
  'shell:topbar': ['brandGo', 'importClip', 'searchClear', 'searchInput', 'sortSheet'],
  /* shell:tabbar   组件根 TabBar，2 个 key */
  'shell:tabbar': ['fabAct', 'tabPick'],
  /* shell:sheetRoot 组件根 SheetHost，3 个 key */
  'shell:sheetRoot': ['SHOTPROG', 'closeSheet', 'sheetLeft'],
  /* shell:dlgRoot  组件根 DialogHost，2 个 key */
  'shell:dlgRoot': ['dlgCancel', 'dlgOk'],
  /* shell:toastRoot 组件根 ToastHost，0 个 key */
  'shell:toastRoot': []
};
setHostKeys(HOST_KEYS);

/* Vue 路径的观测缝（步骤 6 加，步骤 5 就没写过）。
   它是给测试用的，不是生产门禁：render() 走哪条路径只看 VUE_VIEWS[tab]，没这个缝时
   Vue 照跑。缺它的代价是「测不出来」：DOM 长得一样就分不出谁画的，所以 test.sh 的
   TINT 用 isVue(tab) + apps[tab] 正向断言「目标 tab 真的由 Vue 挂载」。
   必须在首次 refresh() 之前（mountView 会写 apps[tab]）。 */
window.__enote = window.__enote || {};
window.__enote.vue = { app:null, views:VUE_VIEWS, apps:apps,
                       isVue:function(tab){ return !!VUE_VIEWS[tab] },
                       /* 步骤 8：弹层的观测缝。isVueSheet 是正向断言「目标弹层真的由 Vue
                          挂载」（VDIFF 结构上分不出走了哪条路径：两条的 DOM 按设计逐字相同）；
                          sheets 就是 sheetApps，夹具用它确认 mount/unmount 真的发生了。 */
                       sheets:sheetApps, VUE_SHEETS:VUE_SHEETS,
                       isVueSheet:function(name){ return !!VUE_SHEETS[name] },
                       /* 夹具注入 FOLD.all/FOLD.sel 后要重画一次。名字留着 folderPaint
                          是 test.sh 夹具与签名断言写死的契约；四个弹层现在共用 sheetPaint()。 */
                       folderPaint:function(){ return sheetPaint() },
                       /* 进度层夹具用：直接驱动一次进度层（不跑真导入也能验 DOM） */
                       shotPaint:function(){ return sheetPaint() },
                       clipPaint:function(){ return sheetPaint() },
                       /* 步骤 7 加：宿主接口对象本身。jseval 载荷只能碰 window，而
                          filesNow / setTab 这类「刷新某一页」的函数不在导出表里（导出表
                          只服务内联 handler，加一个 key 就要动 Tony 的基线），测试要刷新
                          附件列表只能走这里。它是观测缝，不是生产门禁。 */
                       host: HOST };
setInterval(function(){ if(!document.hidden) refresh(true); }, 2000);
refresh();
setTab();
// 补看「不在的时候错过的提醒」：不挡首屏，拿到再重绘一次
loadMissed();
// 截图捕获的轻量状态（横幅要按"未开启/没权限/没选文件夹"分状态显示）
shotFlags(function(){ render(); shotIntroOnce() });
/* 启动自检（R15）：把各页渲染和「展开详情」这类交互入口真跑一遍。
   起因：expand() 用了从没声明过的 expAnim，点了抛 ReferenceError，界面一动不动，
   而语法检查、结构断言都发现不了 —— 只有真调用才会暴露。 */
function selfCheck(){
  var errs = [], probe = function(name, fn){
    try { fn() } catch(e){ errs.push(name + ': ' + ((e && e.message) || e)) }
  };
  /* 步骤 11 起四个 tab 只能走 render()（字符串渲染器已删）：逐个切过去渲染一次，
     组件的 setup / computed 抛异常会直接进 SELFCHECK FAIL。 */
  var tab0 = tab;
  ['notes','todos','files','mine'].forEach(function(t){
    probe('render:' + t, function(){ setTab(t); });
  });
  setTab(tab0);
  var n = (S.notes || [])[0];
  if(n){
    probe('expand', function(){
      var was = !!open[n.id];
      expand(n.id);            // 打开
      if(!open[n.id]) throw new Error('点了没展开');
      expand(n.id);            // 收回原状
      open[n.id] = was;
    });
  }
  if(errs.length) console.log('SELFCHECK FAIL ' + errs.join(' | '));
  else console.log('SELFCHECK OK');
}
setTimeout(selfCheck, 1200);

/* ---------- S3（D12）：ES module 导出表 ----------
   页面里 70 处内联 handler（69 onclick + 1 oninput）按**全局**作用域解析函数名。
   加上 type="module" 后顶层 function 变成模块作用域，70 个 handler 会全部静默失效——
   点了没反应、控制台什么都不说（P12 那一类 bug，语法检查和结构断言都发现不了）。
   所以「转 module」和这张表必须同批落地，中间态不能存在；tools/ui_test.js 闸门① 是这条
   防线的执行者：handler 里调用的函数名必须 ⊆ 本表 key ∪ 内建，少一个就报出函数名和次数。
   Object.assign(window, …) 是「70 处 handler 逐字不动」的唯一办法：内联 handler 里的函数名走全局查找。
   （注：这段注释里不能写 onclick="…" 这种字面量，tools/ui_test.js 闸门① 会把它当成真 handler 扫。）
   表必须是**单处对象字面量**（闸门① 用配对括号扫 key），别拆成多处 __enoteActions.foo = foo。
   成员 = 内联 handler 调用的 54 个 ∪ jseval 载荷独有的 api/refresh/render = 57。 */
window.__enoteActions = {
  addNote, addTodo, addTodoSheet, api, askBattery, askExact,
  askNotify, askShotPerm, clearAllNotes, clipDel, clipDelSel, clipParse,
  clipPick, clipSelAll, clipSheet, closeSheet, delAttach, delNote, sheetLeft,
  delTodo, doImportShots, expand, exportJSON, folderFilter, folderPick, folderPickShots,
  folderSave, folderSelAll, folderSheet, importClip, importJSON, jump,
  missedDismiss, missedDone, missedGoTodos, missedSheet, openAttach, pickImage,
  refresh, render, reocr, reparse, resetPrefs, rescanShots, saveSettings,
  scanShotsNow, settingsRefresh, settingsSheet, showDebug, showLog, sortSheet, statsNow,
  clearShots,
  setPref, setTheme, shotIgnoreSel, shotOverlay, shotOvlSub, shotPick, shotSelAll, shotSetup,
  shotGo, shotSheet, testLLM, toAlarm, toCalendar,
  toggle, toggleAI, toggleKeepAlive
};
Object.assign(window, window.__enoteActions);

/* shotOverlay / shotOvlSub 加进导出表是为了测试能测到进度层：它是步骤 8 迁 Vue 的一部分
   （SHOTPROG + ShotProgress 组件），而真机上走一次 AI 解析要几十秒且依赖 LLM，用例里直接
   调这两个入/出口函数比「等真导入」稳定得多。
   步骤 10 补上的四个（settingsSheet / scanShotsNow / rescanShots / clearShots）是**真 bug**：
   我的页的行是 liHTML(…, 'settingsSheet()') 把 handler 当字符串传进去的，闸门① 只扇
   onclick="…" 字面量，扇不到这种「叶子函数的参数」，转 module（步骤 2）后这四个名字不再是
   全局，我的页上「设置 / 现在扫描一次 / 回捞最近 7 天 / 清空截图暂存」四行点了就是
   ReferenceError。新增的闸门①d 扇 handler 字符串参数，钉住这一类。
   步骤 13 补 sortSheet：它是 `$('#sortBtn').onclick = sortSheet` 挂上去的，不是内联 handler，
   闸门① 扇不到；待办页筛选三态用例要在 jseval 里开排序筛选面板，裸调 sortSheet() 就是
   ReferenceError（静态全绿、真机才红，真机日志 TINT ERR=sortSheet is not defined）。闸门②
   现在会把闭集与导出表求交，这类「只有测试调的函数」漏导出会静态红。
   注意：表体里不能写注释 —— tools/ui_test.js 的 exportTableKeys() 是粗解析标识符列表，
   注释会被当成一个名字，运行时导出表比对（P6.6）立刻红。 */

/* ---------- S3（D21）：状态桥 ----------
   jseval 测试载荷跑在 module 外面，拿不到模块作用域里的变量。tab / MISSED.v / SHOTS.sel
   在载荷里是**整体赋值**（tab="notes"），必须有 setter：否则赋值只是在 window 上新建一个
   同名全局变量，模块里的 tab 一动不动，测试会「绿着骗过去」——这正是最难查的一类假绿。
   S / open / SHOTS.list 载荷只读或只改属性，getter 就够；一并给 setter 免得以后踩同一个坑。
   闸门②（步骤 4）按「载荷引用的名字 ⊆ 导出表 ∪ 状态桥 ∪ 内建 ∪ 载荷局部名」判红。 */
window.__enote = window.__enote || {};
window.__enote.actions = window.__enoteActions;
window.__enote.state = {
  get tab(){ return TAB.v }, set tab(v){ tab = syncBox(TAB, v) },
  get S(){ return S }, set S(v){ reassign(S, v) },
  get MISSED(){ return MISSED.v }, set MISSED(v){ MISSED.v = v },
  get open(){ return OPENB.v }, set open(v){ open = OPENB.v = v },
  get shotSel(){ return SHOTS.sel }, set shotSel(v){ SHOTS.sel = v },
  get shotList(){ return SHOTS.list }, set shotList(v){ SHOTS.list = v },
  /* 步骤 8 加：文件夹页夹具要整体注入 FOLD.all / FOLD.sel（Android.shotFolders() 在
     真机上是设备目录，夹具不能依赖它），FOLD.q 是搜索框的当前值。闭合集 17 → 20 名，
     闸门③与 web_test 的名单同步。没 setter 就是 D21 那个坑：赋值只写 window，
     模块变量一动不动，夹具注入完全空跑。 */
  get folderAll(){ return FOLD.all }, set folderAll(v){ FOLD.all = v },
  get folderSel(){ return FOLD.sel }, set folderSel(v){ FOLD.sel = v },
  get folderQ(){ return FOLD.q }, set folderQ(v){ FOLD.q = v },
  /* 步骤 9 加：剪贴板页夹具与交互用例要读 CLIP.list / CLIP.sel（闭合集 20 → 22 名，
     app.js / go/web_test.go / tools/ui_test.js 三处名单同步）。 */
  get clipList(){ return CLIP.list }, set clipList(v){ CLIP.list = v },
  get clipSel(){ return CLIP.sel }, set clipSel(v){ CLIP.sel = v },
  /* 步骤 10 加：我的页 / 设置页的夹具要注入 ST.v（/api/stats 的返回），没 setter 就是 D21
     那个坑。闭合集 22 → 23 名，app.js / go/web_test.go / tools/ui_test.js 三处名单同步。 */
  get ST(){ return ST.v }, set ST(v){ ST.v = v },
  /* 步骤 5 加：SR 是 notesFiltered() 的第一优先级输入（if(SR.notes) return SR.notes），
     不暴露它，夹具把 S.notes 改成 [] 也画不出空态 —— 画的是服务端搜索结果那 2 条，
     症状是「Vue 视图的 computed 冻住了」，实测在这里烧了两轮探针才定位。
     闭合集 16 → 17 名（D21），闸门③与 web_test 的名单同步。 */
  get SR(){ return SR }, set SR(v){ reassign(SR, v) }
};

/* ---------- S3（D17）：__enote 测试缝 ----------
   测试要的是「能可靠地等首屏、能拿到刚装的这版是哪个 sha、能拿到 DOM 入口」，不是靠
   `typeof api === "function"` 猜页面还活着（那个哨兵连 module 没执行都看不出来）。
   必须用 Object.assign 合并：整份赋值会把上面 state 的七个 getter/setter 全冲掉，
   载荷里 tab="notes" 就变成往新对象上写，模块里的 tab 一动不动 —— 步骤 2 那 11 处载荷
   集体假绿，比白屏难查一个量级。
   build.json 由 build.sh 生成（sha 带 -dirty 后缀），/build.json 走 no-store：设备是共享的，
   两个 worktree 轮流装，测试得能证明「页面里跑的就是刚装的这版」。 */
/* 步骤 15：外壳挂载（顶栏/底栏/弹层宿主/对话框/toast 五个应用）。
   必须在首次 render()/refresh() 之前：toast()、dialog()、sheet() 与 __enote.dom 都假定
   #toast / #dlg / #sheet / #panel 这些节点已经存在。 */
mountShell();
moveInd();

var __ready = new Promise(function(r){ readyResolve = r; if(firstPainted) r() });
Object.assign(window.__enote, {
  ready: __ready,
  build: null,
  api: api,
  /* 步骤 15：外壳转 Vue 之后这些节点是挂载之后才出现的，取一次存下来的话拿到的全是
     null —— 改成 getter，载荷每次读都现取。 */
  dom: {
    get main(){ return document.getElementById('view') },
    get sheet(){ return document.getElementById('sheet') },
    get panel(){ return document.getElementById('panel') },
    get toast(){ return document.getElementById('toast') },
    get dlg(){ return document.getElementById('dlg') }
  },
  probe: window.__enoteProbe || null,
  markReady: markReady,
  /* 步骤 18b：轻提示的容器换成 van-toast 之后，静息态下 #toast 节点不存在（Vant 随开随建），
     测试要能主动弹一条才测得到它 —— toast() 是模块内的，测试缝给它一个入口。 */
  toast: toast,
  /* 步骤 11：D17 的遗留基准缝（VDIFF 用来对比字符串渲染器的 legacy 那组）与 afterPaint
     一起删了 —— 字符串渲染器整批删除之后，「与它逐字一致」这个命题没有对象了。
     clearSeen 留着：切 tab 强制重绘与「外部改数据后立刻刷新」那几个用例都靠它，
     它不是迁移期的临时物。 */
  clearSeen: clearSeen,
  /* 步骤 14：失败注入缝（见上面 API_FAIL 的注释）。setter 而不是直接赋值函数：
     载荷里 `__enote.test.failApi = '/api/clip/list'` 就能让下一次请求抛，赋空串关掉。 */
  test: { get failApi(){ return API_FAIL }, set failApi(v){ API_FAIL = v || '' } }
});
/* buildReady（步骤 4，Tony 提的竞态）：ready 在首屏就兑现，build 由这个独立 fetch 填，
   载荷 await ready 后立刻读 E.build 是没顺序保证的（实测不犯：seam 载荷是在桥载荷轮询完
   几秒后注入的）。把 promise 存下来，载荷里带超时 await 一下就能把顺序钉死。
   两个分支都 resolve（失败也返回一个带 error 的对象），载荷里 await 它不会抛。 */
window.__enote.buildReady = fetch('/build.json').then(function(r){ return r.json() }).then(
  function(b){ window.__enote.build = b; return b },
  function(e){ window.__enote.build = { sha: 'unreachable', builtAt: '', error: String(e) };
               return window.__enote.build });

/* 步骤 29：js/shotflow.js（截图捕获那一簇）反过来 import 本模块的这些名字，所以它们要显式
   导出。循环依赖（app.js → shotflow.js → app.js）成立的条件是 shotflow.js 只在函数体里读
   它们，模块求值期谁都不碰谁 —— 那边文件头写了这条契约。
   `tab` 是 `var tab = TAB.v` 且会被 `tab = syncBox(TAB, …)` 重新赋值：ES module 的导入是
   活绑定，重新赋值那边看得见，这一点是这次搬迁最容易踩空的地方。
   步骤 38 起这张表也是 js/sheetflow.js 的取用面（$ / VUE_SHEETS）：VUE_SHEETS 是 var，
   只在 nextTick 回调里读，求值期不碰，安全。 */
export { S, tab, open, q, $, esc, now, toast, dialog, closeSheet, pageSheetVue, setTab,
  refresh, api, paneDirty, statsNow, relTime, statCls,
  apiTimeout, P, SRK, reassign, paintStatus, errText, render, enterCls, askDel,
  prefs, savePrefs, searchNow, setQ, setQRaw, setTabTo, ST, REQ_TIMEOUT_MS, syncBox, STERR,
  dueMs, REMIND, toggle, VUE_SHEETS, SHEETARGB, SRERR }
