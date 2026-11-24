#!/usr/bin/env node
/* 步骤 16 的 DOM 等价性核对（VDIFF 在步骤 11 删了，这里补一个针对叶子片段的比对）：
   左边 = git HEAD 里遗留的字符串函数（srcChip / statusChip / metaHTML / whereHTML /
   attachHTML / factsBlock / cbInnerHTML / todoTxHTML / todoRow / noteCard）对一份固定数据的
   输出；右边 = 真机 WebView 里 Vue 组件渲染出的 DOM（.test/probe_dom.sh 注入同一份数据抓回）。

   归一化只允许三类，都是「HTML 解析器 / CSSOM 自己的规范化」，不是迁移动的手脚：
   - v-if 留下的注释节点 <!---->（字符串路径没有，Vue 的 fragment 占位，不产生元素）；
   - 标签之间的空白（Vue 的 whitespace:'condense' 规则，字符串路径本来也没写）；
   - 入场动画类 enter / justdone 与 syncExpand 事后加的 style="display:none"（都是渲染后的
     副作用，两边时序不同，不属于「模板产出的结构」）。
   用法：node .test/dom_equiv.js */
const { execSync } = require('child_process');
const fs = require('fs');

const src = execSync('git show HEAD:go/ui/js/app.js', { encoding: 'utf8' });
function fn(name){
  // 单行函数（function esc(s){return …}）先单行匹配：多行正则的 ^} 会一路吞到下一个函数结尾
  const one = src.match(new RegExp('^function ' + name + '\\(.*\\}\\s*$', 'm'));
  if (one) return one[0] + '\n';
  const m = src.match(new RegExp('^function ' + name + '\\([\\s\\S]*?^}', 'm'));
  if (!m) throw new Error('找不到函数 ' + name);
  return m[0] + '\n';
}

const NOTE = JSON.parse(fs.readFileSync('.test/equiv_note.json', 'utf8')).note;
const TODO = NOTE.todos[0];
const names = ['esc','ic','fmtTime','now','cdCls','spanText','cdText','cdChip','srcChip','statusChip',
  'metaHTML','whereHTML','attachHTML','factsInner','factsBlock','cbInnerHTML','todoEnterCls','enterCls',
  'todoRowCls','todoTxHTML','todoRow','remindBtns','noteCard'];
const sandbox = `
var S = {notes: [], settings:{}, info:{}};
var SR = {where: {eq1: ['标题','来自图片文字']}};
var open = {}, seen = {}, expAnim = {}, busy = {}, justDone = {};
function keyOf(n,t){ return n.id+'_'+t.id; }
function toast(m){}
function dueMs(s){ var d=new Date(s); return isNaN(d)?0:d.getTime(); }
${names.map(fn).join('\n')}
return JSON.stringify({
  card: noteCard(NOTE_0, 0),
  todoRow: todoRow(TODO_0, NOTE_0, true),
  todoTx: todoTxHTML(TODO_0, NOTE_0)
});
`;
const out = JSON.parse(new Function('NOTE_0', 'TODO_0', sandbox)(NOTE, TODO));

const live1 = JSON.parse(fs.readFileSync('.test/live_dom.json', 'utf8'));
const live2 = JSON.parse(fs.readFileSync('.test/live_dom2.json', 'utf8'));
const live = { card: live1.card, todoRow: live1.todoRow, todoTx: live2.todoTx };

const norm = (h) => (h || '')
  .replace(/<!--[\s\S]*?-->/g, '')
  // 字符串路径里的 <use/> 是自闭合写法，浏览器解析后序列化成长合写法；Vue 模板那侧
  // 抓回来的是解析后的 DOM，两边统一成后者（这是 HTML 解析器的规范化，不是迁移动的手脚）
  .replace(/<use ([^>]*?)\/>/g, '<use $1></use>')
  .replace(/ class="([^"]*)"/g, (m, c) => ' class="' + c.replace(/\s*\b(?:enter|justdone)\b/g, '') + '"')
  .replace(/ style="display: none;"/g, '')
  // 步骤 16 的有意改动：内联 onclick 属性没了，换成 addEventListener（Vue 的 @click），
  // 元素、类名、id 都不动 —— 这一条是「要删的东西」，不是漂移。
  .replace(/ onclick="[^"]*"/g, '')
  // style 里的自定义属性经 CSSOM 序列化会补空格与分号（--i:0 → --i: 0;），两边都走 CSSOM
  .replace(/style="([^"]*)"/g, function(m, css){
    var out = css.split(';').filter(function(d){ return d.trim() })
      .map(function(d){ var kv = d.split(':'); return kv[0].trim() + ': ' + kv.slice(1).join(':').trim() + ';' });
    return out.length ? ' style="' + out.join(' ') + '"' : '';
  })
  .replace(/>\s+</g, '><')
  .replace(/\s+/g, ' ')
  .trim();

let bad = 0;
for (const k of ['card', 'todoRow', 'todoTx']) {
  const a = norm(out[k]), b = norm(live[k]);
  if (!b) { bad++; console.log('FAIL ' + k + '：真机没抓到 DOM（探针没跑成？见 .test/logs/probe_dom.txt）'); continue; }
  if (a === b) { console.log('ok   ' + k + ' 逐字一致（归一化后 ' + a.length + ' 字节）'); continue; }
  bad++;
  console.log('FAIL ' + k);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log('  旧字符串: …' + a.slice(Math.max(0, i - 70), i + 110) + '…');
  console.log('  Vue 组件: …' + b.slice(Math.max(0, i - 70), i + 110) + '…');
}
process.exit(bad ? 1 : 0);
