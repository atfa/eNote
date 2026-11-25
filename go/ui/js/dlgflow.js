// go/ui/js/dlgflow.js — 自绘对话框那一簇从 app.js 搬出来（P14 S6 步骤 39）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块顶层不碰 app.js 的任何东西，
// 从 app.js 拿的（tab / setTab / setTabTo）全部只在函数体里读，求值期谁都不碰谁。
// dlgCb / dlgCancel 是模块私有：对话框的回调只有一对，dialog() 装、closeDlg() 取走并清空，
// 别的模块不需要（也不该）碰它们，所以不导出。
// 两行 window 桥（uiDialog / uiBack）留在 app.js：Java 侧找的是全局名，闸门㉒ 的
// APP_BRIDGES 钉住它们不许搬走，本模块只导出它们要调的实现。
import { shell } from './shell.js'
import { closeSheet } from './sheetflow.js'
import { tab, setTab, setTabTo } from './app.js'
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
function uiDialog(title, msg, id){
  dialog({title:title, body:msg, noCancel:!id,
    onOk:function(){ if(id && window.Android) Android.dialogResult(id, true) },
    onCancel:function(){ if(id && window.Android) Android.dialogResult(id, false) }});
};

/* 手机返回键：先关对话框/面板，再回笔记页，最后才退 app */
function uiBackKey(){
  if(shell.dlg.on){ closeDlg(false); return 1; }
  if(shell.sheet.on){ closeSheet(); return 1; }
  if(tab !== 'notes'){ setTabTo('notes'); setTab(true); return 1; }
  return 0;
};
/* app.js 里 window.uiDialog / window.uiBack 两行桥调这两个实现；dialog 由 shotflow.js /
   remindflow.js 从 app.js 取用，askDel 由 filesflow.js / settingsflow.js 取用，
   所以 app.js 那边继续再导出。 */
export { dialog, closeDlg, askDel, uiDialog, uiBackKey }
