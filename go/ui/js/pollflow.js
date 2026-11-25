// go/ui/js/pollflow.js — 安静轮询从 app.js 搬出来（P14 S6 步骤 52）。
//
// 2s 一次的 /api/state 很便宜，render() 不便宜，所以先比指纹：没变就只刷状态点。
// 这一簇是 SIG / drawn（上一轮指纹与「画过没有」）、SIG_SKIP（指纹排除表 = 行为契约，
// 闸门钉住）、stateSig（整份序列化 + 排除表）、refresh（唯一的数据入口）、
// prefsLoaded（首帧偏好只应用一次的闩）。
//
// 循环依赖契约（见 js/shotflow.js 文件头）：本模块 import app.js 的 S / reassign / setQRaw / q，
// app.js import 本模块的 refresh。两边都只在函数体里读，求值期谁都不碰对面。
// 写 app.js 的 q 走 setQRaw（ESM 的 import 是只读活绑定），写 prefs / CUR / shell 都是属性写。
import { S, q, reassign, setQRaw } from './app.js'
import { shell } from './shell.js'
import { api } from './netflow.js'
import { MISSED } from './missedflow.js'
import { SHOTFLAGS } from './shotflow.js'
import { prefs, P, flattenPrefs, themeOf, CUR, applyTheme } from './prefsflow.js'
import { ANIMLOCK } from './noteflow.js'
import { paintStatus, render } from './renderflow.js'
import { searchNow } from './searchflow.js'

/* 首帧拿到 settings 时把服务端偏好灌进 prefs（只做一次，之后本地改动优先）。 */
var prefsLoaded = false;

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
  if(Date.now() < ANIMLOCK.v){ paintStatus(); return }
  try{ var d = await api('/api/state'); reassign(S, d); if(MISSED.v) S.missed = MISSED.v;
       var dirty = !quiet || !drawn || stateSig(d) !== SIG;
       if(!prefsLoaded && S.settings && S.settings.ui){
         prefsLoaded = true;
         var fp = flattenPrefs(S.settings.ui);
         Object.keys(fp).forEach(function(k){
           prefs[k] = Object.assign(prefs[k]||{}, fp[k]);
         });
         setQRaw(P().q || '');
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

/* app.js 把 refresh 再导出（十来个模块与 __enoteActions 从 './app.js' 拿它），
   stateSig / SIG_SKIP 只在本模块用，闸门⑩/⑪ 读的是拼接后的 UI 源码，看得见这里。 */
export { refresh, stateSig, SIG_SKIP, prefsLoaded }
