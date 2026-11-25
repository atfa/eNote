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
