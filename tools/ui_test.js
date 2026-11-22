// 界面静态闸门（S2 起，随 Vue 迁移逐步加严；S6 由 ui_sig_test.js 合并进来）
//
// 存在的理由只有一个：P12 / P12.1 那类「点了没反应」的 bug——内联 onclick 里调了
// 一个不存在的函数，页面不报错、测试全绿、用户点着没反应。这类 bug 在真机上不可测，
// 只能静态抓。
//
// 跑法：node tools/ui_test.js（test.sh 会调用）
// 拆分前后都要能跑：go/ui/ 存在就读目录，否则回落 go/ui.html。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const fails = [];
const oks = [];
function ok(name) { oks.push(name); }
function bad(name, detail) { fails.push(name + (detail ? '：' + detail : '')); }

// ---------- 读源码 ----------
function walkDir(d) {
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== 'vendor') out = out.concat(walkDir(p)); }
    else if (/\.(css|js|html)$/.test(f.name)) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}
const uiDir = path.join(root, 'go/ui');
const SPLIT = fs.existsSync(uiDir);
const uiFiles = SPLIT ? walkDir(uiDir) : [fs.readFileSync(path.join(root, 'go/ui.html'), 'utf8')];
const ui = uiFiles.join('\n');
function read(p) { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { return ''; } }

// 内联 handler 全部写在 JS 的字符串拼接里（实测 index.html 里 0 个、app.js 里 70 个），
// 所以要先还原 \' 和 \" 转义，才能按 onclick="..." 抓全。
const uiUnescaped = ui.replace(/\\'/g, "'").replace(/\\"/g, '"');

// ---------- 闸门① 内联 handler 调的函数必须存在 ----------
// 顶层声明收集：function / async function / var|let|const x = / window.x =
const declared = new Set();
for (const m of ui.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
for (const m of ui.matchAll(/(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
for (const m of ui.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
// 对象方法形式（Vue 组件的 methods: { foo() {} }）在 S3 之后是主要来源
for (const m of ui.matchAll(/(?:^|\n)\s{2,}([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);

const BUILTIN = new Set(['this', 'window', 'document', 'location', 'navigator', 'alert', 'confirm',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'JSON', 'Math', 'Date', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Promise', 'encodeURIComponent', 'decodeURIComponent',
  'parseInt', 'parseFloat', 'isNaN', 'event', 'console', 'fetch', 'localStorage', 'RegExp', 'Set', 'Map']);

const handlerRe = /on(click|input|change|keyup|keydown|focus|blur|submit|touchstart|touchend)="([^"]*)"/g;
const missing = new Map();
let handlerCount = 0;
for (const m of uiUnescaped.matchAll(handlerRe)) {
  handlerCount++;
  for (const stmt of m[2].split(/;\s*/)) {
    const t = stmt.trim();
    if (!t) continue;
    const call = t.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (!call) continue;                 // 赋值、return false、this.x=… 等，不是调用
    const name = call[1];
    if (BUILTIN.has(name) || declared.has(name)) continue;
    missing.set(name, (missing.get(name) || 0) + 1);
  }
}
if (missing.size) {
  bad('内联 handler 调了不存在的函数（P12 类：点了没反应）',
    [...missing].map(([k, v]) => k + '×' + v).join(', '));
} else {
  ok('内联 handler ' + handlerCount + ' 处引用的函数全部存在（页面顶层声明 ' + declared.size + ' 个）');
}

// ---------- 闸门② test.sh 的 jseval 引用的全局名必须存在 ----------
// jseval 脚本是 `"$PY" -c 'import json…' '(async function(){ … })()' > js.json`，
// 所以整块 JS 是单引号参数，按 (async function(){ … })() 的配对抓。
const testSh = read('test.sh');
const jsevalNames = new Set();
const jsevalLocals = new Set();
for (const m of testSh.matchAll(/\(async function\(\)\{[\s\S]*?\}\)\(\)'/g)) {
  const body = m[0];
  // 脚本内部自己声明的 var L / var q / var sleep 是局部名，不算页面全局
  for (const d of body.matchAll(/(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) jsevalLocals.add(d[1]);
  for (const s of body.split(/;|\n/)) {
    const t = s.trim();
    const call = t.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (call) jsevalNames.add(call[1]);
    const asg = t.match(/^([A-Za-z_$][\w$]*)\.[A-Za-z_$][\w$]*\s*=/);
    if (asg) jsevalNames.add(asg[1]);
  }
}
const JS_BUILTINS = new Set(['var', 'let', 'const', 'if', 'for', 'while', 'return', 'function', 'await',
  'new', 'typeof', 'JSON', 'Math', 'Date', 'Object', 'Array', 'String', 'Number', 'Promise', 'document',
  'window', 'console', 'setTimeout', 'clearTimeout', 'setInterval', 'api', 'render', 'encodeURIComponent',
  'parseInt', 'Boolean', 'String', 'location', 'navigator', 'fetch', 'localStorage', 'Array', 'Set', 'Map']);
const jsMissing = [...jsevalNames].filter(n => !JS_BUILTINS.has(n) && !jsevalLocals.has(n) && !declared.has(n));
if (jsMissing.length) {
  bad('test.sh 的 jseval 用了页面里不存在的名字', jsMissing.join(', '));
} else {
  ok('test.sh 的 jseval 引用的 ' + jsevalNames.size + ' 个页面名字全部存在（局部名 ' + jsevalLocals.size + ' 个已排除）');
}

// ---------- 闸门③ 裸 hex / 裸 px 棘轮 ----------
// 棘轮：只许降不许升。基线是拆分前实测值，S2 之后每迁移一个视图就该往下走。
// px 只统计刻度管得着的属性（margin/padding/gap/border-radius/font-size），
// 全部 px 是 650 处，其中 259 处是 width/height/top/left 这类布局尺寸，
// 那些本来就不归间距刻度管，拉进来只会把信号淡掉。
const RATCHET = {
  hex: 62,   // go/ui.html 的 <style> 里实测 62 处
  px: 391,   // 刻度相关属性里的裸 px，实测 391 处
};
const cssText = SPLIT
  ? walkDir(path.join(uiDir, 'css')).join('\n')
  : (ui.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
const cssBody = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
function count(re, s) { const m = s.match(re); return m ? m.length : 0; }
const hexCount = count(/#[0-9a-fA-F]{3,8}\b/g, cssBody);
const scaleDecls = (cssBody.match(/(?:margin|padding|gap|border-radius|font-size)[^;{}]*/g) || []).join('\n');
const pxCount = count(/\d+px\b/g, scaleDecls);
if (hexCount > RATCHET.hex) bad('裸 hex 比基线多了', hexCount + ' > ' + RATCHET.hex + '，新样式必须用 token');
else ok('裸 hex ' + hexCount + ' ≤ 基线 ' + RATCHET.hex);
if (pxCount > RATCHET.px) bad('裸 px 比基线多了', pxCount + ' > ' + RATCHET.px + '，新样式必须用 --s*/--r*/--fs-*');
else ok('裸 px ' + pxCount + ' ≤ 基线 ' + RATCHET.px);

// ---------- 闸门④ 调色板 5 处必须一致 ----------
// 同一套背景色今天写在 5 个地方，改一处漏四处就是状态栏和页面颜色不一致。
const bgLight = (cssText.match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [, ''])[1].toLowerCase();
const darkBlock = cssText.match(/html\[data-theme=dark\]\s*\{([\s\S]*?)\}/) || [, ''];
const bgDark = (darkBlock[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [, ''])[1].toLowerCase();
const themeJava = read('src/dev/xduo/enote/Theme.java');
const jLight = (themeJava.match(/BG_LIGHT\s*=\s*0xFF([0-9a-fA-F]{6})/) || [, ''])[1].toLowerCase();
const jDark = (themeJava.match(/BG_DARK\s*=\s*0xFF([0-9a-fA-F]{6})/) || [, ''])[1].toLowerCase();
const meta = (ui.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-fA-F]{3,8})"/) || [, ''])[1].toLowerCase();
const pal = [];
if (!bgLight) pal.push('tokens 里找不到亮色 --bg');
if (!bgDark) pal.push('tokens 里找不到暗色 --bg');
if (jLight && bgLight && '#' + jLight !== bgLight) pal.push('Theme.java BG_LIGHT=#' + jLight + ' ≠ --bg ' + bgLight);
if (jDark && bgDark && '#' + jDark !== bgDark) pal.push('Theme.java BG_DARK=#' + jDark + ' ≠ --bg ' + bgDark);
if (meta && bgLight && bgDark && meta !== bgLight && meta !== bgDark) pal.push('meta theme-color ' + meta + ' 两个 --bg 都不是');
if (pal.length) bad('调色板一致性被破坏', pal.join('；'));
else ok('调色板一致：--bg ' + bgLight + '/' + bgDark + ' = Theme.java = meta theme-color');

// ---------- 闸门⑤ 已删除的类名不许复活 ----------
// test.sh:652 是负向断言，这两个类名今天不存在，存在就说明提醒面板退回了整块重绘。
for (const cls of ['missedb', 'missedtop']) {
  if (new RegExp('\\.' + cls + '\\b').test(cssText)) bad('.' + cls + ' 复活了', '它已被删除，test.sh:652 断言它不存在');
  else ok('.' + cls + ' 保持不存在');
}

// ---------- 闸门⑥ test.sh 依赖的 class 名必须存在 ----------
// 这些是端到端用例的选择器，改名等于删测试。
const FROZEN = { msrow: 7, cb: 30, pfoot: 11, ttx: 9, acard: 5, iconbtn: 11, brand: 2, justdone: 3, sheet: 33, todo: 19 };
for (const cls of Object.keys(FROZEN)) {
  const n = count(new RegExp('\\.' + cls + '\\b', 'g'), cssText);
  if (n === 0) bad('class .' + cls + ' 在 CSS 里消失了', 'test.sh 用它当选择器');
}
ok('test.sh 依赖的 ' + Object.keys(FROZEN).length + ' 个 class 名全部还在');

// ---------- 闸门⑦ CSS 拆分的层叠安全 ----------
// 按视图拆 css/*.css 后，加载顺序变成 tokens → base → components → views/*。
// 如果同一个选择器的两条规则被分到两个文件，而它们又设了同一个属性，后写的那条
// 就不再赢——层叠顺序静默翻转，测试全绿但像素变了。这是拆分最容易踩且最难发现的坑。
// 不变量：一个选择器的多条规则如果属性集有交集，必须待在同一个文件里。
// 跟 hex/px 一样用棘轮：S1a 是按原始行号切的，切在 .sheet 中间，这两条先记成基线，
// 只拦新增的冲突；S2 按视图重排 CSS 时把基线清零。
const CASCADE_BASELINE = new Set(['.sheet', '.sheet .panel']);
function rulesOf(text) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  // 递归而不是扫平：@media 的上下文必须随块关闭而失效，
  // 否则后面所有顶层规则都会被错标成在那条 @media 里，跳文件比对就漏。
  function parseBlock(text, media) {
    let i = 0;
    while (i < text.length) {
      const at = text.indexOf('{', i);
      if (at < 0) break;
      const head = text.slice(i, at).trim();
      let end = at + 1, depth = 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
        end++;
      }
      const inner = text.slice(at + 1, end - 1);
      if (/^@(media|supports)/.test(head)) {
        parseBlock(inner, head.replace(/\s+/g, ' '));
      } else if (!/^@/.test(head)) {   // keyframes 等不参与层叠
        const props = new Set();
        for (const d of inner.split(';')) {
          const p = d.match(/^\s*([-a-zA-Z]+)\s*:/);
          if (p) props.add(p[1].toLowerCase());
        }
        for (const sel of head.split(',').map(s => s.replace(/\s+/g, ' ').trim())) {
          if (sel) out.push({ sel: media + '␤' + sel, props });
        }
      }
      i = end;
    }
  }
  parseBlock(body, '');
  return out;
}
if (SPLIT) {
  const bySelector = new Map();
  const cssDir = path.join(uiDir, 'css');
  for (const f of fs.readdirSync(cssDir, { withFileTypes: true })) {
    if (!f.isFile() || !f.name.endsWith('.css')) continue;
    const rel = 'css/' + f.name;
    for (const r of rulesOf(fs.readFileSync(path.join(cssDir, f.name), 'utf8'))) {
      if (!bySelector.has(r.sel)) bySelector.set(r.sel, []);
      bySelector.get(r.sel).push({ file: rel, props: r.props });
    }
  }
  const flips = [];
  for (const [sel, list] of bySelector) {
    const files = new Set(list.map(x => x.file));
    if (files.size < 2) continue;
    const seen = new Map();
    for (const x of list) {
      for (const p of x.props) {
        if (seen.has(p) && seen.get(p) !== x.file && !CASCADE_BASELINE.has(sel.replace(/^[^␤]*␤/, ''))) {
          flips.push(sel + ' 的 ' + p + '：' + seen.get(p) + ' 与 ' + x.file);
        }
        seen.set(p, x.file);
      }
    }
  }
  if (flips.length) bad('CSS 拆分造成层叠顺序翻转', flips.slice(0, 6).join('；'));
  else ok('CSS 拆分无新增层叠冲突（基线内 ' + CASCADE_BASELINE.size + ' 条，共 ' + bySelector.size + ' 个选择器）');
}

// ---------- 输出 ----------
for (const s of oks) console.log('ok   ' + s);
for (const s of fails) console.log('FAIL ' + s);
process.exit(fails.length ? 1 : 0);
