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

// ---------- 底部 5 按钮 / 自绘对话框 / 返回键 ----------
const java = fs.readFileSync(path.join(root, 'src/dev/xduo/enote/MainActivity.java'), 'utf8');

// “记一笔”在导航栏第三格，形成 5 个按钮
const bar = src.match(/<nav class="tabbar"[\s\S]*?<\/nav>/);
const inBar = bar && /class="tab"[^>]*todos[\s\S]*?<button class="fab" id="fab"[\s\S]*?data-tab="files"/.test(bar[0]);
console.log((inBar ? '  ok   ' : '  FAIL ') + '“记一笔”在底栏第三格（5 个按钮）');
if (!inBar) bad++;

// 指示条必须 left:0，否则它和按钮差一个 padding，看起来左对齐
const indLeft = /\.tabbar \.ind\{position:absolute;left:0/.test(src);
console.log((indLeft ? '  ok   ' : '  FAIL ') + '导航指示条居中对齐（left:0）');
if (!indLeft) bad++;

// 原生 confirm/alert 会顶着一行“网址为 http://127.0.0.1 的网页显示：”
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const native = /\bconfirm\(|\balert\(/.test(code);
console.log((!native ? '  ok   ' : '  FAIL ') + '页面不再用原生 confirm/alert');
if (native) bad++;
const jsDlg = /public boolean onJsConfirm\(/.test(java) && /public boolean onJsAlert\(/.test(java);
console.log((jsDlg ? '  ok   ' : '  FAIL ') + 'Java 把 alert/confirm 转发给页面对话框');
if (!jsDlg) bad++;

// 面板要有关闭按钮
const pclose = /class="pclose" onclick="closeSheet\(\)"/.test(src);
console.log((pclose ? '  ok   ' : '  FAIL ') + '浮动面板有关闭按钮');
if (!pclose) bad++;

// 返回键 / 侧滑返回：先关面板、回笔记页，主页上连返两次才退 app
const back = /window\.uiBack = function\(\)/.test(src)
  && /evaluateJavascript\("window\.uiBack \? uiBack\(\) : 0"/.test(java);
console.log((back ? '  ok   ' : '  FAIL ') + '返回键先关面板再退 app');
if (!back) bad++;
const back2 = /public void onBackPressed\(\)/.test(java) && /再返回一次退出/.test(java);
console.log((back2 ? '  ok   ' : '  FAIL ') + '侧滑返回走同一逻辑，主页连返两次才退出');
if (!back2) bad++;

// “我的”页是最后一页，左滑不该拉伸回弹
const noStretch = /setOverScrollMode\(View\.OVER_SCROLL_NEVER\)/.test(java);
console.log((noStretch ? '  ok   ' : '  FAIL ') + 'WebView 关闭横向拉伸回弹');
if (!noStretch) bad++;

// “我的”页去掉装饰动画
const heroPlain = !/main\.enter \.hero\{animation/.test(src) && !/main\.enter \.stat\{animation/.test(src);
console.log((heroPlain ? '  ok   ' : '  FAIL ') + '我的页没有装饰性入场动画');
if (!heroPlain) bad++;

// 页面内容左右留白（卡片不贴屏幕边）
const pad = /main#view\{padding:0 14px\}/.test(src);
console.log((pad ? '  ok   ' : '  FAIL ') + '页面左右有留白');
if (!pad) bad++;

// 主题开关只在设置面板里，“我的”页不重复列一项
const oneTheme = !/themeSheet\(\)/.test(code) && /外观[\s\S]{0,200}setTheme/.test(src);
console.log((oneTheme ? '  ok   ' : '  FAIL ') + '主题入口只保留设置面板里那一个');
if (!oneTheme) bad++;

// 涟漪只能在被裁剪的按钮里：选择器带上 .li 时，水波会画到 viewport 上，铺满全屏 = 闪屏
const ripSel = (src.match(/closest\('([^']*)'\)/) || [])[1] || '';
const ripOk = ripSel.length > 0 && !/\.li\b/.test(ripSel)
  && /\.tabbar \.fab\{[^}]*position:relative/.test(src) && /\.seg button\{[^}]*overflow:hidden/.test(src);
console.log((ripOk ? '  ok   ' : '  FAIL ') + '涟漪不会溢出按钮（不闪屏）');
if (!ripOk) bad++;

process.exit(bad ? 1 : 0);
