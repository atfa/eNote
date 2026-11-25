// go/ui/js/prefsflow.js — 页签偏好（排序/筛选）+ 主题那一簇从 app.js 搬出来（P14 S6 步骤 35）。
//
// 循环依赖安全（契约同 js/shotflow.js 文件头）：本模块的顶层跑在 app.js 求值之前，顶层只碰
// vue.js 的 Vue 与自己新建的 reactive 盒子；app.js 那边（S / tab / q / api / toast / render）
// 全部只在函数体里读。`q` 是 app.js 的 var，这里只读（ESM 的 import 绑定是只读的活视图，
// 读得到最新值，写会抛），要清它走 app.js 的 setQ()。
// curTheme 两边都要写，所以装进盒子 CUR：app.js 的 refresh() 写 CUR.v，本模块的 setTheme()
// 也写 CUR.v（同 SRK 那条规矩）。
import { Vue } from './vue.js'
import { S, tab, q, render } from './app.js'
import { api, toast } from './netflow.js'

/* 上次应用的主题名：app.js 的 refresh() 用它判断「主题变了没有」，两边都要写，所以是盒子。 */
var CUR = { v: '' };

/* 每个页签自己的搜索/排序/筛选条件（P3 会持久化到服务端） */
var prefs = Vue.reactive({
  notes:{sort:'new', src:'all', status:'all'},
  todos:{sort:'due', done:'open', pri:'all'},
  files:{sort:'new', kind:'all'}
});
function P(){ return prefs[tab] || prefs.notes }

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
    S.settings = d.settings; CUR.v = themeOf(); applyTheme(); render();
    toast('主题：' + ({light:'亮色', dark:'暗色', auto:'跟随系统'}[mode] || mode));
  }catch(e){ toast('切换失败: '+e) }
}

/* 步骤 35：app.js 把下面这些名字挂进 HOST / HOST_KEYS / window.__enoteActions；
   settingsflow.js 与 filesflow.js 也从这里 import（app.js 再导出一次给它们）。 */
export { prefs, P, prefQS, flattenPrefs, savePrefs, CUR, themeOf, applyTheme, setTheme }
