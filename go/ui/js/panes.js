// go/ui/js/panes.js — 常驻面板与 Vue 注册表从 app.js 搬出来（P14 S6 步骤 50）。
//
// 循环依赖契约（见 js/shotflow.js 文件头）：本模块 import app.js 的 tab（showPane 读它），
// app.js import 本模块的 panes / paneFor / invalidatePanes / showPane / VUE_VIEWS / VUE_SHEETS。
// 两边都只在函数体里读，求值期谁都不碰对面：本模块顶层只建四个空对象与两张注册表，
// 注册表里的组件由 ESM 保证先于本模块求值。
// 谁在写这些对象：app.js 的 render() 写 paneBuilt[tab] / paneDirty[tab]，js/shotflow.js 写
// paneDirty[tab]，js/tabflow.js 写 tabScroll[lastTab] —— 全是属性写，没有整包赋值，
// 所以 import 进来的对象直接改属性就够（ESM 只锁绑定，不锁属性）。
import { $ } from './domutil.js'
import { tab } from './app.js'
import { NotesView } from './views/notes.js'
import TodosView from './views/todos.js'
import FilesView from './views/files.js'
import { ShotsView } from './views/shots.js'
import FoldersView from './views/folders.js'
import ClipSheetView from './views/clip.js'
import StatsView from './views/stats.js'
import SettingsSheetView from './views/settings.js'
import { SortSheetView, MissedSheetView, AddSheetView, AddTodoSheetView,
         LogSheetView, DebugSheetView } from './views/sheets.js'

/* 每个 tab 一个常驻面板（R14）：来回切页不重绘整个页面，滚动位置也不会丢。
   数据变了才把「其它页」标记为待重绘，切过去时重建一次。 */
var panes = {}, paneBuilt = {}, paneDirty = {}, tabScroll = {notes:0, todos:0, files:0, mine:0};
/* lastTab（上一个页签）只有 setTab 读写，跟着它搬进 js/tabflow.js（步骤 43）。 */
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

/* app.js 把 VUE_SHEETS 原样再导出（js/sheetflow.js 从 './app.js' 拿它），VUE_VIEWS 由
   app.js 挂进 window.__enote.vue；paneBuilt / paneDirty / showPane / tabScroll 是
   js/tabflow.js 与 js/shotflow.js 的取用面。 */
export { panes, paneBuilt, paneDirty, tabScroll, paneFor, invalidatePanes,
         showPane, VUE_VIEWS, VUE_SHEETS }
