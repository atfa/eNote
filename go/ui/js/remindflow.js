// go/ui/js/remindflow.js — 到期倒计时 + 自研提醒 + 常驻后台那一簇从 app.js 搬出来（P14 S6 步骤 34）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块的顶层跑在 app.js 求值之前，顶层只碰
// 自己声明的东西（tickCD 与那个 setInterval）；app.js 那边（S / REMIND / syncBox / toast /
// dialog / dueMs）与 settingsflow.js 那边（settingsRefresh）全部只在函数体里读。
// 顶层那句 `var remindPending = REMIND.v` 是这条契约的例外：那时 app.js 的 `var REMIND` 还是
// undefined，读它的 .v 会抛 TypeError（步骤 33 的 stErr 同一个坑），初值改成字面量 0
// （REMIND 的初值本来就是 0，语义逐字不变）。
import { S, REMIND, syncBox, dialog, dueMs } from './app.js'
import { toast } from './netflow.js'
import { settingsRefresh } from './settingsflow.js'

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
  toast(ok ? '系统通知已开启，到期前 15 分钟会弹提醒' : '没有通知权限；可在系统设置里打开「懒得记」的通知');
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

/* 步骤 34：app.js 把下面这些名字挂进 HOST / HOST_KEYS / window.__enoteActions，
   views/settings.js 与 components/leaf.js 通过 H.xxx 读它们。 */
export { cdText, cdCls, syncReminders, exactGranted, askExact, notifyGranted, askNotify,
  notifyResult, keepAliveOn, batteryIgnoring, toggleKeepAlive, askBattery }
