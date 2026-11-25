// go/ui/js/selfcheck.js — 启动自检 selfCheck() 从 app.js 搬出来（P14 S6 步骤 49）。
//
// 循环依赖契约（见 js/shotflow.js 文件头）：本模块 import app.js 的 S / tab / open，
// app.js import 本模块。selfCheck 只在 setTimeout 里跑（1200ms 后），那时 app.js 早已
// 求值完，读到的都是活绑定的最终值 —— 求值期谁都不碰对面，所以这个环是安全的。
// setTab / expand 直接找各自的模块要，不绕 app.js。
import { S, tab, open } from './app.js'
import { setTab } from './tabflow.js'
import { expand } from './noteflow.js'

/* 启动自检（R15）：把各页渲染和「展开详情」这类交互入口真跑一遍。
   起因：expand() 用了从没声明过的 expAnim，点了抛 ReferenceError，界面一动不动，
   而语法检查、结构断言都发现不了 —— 只有真调用才会暴露。 */
function selfCheck(){
  var errs = [], probe = function(name, fn){
    try { fn() } catch(e){ errs.push(name + ': ' + ((e && e.message) || e)) }
  };
  /* 步骤 11 起四个 tab 只能走 render()（字符串渲染器已删）：逐个切过去渲染一次，
     组件的 setup / computed 抛异常会直接进 SELFCHECK FAIL。 */
  var tab0 = tab;
  ['notes','todos','files','mine'].forEach(function(t){
    probe('render:' + t, function(){ setTab(t); });
  });
  setTab(tab0);
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

/* app.js 只留 setTimeout 那一笔的调用者：本模块求值期就把自己排进 1200ms 后。 */
setTimeout(selfCheck, 1200)

export { selfCheck }
