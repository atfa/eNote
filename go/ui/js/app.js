// go/ui/js/app.js — 由 go/ui.html 684-2523 机械拆分而来（S1a，行为零变化）。
// S3 起是 **ES module**（index.html 的 <script type="module">）。模块顶层声明不再是全局，
// 页面里 69 处 onclick + 1 处 oninput 按 window 作用域解析函数名，所以文件末尾必须有
// window.__enoteActions 导出表 + Object.assign(window, …)（见文件末尾 D12）。
// 转 module 与导出表、tools/ui_test.js 闸门① 同批落地，中间态不能存在：
// 少了任何一环，70 个 handler 会全部静默失效（P12 那一类「点了没反应」）。
/* ---------- P14 S6：app.js 与 27 个模块的分工表（步骤 29-53 的收口）----------
   app.js 现在只剩四样东西：响应式盒子层（S / 七个盒子 / setQ / setQRaw / setTabTo）、
   Java 侧与测试侧的 window 桥、Vue 宿主接口（setHost 的 H 与 HOST_KEYS 白名单）、
   文件末尾的 ES module 导出表。功能簇全在下面的模块里，每个模块的文件头写着它为什么这么切。

   三条搬动规矩（踩过的坑都在这里）：
   ① 模块顶层不许读 app.js —— 模块求值早于 app.js 的函数体，那时读到的就是 undefined
      （步骤 40：模块顶层写 `var SHEETARG = SHEETARGB.v` → 整份 app.js 抛 TypeError、页面全白）。
      只在函数体里读，循环依赖（模块反过来 import app.js）就是安全的。
   ② 要写 app.js 的 var，走那边开出来的 setter：setTabTo / setQ / setQRaw / setApiFail /
      setReadyResolve。判据一句话：属性写能搬，整包赋值不能搬。
   ③ 整包赋值的对象一律进盒子（Vue.reactive({v:…})），组件读 getter；传值的话 Vue 拿到的是
      装配时那份快照，症状正是「数据换了界面不动」。

   零依赖（不碰 app.js，最该先读的样板）：
     js/statebox.js    S + 七个盒子 + syncBox + reassign
     js/vue.js         Vue 全局、nextTick、setHost/setHostKeys、视图与弹层挂载、paint
     js/shell.js       外壳组件（顶栏 / 底栏+fab / 弹层宿主 / 进度层 / 对话框 / toast）与 shell 状态表
     js/domutil.js     $ / esc / ic / clip
     js/timeflow.js    now / fmtTime / relTime
   只依赖 shell.js 的：js/netflow.js（toast 宿主接线 + api / apiTimeout / errText / REQ_TIMEOUT_MS + API_FAIL 测试缝）
   渲染链：js/panes.js（常驻面板 + VUE_VIEWS / VUE_SHEETS 两张注册表）→ js/renderflow.js
     （render / afterPaint / markReady / syncExpand / strip / paintStatus）→ js/pollflow.js
     （状态指纹 SIG / SIG_SKIP / stateSig + 安静轮询 refresh）
   数据与偏好：js/prefsflow.js（页签偏好 + 主题）、js/statsflow.js（我的页统计）、
     js/listflow.js（列表过滤排序与待办分组，纯读无盒子）、js/searchflow.js（服务端搜索 SR / SRK）
   功能簇：js/filesflow.js（附件页）、js/clipflow.js（剪贴板暂存）、js/shotflow.js（截图捕获与
     监控文件夹）、js/missedflow.js（错过的提醒）、js/remindflow.js（到期倒计时 + 自研提醒 +
     常驻后台）、js/noteflow.js（笔记/待办操作 + 入场动画 seen / ANIMLOCK）、js/openflow.js
     （打开笔记/待办 + 系统日历/闹钟）、js/sheetflow.js（弹层开合与返回键路由）、js/dlgflow.js
     （自绘对话框）、js/addflow.js（记一笔 / 添加待办表单）、js/settingsflow.js（设置页 + 排序偏好）、
     js/logflow.js（运行日志 / AI 调用记录 / 连通测试）、js/tabflow.js（页签切换 + 底部 fab）
   启动自检：js/selfcheck.js（自己排 1200ms 后的定时器，app.js 只 import 它）*/
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
import { Vue, nextTick, setHost, setHostKeys, mountView, mountSheet, unmountSheet, unmountAllSheets, sheetPaint, vuePaint, apps, sheetApps } from './vue.js'
/* 外壳（步骤 15）：顶栏 / 底栏+fab / 弹层宿主 / 对话框 / toast 的组件与它们读的 reactive 状态表。
   shell.js 只依赖 vue.js，不反向读 app.js 的状态（事件走下面的 setHost），所以没有循环导入。 */
import { shell, mountShell } from './shell.js'
import { ST, statsNow, statCls } from './statsflow.js'
import { MISSED, loadMissed, missedSheet, missedDone, missedGoTodos, missedDismiss }
         from './missedflow.js'
import { LLMTEST, testLLM, LOGDATA, DEBUGDATA, showLog, showDebug } from './logflow.js'
import { setTab, moveInd, tabPick, brandGo, fabAct } from './tabflow.js'
import { expand, toggle, todoEnterCls, clearEnter, enterCls, clearSeen, delTodo,
         reparse, delNote, reocr, revoice, toggleAI, ANIMLOCK } from './noteflow.js'
import { todoRowCls, notesFiltered, groupTodos, rank, hit } from './listflow.js'
import { now, fmtTime, relTime } from './timeflow.js'
import { toast, api, apiTimeout, errText, REQ_TIMEOUT_MS, setApiFail, apiFail } from './netflow.js'
import { $, clip, esc, ic } from './domutil.js'
import { watchKeyboard } from './keyboard.js'
import { lockSelection } from './noselect.js'
import { panes, paneBuilt, paneDirty, tabScroll, paneFor, invalidatePanes,
         showPane, VUE_VIEWS, VUE_SHEETS } from './panes.js'
import { render, afterPaint, markReady, syncExpand, strip, paintStatus,
         setReadyResolve, hasFirstPainted } from './renderflow.js'
import { refresh } from './pollflow.js'
import { S, syncBox, TAB, QB, OPENB, REMIND, STERR, SRERR, SHEETARGB, reassign } from './statebox.js'
import './selfcheck.js'
/* 步骤 73：SSE 事件总线。side-effect import：模块求值时就连上 /api/events，
   之后 Go 侧任一落盘点广播，onmessage → poke() → 150ms 合并 → refresh(true)。
   轮询降级为 30s 心跳（见下方 setInterval）+ onAppResume 兜底。 */
import './bus.js'
import { SR, SRK, searchNow, searchInput, searchClear } from './searchflow.js'
import { FORMS, formSet, addSheet, addNote, pickImage, addTodoSheet, addTodo } from './addflow.js'
import { dialog, closeDlg, askDel, uiDialog, uiBackKey } from './dlgflow.js'
import { pageSheetVue, sheetVue, closeSheet, sheetLeft } from './sheetflow.js'
import { openNote, openTodo, openTodoFocus, jump, dueMs, toCalendar, toAlarm }
         from './openflow.js'
import { prefs, P, prefQS, flattenPrefs, savePrefs, CUR, themeOf, applyTheme, setTheme }
         from './prefsflow.js'
import { cdText, cdCls, syncReminders, exactGranted, askExact, notifyGranted, askNotify, testNotify, testNotifyDelayed, openNotifySettings,
         notifyResult, keepAliveOn, batteryIgnoring, toggleKeepAlive, askBattery } from './remindflow.js'
import { SFORM, formFill, formInput, settingsSheet, settingsRefresh, exportJSON, importJSON,
         clearAllNotes, sortSheet, setPref, resetPrefs, saveSettings } from './settingsflow.js'
import { FA, fmtSize, filesNow, attachCardCls, attachGlyphName, openAttach, delAttach,
         pickFile, pickNoteAttachments, openNoteAttachments, noteAttachmentsSaved } from './filesflow.js'
import { editNoteDescription } from './views/note-description.js'
/* P18：「记一笔」里的语音暂存区（多段识别 → 一次发送成一条 kind=voice 的笔记）。
   STT 是 {v:} 容器，进宿主走 getter；那八个 voiceXxx 都被 views/sheets.js 的
   AddSheetView 模板直接调（H.voiceXxx），所以必须进 HOST_KEYS['sheet:add']。
   面板一打开就是展开态（不再先点「录音」），所以没有 voiceOpen / voiceClose 了。 */
import { STT, voiceDown, voiceUp, voiceStop, voiceUndo,
         voicePlay, voiceDelSeg, voiceOrganize,
         voiceOrganizedEdit, voiceUseOriginal } from './voiceflow.js'
import { CLIP, openClip, importClip, clipItemCls, clipPrevText, clipThumbText, clipMetaText,
         clipParseText, clipSheet, loadClips, clipPick, clipSelAll, clipDel, clipDelSel,
         clipParse } from './clipflow.js'
import { SHOTFLAGS, SHOTS, FOLD, SHOTPROG, shotFlags, shotGo, shotSetup, askShotPerm,
         shotSheet, fmtClock, shotPick, shotSelAll, doImportShots, shotOverlay, shotOvlSub,
         folderSheet, folderLabel, folderPick, folderSelAll, folderPickShots, folderFilter,
         folderSave, shotIntroOnce, scanShotsNow, rescanShots,
         loadShots, shotIgnoreSel, clearShots } from './shotflow.js'
/* 响应式盒子层（syncBox / TAB / QB / OPENB / REMIND / STERR / SRERR / SHEETARGB）与 S、
   reassign 一起搬进 js/statebox.js（P14 S6 步骤 53）：盒子先于本文件求值，
   「盒子必须早于第一次读它」那条硬要求由 ESM 的 import 顺序保证。 */
var tab = TAB.v, open = OPENB.v, busy = {};
var expAnim = {}; // 正在播放展开动画的笔记 id（P7c 加动效时忘了声明，展开详情点了没反应就是这个）

var q = QB.v;
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



/** 通知点按后打开对应笔记（Java 侧调用）*/
/* 步骤 9 转 Vue：CLIP.list 是 /api/clip/list 的结果，CLIP.loading / CLIP.error 是加载三态。
   三个都会被整体赋值，进 setHost 必须走 getter（同 SHOTS.list / FA 的教训：传值的话
   Vue 拿的是装配时那份快照，症状是「数据变了界面不动」）。 */

window.openClip = openClip;
/* 打开一条笔记 / 一条待办（通知点进来定位到那条待办）+ 把到期时间交给系统日历 /
   闹钟那一簇搬进 js/openflow.js（P14 S6 步骤 37）。下面两行是 Java 侧通知的入口桥，
   名字不能动，留在 app.js。 */
window.openNote = openNote; window.notifyResult = notifyResult;
window.openTodo = openTodo;

/* 从系统设置页回来后重新读一次权限/保活状态；顺便重画，让「剪贴板刚有更新」提示立刻出现 */
window.onNoteAttachmentsSaved = noteAttachmentsSaved;
window.onAppResume = function(){
  shotFlags();
  settingsRefresh();
  if (S && S.notes) render();
};

/* 步骤 39：自绘对话框那一簇（dialog / closeDlg / askDel）搬进 js/dlgflow.js（循环依赖，
   同上：本模块顶层不碰 app.js，只在函数体里读 tab，写 tab 走 setTabTo）。
   这两行 window 桥留在本文件：Java 的 onJsAlert/onJsConfirm 与手机返回键找的是全局名，
   闸门㉒ 的 APP_BRIDGES 钉住它们不许搬走。 */
window.uiDialog = function(title, msg, id){ uiDialog(title, msg, id) };

window.uiBack = function(){ return uiBackKey() };
/* 「记一笔」与「添加待办」那一簇（FORMS / formSet / addSheet / addNote / pickImage /
   addTodoSheet / addTodo）搬进 js/addflow.js（P14 S6 步骤 40，循环依赖，同上）。
   SHEETARGB 这个盒子留在本文件的盒子区（声明顺序是硬要求），那边写它走 syncBox。 */
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
  revoice: revoice, editNoteDescription: editNoteDescription,
  pickNoteAttachments: pickNoteAttachments, openNoteAttachments: openNoteAttachments,
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
  /* P18：「记一笔」的第四种原料（本地文件，走系统的文件选择器）与语音暂存区。
     STT.v 是 {segs, hidden, listening, …}，整包不换引用但 segs 会被整体赋值（发送后清空），
     所以走 getter（同 FA / q 的教训）。圆钮的按下/松手/结束必须分三个函数：模板上
     @pointerdown / @pointerup / @pointercancel 各自到底（点按与按住的区别在 voiceDown/Up 里判）。 */
  pickFile: pickFile,
  get STT(){ return STT.v },
  voiceDown: voiceDown, voiceUp: voiceUp,
  voiceStop: voiceStop, voiceUndo: voiceUndo,
  voicePlay: voicePlay, voiceDelSeg: voiceDelSeg,
  voiceOrganize: voiceOrganize, voiceOrganizedEdit: voiceOrganizedEdit,
  voiceUseOriginal: voiceUseOriginal,
  get sheetArg(){ return SHEETARGB.v },
  fmtSize: fmtSize, notifyGranted: notifyGranted, exactGranted: exactGranted,
  keepAliveOn: keepAliveOn, batteryIgnoring: batteryIgnoring,
  askNotify: askNotify, askExact: askExact, askBattery: askBattery, testNotify: testNotify, testNotifyDelayed: testNotifyDelayed, openNotifySettings: openNotifySettings,
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
  /* view:notes     组件根 NotesView，32 个 key */
  'view:notes': ['MISSED', 'S', 'SHOTFLAGS', 'SR', 'addTodoSheet', 'cdCls', 'cdText', 'clipHint',
    'clipSheet', 'delNote', 'editNoteDescription', 'enterCls', 'expand', 'fmtTime', 'importClip', 'missedSheet',
    'notesFiltered', 'now', 'open', 'openAttach', 'openNoteAttachments', 'pickNoteAttachments', 'reocr', 'reparse', 'revoice', 'searchNow', 'shotGo', 'srErr',
    'toAlarm', 'toCalendar', 'todoRowCls', 'toggle'],
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
  'sheet:settings': ['S', 'ST', 'askBattery', 'askExact', 'askNotify', 'batteryIgnoring', 'testNotify', 'testNotifyDelayed', 'openNotifySettings',
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
  /* sheet:add      组件根 AddSheetView。 */
  'sheet:add': ['addNote', 'formSet', 'FORMS', 'pickFile', 'pickImage', 'STT',
    'voiceDelSeg', 'voiceDown', 'voicePlay', 'voiceStop',
    'voiceUndo', 'voiceUp', 'voiceOrganize', 'voiceOrganizedEdit', 'voiceUseOriginal'],
  'sheet:attachmentPreview': [],
  'sheet:noteAttachments': ['pickNoteAttachments'],
  'sheet:noteDescription': [],
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
/* P18：软键盘遮挡补偿（--kb，见 js/keyboard.js）。弹层是 fixed 贴底的，键盘弹起时
   布局视口不缩，面板下半截会被键盘盖住 —— 挂一次监听就够，全程有效。 */
watchKeyboard();
/* P18.2：长按不许出现网页式的选择/复制/打开图片菜单（CSS 已全局禁选，这里兜住
   contextmenu / selectstart / dragstart，见 js/noselect.js）。 */
lockSelection();
setInterval(function(){ if(!document.hidden) refresh(true); }, 30000);
refresh();
setTab();
// 补看「不在的时候错过的提醒」：不挡首屏，拿到再重绘一次
loadMissed();
// 截图捕获的轻量状态（横幅要按"未开启/没权限/没选文件夹"分状态显示）
shotFlags(function(){ render(); shotIntroOnce() });

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
  refresh, render, reocr, reparse, revoice, resetPrefs, rescanShots, saveSettings,
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

var __ready = new Promise(function(r){ setReadyResolve(r); if(hasFirstPainted()) r() });
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
  test: { get failApi(){ return apiFail() }, set failApi(v){ setApiFail(v) } }
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
export { S, tab, open, q, dialog, closeSheet, pageSheetVue, setTab,
  refresh, paneDirty, statsNow, statCls,
  P, SRK, reassign, paintStatus, render, enterCls, askDel,
  prefs, savePrefs, searchNow, setQ, setQRaw, setTabTo, ST, syncBox, STERR,
  dueMs, REMIND, toggle, VUE_SHEETS, SHEETARGB, SRERR,
  showPane, paneBuilt, clearSeen, tabScroll,
  expAnim, busy }
