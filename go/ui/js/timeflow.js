// go/ui/js/timeflow.js — 时间格式化那一簇从 app.js 搬出来（P14 S6 步骤 46）。
//
// 这是第一个**零 import** 的模块：三个函数都是纯函数（只吃参数、只读 Date.now()），
// 不碰 app.js 的任何东西，所以也没有循环依赖——契约（js/shotflow.js 文件头）在这里
// 是空满足的：本模块求值期谁都不碰。
// 名字是硬要求：now() 出的 'YYYY-MM-DDTHH:MM' 是服务端 due 字段的线格式，
// fmtTime() 的「今天 09:05」与 relTime() 的「3 天前」是 DOM 基线钉着的文案。
function now(){var d=new Date(),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())}
function fmtTime(iso){if(!iso)return '';var d=new Date(iso);if(isNaN(d))return iso;
  var p=n=>String(n).padStart(2,'0'), t=new Date();
  var same = d.toDateString()===t.toDateString();
  return (same?'今天':(d.getMonth()+1)+'/'+d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes())}
function relTime(iso){
  if(!iso) return '';
  var d = new Date(iso); if(isNaN(d)) return '';
  var s = Math.floor((Date.now()-d.getTime())/1000);
  if(s < 60) return '刚刚';
  if(s < 3600) return Math.floor(s/60)+' 分钟前';
  if(s < 86400) return Math.floor(s/3600)+' 小时前';
  return Math.floor(s/86400)+' 天前';
}
/* app.js 把 now / fmtTime 挂进 HOST（views 与 components 里 H.now() / H.fmtTime() 读它们），
   relTime 不进 HOST（步骤 22 从宿主里摘掉，模板里没人读），只给 js/clipflow.js 的
   clipMetaText() 用；now 另外给 js/listflow.js 的 groupTodos() 与 js/shotflow.js 用。 */
export { now, fmtTime, relTime }
