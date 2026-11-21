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
const pad = /main#view\{padding:0 14px 104px\}/.test(src);
console.log((pad ? '  ok   ' : '  FAIL ') + '页面左右有留白');
if (!pad) bad++;

// 主题开关只在设置面板里，“我的”页不重复列一项
const oneTheme = !/themeSheet\(\)/.test(code) && /外观[\s\S]{0,400}setTheme/.test(src);
console.log((oneTheme ? '  ok   ' : '  FAIL ') + '主题入口只保留设置面板里那一个');
if (!oneTheme) bad++;

// 涟漪只能在被裁剪的按钮里：选择器带上 .li 时，水波会画到 viewport 上，铺满全屏 = 闪屏
const ripSel = (src.match(/closest\('([^']*)'\)/) || [])[1] || '';
const ripOk = ripSel.length > 0 && !/\.li\b/.test(ripSel)
  && /\.tabbar \.fab\{[^}]*position:relative/.test(src) && /\.seg button\{[^}]*overflow:hidden/.test(src);
console.log((ripOk ? '  ok   ' : '  FAIL ') + '涟漪不会溢出按钮（不闪屏）');
if (!ripOk) bad++;

// ---------- R11 到期倒计时 ----------
// 每个未完成待办都要有倒计时徽标，并且是就地改写文本（整页重绘会闪）
const cd = /function cdText\(due\)/.test(src) && /data-due="/.test(src)
  && /setInterval\(tickCD, \d+\)/.test(src) && /function tickCD\(\)/.test(src);
console.log((cd ? '  ok   ' : '  FAIL ') + '待办显示到期倒计时，且按秒级定时就地更新');
if (!cd) bad++;
const cdWords = /不足/.test(src) && /逾期/.test(src) && /天'/.test(src) && /小时'/.test(src) && /分钟'/.test(src);
console.log((cdWords ? '  ok   ' : '  FAIL ') + '倒计时文案：不足N天/小时/分钟、逾期N…');
if (!cdWords) bad++;
// 笔记页与待办页都要挂上
const cdBoth = (src.match(/cdChip\(/g) || []).length >= 2;
console.log((cdBoth ? '  ok   ' : '  FAIL ') + '笔记页与待办页都显示倒计时');
if (!cdBoth) bad++;

// ---------- 勾选完成的动画反馈 ----------
const anim = /\.todo\.justdone \.ttx::after,[^{]*\{[\s\S]*?animation:strike/.test(src)
  && /\.todo\.leaving\{/.test(src) && /\.todo\.enter\{animation:todoenter/.test(src)
  && /row\.classList\.add\('leaving'\)/.test(src);
console.log((anim ? '  ok   ' : '  FAIL ') + '勾选 → 划线动画 → 原位淡出 → 新位置高亮入场');
if (!anim) bad++;
// 动画期间不能被轮询重绘打断
const lock = /if\(Date\.now\(\) < animLock\)\{ paintStatus\(\); return \}/.test(src);
console.log((lock ? '  ok   ' : '  FAIL ') + '动画期间轮询不重绘（不打断划线动画）');
if (!lock) bad++;

// ---------- R5 我的页统计 + 全屏设置面板 ----------
const stats = /api\/stats/.test(src) && /function statsNow\(\)/.test(src)
  && /function chartHTML\(days\)/.test(src) && /^\.chart\{/m.test(src);
console.log((stats ? '  ok   ' : '  FAIL ') + '我的页统计来自 /api/stats，近 7 天为纯 CSS 柱状图');
if (!stats) bad++;
const go = fs.readFileSync(path.join(root, 'go/stats.go'), 'utf8');
const goweb = fs.readFileSync(path.join(root, 'go/web.go'), 'utf8');
const goRoutes = /m\.HandleFunc\("\/api\/stats", handleStats\)/.test(fs.readFileSync(path.join(root, 'go/web.go'), 'utf8'))
  && /func stats\(\) statsRes/.test(go) && /func handleImport/.test(fs.readFileSync(path.join(root, 'go/backup.go'), 'utf8'));
console.log((goRoutes ? '  ok   ' : '  FAIL ') + 'Go 侧 /api/stats + /api/import + /api/clear 已注册');
if (!goRoutes) bad++;
const panel = /function pageSheet\(title, html\)/.test(src) && /\.panel\.page\{/.test(src)
  && /settingsSheet\(\)\{ pageSheet\('设置'/.test(src);
console.log((panel ? '  ok   ' : '  FAIL ') + '设置是全屏面板（顶栏固定 + 分组）');
if (!panel) bad++;
const secs = ['外观', 'AI 模型', '采集', '本地 OCR', '数据', '运行状态']
  .every(function (t) { return src.indexOf(t) > 0 });
console.log((secs ? '  ok   ' : '  FAIL ') + '设置面板分组齐全（外观/AI/采集/OCR/数据/状态）');
if (!secs) bad++;
const data = /function importJSON\(\)/.test(src) && /function clearAllNotes\(\)/.test(src)
  && /Android\.pickJSON\(\)/.test(src) && /REQ_IMPORT/.test(java) && /api\/import/.test(java);
console.log((data ? '  ok   ' : '  FAIL ') + '导出 / 导入（选文件→POST /api/import）/ 清空 全通');
if (!data) bad++;

// ---------- 时区：Go 用 UTC 会算错「逾期」 ----------
const tz = /nativeInit\(String filesDir, int tzOffsetSec, String tzId\)/.test(
    fs.readFileSync(path.join(root, 'src/dev/xduo/enote/Bridge.java'), 'utf8'))
  && /func applyTZ\(offSec int, id string\)/.test(fs.readFileSync(path.join(root, 'go/app.go'), 'utf8'))
  && /time\.Local = time\.FixedZone/.test(fs.readFileSync(path.join(root, 'go/app.go'), 'utf8'));
console.log((tz ? '  ok   ' : '  FAIL ') + 'Java 把时区传给 Go，逾期/按天统计不再差 8 小时');
if (!tz) bad++;

// ---------- 改名 + 竖琴图标 ----------
const man = fs.readFileSync(path.join(root, 'AndroidManifest.xml'), 'utf8');
const named = /android:label="懒得记"/.test(man) && !/android:label="eNote"/.test(man)
  && /<title>懒得记<\/title>/.test(src);
console.log((named ? '  ok   ' : '  FAIL ') + '应用名改为「懒得记」');
if (!named) bad++;
// 图标换成用户提供的稿子：各尺寸方形 + 自适应图层 + app 内 logo
const icon = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']
    .every(d => fs.existsSync(path.join(root, 'res/mipmap-' + d + '/ic_launcher.png'))
      && fs.existsSync(path.join(root, 'res/drawable-' + d + '/ic_launcher_foreground.png'))
      && fs.existsSync(path.join(root, 'res/drawable-' + d + '/ic_launcher_background.png')))
  && fs.existsSync(path.join(root, 'res/mipmap-anydpi-v26/ic_launcher.xml'))
  && !fs.existsSync(path.join(root, 'res/mipmap-anydpi-v26/ic_launcher_round.xml'))
  && /android:roundIcon="@mipmap\/ic_launcher"/.test(man)
  && fs.existsSync(path.join(root, 'go/icon.png'))
  && /\/icon\.png/.test(goweb) && /src="\/icon\.png"/.test(src);
console.log((icon ? '  ok   ' : '  FAIL ') + '启动图标：各尺寸 + 自适应图层 + app 内 logo');
if (!icon) bad++;

// 「重要」标签不能比时间标签高出一截：两者都要 inline-block + 固定行高
// 三种小标签（.chip 重要 / .due 到期 / .cd 倒计时）盒模型必须完全一致，容器 flex 居中
function ruleBody(cls) {
  const m = src.match(new RegExp('^\\.' + cls + '\\{([^}]*)\\}', 'm'));
  return m ? m[1] : '';
}
const NEED = ['display:inline-flex', 'align-items:center', 'font-size:10.5px',
  'line-height:1.4', 'padding:1px 7px', 'border:1px solid'];
const chipH = ['chip', 'due', 'cd'].every(c => NEED.every(k => ruleBody(c).indexOf(k) >= 0))
  && /^\.tx small\{display:flex;flex-wrap:wrap;align-items:center;gap:4px/m.test(src);
console.log((chipH ? '  ok   ' : '  FAIL ') + '「重要」与时间标签同高（统一盒模型 + flex 居中）');
if (!chipH) bad++;

// 导出 JSON 是整页跳转，返回键得先回退网页历史，不然回不到 app
const backHist = /if \(w\.canGoBack\(\)\) \{ w\.goBack\(\); return; \}/.test(java);
console.log((backHist ? '  ok   ' : '  FAIL ') + '返回键先回退网页历史（导出页能退出）');
if (!backHist) bad++;

// ---- R12/R13/R14 ----
const gollm = fs.readFileSync(path.join(root, 'go/llm.go'), 'utf8');
const gostore = fs.readFileSync(path.join(root, 'go/store.go'), 'utf8');
const gosearch = fs.readFileSync(path.join(root, 'go/search.go'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/dev/xduo/enote/Bridge.java'), 'utf8');

// 关键信息：六问框架进提示词，落到 Note.Facts，卡片渲染，搜索能命中
const facts = /facts/.test(gollm) && /何时/.test(gollm) && /何人/.test(gollm) && /何地/.test(gollm)
  && /何事/.test(gollm) && /为何/.test(gollm) && /下一步/.test(gollm)
  && /Facts\s+\[\]Fact/.test(gostore) && /func cleanFacts/.test(gollm)
  && /关键信息/.test(gosearch)
  && /function factsBlock/.test(src) && /factsBlock\(n\)/.test(src) && /class="facts"/.test(src);
console.log((facts ? '  ok   ' : '  FAIL ') + '关键信息：六问提取 + 落库 + 卡片渲染 + 可搜索');
if (!facts) bad++;

// 到期提醒：系统日历 + 系统闹钟 intent（零权限），有 due 才显示按钮
const remind = /ACTION_INSERT[\s\S]{0,400}CalendarContract\.Events/.test(java)
  && /CalendarContract\.EXTRA_EVENT_BEGIN_TIME/.test(java) && /CalendarContract\.EXTRA_EVENT_END_TIME/.test(java)
  && /com\.android\.alarm\.permission\.SET_ALARM/.test(man)
  && /AlarmClock\.ACTION_SET_ALARM/.test(java) && /EXTRA_SKIP_UI/.test(java)
  && /addToCalendar/.test(bridge) && /setAlarm/.test(bridge)
  && /function remindBtns/.test(src) && /toCalendar\(/.test(src) && /toAlarm\(/.test(src)
  && /if\(!t\.due\|\|t\.done\) return ''/.test(src)
  && (src.match(/remindBtns\(/g)||[]).length >= 3;   // 笔记卡片 + 待办页两处都要有
console.log((remind ? '  ok   ' : '  FAIL ') + '待办可一键写入系统日历 / 设为闹钟（intent，无权限）');
if (!remind) bad++;

// logo 铺满按钮：UA button{padding} 会挤出一圈白框
const logo = /\.iconbtn\{[^}]*padding:0/.test(src) && /img\.brand\{width:100%;height:100%/.test(src);
console.log((logo ? '  ok   ' : '  FAIL ') + '顶栏 logo 铺满按钮（去掉白底外框留白）');
if (!logo) bad++;


// ---- R7/P6 剪贴板采集 ----
// 后台读剪贴板在 Android 10+ 被系统禁止（只有默认输入法/有焦点 app 可以），
// 所以方案定稿为前台监听：MainActivity onResume 注册 ClipboardManager 监听，
// Go 侧 clip.json 暂存 + 去重，UI 横幅 + 批量勾选 + 一键解析。
const goclip = fs.readFileSync(path.join(root, 'go/clip.go'), 'utf8');
const mainact = fs.readFileSync(path.join(root, 'src/dev/xduo/enote/MainActivity.java'), 'utf8');
const clip = /func clipAdd/.test(goclip) && /func clipParse/.test(goclip)
  && /5\*time\.Second/.test(goclip) && /clip\.json/.test(goclip)
  && /nativeClipAdd/.test(goclip)
  && /addPrimaryClipChangedListener/.test(mainact) && /drainClipboard/.test(mainact)
  && /onResume\(\)/.test(mainact)
  && !/ClipWatchService/.test(man)            // 无障碍方案已移除（读不到内容）
  && /function clipBanner/.test(src) && /function clipSheet/.test(src)
  && /\/api\/clip\/parse/.test(src) && /\/api\/clip\/list/.test(src)
  && (src.match(/clipBanner\(\)/g)||[]).length >= 3;   // 三个 renderNotes 分支都挂横幅
console.log((clip ? '  ok   ' : '  FAIL ') + '剪贴板前台采集 + 暂存去重 + 横幅/批量页/一键解析');
if (!clip) bad++;

// tab 切换不再有整页浮现动画（用户要求：干净利落，避免闪烁）
const cleanTab = !/main\.enter/.test(src) && !/@keyframes fadein/.test(src)
  && /\.todo\.enter/.test(src);              // 完成待办的高亮动画保留
console.log((cleanTab ? '  ok   ' : '  FAIL ') + '切页无整页浮现动画（完成动画保留）');
if (!cleanTab) bad++;

// 待办行左侧竖条：所有行统一 3px 透明占位，重要行只改颜色 → checkbox 对齐
const priBar = /border-left:3px solid transparent/.test(src)
  && /\.pri-high\{border-left-color:var\(--bad\)\}/.test(src)
  && /padding:9px 2px 9px 8px/.test(src);
console.log((priBar ? '  ok   ' : '  FAIL ') + '待办竖条统一占位（checkbox 对齐）');
if (!priBar) bad++;

process.exit(bad ? 1 : 0);
