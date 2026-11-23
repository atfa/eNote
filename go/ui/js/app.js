// go/ui/js/app.js — 由 go/ui.html 684-2523 机械拆分而来（S1a，行为零变化）。
// S3 起是 **ES module**（index.html 的 <script type="module">）。模块顶层声明不再是全局，
// 页面里 69 处 onclick + 1 处 oninput 按 window 作用域解析函数名，所以文件末尾必须有
// window.__enoteActions 导出表 + Object.assign(window, …)（见文件末尾 D12）。
// 转 module 与导出表、tools/ui_test.js 闸门① 同批落地，中间态不能存在：
// 少了任何一环，70 个 handler 会全部静默失效（P12 那一类「点了没反应」）。
var S = {notes:[], settings:{}, info:{}};
var tab = 'notes', open = {}, busy = {};
var seen = {};   // 已经出现过的卡片 id：只有新出现的才带入场动画（P7c）
var expAnim = {}; // 正在播放展开动画的笔记 id（P7c 加动效时忘了声明，展开详情点了没反应就是这个）
var curTheme = '';
var q = '';
/* 每个页签自己的搜索/排序/筛选条件（P3 会持久化到服务端） */
var prefs = {
  notes:{sort:'new', src:'all', status:'all'},
  todos:{sort:'due', done:'open', pri:'all'},
  files:{sort:'new', kind:'all'}
};
function P(){ return prefs[tab] || prefs.notes }
/* 图标：ic('search') → 一个 24dp 线性图标，颜色跟着 currentColor */
function ic(n, cls){ return '<svg class="ic' + (cls ? ' ' + cls : '') + '"><use href="#i-' + n + '"/></svg>' }

/* ---------- 服务端搜索（R3）----------
   列表数据一律来自 /api/search；请求失败时退回本地过滤，断网也能看。 */
var SR = {notes:null, todoIds:null, where:{}, total:0, scanned:0};
var searchSeq = 0, prefsLoaded = false;
var PREF_KEYS = ['src','status','done','pri','kind','file'];
function prefPayload(){
  var p = P(), f = {};
  PREF_KEYS.forEach(function(k){ if(p[k] && p[k]!=='all') f[k]=p[k] });
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
async function searchNow(force){
  if(tab==='files'){ filesNow(); return; }
  var my = ++searchSeq;
  try{
    var d = await api('/api/search?'+prefQS());
    if(my !== searchSeq) return;
    var k = JSON.stringify(d);
    SR = {notes:d.notes||[], todoIds:d.todoIds||null, where:d.where||{}, total:d.total||0, scanned:d.scanned||0};
    // 顶部横幅（剪贴板暂存 / 新截图 / 错过的提醒）不在搜索结果里：搜索结果没变、
    // 但页面签名变了（条数变了）时必须强制重绘，否则「删光剪贴板」「刚扫到新截图」
    // 回到首页都看不到横幅 —— 这两处的 bug 都是这里短路掉的。
    if(k === SRK && !force){ paintStatus(); return }
    SRK = k;
  }catch(e){ SR = {notes:null, todoIds:null, where:{}, total:0, scanned:0}; SRK = '' }
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
function toast(m){var t=$('#toast');t.innerHTML=ic('info')+'<span>'+esc(String(m))+'</span>';
  t.classList.add('on');
  clearTimeout(t._t);t._t=setTimeout(function(){t.classList.remove('on')},2200)}
async function api(path, body){
  var o = body ? {method:'POST',headers:{'Content-Type':'application/json'},
                  body:JSON.stringify(body)} : {};
  var r = await fetch(path, o);
  if(!r.ok) throw new Error('HTTP '+r.status);
  return r.json();
}
function now(){var d=new Date(),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function fmtTime(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return iso;
  var p=n=>String(n).padStart(2,'0'), t=new Date();
  var same = d.toDateString()===t.toDateString();
  return (same?'今天':(d.getMonth()+1)+'/'+d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
function srcChip(n){
  if(n.source==='clipboard-text') return '<span class="chip">剪贴板</span>';
  if(n.source==='clipboard-image') return '<span class="chip img">剪贴板图片</span>';
  if(n.source==='share-text') return '<span class="chip">分享文字</span>';
  if(n.source==='share-image') return '<span class="chip img">分享图片</span>';
  if(n.source==='manual-image') return '<span class="chip img">图片</span>';
  return '<span class="chip">手动</span>';
}
function statusChip(n){
  if(n.status==='queued') return '<span class="chip pend"><span class="spin"></span> 排队中</span>';
  if(n.status==='parsing') return '<span class="chip pend"><span class="spin"></span> AI 解析中</span>';
  if(n.status==='done') return '<span class="chip ai">✦ AI '+(n.aiModel||'')+' · '+(n.aiMs||0)+'ms</span>';
  if(n.status==='raw') return '<span class="chip pend">仅原文</span>';
  if(n.status==='error') return '<span class="chip err">失败</span>';
  return '';
}
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
function cdChip(t){
  if(!t.due || t.done) return '';
  return '<span class="'+cdCls(t.due)+'" data-due="'+esc(t.due)+'">'+ic('clock')+cdText(t.due)+'</span>';
}
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
var remindPending = 0;
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
  try { remindPending = Android.syncReminders(JSON.stringify(list)) || 0; } catch(e){ remindPending = 0; }
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
function toggleKeepAlive(el){
  if(!window.Android || !Android.setKeepAlive){ toast('常驻后台只在 app 内可用'); return }
  var on = !keepAliveOn();
  // 关掉要二次确认：服务一停，后台到点的提醒就全交给系统调度了
  if(!on){
    dialog({title:'关闭常驻后台', body:'关闭后 app 在后台可能被系统冻结，到点提醒可能不响。',
      ok:'关闭', danger:true, onOk:function(){ applyKeepAlive(el, false) }});
    return;
  }
  applyKeepAlive(el, true);
}
function applyKeepAlive(el, on){
  Android.setKeepAlive(on);
  el.className = 'sw' + (on ? ' on' : '');
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
var clipSel = {};
function emptyState(icon, t, sub){
  return '<div class="empty"><div class="eo"><svg class="ic"><use href="#i-'+icon+'"/></svg></div>'
    + t + (sub ? '<div class="esub">'+sub+'</div>' : '') + '</div>';
}
/* 错过的提醒（后台被冻结时到点的那些）：只在有内容时出现，点开看清单 */
var MISSED = null;   // 服务端只在启动时算一次，之后 refresh 覆盖 S 时要把它贴回去
function missedBanner(){
  var m = MISSED;
  if(!m || !m.count) return '';
  var more = m.count > (m.items || []).length;
  return '<div class="missed" onclick="missedSheet()"><span class="mi">'+ic('bell')+'</span>'
    + '<div style="flex:1;min-width:0"><b>错过 ' + m.count + ' 条提醒</b>'
    + '<div class="cbsub">' + (more ? '只列出最早到点的 ' + (m.items || []).length + ' 条' : '你不在的时候到点了，闹钟可能没响')
    + '</div></div>'
    + '<span class="cbar">查看 ›</span></div>';
}
async function loadMissed(){
  try{
    var d = await api('/api/missed');
    if(d && d.count){ MISSED = d; S.missed = d; render(); }
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
  var m = MISSED || S.missed;
  if(!m) return;
  var items = m.items || [];
  var h = '';
  if(!items.length){
    h = emptyState('check-circle', '这批处理完了', '到点的待办会照常提醒');
  } else {
    // 行结构直接复用待办页的 .todo/.cb/.ttx，划线淡出动画和样式就都是那一套
    h = '<div class="list card">';
    items.forEach(function(t){
      h += '<div class="todo msrow" onclick="closeSheet();jump(\''+t.nid+'\')">'
        + '<div class="cb" onclick="missedDone(event,\''+t.nid+'\',\''+t.id+'\',this)">'+ic('check')+'</div>'
        + '<div class="tx"><span class="ttx">'+esc(t.text)
        + '<small><span class="due over">'+ic('calendar')+fmtTime(t.due)+'</span>'+cdChip(t)
        + '<a href="#" onclick="jump(\''+t.nid+'\');return false">'+esc(t.ntitle||'查看笔记')+'</a></small>'
        + '</span></div></div>';
    });
    h += '</div>';
  }
  h += '<div class="pfoot"><div class="count">点整行看笔记上下文<br>勾 ✓ 直接完成</div>'
    + '<button class="btn" onclick="missedGoTodos()">去待办页</button>'
    + '<button class="btn pri" onclick="missedDismiss()">'+ic('check')+'这批我知道了</button></div>';
  pageSheet('错过的提醒', h);
}
function missedDone(ev, nid, tid, el){
  ev.stopPropagation();
  toggle(nid, tid, el);          // 复用待办页：划线 → 原位淡出 → 新位置高亮入场
  setTimeout(function(){         // 动画跑完再把这条从清单里摘掉
    if(!MISSED) return;
    var n0 = (MISSED.items || []).length;
    MISSED.items = (MISSED.items || []).filter(function(t){ return t.id !== tid });
    MISSED.count = (MISSED.items || []).length;
    if(S.missed) S.missed = MISSED;
    if((MISSED.items || []).length === n0) return;
    render();                 // 背后的横幅条数
    if(MISSED.items.length) missedSheet(); else closeSheet();
  }, 900);
}
function missedGoTodos(){ closeSheet(); tab = 'todos'; setTab(true); }
function missedDismiss(){
  MISSED = null;
  if(S) S.missed = null;
  closeSheet();
  render();
  toast('好，这批不再提示');
}
/* 点清单里的一条：跳到笔记并展开那条待办 */
function openTodoFromMissed(nid, tid){
  if(window.Android && Android.openNote) { Android.openNote(nid); return }
  if(nid) { open[nid] = 1; }
  setTab('notes');
}
// ---- 截图捕获（P11）：扫描监控文件夹 → 横幅 → 多选 → 导入笔记 ----
var SHOTFLAGS = null;    // {enabled, granted, folders:n, watermark}  便宜的状态，每次 refresh 都行
var shotSel = {};        // 暂存区里被勾选的截图 id
var shotList = [];       // /api/shots/list 的结果（sheet 用）
var folderSel = {};      // 文件夹选择里勾中的路径
var folderAll = [];      // MediaStore 枚举出来的所有目录
var shotTimer = 0, shotStartAt = 0;

function shotFlags(cb){
  if(!(window.Android && Android.shotFlags)){ SHOTFLAGS = {enabled:false, granted:false, folders:0}; if(cb) cb(); return }
  try{
    var d = JSON.parse(Android.shotFlags() || '{}');
    SHOTFLAGS = d && typeof d === 'object' ? d : null;
  }catch(e){ SHOTFLAGS = null }
  if(cb) cb();
}
function shotBanner(){
  var f = SHOTFLAGS || {};
  var n = (S.info && S.info.shot) || 0;
  if(n > 0){
    return '<div class="shotbanner" onclick="shotSheet()"><span class="si">'+ic('image')+'</span>'
      + '<div style="flex:1;min-width:0"><b>发现 ' + (n >= 50 ? '50+' : n) + ' 张新截图</b>'
      + '<div class="cbsub">点开勾选：可以合并成一条笔记，也可以各存一条</div></div>'
      + '<span class="cbar">整理 ›</span></div>';
  }
  if(!f.enabled){
    return '<div class="shotbanner" onclick="shotSetup()"><span class="si">'+ic('image')+'</span>'
      + '<div style="flex:1;min-width:0"><b>自动收集截图</b>'
      + '<div class="cbsub">选几个文件夹盯着，新截图自动变成笔记</div></div>'
      + '<span class="cbar">开启 ›</span></div>';
  }
  if(!f.granted){
    return '<div class="shotbanner" onclick="askShotPerm()"><span class="si">'+ic('alert')+'</span>'
      + '<div style="flex:1;min-width:0"><b>需要允许读取照片</b>'
      + '<div class="cbsub">不给权限就发现不了新截图（只读，不上传）</div></div>'
      + '<span class="cbar">去授权 ›</span></div>';
  }
  if(!f.folders){
    return '<div class="shotbanner" onclick="folderSheet()"><span class="si">'+ic('folder')+'</span>'
      + '<div style="flex:1;min-width:0"><b>还没选监控文件夹</b>'
      + '<div class="cbsub">至少选一个目录（默认会勾上截图目录）</div></div>'
      + '<span class="cbar">去选择 ›</span></div>';
  }
  return '';
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
function shotSheet(){
  // 缩略图最多 50 张，操作按钮同样固定在底部条里（跟文件夹页一致）
  pageSheet('新截图', '<div class="cliptop">'
    + '<button class="btn sm" onclick="shotSelAll(true)">全选</button>'
    + '<button class="btn sm" onclick="shotSelAll(false)">全不选</button>'
    + '<div class="sp"></div>'
    + '<button class="btn sm dg" onclick="shotIgnoreSel()">忽略所选</button></div>'
    + '<div id="shotGrid" class="clipload">加载中…</div>'
    + '<div class="pfoot" style="display:block">'
    + '<div class="count" id="shotFoot" style="margin-bottom:8px">已选 0 张</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn pri" id="shotGo" style="flex:1.6" onclick="doImportShots(\'merge\')">合并成一条笔记</button>'
    + '<button class="btn" id="shotSplit" style="flex:1" onclick="doImportShots(\'split\')">各存一条</button>'
    + '<button class="btn" id="shotRaw" style="flex:1" onclick="doImportShots(\'raw\')">原样存</button>'
    + '</div></div>');
  loadShots();
}
async function loadShots(){
  try{
    var r = await api('/api/shots/list');
    shotList = (r && r.shots) || [];
    if(S.info) S.info.shot = shotList.length;
    var keep = {};
    shotList.forEach(function(x){ keep[x.id] = shotSel[x.id] !== undefined ? shotSel[x.id] : true });
    shotSel = keep;
    var g = $('#shotGrid');
    if(!shotList.length){
      if(g) g.innerHTML = emptyState('image', '没有待整理的截图', '新截图出现时会先在这里排队');
      shotCountLabel(); return;
    }
    var h = '<div class="shotgrid">';
    shotList.forEach(function(x){
      var on = !!shotSel[x.id];
      h += '<div class="shotitem'+(on?' on':'')+'" onclick="shotPick(\''+x.id+'\',this)">'
        + '<img src="/shotimg?id='+encodeURIComponent(x.id)+'" alt="" loading="lazy">'
        + '<div class="shottime">'+esc(fmtClock(x.dateAdded || 0))+'</div>'
        + '<div class="shotck">'+ic('check')+'</div></div>';
    });
    h += '</div>';
    if(g) g.innerHTML = h;
    shotCountLabel();
  }catch(e){
    var g2 = $('#shotGrid'); if(g2) g2.innerHTML = '<div class="empty">加载失败</div>';
  }
}
function fmtClock(sec){
  if(!sec) return '';
  var d = new Date(sec * 1000);
  return ('0'+d.getHours()).slice(-2)+':'+('0'+d.getMinutes()).slice(-2);
}
function shotPick(id, el){
  shotSel[id] = !shotSel[id];
  if(el) el.classList.toggle('on', !!shotSel[id]);
  shotCountLabel();
}
function shotSelAll(on){
  shotList.forEach(function(x){ shotSel[x.id] = !!on });
  var g = $('#shotGrid');
  if(g){
    var items = g.querySelectorAll('.shotitem');
    for(var i=0;i<items.length;i++) items[i].classList.toggle('on', !!on);
  }
  shotCountLabel();
}
function shotCountLabel(){
  var n = 0, total = shotList.length;
  shotList.forEach(function(x){ if(shotSel[x.id]) n++ });
  var el = $('#shotFoot') || $('#shotCount');
  if(el) el.innerHTML = '<b>' + n + '</b> 张已选 · 共 ' + total + ' 张';
  syncShotBtns(n);
}
/**
 * 只有一张的时候「合并成一条」和「各存一条」是同一件事，摆两个按钮只会让人犹豫
 * （用户反馈）—— 一张就只留「创建笔记」，两张以上才出现合并/各存/原样三个选择。
 */
function syncShotBtns(n){
  var go = $('#shotGo'), sp = $('#shotSplit'), rw = $('#shotRaw');
  if(!go) return;
  var one = n <= 1;
  go.textContent = one ? '创建笔记' : '合并成一条笔记';
  go.style.flex = one ? '1' : '1.6';
  if(sp) sp.style.display = one ? 'none' : '';
  if(rw) rw.style.display = one ? 'none' : '';
}
function shotPicked(){
  return shotList.filter(function(x){ return !!shotSel[x.id] });
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
var SHOTOVL_TEXT = '';
/** 进度层：不可点掉，配一句醒目的"别黑屏/别退出"（用户明确要求） */
function shotOverlay(on, total, what){
  var el = $('#shotOvl');
  if(!on){
    if(shotTimer){ clearInterval(shotTimer); shotTimer = 0 }
    SHOTOVL_TEXT = '';
    if(el && el.parentNode) el.parentNode.removeChild(el);
    return;
  }
  SHOTOVL_TEXT = esc(what || '');
  if(!el){
    el = document.createElement('div');
    el.id = 'shotOvl';
    el.className = 'ovl';
    document.body.appendChild(el);
  }
  shotStartAt = Date.now();
  el.innerHTML = '<div class="ovlcard"><div class="orw"></div>'
    + '<b>正在处理 ' + total + ' 张截图</b>'
    + '<div class="osub" id="shotOvlSub">' + SHOTOVL_TEXT + ' · 已用 0s</div>'
    + '<div class="owarn">'+ic('alert')+'请保持屏幕常亮：不要锁屏、不要让手机黑屏，'
    + '也不要退出 App 或切到别的应用，否则解析会中断。</div>'
    + '<div style="font-size:11px;color:var(--dim2);margin-top:10px">'
    + '完成后会自动回到列表，不用一直盯着</div></div>';
  if(shotTimer) clearInterval(shotTimer);
  shotTimer = setInterval(function(){
    var sub = $('#shotOvlSub');
    if(!sub) return;
    var s = Math.round((Date.now() - shotStartAt) / 1000);
    sub.textContent = SHOTOVL_TEXT + ' · 已用 ' + s + 's';
  }, 1000);
}
/** 更新进度层副标题（OCR 完 → 进入 AI 解析，或 3/7 这种进度） */
function shotOvlSub(txt){
  SHOTOVL_TEXT = esc(txt);
  var sub = $('#shotOvlSub');
  if(sub){
    var s = Math.round((Date.now() - shotStartAt) / 1000);
    sub.textContent = SHOTOVL_TEXT + ' · 已用 ' + s + 's';
  }
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
  shotSel = {};
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
  shotSel = {};
  loadShots();
  refresh();
  toast('已忽略 ' + ids.length + ' 张，以后不再提醒');
}
// ---- 文件夹选择（首次向导 + 设置页共用）----
function folderSheet(){
  // 确定按钮放底部固定条里：文件夹可能有几十个，滚到底才能点确定太难用了（用户反馈）
  var h = '<div class="cliptop">'
    + '<button class="btn sm" onclick="folderSelAll(true)">全选</button>'
    + '<button class="btn sm" onclick="folderSelAll(false)">全不选</button>'
    + '<button class="btn sm" onclick="folderPickShots()">只选截图目录</button></div>'
    + '<div style="margin:8px 0 4px"><input id="folderQ" class="fin" placeholder="搜索文件夹" '
    + 'oninput="folderFilter(this.value)"></div>'
    + '<div id="folderList" class="clipload">加载中…</div>'
    + '<div class="pfoot"><div class="count" id="folderCount">已选 0 个</div>'
    + '<div class="sp"></div>'
    + '<button class="btn pri" onclick="folderSave()">开始监控</button></div>';
  pageSheet('选择监控文件夹', h);
  loadFolders();
}
function loadFolders(){
  var raw = '[]';
  try{ raw = (window.Android && Android.shotFolders) ? Android.shotFolders() : '[]' }catch(e){}
  try{ folderAll = JSON.parse(raw) || [] }catch(e){ folderAll = [] }
  var want = {};
  ((SHOTFLAGS && SHOTFLAGS.list) || []).forEach(function(p){ want[p] = 1 });
  folderSel = {};
  folderAll.forEach(function(f){
    // 首次：默认勾上名字像截图目录的；已经有配置的按配置来
    if(Object.keys(want).length) folderSel[f.path] = !!want[f.path];
    else folderSel[f.path] = !!f.shot;
  });
  folderRender();
}
function folderRender(){
  var g = $('#folderList');
  if(!g) return;
  if(!folderAll.length){
    g.innerHTML = emptyState('folder', '读不到文件夹', '需要先允许读取照片（我的 → 截图捕获 → 去授权）');
    folderCountLabel();
    return;
  }
  // 已选的排最前（组内仍按张数多的优先），这样一边勾一边看，选中的不会跑丢
  var rows = folderAll.slice().sort(function(a, b){
    var sa = (folderSel[a.path] && !a.missing) ? 1 : 0;
    var sb = (folderSel[b.path] && !b.missing) ? 1 : 0;
    if(sa !== sb) return sb - sa;
    if((b.count||0) !== (a.count||0)) return (b.count||0) - (a.count||0);
    return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0);
  });
  var h = '';
  rows.forEach(function(f){
    var on = !!folderSel[f.path];
    h += '<div class="frow'+(on?' on':'')+(f.missing?' gone':'')+'" data-path="'+esc(f.path)+'" '
      + 'onclick="folderPick(\''+esc(f.path)+'\')">'
      + '<div class="fcb">'+ic('check')+'</div>'
      + '<div style="flex:1;min-width:0"><div class="fname">'+esc(folderLabel(f.path))+'</div>'
      + '<div class="fpath">'+esc(f.path)+'</div></div>'
      + '<div class="fmeta">'+(f.missing ? '已不存在' : (f.count||0)+' 张')+'</div></div>';
  });
  // 重排会让列表高度变化：先记住滚动位置，画完再放回去，别让手指下面的内容跳走
  var panel = $('#sheet .panel'), top = panel ? panel.scrollTop : 0;
  g.innerHTML = h;
  if(panel) panel.scrollTop = top;
  folderFilter(($('#folderQ') || {}).value || '');
  folderCountLabel();
}
/** 已选数量实时显示在底部固定条上（勾一个变一次） */
function folderCountLabel(){
  var n = 0, total = 0;
  folderAll.forEach(function(f){
    if(f.missing) return;
    total++;
    if(folderSel[f.path]) n++;
  });
  var el = $('#folderCount');
  if(el) el.innerHTML = '<b>' + n + '</b> 个已选 · 共 ' + total + ' 个';
  var b = $('#sheet .pfoot .btn.pri');
  if(b) b.textContent = n ? '开始监控这 ' + n + ' 个' : '开始监控';
}
function folderLabel(path){
  var seg = String(path||'').replace(/\/$/,'').split('/');
  var last = seg[seg.length-1] || path;
  var map = {'Screenshots':'截图','screenshots':'截图','Screenshot':'截图','截图':'截图','截屏':'截屏'};
  return map[last] || last;
}
function folderPick(path){
  folderSel[path] = !folderSel[path];
  folderRender();          // 重排 + 刷新计数：选中的浮到最上面
}
function folderSelAll(on){
  folderAll.forEach(function(f){ if(!f.missing) folderSel[f.path] = !!on });
  folderRender();
}
function folderPickShots(){
  folderAll.forEach(function(f){ folderSel[f.path] = !!f.shot && !f.missing });
  folderRender();
}
function folderFilter(t){
  var q = String(t||'').toLowerCase();
  var rows = document.querySelectorAll('#folderList .frow');
  for(var i=0;i<rows.length;i++){
    var p = (rows[i].getAttribute('data-path')||'').toLowerCase();
    rows[i].style.display = (!q || p.indexOf(q) >= 0) ? '' : 'none';
  }
}
function folderSave(){
  var want = folderAll.filter(function(f){ return folderSel[f.path] && !f.missing })
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
  var f = SHOTFLAGS || {};
  if(f.enabled) return;
  var asked = false;
  try{ asked = localStorage.getItem('shotIntro') === '1' }catch(e){}
  if(asked) return;
  setTimeout(function(){
    if(SHOTFLAGS && SHOTFLAGS.enabled) return;   // 这期间用户已经自己开了
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
  if(!(SHOTFLAGS && SHOTFLAGS.granted)) return askShotPerm();
  toast('正在扫描监控文件夹…');
  Android.scanShots(true);
}
function rescanShots(days){
  if(!(window.Android && Android.rescanShots)) return toast('只在 app 内可用');
  if(!(SHOTFLAGS && SHOTFLAGS.granted)) return askShotPerm();
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
      }).then(function(){ shotSel = {}; refresh(); toast('已清空截图暂存') });
    }
  });
}
function clipBanner(){
  var n = (S.info && S.info.clip) || 0;
  if(!n){
    // 后台看到剪贴板变了，但前台读被系统拒了 → 给个一键入口，不要默默失败
    var hint = window.Android && Android.clipHint && Android.clipHint() === '1';
    if(!hint) return '';
    return '<div class="clipbanner" onclick="importClip()">'+ic('clipboard')
      +'<div style="flex:1"><b>剪贴板刚有更新</b>'
      +'<div class="cbsub">系统不让后台读，点这里收进暂存</div></div>'
      +'<span class="cbar">收进来 ›</span></div>';
  }
  return '<div class="clipbanner" onclick="clipSheet()">'+ic('clipboard')
    +'<div style="flex:1"><b>剪贴板暂存 '+n+' 条</b>'
    +'<div class="cbsub">复制的内容已留在这里，点开勾选再处理</div></div>'
    +'<span class="cbar">整理 ›</span></div>';
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
function clipSheet(){
  // 暂存条数可能很多：操作按钮固定到底部，别让人滚到底才看得见（跟文件夹页一致）
  pageSheet('剪贴板暂存', '<div class="cliptop">'
    +'<button class="btn sm" onclick="clipSelAll(true)">全选</button>'
    +'<button class="btn sm" onclick="clipSelAll(false)">全不选</button>'
    +'</div>'
    +'<div id="clipList" class="clipload">加载中…</div>'
    +'<div class="pfoot" style="display:block">'
    +'<div class="count" id="clipFoot" style="margin-bottom:8px"></div>'
    +'<div style="display:flex;gap:8px">'
    +'<button class="btn" style="flex:1" onclick="clipDelSel()">删除所选</button>'
    +'<button class="btn" style="flex:1.2" onclick="clipParse(false)">原样存为笔记</button>'
    +'<button class="btn pri" style="flex:1.2" onclick="clipParse(true)">一键解析</button>'
    +'</div></div>');
  loadClips();
}
async function loadClips(){
  try{
    var r = await api('/api/clip/list');
    var clips = (r && r.clips) || [];
    S.info.clip = clips.length;
    if(!clips.length){
      var el = $('#clipList');
      if(el) el.innerHTML = emptyState('inbox', '暂存区是空的');
      var cc = $('#clipFoot') || $('#clipCount'); if(cc) cc.innerHTML = '<b>0</b> 条已选';
      return;
    }
    var h = '';
    // clipSel 是全局的，只增不减的话「已选 N 条」会把早就处掉的旧 id 也算进去
    var keep = {};
    clips.forEach(function(c){
      keep[c.id] = clipSel[c.id] !== undefined ? clipSel[c.id] : true;
      var on = !!clipSel[c.id];
      var body = c.kind==='image'
        ? '<div class="climthumb">'+ic('image')+' 图片'+(c.name?' · '+esc(c.name):'')+'</div>'
        : '<div class="cliprev">'+esc(String(c.text||'').slice(0,160))+(c.text&&c.text.length>160?'…':'')+'</div>';
      h += '<div class="clipitem'+(on?' on':'')+'" onclick="clipPick(\''+c.id+'\',this)">'
        +'<div class="clicb">'+ic('check')+'</div>'
        +'<div class="clipbody">'+body
        +'<div class="climeta">'+esc(c.app||'剪贴板')+' · '+relTime(c.createdAt)+'</div></div>'
        +'<button class="clipdel" onclick="clipDel(event,'+JSON.stringify(c.id)+')" aria-label="删除这条">'+ic('x')+'</button></div>';
    });
    clipSel = keep;
    var el2 = $('#clipList'); if(el2) el2.innerHTML = h;
    clipCount();
  }catch(e){
    var el3 = $('#clipList'); if(el3) el3.innerHTML = '<div class="empty">加载失败</div>';
  }
}
function clipPick(id, el){
  clipSel[id] = !clipSel[id];
  el.classList.toggle('on', !!clipSel[id]);
  var cb = el.querySelector('.clicb');
  if(cb) cb.classList.toggle('on', !!clipSel[id]);
  clipCount();
}
function clipSelAll(v){
  Object.keys(clipSel).forEach(function(k){ clipSel[k]=v; });
  var items = document.querySelectorAll('.clipitem');
  for(var i=0;i<items.length;i++){
    items[i].classList.toggle('on', v);
    var cb = items[i].querySelector('.clicb');
    if(cb) cb.classList.toggle('on', v);
  }
  clipCount();
}
function clipCount(){
  // 以页面上真正列出来的条目为准，不拿全局 map 计数
  var items = document.querySelectorAll('.clipitem');
  var n = 0;
  for(var i=0;i<items.length;i++){ if(items[i].classList.contains('on')) n++; }
  var el = $('#clipFoot') || $('#clipCount');
  if(el) el.innerHTML = '<b>' + n + '</b> 条已选 · 共 ' + items.length + ' 条';
  var b = $('#sheet .pfoot .btn.pri');
  if(b) b.textContent = n > 1 ? ('一键解析 ' + n + ' 条') : '一键解析';
}
function clipSelected(){
  return Object.keys(clipSel).filter(function(k){return clipSel[k]});
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
    ids.forEach(function(id){ delete clipSel[id]; });
    toast('已删除 '+ids.length+' 条');
    if(window.Android && Android.clipSync) Android.clipSync();
    loadClips();
    refresh(true);
  }catch(e){ toast('删除失败'); }
}
async function clipParse(ai){
  var ids = clipSelected();
  if(!ids.length){ toast('先勾选要处理的条目'); return; }
  var r = await api('/api/clip/parse', {ids:ids, raw:!ai});
  var ok = r && r.ok;
  toast(ai ? (ok ? '已入队解析 '+r.parsed+' 条' : '解析失败: '+(r&&r.error||''))
            : (ok ? '已存 '+r.parsed+' 条笔记' : '保存失败: '+(r&&r.error||'')));
  clipSel = {};
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
function remindBtns(n,t){
  if(!t.due||t.done) return '';
  return ' <span class="remind" title="写入系统日历" onclick="toCalendar(\''+n.id+'\',\''+t.id+'\',event)">'+ic('calendar')+'</span>'
       + ' <span class="remind" title="设为闹钟" onclick="toAlarm(\''+n.id+'\',\''+t.id+'\',event)">'+ic('alarm')+'</span>';
}
function factsBlock(n){
  var f = n.facts||[]; if(!f.length) return '';
  return '<div class="facts"><div class="fh">'+ic('search')+'关键信息</div>'
    + f.map(function(x,ki){return '<div class="fr" style="--k:'+ki+'"><span class="fq">'+esc(x.q)+'</span>'
        + '<span class="fa">'+esc(x.a)+'</span></div>'}).join('') + '</div>';
}
function todoRow(t, n, compact){
  var d='', dcls='due';  if(t.due){
    var overdue = t.due < now(), today = t.due.slice(0,10)===now().slice(0,10);
    if(overdue && !t.done) dcls+=' over'; else if(today) dcls+=' today';
    d='<span class="'+dcls+'">'+ic('calendar')+fmtTime(t.due)+'</span>'+cdChip(t)+remindBtns(n,t);
  }
  var extra = [];
  if(t.priority==='high') extra.push('<span class="chip err">'+ic('bolt')+'重要</span>');
  if(t.priority==='low') extra.push('<span class="chip">'+ic('chevup')+'低</span>');
  if(!compact && t.source==='manual') extra.push('<span class="chip">'+ic('edit')+'手动</span>');
  return '<div class="todo'+(t.done?' done':'')+(t.priority==='high'?' pri-high':'')+todoEnterCls(n,t)+'"'
    +' id="t'+n.id+'_'+t.id+'">'
    +'<div class="cb'+(t.done?' on':'')+'" onclick="toggle(\''+n.id+'\',\''+t.id+'\',this)">'+ic('check')+'</div>'
    +'<div class="tx"><span class="ttx">'+esc(t.text)+'</span><small>'+d+' '+extra.join(' ')+'</small></div>'
    +(compact?'':'<button class="btn sm gh" aria-label="删除待办" onclick="delTodo(\''+n.id+'\',\''+t.id+'\')">'+ic('x')+'</button>')
    +'</div>';
}
function noteCard(n, k){
  var exp = !!open[n.id];
  var body = n.content || '(无正文)';
  var h = '<div class="card'+enterCls('n'+n.id)+'" id="n'+n.id+'" style="--i:'+Math.min(k||0,8)+'">';
  h += '<div class="row between"><p class="t">'+esc(n.title || '未命名笔记')+'</p></div>';
  h += '<div class="meta">'+srcChip(n)+statusChip(n)
     + '<span>'+ic('clock', 's')+' '+fmtTime(n.createdAt.toISOString?n.createdAt:n.createdAt)+'</span>'
     + (n.tags||[]).map(function(t){return '<span class="chip tag">'+ic('tag')+' '+esc(t)+'</span>'}).join('')
     + '</div>';
  var w = SR.where[n.id];
  if(w && w.length) h += '<div class="hits">' + w.map(function(x){
      return '<span class="hit'+(x==='来自图片文字'?' img':'')+'">'+ic(x==='来自图片文字'?'image':'search')
        +esc(x)+'</span>' }).join('') + '</div>';
  if(n.attachments && n.attachments.length > 1)
    h += '<div class="hits"><span class="hit">'+ic('clip')+n.attachments.length+' 个附件</span></div>';
  if(n.imagePath) h += '<img class="thumb" src="/img?id='+n.id+'">';
  h += factsBlock(n);
  h += '<div class="body'+(exp?'':' clamp')+'">'+esc(body)+'</div>';
  if(n.error) h += '<div class="errbox">'+esc(n.error)+'</div>';
  if(n.todos && n.todos.length){
    h += '<div style="margin-top:10px">'+n.todos.map(function(t){return todoRow(t,n,true)}).join('')+'</div>';
  }
  h += '<div class="acts">';
  h += '<button class="btn sm gh exp" onclick="expand(\''+n.id+'\')">'+ic(exp?'chevup':'chev')+(exp?'收起':'展开详情')+'</button>';
  if(n.status==='done'||n.status==='raw')
    h += '<button class="btn sm" onclick="reparse(\''+n.id+'\')">'+ic('refresh')+'重新解析</button>';
  if(n.imagePath) h += '<button class="btn sm" onclick="reocr(\''+n.id+'\')">'+ic('scan')+'重新识别图片</button>';
  h += '<button class="btn sm" onclick="addTodoSheet(\''+n.id+'\')">'+ic('plus')+'待办</button>';
  h += '<button class="btn sm dg" onclick="delNote(\''+n.id+'\')">'+ic('trash')+'删除</button>';
  h += '</div></div>';
  return h;
}
function renderNotes(){
  var list = notesFiltered();
  if(!S.notes.length) return strip()+missedBanner()+shotBanner()+clipBanner() + emptyState('inbox', '还没有笔记',
      '在任何 app 里点「分享 → 懒得记」，文字和图片会自动变成笔记与待办');
  if(!list.length) return strip()+missedBanner()+shotBanner()+clipBanner() + emptyState('search', '没有符合条件的笔记',
      '换个关键词，或点右上角重置筛选');
  var h = strip()+missedBanner()+shotBanner()+clipBanner();
  list.forEach(function(n, k){ h += noteCard(n, k) });
  return h;
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
function renderTodos(){
  var g = groupTodos(), h = strip(), icons = {'已逾期':'warn-tri','今天':'fire','明天':'calendar','本周':'calendar-check','以后':'seed','无日期':'pin','已完成':'check-circle'};
  var any = false, k = 0;
  var p = P();
  Object.keys(g).forEach(function(k0){
    if(k0==='已完成' && p.done==='open') return;
    if(k0!=='已完成' && p.done==='done') return;
    var items = g[k0].filter(function(o){
      if(SR.todoIds) return SR.todoIds[o.n.id+'|'+o.t.id];
      if(p.pri!=='all' && (o.t.priority||'normal')!==p.pri) return false;
      return hit([o.t.text, o.n.title, o.n.content].join(' '));
    });
    if(!items.length) return; any = true;
    if(p.sort==='pri') items.sort(function(a,b){return rank(b.t)-rank(a.t)});
    h += '<div class="sec">'+ic(icons[k0], 's')+k0+' · '+items.length+'</div><div class="card'+enterCls('g'+k0)+'" style="--i:'+(k++)+'">';
    items.forEach(function(o){
      h += '<div class="todo'+(o.t.done?' done':'')+(o.t.priority==='high'?' pri-high':'')+todoEnterCls(o.n,o.t)+'">'
        +'<div class="cb'+(o.t.done?' on':'')+'" onclick="toggle(\''+o.n.id+'\',\''+o.t.id+'\',this)">'+ic('check')+'</div>'
        +'<div class="tx"><span class="ttx">'+esc(o.t.text)
        +'<small>'+(o.t.due?'<span class="due'+(o.t.due<now()&&!o.t.done?' over':'')+'">'+ic('calendar')+fmtTime(o.t.due)+'</span> '+cdChip(o.t)+remindBtns(o.n,o.t):'')
        +'<a href="#" onclick="jump(\''+o.n.id+'\');return false">'+esc(o.n.title||'查看笔记')+'</a></small></div></div>';
    });
    h += '</div>';
  });
  if(!any) return h + emptyState('check-circle', '没有符合条件的待办', '分享一段文字，AI 会自动提取待办');
  return h;
}
function rank(t){ return ({high:3,normal:2,low:1})[t.priority||'normal'] }
function hit(s){ if(!q) return true; return (s||'').toLowerCase().indexOf(q.toLowerCase())>=0 }
function renderSettings(){
  var s = S.settings, i = S.info, st = ST;
  var h = '<div class="pgroup">提醒</div>'
   +'<div class="card"><div class="row between" style="margin-top:2px"><div><b>到期待办提醒</b>'
   +'<div style="font-size:11px;color:var(--dim)">'+ (notifyGranted()
        ? '已排定 '+remindPending+' 条 · 按系统闹钟登记，尽量不被后台清理'
        : '需要通知权限 · 开启后到点用系统通知提醒') +'</div></div>'
   +'<button class="btn sm '+(notifyGranted()?'gh':'')+'" onclick="askNotify()">'
   + (notifyGranted() ? '已开启' : '开启通知') +'</button></div>'
   + (exactGranted() ? '' :
       '<div class="row between" style="margin-top:8px"><div><b>精确提醒</b>'
      +'<div style="font-size:11px;color:var(--dim)">允许「闹钟和提醒」后不再被系统延迟</div></div>'
      +'<button class="btn sm" onclick="askExact()">去开启</button></div>')
   +'</div>'
   +'<div class="pgroup">后台</div>'
   +'<div class="card"><div class="row between" style="margin-top:2px"><div><b>常驻后台</b>'
   +'<div style="font-size:11px;color:var(--dim)">'+ (keepAliveOn()
        ? (batteryIgnoring() ? '已开启 · 已豁免电池优化' : '已开启 · 建议再豁免电池优化')
        : '关闭 · 只在打开 app 时可靠，后台可能收不到提醒') +'</div></div>'
   +'<div class="sw'+(keepAliveOn()?' on':'')+'" onclick="toggleKeepAlive(this)"></div></div>'
   + (keepAliveOn()
       ? (batteryIgnoring()
          ? '<div class="kv" style="margin-top:10px"><span>电池优化</span>'
            +'<span style="color:var(--ok)">已豁免，不会被冻结</span></div>'
          : '<div style="margin-top:10px;font-size:12px;color:var(--dim);line-height:1.8">'
            +'部分系统会在后台冻结应用，连闹钟一起丢掉。标准做法是把它加进电池优化白名单：<br>'
            +'① 点下面的按钮；<br>② 在列表里找到「懒得记」；<br>'
            +'③ 选「不限制 / 允许后台活动」。<br>'
            +'如果系统另外还有「后台高耗电」「自启动」之类的开关，一并允许。</div>'
            +'<div class="acts"><button class="btn pri" onclick="askBattery()">去关闭电池优化</button>'
            +'<button class="btn gh" onclick="askNotify()">检查通知权限</button></div>')
       : '')
   +'<div style="font-size:11px;color:var(--dim);margin-top:8px">开启后通知栏会有一条常驻提示，'
   +'这是系统允许的标准保活方式；服务每 10 分钟检查一次待办，把被系统丢掉的闹钟重新排上。'
   +'仍有厂商会在后台强行冻结应用（连闹钟一起取消），app 无法绕过；那种情况下打开 app 时'
   +'未完成的待办都还在「待办」页。电池优化页面的名字各厂商可能不同，这只是系统设置页，'
   +'app 不侦测品牌。</div>'
   +'</div>'
   +'<div class="pgroup">外观</div>'
   +'<div class="card"><div class="seg" style="margin-top:2px">'
   + ['light','dark','auto'].map(function(m){
       return '<button class="'+(m===(s.theme||'light')?'on':'')+'" onclick="setTheme(\''+m+'\')">'
         + ic(m==='light'?'sun':m==='dark'?'moon':'monitor')+({light:'亮色', dark:'暗色', auto:'跟随系统'}[m]) + '</button>'}).join('')
   +'</div><div style="font-size:11px;color:var(--dim);margin-top:8px">默认亮色；'
   +'选「跟随系统」时随手机夜间模式切换，状态栏与导航栏同步变色</div></div>';

  h += '<div class="pgroup">AI 模型（BYOK）</div><div class="card">'
   +'<div class="row between" style="margin-top:2px"><div><b>启用 AI 解析</b>'
   +'<div style="font-size:11px;color:var(--dim)">关闭后只保存原文，不调用模型</div></div>'
   +'<div class="sw'+(s.useAI?' on':'')+'" onclick="toggleAI(this)"></div></div>'
   +'<label>API Base URL（OpenAI 兼容）</label><input id="sUrl" value="'+esc(s.baseUrl)+'" placeholder="https://your-server:8080/v1">'
   +'<label>API Key</label><input id="sKey" value="'+esc(s.apiKey)+'" placeholder="sk-...">'
   +'<div class="fhint">明文存在本机 app 私有目录（别的 app 读不到），这里显示的就是已保存的 key，换 key 直接改这一栏</div>'
   +'<label>模型名</label><input id="sModel" value="'+esc(s.model)+'">'
   +'<div class="grid2"><div><label>超时（秒）</label><input id="sTimeout" value="'+(s.timeoutS||90)+'"></div>'
   +'<div><label>最大 tokens</label><input id="sMax" value="'+(s.maxTokens||2048)+'"></div></div>'
   +'<label>温度 temperature</label><input id="sTemp" value="'+(s.temperature==null?'0.2':s.temperature)+'">'
   +'<div class="acts"><button class="btn pri" onclick="saveSettings()">保存</button>'
   +'<button class="btn" onclick="testLLM()">测试连接</button></div>'
   +'<div id="llmOut"></div></div>';

  h += '<div class="pgroup">采集</div><div class="card">'
   +'<div class="kv"><span>剪贴板暂存</span><span style="color:var(--acc2)">前台自动 + 顶栏按钮手动</span></div>'
   +'<div style="font-size:11px;color:var(--dim);margin-top:8px">打开 app 时自动暂存剪贴板里的文字；'
   +'在别的 app 复制后切回「懒得记」即可看到，顶栏剪贴板按钮也可以随时手动收一条。'
   +'Android 10+ 只允许有焦点的窗口读剪贴板，刚点通知进来时系统会拒读，app 会等拿到焦点重试。'
   +'点「解析」才发到大模型，之前内容不会离开本机。</div></div>';

  h += '<div class="pgroup">本地 OCR</div><div class="card">'
   +'<div class="kv"><span>引擎状态</span><span>'+(i.ocrReady?'<b style="color:var(--ok)">● 就绪</b>':'<span style="color:var(--warn)">◌ 初始化中</span>')+'</span></div>'
   +'<div class="kv"><span>引擎信息</span><span>'+(S.ocrInfo||'vivo 离线 OCR')+'</span></div>'
   +'<div style="font-size:11px;color:var(--dim);margin-top:8px">图片只在本机识别成文字，'
   +'只有识别出的文字（和原文）会发给模型。单条笔记可在笔记卡片上「↻ 重新识别图片」。</div></div>';

  h += '<div class="pgroup">数据</div><div class="card">'
   +'<div class="kv"><span>笔记 / 待办</span><span>'+(st?st.notes.total:i.notes||0)+' / '
     +(st?st.todos.total:i.todos||0)+'</span></div>'
   +'<div class="kv"><span>未完成 / 已逾期</span><span>'+(st?st.todos.open:i.open||0)+' / <b style="color:var(--bad)">'
     +(st?st.todos.overdue:i.overdue||0)+'</b></span></div>'
   +'<div class="kv"><span>附件 / 占用</span><span>'+(st?(st.attach.count||0):0)+' 个 / '
     +fmtSize(st?st.bytes:0)+'</span></div>'
   +'<div class="acts"><button class="btn gh" onclick="location.href=\'/api/export\'">导出 JSON</button>'
   +'<button class="btn gh" onclick="importJSON()">导入 JSON</button>'
   +'<button class="btn dg" onclick="clearAllNotes()">清空全部</button></div>'
   +'<div style="font-size:11px;color:var(--dim);margin-top:8px">导出＝全量备份（含待办与附件元数据）；'
   +'导入按笔记 ID 合并，已存在的笔记不覆盖；清空只删笔记与附件，设置与 API Key 保留。</div></div>';

  h += '<div class="pgroup">运行状态</div><div class="card">'
   +'<div class="kv"><span>Go 服务</span><span>'+(i.server||'')+'</span></div>'
   +'<div class="kv"><span>Go / 运行时长</span><span>'+(i.go||'')+' / '+(i.uptimeS||0)+'s</span></div>'
   +'<div class="kv"><span>时区</span><span>'+(i.tz||'')+'</span></div>'
   +'<div class="kv"><span>解析队列</span><span>'+(i.queue||0)+' 条待处理</span></div>'
   +'<div class="acts"><button class="btn gh" onclick="showLog()">查看日志</button>'
   +'<button class="btn gh" onclick="showDebug()">AI 调用记录</button></div></div>';

  h += '<div class="pgroup">用法</div><div class="card"><div class="body" style="margin-top:2px">'
   +'· 在微信 / 浏览器 / 相册里点「分享」→ 选 懒得记<br>'
   +'· 文字直接发给模型；图片先在本机用离线 OCR 识别成文字，再发给模型（图片不出门）<br>'
   +'· 模型返回 JSON：标题、正文、标签、待办（含到期时间）<br>'
   +'· 底部 ＋ 可手动记文字或选图片；返回键先关面板，再回笔记页</div></div>';
  return h;
}
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
function buildPage(t){
  return t==='notes' ? renderNotes()
       : t==='todos' ? renderTodos()
       : t==='files' ? renderFiles() : renderMine();
}
function render(){
  var p = paneFor(tab);
  p.innerHTML = buildPage(tab);
  paneBuilt[tab] = 1; paneDirty[tab] = 0;
  invalidatePanes(tab);
  showPane();
  paintStatus();
  clearEnter();
  syncReminders();
  syncExpand();
}

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
  var i = S.info, d = $('#dot');
  if(!d) return;
  d.className = 'dot' + ((i.server && i.ocrReady) ? '' : ' bad');
}
/* ---------- 附件页（R4）----------
   数据来自 /api/attachments（服务端过滤/排序，含磁盘文件数校验）。 */
var FA = {items:[], total:0, bytes:0, files:0, missing:0, scanned:0, diskFiles:0, loaded:false};
var KIND = {image:'image',pdf:'file-pdf',doc:'file',sheet:'file-sheet',slides:'file-slides',text:'file-text',audio:'music',video:'film',archive:'archive',file:'clipfile'};
function fmtSize(b){
  b = b||0;
  if(b >= 1073741824) return (b/1073741824).toFixed(2)+' GB';
  if(b >= 1048576) return (b/1048576).toFixed(1)+' MB';
  if(b >= 1024) return Math.round(b/1024)+' KB';
  return b+' B';
}
async function filesNow(){
  var my = ++searchSeq, p = P();
  var s = 'q='+encodeURIComponent(q)+'&sort='+encodeURIComponent(p.sort||'new');
  if(p.dir) s += '&dir='+encodeURIComponent(p.dir);
  if(p.kind && p.kind!=='all') s += '&mime='+encodeURIComponent(p.kind);
  try{
    var d = await api('/api/attachments?'+s);
    if(my !== searchSeq) return;
    var k = JSON.stringify(d);
    FA = {items:d.items||[], total:d.total||0, bytes:d.bytes||0, files:d.files||0,
          missing:d.missing||0, scanned:d.scanned||0, diskFiles:d.diskFiles||0, loaded:true};
    if(k === SRK){ paintStatus(); return }
    SRK = k;
  }catch(e){ FA.loaded = false; SRK = '' }
  render();
}
function fileStrip(){
  if(!FA.total) return '<div class="strip">附件 <b>0</b></div>';
  return '<div class="strip">附件 <b>'+FA.total+'</b> · '+fmtSize(FA.bytes)
    + (FA.missing ? ' · <i>'+FA.missing+' 个文件缺失</i>' : '')
    + '</div>';
}
function renderFiles(){
  if(!FA.loaded) return fileStrip() + '<div class="card"><div class="skel img"></div>'
    + '<div class="skel l"></div><div class="skel s"></div></div>';
  if(!FA.items.length) return fileStrip() + emptyState('clip',
      q ? '没有匹配的附件' : '还没有附件',
      '分享图片 / PDF，或点右下角「添加附件」');
  var h = fileStrip() + '<div class="agrid">';
  FA.items.forEach(function(a, k){
    h += '<div class="acard'+(a.missing?' gone':'')+enterCls('a'+a.id)+'" style="--i:'+Math.min(k,8)+'" '
      + 'onclick="openAttach(\''+a.id+'\')">'
      + (a.kind==='image' && !a.missing
          ? '<img class="athumb" loading="lazy" src="/file?id='+a.id+'">'
          : '<div class="aglyph">'+ic(KIND[a.kind]||'clipfile','xl')+'</div>')
      + '<div class="aname">'+esc(a.name)+'</div>'
      + '<div class="ameta">'+esc(a.kind)+' · '+fmtSize(a.size)+' · '+fmtTime(a.createdAt)+'</div>'
      + '<div class="anote">'+esc(a.noteTitle||'')+'</div>'
      + (a.missing ? '<div class="amiss">文件已不在</div>' : '')
      + '<div class="arow" onclick="event.stopPropagation()">'
      + '<button class="btn sm gh" onclick="jump(\''+a.noteId+'\')">'+ic('note')+'笔记</button>'
      + '<button class="btn sm dg" onclick="delAttach(\''+a.id+'\')">'+ic('trash')+'删除</button>'
      + '</div></div>';
  });
  return h + '</div>';
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
var ST = null, stBusy = false;
async function statsNow(){
  if(stBusy) return;
  stBusy = true;
  try{ ST = await api('/api/stats') }catch(e){ ST = null }
  stBusy = false;
  if(tab==='mine') render();
}
function renderMine(){
  var i = S.info, s = ST;
  var h = '<div class="hero"><div class="hrow"><div class="hlogo"><img src="/icon.png" alt=""></div>'
    + '<div><h1>懒得记</h1><div class="hver">'+esc(i.go||'')+' · 本机离线 OCR · BYOK</div></div></div>'
    + '<div class="hstats">'
    + (s ? '<span>'+ic('note')+s.notes.total+' 条笔记</span>'
          + '<span>'+ic('check-square')+s.todos.total+' 条待办</span>'
          + '<span>'+ic('clip')+(s.attach.count||0)+' 个附件</span>'
          + '<span>'+ic('db')+fmtSize(s.bytes)+'</span>'
      : '<span>正在统计本地数据…</span>')
    + '</div></div>';
  if(!s) return h + '<div class="card"><div class="skel l"></div><div class="skel s"></div></div>';
  h += '<div class="statgrid">'
    + stat(0, s.notes.total, '笔记', 'note') + stat(1, s.todos.total, '待办', 'check-square')
    + stat(2, s.todos.open, '未完成', 'clock') + stat(3, s.todos.overdue, '已逾期', 'alert', 1)
    + stat(4, s.attach.count||0, '附件', 'clip') + stat(5, s.ai.calls||0, 'AI 调用', 'sparkle') + '</div>';
  h += '<div class="card"><h2>近 7 天</h2>'+chartHTML(s.days)
    + '<div class="legend"><span><i style="background:var(--acc)"></i>新增笔记</span>'
    + '<span><i style="background:var(--acc2)"></i>完成待办</span></div></div>';
  h += '<div class="card"><h2>笔记状态</h2>'
    + kv('AI 解析完成', s.notes.done) + kv('仅存原文', s.notes.raw)
    + kv('解析失败', s.notes.error) + kv('队列中', (s.notes.queued||0)+(s.notes.parsing||0))
    + kv('附件缺失文件', s.attach.missing||0) + '</div>';
  if(s.tags && s.tags.length){
    h += '<div class="card"><h2>常见标签</h2><div class="tagrow">'
      + s.tags.map(function(t){return '<span class="chip tag">#'+esc(t.tag)+' · '+t.n+'</span>'}).join('')
      + '</div></div>';
  }
  var sf = SHOTFLAGS || {};
  h += '<div class="card"><h2>截图捕获</h2><div style="padding:0 12px 4px">'
    + li('folder','监控文件夹', sf.enabled
        ? ((sf.folders||0) + ' 个 · 点这里增删')
        : '未开启 · 点这里开始', 'folderSheet()')
    + li('image','截图暂存','当前 ' + ((S.info && S.info.shot) || 0) + ' 张待整理', 'shotSheet()')
    + li('refresh','现在扫描一次', sf.granted ? '只看上次之后的新图' : '需要先允许读取照片', 'scanShotsNow()')
    + li('calendar','回捞最近 7 天', '把最近 7 天的截图都收一遍（不会重复）', 'rescanShots(7)')
    + li('trash','清空截图暂存', '只删副本，不动系统相册', 'clearShots()')
    + '</div></div>';
  h += '<div class="card" style="padding:2px 12px">'
    + li('settings','设置','AI 模型 / 外观 / 采集 / OCR / 数据', 'settingsSheet()')
    + li('file-text','运行日志','Go 服务、解析队列、OCR 状态', 'showLog()')
    + li('sparkle','AI 调用记录','本次运行的请求与返回', 'showDebug()')
    + li('download','导出 JSON','全量备份笔记与待办', "location.href='/api/export'")
    + li('inbox','导入 JSON','按笔记 ID 合并，不覆盖本地', 'importJSON()')
    + li('trash','清空全部','删除所有笔记与附件', 'clearAllNotes()')
    + '</div>';
  h += '<div class="card"><div class="kv"><span>Go 服务</span><span>'+(i.server||'')+'</span></div>'
    + '<div class="kv"><span>Go / 运行时长</span><span>'+(i.go||'')+' / '+(i.uptimeS||0)+'s</span></div>'
    + '<div class="kv"><span>时区</span><span>'+(i.tz||'')+'</span></div>'
    + '<div class="kv"><span>OCR 引擎</span><span>'+(i.ocrReady?'<b style="color:var(--ok)">● 就绪</b>':'<span style="color:var(--warn)">◌ 初始化中</span>')+'</span></div></div>';
  return h;
}
function kv(k, v){ return '<div class="kv"><span>'+k+'</span><span>'+v+'</span></div>' }
function chartHTML(days){
  var mx = 1;
  days.forEach(function(d){ mx = Math.max(mx, d.notes, d.done) });
  var h = '<div class="chart">';
  days.forEach(function(d, k){
    h += '<div class="col" title="'+esc(d.day)+'：'+d.notes+' 条笔记 / '+d.done+' 条完成">'
      + '<div class="bars">'
      + '<div class="bar n" style="height:'+Math.max(2,Math.round(d.notes/mx*76))
        +'px;animation-delay:'+(k*40)+'ms"></div>'
      + '<div class="bar d" style="height:'+Math.max(2,Math.round(d.done/mx*76))
        +'px;animation-delay:'+(k*40+60)+'ms"></div>'
      + '</div><div class="lb">'+esc(d.label)+'</div></div>';
  });
  return h+'</div>';
}
function stat(i, v, label, icon, hot){
  return '<div class="stat'+(hot?' hot':'')+enterCls('s'+label)+'" style="--i:'+i+'">'
    + '<div class="si">'+ic(icon)+'</div><b>'+v+'</b><span>'+label+'</span></div>';
}
function li(icn, t, sub, fn){
  return '<div class="li" onclick="'+fn+'"><span class="lico">'+ic(icn)+'</span>'
    +'<div style="flex:1"><b style="font-size:14.5px">'+t+'</b>'
    +(sub?'<div style="font-size:11px;color:var(--dim2);margin-top:1px">'+sub+'</div>':'')+'</div>'
    +'<span style="color:var(--dim2)">›</span></div>';
}
function settingsSheet(){ pageSheet('设置', renderSettings()); $('#panel').dataset.kind = 'settings'; }
/* 只重绘设置页本身，并把滚动位置放回去（开关、权限回来后刷新用）*/
function settingsRefresh(){
  var p = $('#panel');
  if(!p || p.dataset.kind !== 'settings' || !$('#sheet').classList.contains('on')) return;
  var top = p.scrollTop;
  settingsSheet();
  requestAnimationFrame(function(){ $('#panel').scrollTop = top; });
}
/* 从系统设置页回来后重新读一次权限/保活状态；顺便重画，让「剪贴板刚有更新」提示立刻出现 */
window.onAppResume = function(){
  shotFlags();
  settingsRefresh();
  if (S && S.notes) render();
};
/* 全屏面板：设置页用，顶栏固定，内容可滚 */
function pageSheet(title, html){
  var p = $('#panel');
  p.className = 'panel page';
  p.innerHTML = '<div class="phead"><button class="iconbtn" onclick="closeSheet()" aria-label="返回">'+ic('chev')+'</button>'
    + '<div style="flex:1">'+esc(title)+'</div></div><div class="pbody">'+html+'</div>';
  $('#sheet').classList.add('on');
  p.scrollTop = 0;
}
function importJSON(){
  if(!window.Android){ toast('导入只在 app 内可用'); return }
  toast('选择之前导出的 JSON 文件…');
  Android.pickJSON();
}
function clearAllNotes(){
  var n = ST ? ST.notes.total : (S.info.notes||0);
  askDel('清空全部 '+n+' 条笔记？附件文件一并删除，设置与 API Key 保留。', function(){
    api('/api/clear', {}).then(function(r){
      toast(r.ok ? ('已删除 '+r.deleted+' 条') : ('清空失败: '+(r.error||'')));
      ST = null; refresh(); statsNow();
    }, function(e){ toast('清空失败: '+e) });
  });
}
/* ---------- 排序 / 筛选浮层（R3，P3 接服务端）---------- */
function sortSheet(){
  var p = P(), h = '<h2>排序与筛选</h2><div style="height:6px"></div>';
  var sorts = tab==='todos'
    ? [['due',ic('clock')+'按到期'],['pri',ic('bolt')+'重要优先'],['new',ic('sort')+'最新']]
    : tab==='files' ? [['new',ic('sort')+'最新'],['size',ic('db')+'大小'],['name',ic('file')+'名称'],['kind',ic('folder')+'类型']]
      : [['new',ic('sort')+'最新在前'],['old',ic('sort')+'最早在前'],['title',ic('file-text')+'标题']];
  h += group('排序', 'sort', sorts, p.sort);
  if(tab==='notes'){
    h += group('来源', 'src', [['all','全部'],['text','文字'],['image','图片']], p.src);
    h += group('状态', 'status', [['all','全部'],['done','已解析'],['raw','仅原文'],['error','失败']], p.status);
    h += group('附件', 'file', [['all','全部'],['yes','有附件'],['no','无附件']], p.file);
  }else if(tab==='todos'){
    h += group('状态', 'done', [['open','未完成'],['done','已完成'],['all','全部']], p.done);
    h += group('优先级', 'pri', [['all','全部'],['high','重要'],['normal','普通'],['low','低']], p.pri);
  }else if(tab==='files'){
    // the server knows more kinds (slides/audio/video/archive); the common ones keep the row readable
    h += group('类型', 'kind', [['all','全部'],['image','图片'],['pdf','PDF'],['doc','文档'],
      ['sheet','表格'],['text','文本'],['file','其他']], p.kind);
  }
  h += '<div class="acts"><button class="btn" onclick="resetPrefs()">重置</button>'
     + '<button class="btn pri" onclick="closeSheet()">完成</button></div>';
  sheet(h);
}
function group(label, key, opts, cur){
  return '<label>'+label+'</label><div class="seg">'
    + opts.map(function(o){
        return '<button class="'+(o[0]===cur?'on':'')+'" onclick="setPref(\''+key+'\',\''+o[0]+'\')">'+o[1]+'</button>'
      }).join('') + '</div>';
}
function setPref(k, v){ P()[k] = v; closeSheet(); searchNow(); savePrefs(); }
function resetPrefs(){
  prefs[tab] = tab==='todos' ? {sort:'due',done:'open',pri:'all'}
             : tab==='files' ? {sort:'new',kind:'all'} : {sort:'new',src:'all',status:'all',file:'all'};
  q = ''; var el = $('#q'); if(el){ el.value=''; $('#searchBox').classList.remove('has'); }
  closeSheet(); searchNow(); savePrefs();
}
/* ---------- 轮询：只在数据真的变了才重绘（避免秒级闪烁 ----------
   2s 一次的 /api/state 很便宜，但 render() 要重建整个列表、重载缩略图、
   重播入场动画。所以先比指纹，没变就只刷新右上角状态点。 */
var SIG = '', drawn = false;
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
}
async function refresh(quiet){
  if(Date.now() < animLock){ paintStatus(); return }
  try{ var d = await api('/api/state'); S = d; if(MISSED) S.missed = MISSED;
       var dirty = !quiet || !drawn || sigOf(d) !== SIG;
       if(!prefsLoaded && S.settings && S.settings.ui){
         prefsLoaded = true;
         var fp = flattenPrefs(S.settings.ui);
         Object.keys(fp).forEach(function(k){
           prefs[k] = Object.assign(prefs[k]||{}, fp[k]);
         });
         q = P().q || '';
         var el = $('#q'); el.value = q; $('#searchBox').classList.toggle('has', !!q);
         dirty = true;
       }
       if(themeOf() !== curTheme){ curTheme = themeOf(); applyTheme(); dirty = true; }
       paintStatus();
       if(!dirty) return;
       SIG = sigOf(d); drawn = true;
       searchNow(dirty); }
  catch(e){ var d = $('#dot'); if(d) d.className='dot bad'; if(!drawn) render(); }
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
function toggleAI(el){ var s=S.settings; s.useAI=!s.useAI; el.classList.toggle('on'); saveSettings(); }
async function saveSettings(){
  var s = {baseUrl:$('#sUrl').value.trim(), apiKey:$('#sKey').value.trim(),
    model:$('#sModel').value.trim(), timeoutS:parseInt($('#sTimeout').value)||90,
    maxTokens:parseInt($('#sMax').value)||2048, useAI:S.settings.useAI,
    temperature:S.settings.temperature||0.2};
  var r = await api('/api/settings', s);
  toast(r.ok?'已保存':'保存失败'); if(r.ok){S.settings=r.settings; render();}
}
async function testLLM(){
  $('#llmOut').innerHTML='<div class="body"><span class="spin"></span> 连接中…</div>';
  var r = await api('/api/llm/test',{});
  $('#llmOut').innerHTML='<div class="body" style="margin-top:10px">'
    +(r.ok?'✅ 成功（'+r.ms+'ms，HTTP '+r.httpCode+'）<br>'+esc(r.reply)
           :'❌ 失败（'+(r.ms||0)+'ms）<br>'+esc(r.error||''))+'</div>';
}
async function showLog(){
  var r = await api('/api/log?n=150');
  sheet('<h2>运行日志</h2><div class="meta"><span class="chip">OCR '+(r.ocrReady?'ready':'…')
    +'</span><span class="chip">'+esc(r.server||'')+'</span></div><pre>'+esc(r.log)+'</pre>');
}
async function showDebug(){
  var r = await api('/api/llmlog');
  var h='<h2>AI 调用记录</h2>';
  if(!r.calls.length) h+='<div class="empty">还没有调用记录</div>';
  r.calls.slice(0,10).forEach(function(c){
    h+='<div class="card"><div class="meta"><span class="chip">'+esc(c.model)+'</span>'
     +'<span class="chip">'+c.ms+'ms</span><span class="chip">HTTP '+c.httpCode+'</span></div>'
     +'<div class="body" style="font-size:12px">输入：'+esc(clip(c.user,200))+'</div>'
     +'<pre>'+esc(c.err?('错误：'+c.err):c.raw)+'</pre></div>';
  });
  sheet(h);
}
function clip(s,n){s=s||'';return s.length>n?s.slice(0,n)+'…':s}
function sheet(html, full){
  $('#panel').className = 'panel' + (full?' full':'');
  $('#panel').innerHTML = '<div class="grip"></div>'
    + '<button class="pclose" onclick="closeSheet()" aria-label="关闭">✕</button>' + html;
  $('#sheet').classList.add('on');
}
function closeSheet(){
  var s = $('#sheet');
  if(!s.classList.contains('on')) return;
  s.classList.add('closing');
  setTimeout(function(){ s.classList.remove('on'); s.classList.remove('closing'); }, 110);
}
$('#sheet').addEventListener('click', function(e){ if(e.target.id==='sheet') closeSheet(); });

/* ---------- 自绘对话框（代替原生 confirm/alert）----------
   WebView 的默认弹框会顶着一行“网址为 http://127.0.0.1 的网页显示：”，
   对用户毫无意义。Java 的 onJsAlert/onJsConfirm 也一律转发到这里。 */
var dlgCb = null, dlgCancel = null;
function dialog(o){
  $('#dlgT').textContent = o.title || '';
  $('#dlgB').innerHTML = esc(o.body || '');
  var y = $('#dlgYes'), n = $('#dlgNo');
  y.textContent = o.ok || '确定';
  y.className = 'btn ' + (o.danger ? 'dg' : 'pri');
  n.textContent = o.cancel || '取消';
  n.style.display = o.noCancel ? 'none' : '';
  dlgCb = o.onOk || null; dlgCancel = o.onCancel || null;
  $('#dlg').classList.add('on');
}
function closeDlg(ok){
  $('#dlg').classList.remove('on');
  var cb = dlgCb, cc = dlgCancel;
  dlgCb = null; dlgCancel = null;
  if(ok){ if(cb) cb() } else if(cc) cc();
}
$('#dlgYes').onclick = function(){ closeDlg(true) };
$('#dlgNo').onclick = function(){ closeDlg(false) };
$('#dlg').addEventListener('click', function(e){ if(e.target.id==='dlg') closeDlg(false) });
function askDel(what, onOk){ dialog({title:'删除', body:what, ok:'删除', danger:true, onOk:onOk}) }
/* Java 的 onJsAlert/onJsConfirm 转发到这里（id 非空 = confirm，需要回传结果） */
window.uiDialog = function(title, msg, id){
  dialog({title:title, body:msg, noCancel:!id,
    onOk:function(){ if(id && window.Android) Android.dialogResult(id, true) },
    onCancel:function(){ if(id && window.Android) Android.dialogResult(id, false) }});
};

/* 手机返回键：先关对话框/面板，再回笔记页，最后才退 app */
window.uiBack = function(){
  if($('#dlg').classList.contains('on')){ closeDlg(false); return 1; }
  if($('#sheet').classList.contains('on')){ closeSheet(); return 1; }
  if(tab !== 'notes'){ tab = 'notes'; setTab(true); return 1; }
  return 0;
};
function addSheet(){
  sheet('<h2>记一笔</h2>'
   +'<label>文字</label><textarea id="addText" placeholder="随手记，或粘贴一段内容。含时间/任务的句子会被自动提取成待办"></textarea>'
   +'<div class="acts"><button class="btn pri" onclick="addNote()">保存并解析</button>'
   +'<button class="btn" onclick="pickImage()">'+ic('camera')+'选图片（本机 OCR）</button></div>');
}
async function addNote(){
  var t = $('#addText').value.trim(); if(!t){toast('写点内容吧');return;}
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
function addTodoSheet(nid){
  sheet('<h2>添加待办</h2><label>事项</label><input id="tText" placeholder="要做什么">'
   +'<div class="grid2"><div><label>日期</label><input type="date" id="tDate"></div>'
   +'<div><label>时间</label><input type="time" id="tTime"></div></div>'
   +'<label>优先级</label><select id="tPri"><option value="normal">普通</option>'
   +'<option value="high">重要</option><option value="low">低</option></select>'
   +'<div class="acts"><button class="btn pri" onclick="addTodo(\''+nid+'\')">添加</button></div>');
}
async function addTodo(nid){
  var t=$('#tText').value.trim(); if(!t){toast('写点内容吧');return;}
  var due = $('#tDate').value ? $('#tDate').value+'T'+($('#tTime').value||'09:00') : '';
  var r = await api('/api/todo',{action:'add',noteId:nid,text:t,due:due,priority:$('#tPri').value});
  closeSheet(); toast(r.ok?'已添加':'失败'); refresh();
}
/* reset=true 表示明确要回到顶部（打开某条笔记、返回键回首页），否则恢复上次的位置 */
function setTab(reset){
  tab = tab || 'notes';
  if(lastTab !== tab) tabScroll[lastTab] = window.scrollY;   // 记住离开时看到哪儿
  document.querySelectorAll('.tabbar .tab').forEach(function(b){
    b.classList.toggle('on', b.dataset.tab===tab)});
  moveInd();
  var mine = tab==='mine';
  $('#topbar').style.display = mine ? 'none' : 'flex';
  var f = FABS[tab] || FABS.notes, fab = $('#fab');
  fab.classList.remove('hide');
  fab.querySelector('.fico').innerHTML = f.ico;
  fab.querySelector('.flabel').textContent = f.label;
  fab.onclick = f.fn;
  $('#q').placeholder = tab==='todos' ? '搜索待办' : tab==='files' ? '搜索附件' : '搜索笔记与待办';
  q = P().q || '';
  var qi = $('#q'); qi.value = q; $('#searchBox').classList.toggle('has', !!q);
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
  if(tab==='mine' && !ST) statsNow();
}
function moveInd(){
  var el = document.querySelector('.tabbar .tab.on'), ind = $('#ind');
  if(!el || !ind) return;
  ind.style.width = Math.round(el.offsetWidth*0.46)+'px';
  ind.style.transform = 'translateX('+(el.offsetLeft + el.offsetWidth*0.27)+'px)';
}
var FABS = {
  notes:{ico:ic('plus','l'), label:'记一笔', fn:function(){ addSheet() }},
  todos:{ico:ic('plus','l'), label:'记待办', fn:function(){ addSheet() }},
  files:{ico:ic('clip','l'), label:'加附件', fn:function(){ pickFile() }},
  mine:{ico:ic('plus','l'), label:'记一笔', fn:function(){ addSheet() }}
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
document.querySelectorAll('.tabbar .tab').forEach(function(b){
  b.onclick = function(){ if(tab===b.dataset.tab){ window.scrollTo({top:0,behavior:'smooth'}); return; }
    tab = b.dataset.tab; setTab(); }});
$('#brandBtn').onclick = function(){ tab='mine'; setTab(true); };
$('#sortBtn').onclick = sortSheet;
$('#clipBtn').onclick = importClip;
var searchT = 0;
$('#q').addEventListener('input', function(){
  q = this.value.trim();
  P().q = q;
  $('#searchBox').classList.toggle('has', !!q);
  // 服务端搜索：等用户停手再发，避免每敲一个字就重建一次列表
  clearTimeout(searchT);
  searchT = setTimeout(function(){ searchNow(); savePrefs(); }, 260);
});
$('#qClear').onclick = function(){ q=''; this.blur(); var el=$('#q'); el.value='';
  $('#searchBox').classList.remove('has'); P().q=''; clearTimeout(searchT); searchNow(); savePrefs(); };
window.addEventListener('resize', moveInd);
// 安静轮询：数据没变就只刷状态点，不重建 DOM
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
  probe('renderNotes', renderNotes); probe('renderTodos', renderTodos);
  probe('renderFiles', renderFiles); probe('renderMine', renderMine);
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
   （注：这段注释里不能写 onclick="…" 这种字面量，ui_sig_test.js 会把它当成真 handler 扫。）
   表必须是**单处对象字面量**（闸门① 用配对括号扫 key），别拆成多处 __enoteActions.foo = foo。
   成员 = 内联 handler 调用的 54 个 ∪ jseval 载荷独有的 api/refresh/render = 57。 */
window.__enoteActions = {
  addNote, addTodo, addTodoSheet, api, askBattery, askExact,
  askNotify, askShotPerm, clearAllNotes, clipDel, clipDelSel, clipParse,
  clipPick, clipSelAll, clipSheet, closeSheet, delAttach, delNote,
  delTodo, doImportShots, expand, folderFilter, folderPick, folderPickShots,
  folderSave, folderSelAll, folderSheet, importClip, importJSON, jump,
  missedDismiss, missedDone, missedGoTodos, missedSheet, openAttach, pickImage,
  refresh, render, reocr, reparse, resetPrefs, saveSettings,
  setPref, setTheme, shotIgnoreSel, shotPick, shotSelAll, shotSetup,
  shotSheet, showDebug, showLog, testLLM, toAlarm, toCalendar,
  toggle, toggleAI, toggleKeepAlive
};
Object.assign(window, window.__enoteActions);

/* ---------- S3（D21）：状态桥 ----------
   jseval 测试载荷跑在 module 外面，拿不到模块作用域里的变量。tab / MISSED / shotSel
   在载荷里是**整体赋值**（tab="notes"），必须有 setter：否则赋值只是在 window 上新建一个
   同名全局变量，模块里的 tab 一动不动，测试会「绿着骗过去」——这正是最难查的一类假绿。
   S / open / shotList 载荷只读或只改属性，getter 就够；一并给 setter 免得以后踩同一个坑。
   闸门②（步骤 4）按「载荷引用的名字 ⊆ 导出表 ∪ 状态桥 ∪ 内建 ∪ 载荷局部名」判红。 */
window.__enote = window.__enote || {};
window.__enote.actions = window.__enoteActions;
window.__enote.state = {
  get tab(){ return tab }, set tab(v){ tab = v },
  get S(){ return S }, set S(v){ S = v },
  get MISSED(){ return MISSED }, set MISSED(v){ MISSED = v },
  get open(){ return open }, set open(v){ open = v },
  get shotSel(){ return shotSel }, set shotSel(v){ shotSel = v },
  get shotList(){ return shotList }, set shotList(v){ shotList = v }
};
