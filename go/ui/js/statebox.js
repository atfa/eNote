// go/ui/js/statebox.js — 响应式盒子层从 app.js 搬出来（P14 S6 步骤 53）。
//
// 这一层是「整包赋值的标量/对象怎么接上响应式」的地基（步骤 17f）：
//   S            整份 /api/state 的镜像，reassign() 逐键换，Vue 追踪得到
//   TAB / QB     tab 与搜索词：原变量照旧用，赋值处走 syncBox() 同步进盒子，组件读盒子
//   OPENB        笔记详情（对象型：原变量直接指向盒子里的 proxy）
//   REMIND / STERR / SRERR / SHEETARGB   提醒秒数、两处错误文案、弹层背景色
//   syncBox()    唯一的同步入口（手写第二遍迟早漏一处，漏了就是「数据换了界面不动」）
//   reassign()   逐键换内容、不换引用（S 被 Vue 与十几个模块 import，换引用只换得到 app.js 那份）
//
// 零循环依赖：只 import js/vue.js 拿 Vue，不读 app.js 的任何东西。
// 声明顺序是硬要求：盒子必须在第一次读它之前建好 —— 踩过：盒子放在文件中部，而
// `var tab = TAB.v` 在 app.js 第 32 行，var 提升让 TAB 那一刻是 undefined，整份 app.js
// 抛 TypeError、页面全白（真机日志：Cannot read properties of undefined (reading 'v')）。
// 搬进模块之后这件事由 ESM 的求值顺序保证：import 先于 app.js 的函数体跑完。
import { Vue } from './vue.js'

/* 步骤 17f：H 暴露的「整包赋值的标量」接上响应式。tab / q 在 app.js 里被引用几十次，
   整词改名风险大于收益，所以用镜像：原变量照旧用，赋值处同步一份进 reactive 盒子，组件读盒子。
   同步只走 syncBox()，不手写第二遍（手写第二遍迟早漏一处，漏了就是「数据换了界面不动」）。
   对象型的（open）让原变量直接指向盒子里的 proxy，逐键改也追踪得到。 */
function syncBox(box, v){ box.v = v; return v }
var TAB = Vue.reactive({ v: 'notes' });
var QB = Vue.reactive({ v: '' });
var OPENB = Vue.reactive({ v: {} });
var REMIND = Vue.reactive({ v: 0 });
var STERR = Vue.reactive({ v: '' });
var SRERR = Vue.reactive({ v: '' });
var SHEETARGB = Vue.reactive({ v: '' });
var S = Vue.reactive({notes:[], settings:{}, info:{}});
/* 声明顺序是硬要求：盒子必须在第一次读它之前建好。踩过：盒子放在文件中部，
   而 `var tab = TAB.v` 在第 32 行 —— var 提升让 TAB 在那一刻是 undefined，
   整份 app.js 抛 TypeError，页面全白（真机日志：Cannot read properties of undefined (reading 'v')）。 */
function reassign(box, v){
  for(var k in box) delete box[k];
  if(v && typeof v === 'object') Object.assign(box, v);
  return box;
}

/* app.js 把这一层再导出（S 被 13 个模块、syncBox 被 4 个、reassign 被 3 个模块从
   './app.js' 拿），那边的 import 一个字没改。TAB / QB / OPENB 只有 app.js 的
   setQ / setQRaw / setTabTo 读，导出是为了让「盒子在哪」这件事在模块图里看得见。 */
export { S, syncBox, TAB, QB, OPENB, REMIND, STERR, SRERR, SHEETARGB, reassign }
