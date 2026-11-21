// 界面轮询的回归测试：ui.html 里的 sigOf 决定“要不要重绘”。
// 之前 setInterval 无条件 render()，整页每秒重建 + 重播入场动画 = 肉眼可见的闪烁。
// 跑法：node tools/ui_sig_test.js（test.sh 会调用）
// 从 go/ui.html 里抽出真实的 sigOf 源码来测，避免复制粘贴走样
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'go/ui.html'), 'utf8');
const m = src.match(/function sigOf\(d\)\{[\s\S]*?\n\}/);
if (!m) { console.error('sigOf not found'); process.exit(1); }
const sigOf = eval('(' + m[0] + ')');

const base = () => JSON.parse(JSON.stringify({
  notes: [
    { id: 'a', title: '甲', status: 'done', updatedAt: '2026-01-01T10:00', todos: [{id:'t1'}], attachments: [] },
    { id: 'b', title: '乙', status: 'raw',  updatedAt: '2026-01-01T09:00', todos: [], attachments: [{id:'x'}] }
  ],
  info: { todos: 3, open: 2, overdue: 0, queue: 0, ocrReady: true },
  settings: { theme: 'light' }
}));

const checks = [];
function eq(name, a, b, want) { checks.push([name, (a === b) === want, want ? 'same' : 'different']); }

const s0 = sigOf(base()), s1 = sigOf(base());
eq('同一个 state 两次指纹相同', s0, s1, true);

let d = base(); d.notes[0].status = 'parsing';
eq('笔记状态变化', s0, sigOf(d), false);

d = base(); d.notes[1].todos.push({ id: 't2' });
eq('待办增删', s0, sigOf(d), false);

d = base(); d.notes[0].title = '甲改';
eq('标题变化', s0, sigOf(d), false);

d = base(); d.notes[0].attachments.push({ id: 'y' });
eq('附件增删', s0, sigOf(d), false);

d = base(); d.notes.push({ id: 'c', title: '丙', status: 'done', updatedAt: 'x', todos: [], attachments: [] });
eq('新增笔记', s0, sigOf(d), false);

d = base(); d.info.open = 1;
eq('未完成数变化', s0, sigOf(d), false);

d = base(); d.settings.theme = 'dark';
eq('主题变化', s0, sigOf(d), false);

d = base(); d.notes[0].content = '正文变了但列表不显示正文';
eq('列表不展示的字段变化（允许不重绘）', s0, sigOf(d), true);

let bad = 0;
for (const [name, ok, note] of checks) {
  console.log((ok ? '  ok   ' : '  FAIL ') + name + ' → 期望' + note);
  if (!ok) bad++;
}
// 轮询必须是安静模式，否则又回到每秒重绘
const quiet = /setInterval\(function\(\)\{ if\(!document\.hidden\) refresh\(true\); \}/.test(src);
console.log((quiet ? '  ok   ' : '  FAIL ') + '轮询走 refresh(true) 安静模式');
if (!quiet) bad++;
// 附件卡不能再有无条件入场动画（那是闪一下的来源）
const acard = /^\.acard\{[^}]*animation:/m.test(src);
console.log((!acard ? '  ok   ' : '  FAIL ') + '附件卡没有无条件动画');
if (acard) bad++;
// 切页入场动画只播一次
const enterOnce = /enterT = setTimeout\(function\(\)\{ v\.classList\.remove\('enter'\) \}/.test(src);
console.log((enterOnce ? '  ok   ' : '  FAIL ') + 'enter class 会在动画后移除');
if (!enterOnce) bad++;

process.exit(bad ? 1 : 0);
