// go/ui/js/clipflow.js — 剪贴板暂存队列（P7）从 app.js 搬出来（P14 S6 步骤 30）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块先被求值，顶层只碰 vue.js 的 Vue 与
// 自己新建的 reactive 盒子；app.js 那边（S / toast / esc / relTime / api / refresh /
// closeSheet / pageSheetVue）全部只在函数体里读，求值期谁都不碰谁。
import { Vue } from './vue.js'
import { S, esc, refresh, closeSheet, pageSheetVue } from './app.js'
import { api, toast } from './netflow.js'
import { relTime } from './timeflow.js'

/* 步骤 17e：整包赋值的响应式写法。`X = {...}` 对 reactive 对象是换引用，Vue 追踪不到
   （症状：数据换了界面不动）。reassign 在同一个 proxy 上先删键再写键，读侧一个字不用改
   —— reassign 本身留在 app.js，clipflow 里的调用方读的是 app.js 那份。 */
var CLIP = Vue.reactive({ sel: {}, list: [], loading: false, error: '' });

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

/* 步骤 30：app.js 把下面这些名字挂进 HOST / HOST_KEYS / window.__enoteActions，
   views/clip.js 通过 H.xxx 读它们；clipSelected 只在簇内用，导出来是为了闸门⑩
   的「定义了没人用」能看见引用侧。 */
export { CLIP, openClip, importClip, clipItemCls, clipPrevText, clipThumbText, clipMetaText,
  clipParseText, clipSheet, loadClips, clipPick, clipSelAll, clipSelected, clipDel,
  clipDelSel, clipRemove, clipParse }
