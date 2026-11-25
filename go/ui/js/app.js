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
var curTheme = '';
var q = QB.v;
/* 每个页签自己的搜索/排序/筛选条件（P3 会持久化到服务端） */
var prefs = Vue.reactive({
  notes:{sort:'new', src:'all', status:'all'},
  todos:{sort:'due', done:'open', pri:'all'},
  files:{sort:'new', kind:'all'}
});
function P(){ return prefs[tab] || prefs.notes }
/* 图标：ic('search') → 一个 24dp 线性图标，颜色跟着 currentColor */
function ic(n, cls){ return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + n + '"/></svg>' }

/* ---------- 服务端搜索（R3）----------
   列表数据一律来自 /api/search；请求失败时退回本地过滤，断网也能看。 */
var SR = Vue.reactive({notes:null, todoIds:null, where:{}, total:0, scanned:0});
var searchSeq = 0, prefsLoaded = false;
var PREF_KEYS = ['src','status','done','pri','kind','file'];
function prefPayload(){
  var p = P(), f = {};
  // done 的「全部」必须显式发给服务端：省略它时 go/search.go:195 会给 todos 默认成
  // open，于是筛选面板里的「全部」按钮是个空操作（选了之后仍然只看得见未完成）。
  // 服务端 matchTodo 对 done=all 不匹配任何 case → 不过滤，正好是「全部」的语义。
  PREF_KEYS.forEach(function(k){ if(p[k] && (p[k] !== 'all' || k === 'done')) f[k] = p[k] });
  return {tab:tab, q:q, sort:p.sort||'new', dir:p.dir||'', filters:f};
}
function prefQS(){
  var d = prefPayload(), s = 'tab='+d.tab+'&q='+encodeURIComponent(d.q)+'&sort='+encodeURIComponent(d.sort);
  if(d.dir) s += '&dir='+encodeURIComponent(d.dir);
  Object.keys(d.filters).forEach(function(k){ s += '&'+k+'='+encodeURIComponent(d.filters[k]) });
  return s;
}
function flattenPrefs(u){
  var out = {};
  Object.keys(u||{}).forEach(function(k){
    var v = u[k]||{}, p = {q:v.q||'', sort:v.sort||'', dir:v.dir||''};
    Object.keys(v.filters||{}).forEach(function(fk){ p[fk] = v.filters[fk] });
    out[k] = p;
  });
  return out;
}
var saveT = 0;
function savePrefs(){
  clearTimeout(saveT);
  saveT = setTimeout(function(){ api('/api/prefs', prefPayload()).catch(function(){}) }, 350);
}
var SRK = ''; // 上次搜索结果的指纹，内容一样就不重建 DOM
/* 步骤 13：首页搜索也走 apiTimeout —— fetch 没有超时会永久挂起（WebView 进后台
   再回来，在飞的 fetch 永不 resolve），症状是首页永久停在上一份数据上。失败退回
   本地过滤（原有行为）并记 srErr，首页顶部给一条可重试的错误条。 */
var srErr = SRERR.v;
async function searchNow(force){
  if(tab==='files'){ filesNow(); return; }
  var my = ++searchSeq;
  try{
    var d = await apiTimeout('/api/search?'+prefQS());
    if(my !== searchSeq) return;
    srErr = syncBox(SRERR, '');
    var k = JSON.stringify(d);
    reassign(SR, {notes:d.notes||[], todoIds:d.todoIds||null, where:d.where||{}, total:d.total||0, scanned:d.scanned||0});
    // 顶部横幅（剪贴板暂存 / 新截图 / 错过的提醒）不在搜索结果里：搜索结果没变、
    // 但页面签名变了（条数变了）时必须强制重绘，否则「删光剪贴板」「刚扫到新截图」
    // 回到首页都看不到横幅 —— 这两处的 bug 都是这里短路掉的。
    if(k === SRK && !force){ paintStatus(); return }
    SRK = k;
  }catch(e){ reassign(SR, {notes:null, todoIds:null, where:{}, total:0, scanned:0}); SRK = ''; srErr = syncBox(SRERR, errText(e)) }
  render();
}

/* ---------- 主题（R8）：CSS 变量切换 + 同步系统栏颜色 ---------- */
function themeOf(){
  var m = (S.settings && S.settings.theme) || 'light';
  if(m === 'auto')
    return (window.matchMedia && window.matchMedia('(prefers-color-scheme:dark)').matches) ? 'dark' : 'light';
  return m === 'dark' ? 'dark' : 'light';
}
function applyTheme(){
  var t = themeOf();
  document.documentElement.classList.add('theming');
  document.documentElement.setAttribute('data-theme', t);
  var mc = document.querySelector('meta[name=theme-color]');
  if(mc) mc.setAttribute('content', t === 'dark' ? '#0b0f14' : '#f5f7fb');
  if(window.Android && Android.setTheme) Android.setTheme((S.settings && S.settings.theme) || 'light');
  setTimeout(function(){ document.documentElement.classList.remove('theming') }, 240);
}
async function setTheme(mode){
  try{
    var d = await api('/api/theme', {mode:mode});
    S.settings = d.settings; curTheme = themeOf(); applyTheme(); render();
    toast('主题：' + ({light:'亮色', dark:'暗色', auto:'跟随系统'}[mode] || mode));
  }catch(e){ toast('切换失败: '+e) }
}

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
/* ---------- 到期倒计时（R11）----------
   每个未完成待办显示距截止的剩余时间：不足2天 / 不足3小时 / 不足15分钟，过期则「逾期N…」。
   文本由 tickCD() 每 20 秒就地改写 textContent，不重建 DOM（整页重绘会闪）。 */
/* 这里原来还有一个 dueMs（正则解析 `YYYY-MM-DD[ HH:MM]`）。它在旧版普通脚本里是**死代码**：
   同名 function 声明提升时后者覆盖前者，:970 那个 `new Date(iso)` 版本才是真正生效的。
   ES module 不允许顶层同名 function 声明（直接 SyntaxError：Identifier 'dueMs' has already been
   declared，整个模块不执行 = 白屏），所以 S3 转 module 时删掉它。行为零变化：所有调用点
   （tickCD / 逐期待办）本来拿的就是 :970 那份。tools/ui_test.js 现在有一条「顶层声明不得重名」
   的闸门守着，这类遮蔽不会再静默活下来。 */
function spanText(m){
  m = Math.max(1, m);
  if(m >= 1440) return Math.ceil(m/1440)+'天';
  if(m >= 60) return Math.ceil(m/60)+'小时';
  return m+'分钟';
}
function cdText(due){
  var t = dueMs(due);
  if(!t) return '';
  var m = Math.ceil((t - Date.now())/60000);
  return (m <= 0 ? '逾期' : '不足') + spanText(m <= 0 ? -m : m);
}
function cdCls(due){
  var ms = dueMs(due) - Date.now();
  return 'cd' + (ms <= 0 ? ' over' : (ms <= 3600e3 ? ' soon' : ''));
}
/* cdChip() 随「错过的提醒」弹层一起没了（步骤 16c）：那份行结构现在是
   views/sheets.js 的 MissedSheetView，倒计时条是 <cd-chip>（components/leaf.js）。
   它算的是类名 + 文案，两个算法（cdCls / cdText）留在上面，待办页与笔记页共用。 */
function tickCD(){
  var list = document.querySelectorAll('.cd[data-due]');
  for(var i=0;i<list.length;i++){
    var e = list[i], due = e.getAttribute('data-due'), s = cdText(due);
    if(e.textContent !== s) e.textContent = s;
    var c = cdCls(due);
    if(e.className !== c) e.className = c;
  }
}
setInterval(tickCD, 20000);
// ---- R13-E / P6.5：自研到期提醒（AlarmManager + 通知渠道，纯标准 API）----
// Java 那边不存状态：每次渲染后把「未完成且到期时间在将来」的待办整份推过去，
// 它自己 diff 出要新排/要取消的 alarm。id 里带 dueMs，改了时间就是新 id，旧的自然取消。
var remindPending = REMIND.v;
function syncReminders(){
  if(!window.Android || !Android.syncReminders) return;
  var list = [];
  (S.notes||[]).forEach(function(n){
    (n.todos||[]).forEach(function(t){
      if(t.done || !t.due) return;
      var ms = dueMs(t.due);
      if(!ms || ms <= Date.now()+5000) return;          // 已逾期的不排，免得一开 app 就炸一串
      list.push({id:n.id+'|'+t.id, noteId:n.id, todoId:t.id,
                 text:t.text, note:n.title||'', dueMs:ms});
    });
  });
  try { remindPending = syncBox(REMIND, Android.syncReminders(JSON.stringify(list)) || 0); } catch(e){ remindPending = syncBox(REMIND, 0); }
}
function exactGranted(){
  try { return !!(window.Android && Android.exactGranted && Android.exactGranted()); } catch(e){ return true }
}
function askExact(){
  if(!window.Android || !Android.askExact){ toast('精确提醒设置只在 app 内可用'); return }
  Android.askExact();
  toast('打开「闹钟和提醒」权限后回来即可精确到分钟');
}
function notifyGranted(){
  try { return !!(window.Android && Android.notifyGranted && Android.notifyGranted()); } catch(e){ return false }
}
function askNotify(){
  if(!window.Android || !Android.askNotify){ toast('通知权限只在 app 内可设置'); return }
  if(notifyGranted()){ toast('系统通知已授权'); return }
  Android.askNotify();
}
function notifyResult(ok){
  toast(ok ? '系统通知已开启，到点会弹提醒' : '没有通知权限；可在系统设置里打开「懒得记」的通知');
  syncReminders();
  if(document.querySelector('#sheet.on')) settingsRefresh();
}
/* ---- P6.5 常驻后台：前台服务 + 标准电池优化豁免，不针对任何品牌做分支 ---- */
function keepAliveOn(){
  try { return !!(window.Android && Android.keepAlive && Android.keepAlive()); } catch(e){ return false }
}
function batteryIgnoring(){
  try { return !!(window.Android && Android.batteryIgnoring && Android.batteryIgnoring()); } catch(e){ return true }
}
/* 步骤 18e：开关是 van-switch，类名由状态算出来（settings.js 的 keepSwCls），
   handler 不再接元素。关掉要二次确认：服务一停，后台到点的提醒就全交给系统调度了 */
function toggleKeepAlive(){
  if(!window.Android || !Android.setKeepAlive){ toast('常驻后台只在 app 内可用'); return }
  var on = !keepAliveOn();
  if(!on){
    dialog({title:'关闭常驻后台', body:'关闭后 app 在后台可能被系统冻结，到点提醒可能不响。',
      ok:'关闭', danger:true, onOk:function(){ applyKeepAlive(false) }});
    return;
  }
  applyKeepAlive(true);
}
function applyKeepAlive(on){
  Android.setKeepAlive(on);
  /* 开关的视觉状态是 keepAliveOn() 的纯函数，所以这里立刻重读一次原生状态：
     旧版是 el.className 乐观地先改，500ms 后再校准；现在乐观那一步由 computed 做。 */
  settingsRefresh();
  if(on){
    toast('已开启常驻后台');
    if(!batteryIgnoring()) setTimeout(function(){ toast('再点「去关闭电池优化」后台才稳') }, 2400);
  } else {
    toast('已关闭常驻后台');
  }
  setTimeout(settingsRefresh, 500);
}
function askBattery(){
  if(!window.Android || !Android.askBattery){ toast('电池优化设置只在 app 内可用'); return }
  toast('找到「懒得记」→ 选「不限制 / 允许后台活动」');
  Android.askBattery();
}
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

var CLIP = Vue.reactive({ sel: {}, list: [], loading: false, error: '' });
/* emptyState() 也一起删：空态块现在是 components/empty-state.js 的 <empty-state> 组件，
   app.js 里最后一个调用方就是上面那个 folderRender。 */
/* 错过的提醒（后台被冻结时到点的那些）：只在有内容时出现，点开看清单 */
var MISSED = Vue.reactive({ v: null });   // 服务端只在启动时算一次，之后 refresh 覆盖 S 时要把它贴回去
async function loadMissed(){
  try{
    var d = await api('/api/missed');
    if(d && d.count){ MISSED.v = d; S.missed = d; render(); }
  }catch(e){}
}
/* 错过的提醒面板的操作逻辑（用户反馈：只能看，没法处理）
   三条路，每条都有明确后果：
     点整行   → 跳到那条笔记看上下文
     勾「完成」→ 真的把待办标完成，从这份清单里去掉
     「这批我知道了」→ 待办一条不动，只是承认"我看过了"，横幅消失
   横幅本身是"上次打开 app 之后到点的未完成待办"，服务端记的水位；点过「我知道了」
   之后水位已推进，同一批不会再来烦你（下一批要等新的到点提醒）。 */
function missedSheet(){
  var m = MISSED.v || S.missed;
  if(!m) return;
  return pageSheetVue('missed', '错过的提醒');
}
function missedDone(ev, nid, tid, el){
  ev.stopPropagation();
  toggle(nid, tid, el);          // 复用待办页：划线 → 原位淡出 → 新位置高亮入场
  setTimeout(function(){         // 动画跑完再把这条从清单里摘掉
    if(!MISSED.v) return;
    var n0 = (MISSED.v.items || []).length;
    MISSED.v.items = (MISSED.v.items || []).filter(function(t){ return t.id !== tid });
    MISSED.v.count = (MISSED.v.items || []).length;
    if(S.missed) S.missed = MISSED.v;
    if((MISSED.v.items || []).length === n0) return;
    render();                 // 背后的横幅条数
    if(MISSED.v.items.length) missedSheet(); else closeSheet();
  }, 900);
}
function missedGoTodos(){ closeSheet(); tab = syncBox(TAB, 'todos'); setTab(true); }
function missedDismiss(){
  MISSED.v = null;
  if(S) S.missed = null;
  closeSheet();
  render();
  toast('好，这批不再提示');
}
/* 点清单里的一条：跳到笔记并展开那条待办 */
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
function openClip(){ clipSheet(); }
/** 顶栏 📋：手动把当前剪贴板收进暂存队列（此刻窗口有焦点，系统允许读）。 */
function importClip(){
  if(!(window.Android && Android.clipImport)) return toast('暂不支持读取剪贴板');
  Android.clipImport();
}
/** Java 读完剪贴板后的回调：有新内容直接打开整理页，否则说一声。 */
window.onClipRead = function(n, added){
  if(added) clipSheet();
  else toast(n > 0 ? '剪贴板里没有新文字（已暂存 '+n+' 条）' : '剪贴板是空的');
};
/* ---------- 步骤 9：剪贴板暂存页的叶子片段（遗留渲染器与 views/clip.js 共用） ----------
   两条路径共用同一批函数，VDIFF 才逐字比得过（模式见 views/clip.js 顶部注释）。
   esc 的分工（步骤 5 定的契约）：这些函数产出 HTML 字符串（遗留侧用），Vue 模板里用
   原始值 + {{ }}（Vue 自己转义），所以模板侧不调 esc —— 调了就双重转义。
   需要转义的片段因此有两个版本：*HTML 给遗留，*Text 给 Vue。 */
function clipItemCls(c){ return 'clipitem' + (CLIP.sel[c.id] ? ' on' : '') }
function clipPrevText(c){
  var t = String(c.text || '')
  return t.slice(0, 160) + (c.text && c.text.length > 160 ? '…' : '')
}
/* 剪贴板里的图片没有缩略图（只有名字），画一个图标 + 「图片 · 名字」。
   整段是一个字符串 → 解析后是一个文本节点；Vue 侧用 v-html 同一个字符串才等价。 */
function clipThumbText(c){ return ' 图片' + (c.name ? ' · ' + c.name : '') }
function clipMetaText(c){ return (c.app || '剪贴板') + ' · ' + relTime(c.createdAt) }
/** #clipList 里的内容：加载中 / 加载失败 / 空 / 列表（判定顺序与 loadClips 一致） */
/** 底部计数条：空暂存时是「<b>0</b> 条已选」（loadClips 的空态分支），有条目才是全式 */
/** clipCount() 里那句按钮文案：只选一条时不带数字（一条没什么可「一键」的） */
function clipParseText(n){ return n > 1 ? ('一键解析 ' + n + ' 条') : '一键解析' }
function clipSheet(){
  // 步骤 11：只剩 Vue 一条路径（ClipSheetView）；条数很多时操作按钮固定在底部的契约在模板里
  CLIP.loading = true; CLIP.error = ''
  pageSheetVue('clip', '剪贴板暂存')
  loadClips()
}
async function loadClips(){
  try{
    var r = await api('/api/clip/list');
    CLIP.list = (r && r.clips) || [];
    S.info.clip = CLIP.list.length;
    // CLIP.sel 是全局的，只增不减的话「已选 N 条」会把早就处掉的旧 id 也算进去
    var keep = {};
    CLIP.list.forEach(function(c){ keep[c.id] = CLIP.sel[c.id] !== undefined ? CLIP.sel[c.id] : true });
    CLIP.sel = keep;
    CLIP.loading = false; CLIP.error = '';
    // 步骤 17b：CLIP 是 reactive 的，赋值即重画，不再 sheetPaint() bump tick。
    // 返回一个微任务让调用点（clipParse 等）的 await 语义不变。
    return Promise.resolve();
  }catch(e){
    /* CLIP.loading 必须一起落下：模板的三态判定是 `v-if="loading"` 优先于
       `v-else-if="err"`，只写 CLIP.error 的话加载失败永远停在「加载中…」，
       「加载失败」那一支是死代码（步骤 14 的 CLIP.error 客户端回归抓到的真 bug）。
       截图页的 loadShots 一直是两个一起写的（app.js 的 SHOTS.loading = false; SHOTS.error = 'fail'）。 */
    CLIP.loading = false; CLIP.error = String(e);
    // #clipList 的子节点是 Vue 管的，直接写 innerHTML 会与它的虚拟 DOM 抢；
    // 现在两个属性都是响应式的，赋值就让模板的三态判定重算。
    return Promise.resolve();
  }
}
function clipPick(id, el){
  // 步骤 17b：这一行就是全部。CLIP 是 reactive 的，勾选一条只重画那一条与底部计数，
  // 不用 sheetPaint() 把整个弹层的所有 computed 全失效一遍（那正是 live() 时代的做法）。
  CLIP.sel[id] = !CLIP.sel[id];
}
function clipSelAll(v){
  Object.keys(CLIP.sel).forEach(function(k){ CLIP.sel[k]=v; });
  // 计数与按钮文案都是 computed，读的是同一个 reactive 对象，赋值即更新
}
function clipSelected(){
  return Object.keys(CLIP.sel).filter(function(k){return CLIP.sel[k]});
}
function clipDel(ev, id){
  if(ev && ev.stopPropagation) ev.stopPropagation();
  clipRemove([id]);
}
function clipDelSel(){
  var ids = clipSelected();
  if(!ids.length) return toast('先勾选要删除的条目');
  clipRemove(ids);
}
async function clipRemove(ids){
  try{
    var r = await api('/api/clip/remove', {ids:ids});
    if(r && r.ok === false) return toast('删除失败: '+(r.error||''));
    ids.forEach(function(id){ delete CLIP.sel[id]; });
    toast('已删除 '+ids.length+' 条');
    if(window.Android && Android.clipSync) Android.clipSync();
    loadClips();
    refresh(true);
  }catch(e){ toast('删除失败'); }
}
async function clipParse(ai){
  var ids = clipSelected();
  if(!ids.length){ toast('先勾选要处理的条目'); return; }
  /* 步骤 14：两个失败形态都要有反馈。以前只处理 `r.ok === false`（Go 侧软失败），
     fetch 抛错（断网 / 超时 / 500）时这个 async 函数直接 reject，用户侧是「点了一下
     什么也没发生」—— 剪贴板页的 @click 不会报出来。 */
  var r = null, err = '';
  try{ r = await api('/api/clip/parse', {ids:ids, raw:!ai}) }
  catch(e){ err = (e && e.message) ? e.message : String(e) }
  var ok = !err && r && r.ok;
  if(!ok){
    // 失败不关弹层、不清勾选（同步骤 13 的「骨架屏可重试」）：以前失败也走
    // closeSheet + CLIP.sel={}，用户要重开页、重勾一遍才能重试。
    toast((ai ? '解析失败: ' : '保存失败: ') + (err || (r && r.error) || '未知错误'));
    return;
  }
  toast(ai ? '已入队解析 '+r.parsed+' 条' : '已存 '+r.parsed+' 条笔记');
  CLIP.sel = {};
  if(window.Android && Android.clipSync) Android.clipSync();
  closeSheet();
  refresh();
}
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
function openNote(id){
  if(!id) return;
  tab='notes'; open[id]=true; setTab(true); refresh();
  setTimeout(function(){var el=document.getElementById('n'+id);
    if(el) el.scrollIntoView({behavior:'smooth',block:'center'});
    else toast('这条笔记已删除');}, 300);
}
window.openNote = openNote; window.notifyResult = notifyResult;
/* 通知点进来：展开这条笔记并定位到那一条待办（滚过去 + 亮一下）*/
function openTodo(nid, tid){
  if(!nid) return;
  var n = (S.notes||[]).filter(function(x){return x.id===nid})[0];
  if(n) open[nid] = true;
  tab='notes'; setTab(true); refresh();
  openTodoFocus(nid, tid, 0);
}
function openTodoFocus(nid, tid, tries){
  setTimeout(function(){
    var el = document.getElementById('t'+nid+'_'+tid);
    if(!el){
      if(tries < 6) return openTodoFocus(nid, tid, tries+1);
      toast('这条待办已完成或已删除'); return;
    }
    el.scrollIntoView({behavior:'smooth', block:'center'});
    el.classList.add('flash');
    setTimeout(function(){ el.classList.remove('flash') }, 2600);
  }, 320);
}
window.openTodo = openTodo;

function dueMs(iso){ if(!iso) return 0; var d=new Date(iso); return isNaN(d)?0:d.getTime() }
/* R13：把到期时间交给系统日历 / 闹钟（intent，不需要权限）*/
function toCalendar(nid,tid,ev){
  ev.stopPropagation();
  var n=S.notes.filter(function(x){return x.id===nid})[0]; if(!n) return;
  var t=(n.todos||[]).filter(function(x){return x.id===tid})[0]; if(!t||!t.due) return;
  if(!window.Android||!Android.addToCalendar){ toast('日历只在 app 内可用'); return }
  Android.addToCalendar(t.text, dueMs(t.due));
}
function toAlarm(nid,tid,ev){
  ev.stopPropagation();
  var n=S.notes.filter(function(x){return x.id===nid})[0]; if(!n) return;
  var t=(n.todos||[]).filter(function(x){return x.id===tid})[0]; if(!t||!t.due) return;
  if(!window.Android||!Android.setAlarm){ toast('闹钟只在 app 内可用'); return }
  Android.setAlarm(dueMs(t.due), t.text);
}
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
/* 弹层开启序号（步骤 8）。两个开启入口（pageSheetVue / sheetVue）都是「先改 shell.sheet 状态，
   再 nextTick 往 #sheetBody 里挂 app」；连点两下、开 A 立刻改开 B 时，迟到的 nextTick 回调会
   把上一个弹层的组件挂进新面板里：DOM 在 .panel 里但 app 已死，弹层空白且点了没反应。
   入口 bump，回调发现序号变了就直接放弃。
   步骤 17i：closeSheet 不再参与 —— 收场交给 <Transition>，leave 被取消时 Vue 不会调
   after-leave，所以上面这条只剩「开」这一侧要防。 */
var sheetGen = 0;
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
/* ---------- 附件页（R4）----------
   数据来自 /api/attachments（服务端过滤/排序，含磁盘文件数校验）。 */
var FA = Vue.reactive({items:[], total:0, bytes:0, files:0, missing:0, scanned:0, diskFiles:0, loaded:false, error:''});
/* 步骤 13：附件页的抢占判定以前用**服务端搜索共用的** searchSeq，笔记页搜索一在飞，
   附件页这次请求的结果就被整次丢掉（`if(my !== searchSeq) return`），FA.loaded 永远停在
   false → 用户侧症状是附件页停在骨架屏，只能切走再切回来。真机套件也撞过（步骤 11 的
   「跑一次红一次绿」，当时只在测试侧轮询盖住）。现在：
   ① 用附件页自己的 filesSeq，只有更新的 filesNow 能抢占它；
   ② 请求有超时（apiTimeout），卡死的 fetch 不会把这一页永久钉在骨架屏；
   ③ 失败记 FA.error 并自动退避重试（最多 2 次），骨架屏上同时给「重试」按钮。 */
var filesSeq = 0, filesRetry = 0;
var KIND = {image:'image',pdf:'file-pdf',doc:'file',sheet:'file-sheet',slides:'file-slides',text:'file-text',audio:'music',video:'film',archive:'archive',file:'clipfile'};
function fmtSize(b){
  b = b||0;
  if(b >= 1073741824) return (b/1073741824).toFixed(2)+' GB';
  if(b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if(b >= 1024) return Math.round(b/1024)+' KB';
  return b+' B';
}
async function filesNow(){
  var my = ++filesSeq, p = P();
  var s = 'q='+encodeURIComponent(q)+'&sort='+encodeURIComponent(p.sort||'new');
  if(p.dir) s += '&dir='+encodeURIComponent(p.dir);
  if(p.kind && p.kind!=='all') s += '&mime='+encodeURIComponent(p.kind);
  try{
    var d = await apiTimeout('/api/attachments?'+s);
    if(my !== filesSeq) return;
    var k = JSON.stringify(d);
    reassign(FA, {items:d.items||[], total:d.total||0, bytes:d.bytes||0, files:d.files||0,
          missing:d.missing||0, scanned:d.scanned||0, diskFiles:d.diskFiles||0,
          loaded:true, error:''});
    filesRetry = 0;
    if(k === SRK){ paintStatus(); return }
    SRK = k;
  }catch(e){
    if(my !== filesSeq) return;
    reassign(FA, {items:FA.items, total:FA.total, bytes:FA.bytes, files:FA.files,
          missing:FA.missing, scanned:FA.scanned, diskFiles:FA.diskFiles,
          loaded:false, error:errText(e)});
    SRK = '';
    if(filesRetry < 2){ filesRetry++; setTimeout(filesNow, 1500*filesRetry) }
  }
  render();
}
/* 步骤 7 拆出的叶子：Vue 的 FilesView 直接画 <div class="strip" v-html=...>，
   两条路径共用一份 inner HTML，VDIFF 才能逐字比（步骤 5/6 定下的模式：结构在模板里，
   叶子片段同源）。 */
function attachCardCls(a){
  return 'acard' + (a.missing ? ' gone' : '') + enterCls('a' + a.id);
}
function attachGlyphName(a){
  return KIND[a.kind] || 'clipfile';
}
function openAttach(id){
  var a = null;
  FA.items.forEach(function(x){ if(x.id===id) a = x });
  toast('预览即将上线' + (a ? '：' + a.name : ''));
}
async function delAttach(id){
  var a = null;
  FA.items.forEach(function(x){ if(x.id===id) a = x });
  askDel('附件「' + (a ? a.name : '') + '」？文件会从存储中删除。', function(){
    api('/api/attach/delete', {id:id}).then(function(r){
      toast(r.ok ? '已删除' : ('删除失败: ' + (r.error||'')));
      filesNow(); refresh();
    }, function(e){ toast('删除失败: '+e) });
  });
}
function pickFile(){
  if(!window.Android){ toast('文件选择只在 app 内可用'); return; }
  Android.pickFile();
  setTimeout(function(){ filesNow() }, 2500);
  setTimeout(function(){ filesNow() }, 8000);
}
/* ---------- 我的页（R5）：本地数据摘要 + 近 7 天活动 ----------
   数字全部来自 /api/stats（服务端从同一份 store 现算，不会和列表页对不上）。 */
/* 步骤 13：stBusy 以前没有超时 —— 一次永不返回的 /api/stats 把我的页永久钉在骨架屏
   （`if(stBusy) return` 之后再也没有第二次机会）。现在请求带超时，stBusy 带时间戳，
   超过 REQ_TIMEOUT_MS + 宽限期就允许新的请求进入；失败记 stErr，骨架屏上给「重试」按钮。 */
var ST = Vue.reactive({ v: null }), stBusy = false, stSince = 0, stErr = STERR.v;
async function statsNow(){
  if(stBusy && (Date.now() - stSince) < REQ_TIMEOUT_MS + 2000) return;
  stBusy = true; stSince = Date.now();
  try{ ST.v = await apiTimeout('/api/stats'); stErr = syncBox(STERR, '') }
  catch(e){ ST.v = null; stErr = syncBox(STERR, errText(e)) }
  stBusy = false;
  if(tab==='mine') render();
}
/* ---------- 步骤 10：我的页 / 设置页的叶子片段 ----------
   这些片段函数是 Vue 模板的渲染帮手（经 setHost 暴露给组件）；步骤 11 删掉遗留字符串
   渲染器之后它们只剩一个调用者，留着是因为模板里拼 HTML 的写法与它们逐字一致；Vue 侧经 setHost
   的 H.xxx 调用。hero 整块是静态结构 + 三处动态值，留在叶子函数里比模板抄一遍少一处漂移面。 */
/* 笔记状态卡（纯展示，无 handler）：整块交给叶子函数，Vue 侧 v-html 同一份字符串。
   卡壳（<div class="card">）由两条路径各自写，内容逐字共用。 */
/* 我的页最底部的运行信息卡。设置页的「运行状态」卡前三行相同、第四行是解析队列，
   所以只共用这三行，第四行各自写。 */
function statCls(hot, label){ return 'stat'+(hot?' hot':'')+enterCls('s'+label) }
/* 步骤 20：设置页六个输入框的值搬进状态（SFORM）。以前 saveSettings() 是
   `$('#sUrl').value.trim()` —— DOM 是用户输入的真相源，Vue 那一侧看不见正在打的东西，
   夹具要改一个字段只能写 DOM，settingsRefresh() 还得专门写注释警告「重建会把正在打的
   字清掉」。现在输入写进 SFORM，DOM 是它的纯函数：重绘不再丢字，探针能读能写。
   打开设置页时从 S.settings 灌初值；保存成功后用服务端回包重灌（服务端会规范化）。 */
var SFORM = Vue.reactive({ v: null });
function formFill(){
  var s = S.settings || {};
  SFORM.v = { baseUrl: s.baseUrl || '', apiKey: s.apiKey || '', model: s.model || '',
    timeoutS: s.timeoutS || 90, maxTokens: s.maxTokens || 2048,
    temperature: s.temperature == null ? 0.2 : s.temperature };
}
function formInput(k, v){ if(SFORM.v) SFORM.v[k] = v }
function settingsSheet(){
  /* 步骤 11：只剩 Vue 一条路径（SettingsSheetView）。dataset.kind 是 CSS 钩子
     （css/views/settings.css 靠它定位设置页）；步骤 15 面板归 Vue 所有，钩子走状态。 */
  formFill();
  pageSheetVue('settings', '设置', 'settings');
}
/* 只重绘设置页本身，并把滚动位置放回去（开关、权限回来后刷新用）*/
function settingsRefresh(){
  if(shell.sheet.kind !== 'settings' || !shell.sheet.on) return;
  var top = p.scrollTop;
  /* 不重建 DOM：computed 全依赖 tick，sheetPaint() bump 一次就整页重算。
     步骤 20 起输入框的值在 SFORM 里，重建也不会丢正在打的字了；这里依旧只重画不重建，
     因为重建会打断输入法的组合中状态（Android 上拼音打一半被吞）。 */
  sheetPaint();
  requestAnimationFrame(function(){ var q = $('#panel'); if(q) q.scrollTop = top });
}
/* 从系统设置页回来后重新读一次权限/保活状态；顺便重画，让「剪贴板刚有更新」提示立刻出现 */
window.onAppResume = function(){
  shotFlags();
  settingsRefresh();
  if (S && S.notes) render();
};
/* 弹层开合（步骤 15 之后只有一条路径）：状态写进 shell.sheet，SheetHost 渲染外壳，
   内容交给 VUE_SHEETS 里的组件挂载。两种形态：
   - pageSheetVue(name, title, kind)：全屏页（.phead + .pbody#sheetBody）
   - sheetVue(name, full)：底部卡片（.grip + .pclose + #sheetBody）
   两者都返回 nextTick 的 Promise（D13：调用方 await 完才能断到新 DOM），并在挂载后把
   面板滚回顶部。步骤 16c：字符串内容那条路（pageSheet / sheet + mode:'html'）删掉了，
   六个字符串弹层全成了组件，内联 onclick 也一起没了（app.js 里从 21 处降到 0）。 */
function pageSheetVue(name, title, kind){
  sheetGen++;
  var gen = sheetGen;
  /* 步骤 13：先把所有旧 sheet 拆干。以前只拆同名（mountSheet 里那句 unmountSheet(name)），
     于是「开过剪贴板页再开设置页」会把剪贴板那个 app 连同 effect 一起泄漏在面板里：
     innerHTML 已经把它的根节点换成游离节点，它自己不知道，渲染永远到不了它。
     步骤 17j：进度层不再需要列为例外 —— 它不在 .panel 里，也不在这张表里（见 shotOverlay）。 */
  unmountAllSheets();
  shell.sheet.page = true;
  shell.sheet.kind = kind || '';
  shell.sheet.full = false;
  shell.sheet.title = title;
  shell.sheet.mounted = true;
  shell.sheet.on = true;
  return nextTick(function(){
    if(gen !== sheetGen) return;
    var el = $('#sheetBody');
    if(!el) return;
    mountSheet(name, el, VUE_SHEETS[name]);
    var p = $('#panel');
    if(p) p.scrollTop = 0;
  });
}
/* 卡片形态（底部弹出）：外壳（.grip + .pclose）由 SheetHost 渲染，内容挂在 #sheetBody。
   迁移前是 `p.innerHTML = '<div class="grip"></div><button class="pclose" …>' + html`，
   现在 html 那一层包在 #sheetBody 里（唯一的结构差别，CSS 已跟上）。 */
function sheetVue(name, full){
  sheetGen++;
  var gen = sheetGen;
  unmountAllSheets();
  shell.sheet.page = false;
  shell.sheet.kind = '';
  shell.sheet.full = !!full;
  shell.sheet.title = '';
  shell.sheet.mounted = true;
  shell.sheet.on = true;
  return nextTick(function(){
    if(gen !== sheetGen) return;
    var el = $('#sheetBody');
    if(!el) return;
    mountSheet(name, el, VUE_SHEETS[name]);
    var p = $('#panel');
    if(p) p.scrollTop = 0;
  });
}
/* 导出 JSON：遗留写法是把赋值直接写进 handler（我的页那一行是单引号套双引号属性的
   字符串，设置页是内联属性），抽成函数后两条路径共用一份，handler 字符串里也只剩
   一个名字。 */
function exportJSON(){ location.href = '/api/export' }
function importJSON(){
  if(!window.Android){ toast('导入只在 app 内可用'); return }
  toast('选择之前导出的 JSON 文件…');
  Android.pickJSON();
}
function clearAllNotes(){
  var n = ST.v ? ST.v.notes.total : (S.info.notes||0);
  askDel('清空全部 '+n+' 条笔记？附件文件一并删除，设置与 API Key 保留。', function(){
    api('/api/clear', {}).then(function(r){
      toast(r.ok ? ('已删除 '+r.deleted+' 条') : ('清空失败: '+(r.error||'')));
      ST.v = null; refresh(); statsNow();
    }, function(e){ toast('清空失败: '+e) });
  });
}
/* ---------- 排序 / 筛选浮层（R3，P3 接服务端）----------
   步骤 16c：组由当前 tab 决定这件事进了 views/sheets.js 的 SortSheetView（那里逐字
   比对过迁移前的字符串），本文件只留「开哪个弹层」。setPref / resetPrefs 的副作用
   （写 prefs → 关弹层 → searchNow → savePrefs）没动：test.sh 的排序页用例直接点那些按钮。 */
function sortSheet(){
  return pageSheetVue('sort', '排序与筛选');
}
function setPref(k, v){ P()[k] = v; closeSheet(); searchNow(); savePrefs(); }
function resetPrefs(){
  prefs[tab] = tab==='todos' ? {sort:'due',done:'open',pri:'all'}
             : tab==='files' ? {sort:'new',kind:'all'} : {sort:'new',src:'all',status:'all',file:'all'};
  q = syncBox(QB, ''); shell.q = ''; shell.has = false;
  closeSheet(); searchNow(); savePrefs();
}
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
       if(themeOf() !== curTheme){ curTheme = themeOf(); applyTheme(); dirty = true; }
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
function jump(id){ tab='notes'; open[id]=true; setTab(true); refresh();
  setTimeout(function(){var el=document.getElementById('n'+id);if(el)el.scrollIntoView({behavior:'smooth',block:'center'})},250); }
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
/* 样式表是动画时长的唯一来源：这里读 tokens.css 的 --d1（"110ms"）换算成毫秒。
   单位要认：CSS 时长写成 110ms 时 parseFloat 给的就是毫秒数，写成 .2s 才是秒。 */
function cssMs(name){
  var s = '';
  try{ s = String(getComputedStyle(document.documentElement).getPropertyValue(name)).trim() }
  catch(e){ return 0 }
  var v = parseFloat(s);
  if(!isFinite(v) || v <= 0) return 0;
  return /ms$/.test(s) ? Math.round(v) : Math.round(v * 1000);
}
function closeSheet(){
  if(!shell.sheet.on) return;
  /* 步骤 18d：外壳是 van-popup，显隐是 v-if（没有 Vue 的 leave 阶段，理由见 js/shell.js
     的 SheetHost 注释），所以收场动画自己排：on=false 让 SheetHost 挂上 .closing
     （面板下滑 + 遮罩淡出，规则在 css/components.css），动画跑完才摘节点。
     摘掉之后 van-popup 的 @vue:unmounted → sheetLeft() 拆弹层内容的 app。
     「关掉立刻重开」由状态守卫：定时器只在仍然 on=false 时才摘，重开就不摘。
     定时器在后台标签页会被节流到 1s，但它会跑 —— 17i 的教训是 rAF 在不可见窗口上
     永不跑，Vue 的 <Transition> 因此不可用（CSS 动画走合成器，不受影响）。
     进度层不在这里收，也不在这张表里：它是外壳树里的 <teleport> 子组件（步骤 17j），
     shotsImported 先 closeSheet 再等 AI 解析完，进度层自己管自己的生死（SHOTPROG.on）。 */
  shell.sheet.on = false;
  var ms = cssMs('--d1');
  if(!ms){ shell.sheet.mounted = false; return }
  setTimeout(function(){ if(!shell.sheet.on) shell.sheet.mounted = false }, ms + 20);
}
/** van-popup 的 @vue:unmounted：节点真摘掉了，才拆 sheet 的 app */
function sheetLeft(){
  /* 步骤 13：以前这里手写四个名字（shots/folders/clip/settings），新增 sheet 忘了加
     就是静默泄漏。名单现在只有一份：sheetApps 这张表。步骤 17j：进度层从例外名单里
     没掉了（它不在 sheetApps 里，见 shotOverlay 的注释）。 */
  unmountAllSheets();
}

/* ---------- 自绘对话框（代替原生 confirm/alert）----------
   WebView 的默认弹框会顶着一行“网址为 http://127.0.0.1 的网页显示：”，
   对用户毫无意义。Java 的 onJsAlert/onJsConfirm 也一律转发到这里。 */
var dlgCb = null, dlgCancel = null;
/* 步骤 15：六个字段写进 shell.dlg，显隐、按钮文案、危险色、取消按钮的显隐全由 DialogHost
   渲染（正文是 esc 过的纯文本，模板里的 {{ }} 天然转义，与原来的 innerHTML+esc 等价）。 */
function dialog(o){
  shell.dlg.title = o.title || '';
  shell.dlg.body = o.body || '';
  shell.dlg.ok = o.ok || '确定';
  shell.dlg.cancel = o.cancel || '取消';
  shell.dlg.danger = !!o.danger;
  shell.dlg.noCancel = !!o.noCancel;
  dlgCb = o.onOk || null; dlgCancel = o.onCancel || null;
  shell.dlg.on = true;
}
function closeDlg(ok){
  shell.dlg.on = false;
  var cb = dlgCb, cc = dlgCancel;
  dlgCb = null; dlgCancel = null;
  if(ok){ if(cb) cb() } else if(cc) cc();
}
function askDel(what, onOk){ dialog({title:'删除', body:what, ok:'删除', danger:true, onOk:onOk}) }
/* Java 的 onJsAlert/onJsConfirm 转发到这里（id 非空 = confirm，需要回传结果） */
window.uiDialog = function(title, msg, id){
  dialog({title:title, body:msg, noCancel:!id,
    onOk:function(){ if(id && window.Android) Android.dialogResult(id, true) },
    onCancel:function(){ if(id && window.Android) Android.dialogResult(id, false) }});
};

/* 手机返回键：先关对话框/面板，再回笔记页，最后才退 app */
window.uiBack = function(){
  if(shell.dlg.on){ closeDlg(false); return 1; }
  if(shell.sheet.on){ closeSheet(); return 1; }
  if(tab !== 'notes'){ tab = syncBox(TAB, 'notes'); setTab(true); return 1; }
  return 0;
};
/* 步骤 21：「记一笔」与「添加待办」的表单值也搬进状态（步骤 20 的同一套做法）。
   这两个弹层是每次新建，所以初值就是空串 / 默认值，不需要从服务端灌。
   与设置页的差别：这里用 :value（DOM property）而不是 :value.attr —— 这些元素今天
   DOM 上没有 value 属性，写属性保持序列化逐字不变（设置页那六个必须写属性，见步骤 20）。 */
var FORMS = Vue.reactive({ v: { add: null, todo: null } });
function formSet(name, k, v){ var f = FORMS.v[name]; if(f) f[k] = v }
function addSheet(){
  FORMS.v.add = { text: '' };
  return sheetVue('add');
}
async function addNote(){
  var t = String((FORMS.v.add || {}).text || '').trim(); if(!t){toast('写点内容吧');return;}
  closeSheet(); toast('已加入队列…');
  var r = await api('/api/add',{text:t});
  if(!r.ok) toast(r.error||'失败');
  setTimeout(refresh,500); setTimeout(refresh,3000); setTimeout(refresh,9000);
}
function pickImage(){
  if(!window.Android){toast('选图只在 app 内可用');return;}
  Android.pickImage(); closeSheet(); toast('已提交，正在识别图片…');
  setTimeout(refresh,1500); setTimeout(refresh,5000); setTimeout(refresh,12000);
}
/* 给哪条笔记加待办：弹层组件不接 props（mountSheet 只挂不传），所以存进模块变量，
   组件挂载时读一次（见 views/sheets.js 的 AddTodoSheetView）。 */
var SHEETARG = SHEETARGB.v;
function addTodoSheet(nid){
  SHEETARG = syncBox(SHEETARGB, nid);
  FORMS.v.todo = { text:'', date:'', time:'', pri:'normal' };
  return sheetVue('addtodo');
}
async function addTodo(nid){
  var f = FORMS.v.todo || {};
  var t = String(f.text || '').trim(); if(!t){toast('写点内容吧');return;}
  var due = f.date ? f.date+'T'+(f.time||'09:00') : '';
  var r = await api('/api/todo',{action:'add',noteId:nid,text:t,due:due,priority:f.pri||'normal'});
  closeSheet(); toast(r.ok?'已添加':'失败'); refresh();
}
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
var searchT = 0;
/* 搜索框：shell.q 是输入框里的原文（v-model 双向绑的就是它），真发给服务端的是 trim
   过的 q。服务端搜索：等用户停手再发，避免每敲一个字就重建一次列表。 */
function searchInput(v){
  q = syncBox(QB, v.trim());
  P().q = q;
  shell.has = !!q;
  clearTimeout(searchT);
  searchT = setTimeout(function(){ searchNow(); savePrefs(); }, 260);
}
function searchClear(){
  q = ''; shell.q = ''; shell.has = false;
  var el = $('#q'); if(el) el.blur();
  P().q = '';
  clearTimeout(searchT); searchNow(); savePrefs();
}
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
  strip: strip, P: P, groupTodos: groupTodos, todoEnterCls: todoEnterCls,
  todoRowCls: todoRowCls,
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
  clipDelSel: clipDelSel, clipParse: clipParse, relTime: relTime,
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
