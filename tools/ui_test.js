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
// 带相对路径的版本：闸门③ 要把 tokens.css 从裸 hex 棘轮里排除出去。
function walkDirPairs(d, base) {
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, f.name), rel = base + f.name;
    if (f.isDirectory()) { if (f.name !== 'vendor') out = out.concat(walkDirPairs(p, rel + '/')); }
    else if (/\.css$/.test(f.name)) out.push([rel, fs.readFileSync(p, 'utf8')]);
  }
  return out;
}
const uiDir = path.join(root, 'go/ui');
const SPLIT = fs.existsSync(uiDir);
const uiFiles = SPLIT ? walkDir(uiDir) : [fs.readFileSync(path.join(root, 'go/ui.html'), 'utf8')];
const ui = uiFiles.join('\n');
// 只要 JS 源（带文件名），给闸门①③ 当解析域用。文件名要留着：闸门③ 逐文件查重名。
function walkJs(d) {
  let out = [];
  for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== 'vendor') out = out.concat(walkJs(p)); }
    else if (/\.js$/.test(f.name)) out.push([path.relative(root, p), fs.readFileSync(p, 'utf8')]);
  }
  return out;
}
function read(p) { try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch (e) { return ''; } }

// 剔注释，但要认字符串：handler 就活在字符串字面量里（'<button onclick="foo()">'），
// 用正则一把抹会连真 handler 一起抹掉。反过来，注释里举的例子也不能当真：
// app.js 写过一行 `// 例子：onclick="foo()"`，闸门① 就判红过「foo×1」（Austin 踩的）。
//
// 做法是行锚定：只抹「行首（可带缩进）的 // 行」和「行首开始的 /* */ 块」。
// 为什么不写完整的 JS tokenizer：手写扫描器要区分正则字面量和除法（`/[&<>"]/g` 里带引号、
// `(a-b) / 1000` 里的 / 不是正则），一错就整片代码被当字符串吞掉（实测顶层声明 302→297，
// 闸门② 假红「S 不存在」）。行锚定不会：本仓库的字符串都是单行的，行首的 // 不可能在字符串里。
// 已知盲区：代码后面的行尾注释（`x=1; // onclick="fake()"`）不会被抹，真撞上了再改。
function stripComments(src) {
  const lines = src.split('\n');
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    const t = line.replace(/^\s+/, '');
    if (inBlock) {
      const e = t.indexOf('*/');
      if (e >= 0) { inBlock = false; out.push(line.slice(line.indexOf('*/') + 2)); }
      else out.push('');
      continue;
    }
    if (t.startsWith('//')) { out.push(''); continue; }
    if (t.startsWith('/*')) {
      const e = t.indexOf('*/');
      if (e >= 0) { out.push(line.slice(line.indexOf('*/') + 2)); continue; }
      inBlock = true; out.push(''); continue;
    }
    out.push(line);
  }
  return out.join('\n');
}
// 只对 JS 源做剔注释：HTML 里 https:// 的 `//` 会被当成行注释，整行连收尾引号一起吞掉
// （实测 index.html 剔完从 14707 字节剩 307），CSS 的 /* */ 又会被 JS 扫描器误读。
// 所以逐文件剔，且只剔 .js。未拆分的 go/ui.html 旧形态不剔（它是 HTML 包 script）。
const jsSources = SPLIT ? walkJs(uiDir) : [['go/ui.html', ui]];
const uiCode = jsSources.map(([, s]) => stripComments(s)).join('\n');
// 内联 handler 全部写在 JS 的字符串拼接里（实测 index.html 里 0 个、app.js 里 70 个），
// 所以要先还原 \' 和 \" 转义，才能按 onclick="..." 抓全。
const uiUnescaped = uiCode.replace(/\\'/g, "'").replace(/\\"/g, '"');

// 按顶层分隔符切开，尊重 () [] {} 和字符串。`var L=…,q=…,b=…` 这种逗号声明列表
// 必须整体扫，用 `var (\w+)` 只抓得到第一个名字，后面的会被误判成外部依赖。
function splitTopLevel(src, sep) {
  const out = [];
  let depth = 0, start = 0, q = null;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {                       // 字符串内部：只找收尾，转义跳过下一字符
      if (c === '\\') i++;
      else if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { q = c; continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === sep && depth === 0) { out.push(src.slice(start, i)); start = i + 1; }
  }
  out.push(src.slice(start));
  return out;
}

// window.__enoteActions = { … } 的 key 集合。这是内联 handler 的唯一解析域（D12）。
// 返回 null = 没有导出表；返回 'UNCLOSED' = 写了但括号没配平（解析器不可信，必须红）。
function exportTableKeys(src) {
  const m = /window\.__enoteActions\s*=\s*\{/.exec(src);
  if (!m) return null;
  let depth = 0, end = -1;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return 'UNCLOSED';
  const keys = new Set();
  for (const part of splitTopLevel(src.slice(m.index + m[0].length, end), ',')) {
    const p = part.trim();
    const short = p.match(/^([A-Za-z_$][\w$]*)$/);                 // 简写 { api }
    if (short) { keys.add(short[1]); continue; }
    const kv = p.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*:/);        // { api: api }
    if (kv) keys.add(kv[1]);
  }
  return keys;
}

// ---------- 闸门① 内联 handler 调的函数必须在导出表里（D12 原子防线）----------
// 转 ES module 后 app.js 的顶层声明不再是 window 上的全局，内联 onclick="foo()" 走的是
// 全局查找，看不到模块顶层函数。70 处里漏接一处 = 一次静默失效（P12 那一类）。
// 所以：app.js 一旦是 module，handler 的解析域就只有 window.__enoteActions + 内建，
// 顶层声明不再算数——这条闸门和转 module 必须同批，拆开的中间态就是 70 个静默失效。
const declared = new Set();
for (const m of uiCode.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) declared.add(m[1]);
for (const m of uiCode.matchAll(/(?:^|\n)\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
for (const m of uiCode.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);
// 对象方法形式（Vue 组件的 methods: { foo() {} }）在 S3 之后是主要来源
for (const m of uiCode.matchAll(/(?:^|\n)\s{2,}([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);

const BUILTIN = new Set(['this', 'window', 'document', 'location', 'navigator', 'alert', 'confirm',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'JSON', 'Math', 'Date', 'Array',
  'Object', 'String', 'Number', 'Boolean', 'Promise', 'encodeURIComponent', 'decodeURIComponent',
  'parseInt', 'parseFloat', 'isNaN', 'event', 'console', 'fetch', 'localStorage', 'RegExp', 'Set', 'Map']);

const handlerRe = /on(click|input|change|keyup|keydown|focus|blur|submit|touchstart|touchend)="([^"]*)"/g;

const table = exportTableKeys(uiCode);
const htmlSrc = SPLIT ? read('go/ui/index.html') : ui;
// HTML 只剔 <!-- --> 注释，不能用 stripComments（见上）。
const htmlCode = htmlSrc.replace(/<!--[\s\S]*?-->/g, ' ');
const isModule = /<script[^>]*\btype\s*=\s*["']module["']/.test(htmlCode);
const STRICT = table !== null || isModule;

if (table === 'UNCLOSED') {
  bad('window.__enoteActions 写了但括号没配平，闸门① 无法解析导出表');
} else if (isModule && table === null) {
  bad('app.js 已是 ES module 但没有 window.__enoteActions 导出表',
    '内联 handler 走全局查找，模块顶层函数它们看不到 → 70 处静默失效');
}
if (table instanceof Set && !/Object\.assign\(\s*window\s*,\s*(window\.)?__enoteActions\b/.test(uiCode)) {
  bad('导出表没挂回 window', '缺 Object.assign(window, __enoteActions)：'
    + 'onclick="foo()" 是全局查找，只挂 __enoteActions 上的话 70 处 handler 一个都进不了函数');
}

// 解析域：有导出表（或已是 module）就只认导出表 + 内建，顶层声明不算全局；
// 没导出表且仍是普通 script 时，保持 S2 的老行为（扫顶层声明）。
const domain = STRICT ? (table instanceof Set ? table : new Set()) : declared;
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
    if (BUILTIN.has(name) || domain.has(name)) continue;
    missing.set(name, (missing.get(name) || 0) + 1);
  }
}
if (missing.size) {
  bad(STRICT ? '内联 handler 调了导出表里没有的函数（点了没反应）'
             : '内联 handler 调了不存在的函数（P12 类：点了没反应）',
    [...missing].map(([k, v]) => k + '×' + v).join(', '));
} else if (STRICT) {
  ok('内联 handler ' + handlerCount + ' 处全部能在导出表里解析（导出 ' + domain.size + ' 个）');
} else {
  ok('内联 handler ' + handlerCount + ' 处引用的函数全部存在（页面顶层声明 ' + declared.size + ' 个）');
}

// ---------- 闸门①b Vue 模板的 @click / v-on: 同样必须在导出表里（步骤 5 起）----------
// 视图转 Vue 后 handler 从 onclick="foo()" 变成 @click="foo()"，上面的 handlerRe 抓不到。
// 不补这条的话，闸门① 验的集合会随迁移**静默缩小**：模板里把 delNote 打成 delNot，
// 页面不报错、端到端全绿，正是 P12 那一类。迁移期两种写法并存，所以两条都要跑，
// 并且断言「两者之和」不低于迁移前的基线——视图迁移时把按钮整条丢掉也会红。
const VUE_BUILTIN = new Set(['$event', '$emit', '$props', '$slots', '$refs', '$el', '$attrs',
  '$nextTick', '$forceUpdate', '$index', '$id', '$watch', '$data', '$options', '$parent']);
const vueHandlerRe = /(?:@|v-on:)(click|input|change|keyup|keydown|focus|blur|submit|click\.stop|click\.prevent|input\.change|keyup\.enter)="([^"]*)"/g;

const vueMissing = new Map();
let vueCount = 0;
for (const m of uiUnescaped.matchAll(vueHandlerRe)) {
  vueCount++;
  for (const stmt of m[2].split(/;\s*/)) {
    const t = stmt.trim();
    if (!t) continue;
    // 模板里允许内联箭头：@click="() => delNote(n.id)"，先剥掉箭头前缀再取调用名
    const body = t.replace(/^\(?[\w$,\s{}\[\]'"]*\)?\s*=>\s*/, '');
    const call = body.match(/^([A-Za-z_$][\w$]*)\s*\(/);
    if (!call) continue;
    const name = call[1];
    if (BUILTIN.has(name) || VUE_BUILTIN.has(name) || domain.has(name)) continue;
    vueMissing.set(name, (vueMissing.get(name) || 0) + 1);
  }
}
if (vueMissing.size) {
  bad('Vue 模板里的 @click/v-on 调了导出表里没有的函数（点了没反应）',
    [...vueMissing].map(([k, v]) => k + '×' + v).join(', '));
}

// 迁移期基线：步骤 4 实测 69 处内联 handler（onclick 68 + oninput 1）。
// 视图转 Vue 后内联的减少、模板的增加，总数不该掉——掉了就是迁移时把控件丢了。
const HANDLER_BASELINE = 70;   // 闸门① 同一次扫描实测的内联数，不是 python 数的 69（那个漏了 oninput="event…"）
const total = handlerCount + vueCount;
if (STRICT && total < HANDLER_BASELINE) {
  bad('handler 总数从 ' + HANDLER_BASELINE + ' 掉到 ' + total
    + '（内联 ' + handlerCount + ' + Vue 模板 ' + vueCount + '）',
    '迁移视图时整条控件被丢掉是静默的：老 handler 删了，新模板里那一条没写上');
} else if (STRICT) {
  ok('handler 总数 ' + total + '（内联 ' + handlerCount + ' + Vue 模板 ' + vueCount
    + '）≥ 基线 ' + HANDLER_BASELINE + (vueCount ? '，Vue 模板部分已解析' : '，尚无 Vue 模板'));
}

// ---------- 闸门①c 组件必须真的会重绘（V.tick 拉模型的前提）----------
// 组件不持有数据、直接读模块状态（S/SR/P()/open），靠 V.tick 这个响应式计数触发重算。
// 渲染 effect 只跟踪响应式依赖：组件的渲染路径没读到 V.tick 的话，点了删除 → render()
// → tick++ → 视图一动不动，而且不报错。这条是上面那套拉模型的存在前提，必须静态钉住。
const viewFiles = jsSources.filter(([f]) => /(^|\/)views\/[\w-]+\.js$/.test(f));
if (viewFiles.length) {
  const noTick = viewFiles.filter(([, s]) => !/\bV\.tick\b|\btick\b/.test(s)).map(([f]) => f);
  if (noTick.length) {
    bad('Vue 视图文件里没有任何 tick 引用：' + noTick.join(', '),
      '组件读的是非响应式的模块状态，渲染期不读 V.tick 就永远不重算（点了没反应，且不报错）');
  } else {
    ok('Vue 视图 ' + viewFiles.length + ' 个，渲染路径都引用了 tick（重绘有触发源）');
  }
}

// ---------- 闸门③ 顶层声明不得重名（module 化是颗解析期炸弹）----------
// 真事：app.js 有两份 function dueMs（:131 / :968）。普通脚本里 function 声明提升，
// 后者覆盖前者，:131 那份从写下来就没跑过——静默遮蔽，测试全绿。ES module 不允许顶层
// 同名 function：解析期 SyntaxError，整个模块不执行。症状就是 Austin 第 6 轮全量抓到的
// 那组诡异组合：index.html 正常、/js/app.js 取到 82306 字节且内容含导出表，
// 但 typeof api === "undefined"、页面全空。
//
// 判红规则用 node --input-type=module 实测过：
//   var + var            合法（module 里也合法）
//   var + function       module 里 SyntaxError，普通脚本合法
//   function + function  SyntaxError
// 所以「重名且至少两个不是 var」（Austin 原规则）会漏 var+function，正确规则是
// **重名且其中至少一个不是 var**。
//
// 只看顶格（列 0）的声明：本仓库嵌套代码一律缩进，顶格是顶层的可靠代理，也不会把
// Vue 组件 methods 里的同名方法算进来。逐文件查：module 作用域是按文件算的，
// 跳文件重名在 module 里合法。
function topLevelDecls(src) {
  const out = new Map();
  const add = (kind, name, line) => {
    if (!out.has(name)) out.set(name, []);
    out.get(name).push([kind, line]);
  };
  src.split('\n').forEach((ln, i) => {
    let m = /^function\s+([A-Za-z_$][\w$]*)/.exec(ln);
    if (m) { add('function', m[1], i + 1); return; }
    m = /^(let|const)\s+([A-Za-z_$][\w$]*)/.exec(ln);
    if (m) { add(m[1], m[2], i + 1); return; }
    m = /^var\s+/.exec(ln);
    if (!m) return;
    // var a = 1, b = 2 这种逗号声明串：只取行首第一个名字会漏掉后面的。
    for (const part of splitTopLevel(ln.slice(4), ',')) {
      const n = /^\s*([A-Za-z_$][\w$]*)/.exec(part);
      if (n) add('var', n[1], i + 1);
    }
  });
  return out;
}
const dupReports = [];
for (const [file, code] of jsSources) {
  for (const [name, list] of topLevelDecls(stripComments(code))) {
    if (list.length < 2) continue;
    if (!list.some(([k]) => k !== 'var')) continue;   // 全 var 重名：module 里也合法
    const kinds = list.map(([k, l]) => k + '@' + l).join(' + ');
    dupReports.push(file + ' 的 ' + name + '：' + kinds);
  }
}
if (dupReports.length) {
  bad('顶层声明重名（module 化后是解析期 SyntaxError，整模块不执行 = 白屏；普通脚本里是静默遮蔽）',
    dupReports.join(' | '));
} else {
  ok('顶层声明无重名（' + jsSources.length + ' 个 JS 文件，var+var 合法不计）');
}

// ---------- 闸门② jseval 载荷引用的全局名必须落在闭集里（D12b / D13）----------
// 为什么这么狠：载荷里裸写 tab="notes" 是往 window 上写，模块里的 tab 一动不动，
// 断言全绿而界面根本没切过去 —— 这种假绿比崩溃难查一个量级。步骤 5-10 把视图转成
// Vue 之后，模块顶层名字不再自动是 window 属性，这类假绿会成批出现，所以缝先立起来。
//
// 载荷边界：test.sh 里 `"$PY" -c '…sys.argv[1]}))' '<JS>' > "$TMPDIR/js*.json"`，
// JS 是单引号参数，到 `> "$TMPDIR/js*.json"` 为止。边界外的 Python（open/print/int/val）
// 不是 JS，扫进来就是假阳性（实测）。字符串字面量也要剔掉：`.pane[data-tab=mine]`
// 这种选择器串会命中裸名 tab；正则字面量也要剔掉：replace(/\s+/g) 里的 g/d/s 会被
// 当成标识符（都是实测过的假阳性）。
const testSh = read('test.sh');

// 剥掉注释 / 字符串 / 模板串 / 正则字面量，只留语法骨架。
function stripJsLiterals(src) {
  let out = '', i = 0;
  const prev = () => out.replace(/\s+$/, '').slice(-1);
  while (i < src.length) {
    const d = src.slice(i, i + 2);
    if (d === '//') { const j = src.indexOf('\n', i); i = j < 0 ? src.length : j; continue }
    if (d === '/*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < src.length) { if (src[j] === '\\') { j += 2; continue } if (src[j] === c) break; j++ }
      out += '""'; i = j + 1; continue
    }
    // 判「除号还是正则」看前一个非空字符：载荷里正则一律出现在 ( , = : 后面。
    if (c === '/' && '(,=:[!&|?{};+-*%<>~^'.includes(prev())) {
      let j = i + 1, cls = false;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false;
        else if (src[j] === '/' && !cls) break;
        j++;
      }
      i = j + 1;
      while (/[gimsuy]/.test(src[i] || '')) i++;
      out += '""'; continue;
    }
    out += c; i++;
  }
  return out;
}

// 闭集：载荷能碰到的页面全局。函数 10 个（步骤 2 导出表里测试用得着的那批）
// + 状态 7 个（只能以 __enote.state.X 出现，裸名就是假绿）。
// SR 是步骤 5 加的：notesFiltered() 第一优先级读它，夹具不暴露它就画不出笔记空态。
const CLOSED_FN = ['api', 'refresh', 'render', 'missedDismiss', 'missedSheet', 'folderPick',
  'folderSave', 'folderSheet', 'shotPick', 'shotSheet'];
const STATE_NAMES = ['tab', 'S', 'MISSED', 'open', 'shotSel', 'shotList', 'SR'];
const JS_WORDS = new Set(['var', 'let', 'const', 'if', 'else', 'for', 'while', 'do', 'return',
  'function', 'await', 'async', 'new', 'typeof', 'instanceof', 'in', 'of', 'try', 'catch', 'finally',
  'throw', 'break', 'continue', 'switch', 'case', 'default', 'class', 'extends', 'super', 'void',
  'delete', 'yield', 'static', 'this', 'arguments', 'true', 'false', 'null', 'undefined', 'get',
  'set', 'import', 'export', 'as', 'with', 'debugger']);
const JS_GLOBALS = new Set(['console', 'document', 'window', 'navigator', 'location', 'history',
  'alert', 'Math', 'JSON', 'Date', 'Object', 'Array', 'String', 'Number', 'Boolean', 'Promise',
  'RegExp', 'Error', 'Set', 'Map', 'WeakMap', 'Symbol', 'Reflect', 'Proxy', 'globalThis', 'Infinity',
  'NaN', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'queueMicrotask', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent', 'decodeURIComponent',
  'DOMParser',   // 步骤 5 的 DOM 一致性夹具用（Chrome 1 就有，远低于 ES2020 基线）
  'fetch', 'atob', 'btoa', 'localStorage', 'sessionStorage', 'URL', 'Blob', 'File', 'FormData',
  'Headers', 'Request', 'Response', 'AbortController', 'TextEncoder', 'TextDecoder', 'structuredClone',
  'Intl', 'crypto', 'performance', 'getComputedStyle', 'querySelector', 'querySelectorAll',
  'addEventListener', 'MutationObserver', 'IntersectionObserver',
  '__enote', '__enoteActions', '__enoteProbe']);

function payloadLocals(src) {
  const loc = new Set();
  for (const m of src.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*(?:\s*=\s*[^;]*?,\s*[A-Za-z_$][\w$]*)*)/g))
    for (const p of m[1].split(/[,=]/).map(s => s.trim()).filter(Boolean)) loc.add(p);
  for (const m of src.matchAll(/\bfunction\s*([A-Za-z_$][\w$]*)?\s*\(([^)]*)\)/g)) {
    if (m[1]) loc.add(m[1]);
    m[2].split(',').map(s => s.trim()).filter(Boolean).forEach(s => loc.add(s.replace(/=.*/, '').trim()));
  }
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) loc.add(m[1]);
  for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/g)) loc.add(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g))
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => loc.add(s));
  return loc;
}

const jsevalPayloads = [...testSh.matchAll(/sys\.argv\[1\]\}\)\)'[ \t]*(?:\\\n)?[ \t]*'([\s\S]*?)' > "\$TMPDIR\/[a-z]+\.json"/g)]
  .map(m => m[1]);
const CLOSED = new Set(CLOSED_FN);
const g2 = [];
const refsAll = new Set();
let bareStateAll = [], renderCalls = 0, renderAwaited = 0;
jsevalPayloads.forEach((body, idx) => {
  // 载荷得能编译：包装漏改 async / 括号不平衡都是整段 SyntaxError，症状是 JSEVAL token
  // 集体消失（「用例没跑」而不是「用例红了」）。new Function 只编译不执行，正好当语法闸门。
  try { new Function(body) } catch (e) {
    g2.push('载荷 ' + (idx + 1) + ' 编译不过：' + e.message + '（整段不执行，JSEVAL token 会集体消失）');
    return;
  }
  if (body.indexOf('`') >= 0) g2.push('载荷 ' + (idx + 1) + ' 用了模板字符串，扫描器不认（改成字符串拼接）');
  // 载荷是 shell 单引号参数，JS 里不能出现单引号。shell 没有「转义的单引号」：串在第一个
  // 单引号处结束，前后两段相邻字符串字面量直接拼接，于是引号被静默吃掉。
  // 代码里写 document.createElement('div') → 到浏览器手里变成 document.createElement(div)，
  // 语法完全合法（div 是个合法标识符），上面的 new Function 编译检查抓不到，
  // 真机运行时才炸 div is not defined——整条用例白跑一轮（真踩过，代价是一次完整跑）。
  // 注释里写单引号只伤文字不伤语义，但规则一刀切最好记：载荷里一律用双引号。
  if (body.indexOf("'") >= 0) {
    const at = body.indexOf("'");
    g2.push('载荷 ' + (idx + 1) + " 里有单引号，shell 会把它吃掉：JS 代码里 'x' 会变成裸标识符 x"
      + '（语法合法、编译检查绿，运行时才炸）。改用双引号。片段：'
      + JSON.stringify(body.slice(Math.max(0, at - 40), at + 20)));
  }
  const clean = stripJsLiterals(body);
  const loc = payloadLocals(clean);
  for (const m of clean.matchAll(/(^|[^.\w$?])([A-Za-z_$][\w$]*)/g)) {
    const name = m[2];
    if (/^\s*:/.test(clean.slice(m.index + m[0].length))) continue;   // 对象字面量的 key
    if (JS_WORDS.has(name) || JS_GLOBALS.has(name) || loc.has(name)) continue;
    refsAll.add(name);
    if (STATE_NAMES.includes(name)) bareStateAll.push(name + '@载荷' + (idx + 1));
  }
  renderCalls += (clean.match(/\brender\(/g) || []).length;
  // 两种写法算「已 await」：直接 `await render()`，以及 VDIFF 夹具的
  // `Promise.race([render(), 兑底超时])`——Vue 分支里组件渲染抛异常时 nextTick 不兑现，
  // `await render()` 会挂死，夹具要永远给结论，不能跟着一起挂。
  renderAwaited += (clean.match(/\bawait\s+render\(/g) || []).length
    + (clean.match(/Promise\.race\(\[\s*render\(/g) || []).length;
});

if (jsevalPayloads.length < 7) {
  bad('jseval 载荷只扫到 ' + jsevalPayloads.length + ' 个', '期望 ≥ 7：抽取正则失效了，闸门② 自己在假绿');
} else if (g2.length) {
  bad('闸门② 扫载荷失败', g2.join('；'));
} else {
  const extra = [...refsAll].filter(n => !CLOSED.has(n)).sort();
  const unused = CLOSED_FN.filter(n => !refsAll.has(n));
  // 顺序有讲究：裸状态名先报。它同时也是「闭集外」，但只说「闭集外」会把人往
  // 「新增要改闸门」的方向带，而真正的坑是「写到 window 上、模块没动」这种假绿。
  if (bareStateAll.length) bad('载荷里裸写了状态名', bareStateAll.join(', ') + '：裸名是往 window 上写，模块里的 ' + bareStateAll[0].split('@')[0] + ' 一动不动（假绿），要走 __enote.state.' + bareStateAll[0].split('@')[0]);
  else if (extra.length) bad('jseval 载荷引用了闭集外的全局名', extra.join(', ') + '（闭集 = 函数 10 个 + 状态 6 个走桥，新增要同步改闸门②）');
  else if (unused.length) bad('闭集里有名字没人引用了', unused.join(', ') + '（闭集要同步缩小，否则改名后闸门② 查不出来）');
  else if (renderCalls !== renderAwaited) bad('载荷里的 render 没全部 await', renderAwaited + '/' + renderCalls + '：render() 的契约是 Promise（D13），不 await 就断言不到新 DOM；包装也得是 async function');
  else ok('jseval 载荷 ' + jsevalPayloads.length + ' 个：引用全局名 == 闭集（函数 ' + CLOSED_FN.length + '）+ 状态 6 个全走 __enote.state + render ' + renderCalls + ' 处全部 await');
}

// ---------- 闸门⑯ 每个 jseval 调用前必须自己 touch .devmode ----------
// jseval 钩子只在设备上存在 .devmode 时干活，而几乎每个步骤块末尾都会 rm 它。块与块之间
// 一旦接错，钩子直接回 {"ok":false,"error":"jseval disabled: no .devmode"}：载荷根本没跑，
// 日志里一条 token 也没有，红字长得像「前端抛异常了？已收到=[]」——不是抛异常，是根本没执行。
// 步骤 5 里 Austin（VDIFF 夹具）和我（Notes 交互用例）各踩一次，各付出一轮完整跑。
// 规则：每个 jseval 块自己 touch，别信上一块留下的状态（步骤 6/7/9/10 都要加用例）。
{
  const lines = testSh.split('\n');
  let have = false, calls = [], errs = [];
  lines.forEach((ln, i) => {
    if (/asroot_global\s+"[^"]*touch[^"]*\.devmode/.test(ln)) have = true;
    else if (/asroot_global\s+"[^"]*rm[^" ]*[^" ]*[^"]*\.devmode/.test(ln)) have = false;
    else if (/asroot_global\s+"[^"]*jseval\.sh[^"]*\/([a-z]+)\.json/.test(ln)) {
      const f = (ln.match(/([a-z]+)\.json/) || [, '?'])[1];
      calls.push(f);
      if (!have) errs.push('第 ' + (i + 1) + ' 行调 ' + f + '.json 前没 touch .devmode（钩子会直接 disabled，载荷不执行）');
    }
  });
  if (calls.length < 6) bad('闸门⑯ 只扫到 ' + calls.length + ' 个 jseval 调用点', '期望 ≥ 6：扫描正则失效了，闸门⑯ 自己在假绿');
  else if (errs.length) bad('闸门⑯ jseval 块缺 .devmode touch', errs.join('；'));
  else ok('闸门⑯ jseval 调用点 ' + calls.length + ' 个，每个前面都有 touch .devmode');
}

// ---------- 闸门③ 裸 hex / 裸 px 棘轮 ----------
// 棘轮：只许降不许升。基线是拆分前实测值，S2 之后每迁移一个视图就该往下走。
// px 只统计刻度管得着的属性（margin/padding/gap/border-radius/font-size），
// 全部 px 是 650 处，其中 259 处是 width/height/top/left 这类布局尺寸，
// 那些本来就不归间距刻度管，拉进来只会把信号淡掉。
const RATCHET = {
  hex: 8,    // tokens.css 之外的裸 hex。tokens.css 自已是调色板定义，那 55 处必须是字面值，
             // 把它们算进棘轮会把信号淡掉：新增一个硬编码颜色被新增一个 token 抵消就查不出来。
             // 62（拆分前全量）→ 12（只统计 tokens.css 之外）→ 8（--teal 从 fallback 转正）。
             // 剩下 8 处是刻意保留的字面值：#fff 7（彩色底上的白字，不随主题变）、#000 1（遮罩渐变）。
  px: 57,    // 刻度相关属性里的裸 px：391 →（密度 10px→8px）341 →（stats/settings）292 →（base/components 全量迁移）57
};
const cssFiles = SPLIT
  ? walkDirPairs(path.join(uiDir, 'css'), 'css/')
  : [['ui.html', (ui.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]]];
const cssText = cssFiles.map(x => x[1]).join('\n');
const cssBody = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
const leakBody = cssFiles.filter(x => !/tokens\.css$/.test(x[0])).map(x => x[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
function count(re, s) { const m = s.match(re); return m ? m.length : 0; }
const hexCount = count(/#[0-9a-fA-F]{3,8}\b/g, leakBody);
const hexTokens = count(/#[0-9a-fA-F]{3,8}\b/g, cssFiles.filter(x => /tokens\.css$/.test(x[0])).map(x => x[1]).join('\n'));
const scaleDecls = (cssBody.match(/(?:margin|padding|gap|border-radius|font-size)[^;{}]*/g) || []).join('\n');
const pxCount = count(/\d+px\b/g, scaleDecls);
if (hexCount > RATCHET.hex) bad('裸 hex 比基线多了', hexCount + ' > ' + RATCHET.hex + '，新样式必须用 token');
else ok('裸 hex ' + hexCount + ' ≤ 基线 ' + RATCHET.hex + '（tokens.css 内 ' + hexTokens + ' 处定义不计）');
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
// 跟 hex/px 一样用棘轮：S1a 是按原始行号切的，切在 .sheet 中间；S2 已把这两条
// 合并进 css/base.css 并紧邻排列，所以基线清空——现在任何跨文件同名同属性都是红。
const CASCADE_BASELINE = new Set();
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
  // 递归：S2 后视图层在 css/views/*.css，不递归就完全扫不到（闸门会假绿）。
  const cssList = [];
  (function walk(d, rel) {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.isDirectory()) walk(path.join(d, f.name), rel + f.name + '/');
      else if (f.name.endsWith('.css')) cssList.push([path.join(d, f.name), rel + f.name]);
    }
  })(cssDir, 'css/');
  for (const [abs, rel] of cssList) {
    for (const r of rulesOf(fs.readFileSync(abs, 'utf8'))) {
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
        if (seen.has(p) && seen.get(p) !== x.file && !CASCADE_BASELINE.has(sel)) {
          flips.push(sel + ' 的 ' + p + '：' + seen.get(p) + ' 与 ' + x.file);
        }
        seen.set(p, x.file);
      }
    }
  }
  if (flips.length) bad('CSS 拆分造成层叠顺序翻转', flips.slice(0, 6).join('；'));
  else ok('CSS 拆分无新增层叠冲突（基线内 ' + CASCADE_BASELINE.size + ' 条，共 ' + bySelector.size + ' 个选择器）');
}

// ---------- 闸门⑧ CSS 变量必须能解析 ----------
// 自定义属性未定义时，引用它的整条声明在计算值阶段失效（不是只丢一个属性）。
// 真实事故：--spring 被 .cb .ic 和 #toast 的 transition 引用但从未定义，
// 所以勾选和 toast 一直是「瞬间出现」而不是弹出来，而测试全绿。
{
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'vendor') walk(p); }
      else if(/\.(css|js)$/.test(f.name)) files.push(p);
    }
  })(uiDir);

  const defined = new Set(), jsSet = new Set(), used = new Map();
  for (const p of files) {
    const src = fs.readFileSync(p, 'utf8'), rel = path.relative(root, p);
    if (p.endsWith('.css')) {
      for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
      for (const m of src.matchAll(/var\((--[\w-]+)\s*(,)?/g)) {
        // 有 fallback 的（var(--x, 兜底)）算安全；后面的 var 不会覆盖前面已记的 fallback
        if (!used.has(m[1]) || !m[2])
          used.set(m[1], { rel, line: src.slice(0, m.index).split('\n').length, fb: !!m[2] });
      }
    } else {
      // JS 里内联 style 设的（'--k:'+ki）也算定义
      for (const m of src.matchAll(/['"](--[\w-]+)\s*:/g)) jsSet.add(m[1]);
    }
  }
  const undef = [...used].filter(([n, v]) => !defined.has(n) && !v.fb && !jsSet.has(n))
    .map(([n, v]) => n + ' @ ' + v.rel + ':' + v.line);
  if (undef.length) bad('CSS 里有 var() 解析不了（整条声明会静默失效）', undef);
  else ok('CSS 里 ' + used.size + ' 个 var() 全部能解析（含 JS 内联设的 ' + jsSet.size + ' 个）');

  // 幽灵 token：只在 var() 的 fallback 里出现、全仓 0 处定义。
  // 它不会让声明失效（fallback 兑了），但调色板里根本没有这个颜色：
  // 真实事故是 --teal 被 .shotbanner 4 处 var(--teal,#12b5a5) 引用、从未定义，
  // 于是那个颜色活在 4 个 fallback 里，暗色模式调不到它，而旧版闸门⑧ 因为
  // 「有 fallback 就安全」全部放行。fallback 是应急兼底，不是定义。
  const ghost = [...used].filter(([n, v]) => v.fb && !defined.has(n) && !jsSet.has(n))
    .map(([n, v]) => n + ' @ ' + v.rel + ':' + v.line);
  if (ghost.length) bad('幽灵 token：只在 fallback 里出现、全仓无定义（调色板调不到它）', ghost);
  else ok('无幽灵 token（每个 var() 的名字都在 tokens.css 里有定义）');
}

// ---------- 闸门⑨ 可复制的文本不许被 user-select:none 盖到 ----------
// 控件禁选中是对的（长按按钮弹“复制”菜单很掉价），但笔记正文和剪贴板文本是
// 用户唯一要复制的东西。它们今天没被盖到，而 user-select 的选择器列表是一行长选择器，
// 后续迁移很容易顺手把 .body/.clipbody 加进去——加了不会报错，只是长按没反应。
{
  const COPYABLE = ['.body', '.clipbody', 'pre'];
  const hits = [];
  for (const [rel, text] of cssFiles) {
    for (const m of text.matchAll(/([^{}]+)\{([^}]*user-select:\s*none[^}]*)\}/g)) {
      const sels = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const c of COPYABLE) {
        if (sels.some(s => s === c || s.endsWith(' ' + c) || s.includes(c + ':'))) {
          hits.push(rel + ' 的 ' + sels.find(s => s.includes(c)) + ' 禁了选中');
        }
      }
    }
  }
  if (hits.length) bad('用户要复制的文本被 user-select:none 盖住了', hits);
  else ok('笔记正文 / 剪贴板文本可长按复制（未被 user-select:none 覆盖）');
}

// ---------- 闸门⑩ 定义了却没人用的 token（棘轮）----------
// 闸门⑧ 的镜像：⑧ 查「用了没定义」（声明静默失效），这里查「定义了没人用」。
// 真实事故：--focus-ring 加进 tokens.css 后 base.css 那一笔没提交上去，
// token 定义了、0 处引用，闸门⑧ 全绿——因为⑧ 只看引用侧。没有这条闸门，
// 「加了个 token」和「这个 token 真的在起作用」在测试里长得一模一样。
{
  // 当前 11 个是 S2 先建好刻度、S5/S6/S7 迁移视图时才用上的，只许降不许升。
  const UNUSED_BASELINE = 11;
  const files = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) { if (f.name !== 'vendor') walk(p); }
      else if (/\.(css|js)$/.test(f.name)) files.push(p);
    }
  })(uiDir);
  const defined = new Set(), used = new Set();
  for (const p of files) {
    const src = fs.readFileSync(p, 'utf8');
    if(p.endsWith('.css')) for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
    for (const m of src.matchAll(/var\((--[\w-]+)/g)) used.add(m[1]);
    for (const m of src.matchAll(/setProperty\(\s*['"](--[\w-]+)/g)) used.add(m[1]);
  }
  const unused = [...defined].filter(n => !used.has(n));
  if (unused.length > UNUSED_BASELINE) {
    bad('新增定义了却没人用的 token（棘轮 ' + unused.length + ' > ' + UNUSED_BASELINE + '）', unused);
  } else {
    ok('无新增闲置 token（' + unused.length + ' ≤ 基线 ' + UNUSED_BASELINE + '，均为 S5-S7 待接入的刻度）');
  }
}

// ---------- 闸门⑮：Vue 模板编译 + tick 依赖 + 模板 handler 存活性（S3 步骤 5） ----------
// 视图转 Vue 后，三类静默失效只能静态抓：
//   a) 模板语法错（属性顺序、实体、v-if/v-else 不配对）在 prod 构建里不报错，症状是那块 DOM 直接没；
//   b) 组件没在渲染期读 V.tick → render() 后视图不动（S.notes 不是响应式的，effect 没依赖就永不重跑）；
//   c) 模板里把 delNote 挨成 delNot → 闸门① 只认 onclick="…"，Vue 模板用 @click，不扩它验的 handler
//      集会随迁移静默缩小（点了没反应，P12 同款）。
{
  const vuePath = path.join(uiDir, 'vendor/vue.global.prod.js');
  const viewFiles = [];
  if (fs.existsSync(path.join(uiDir, 'js'))) {
    (function walk(d) {
      for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (/\.js$/.test(f.name) && !/[/\\]vue\.js$/.test(p)) viewFiles.push(p);
      }
    })(path.join(uiDir, 'js'));
  }
  if (!fs.existsSync(vuePath) || !viewFiles.length) {
    ok('Vue 模板闸门：vendor Vue 或 js/ 视图不存在，跳过（未拆分形态）');
  } else {
    // 在 node 里跑 vendored 全局构建：它只要 window + 一个能 decodeEntities 的 div。
    // Vue 的属性值实体解码走 `div.innerHTML = '<div foo="…">'` 然后读 children[0].getAttribute，
    // 所以 shim 必须把这条路径供上（不供就是「Cannot read properties of undefined (reading '0')」）。
    function fakeEl() {
      const el = { style: {}, classList: { add(){}, remove(){} }, children: [], textContent: '' };
      Object.defineProperty(el, 'innerHTML', {
        set(v) { const m = /^<div foo="([\s\S]*)">$/.exec(v);
          el.children = [{ getAttribute: () => (m ? m[1].replace(/&quot;/g, '"') : null) }] },
        get() { return '' }
      });
      return el;
    }
    global.window = global;
    global.document = { createElement: fakeEl, querySelector: () => null,
                        addEventListener(){}, getElementById: () => null };
    let VVue = null;
    try { (0, eval)(fs.readFileSync(vuePath, 'utf8')); VVue = global.Vue } catch (e) {
      bad('闸门⑮ 加载 vendored Vue 失败', e.message);
    }
    if (VVue) {
      const tplErrs = [], tpls = [];
      const bareComputed = [];
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        // 读模块状态的 computed 必须包 live()：S / MISSED 不是响应式的，computed 没依赖就永远缓存，
        // 症状是「数据变了视图不动」（实测：删光剪贴板后首页横幅不消失）。唯一允许的直接 computed
        // 是 tick 源本身。取后窗口 80 字符判 V.tick：computed 的箭头体里括号嵌套，正则匹不出平衡括号。
        const code = stripComments(src);
        for (let i = code.indexOf('computed('); i >= 0; i = code.indexOf('computed(', i + 1)) {
          const win = code.slice(i, i + 80);
          if (!/V\.tick/.test(win)) bareComputed.push(path.relative(root, f) + '：' + win.replace(/\s+/g, ' ').slice(0, 56))
        }
        for (const m of src.matchAll(/template: `([\s\S]*?)`\n\}/g)) {
          tpls.push([path.relative(root, f), m[1]]);
          try { VVue.compile(m[1]) } catch (e) { tplErrs.push(path.relative(root, f) + '：' + e.message) }
        }
      }
      if (tplErrs.length) bad('闸门⑮ Vue 模板编译不过', tplErrs.join(' | '));
      else if (!tpls.length) bad('闸门⑮ 一个 Vue 模板也没扫到（视图文件改名了？）');

      // 模板里的 @click / @input / v-on: 函数名 ⊆ 导出表（闸门①(a) 的 Vue 版）
      const appSrc = read('go/ui/js/app.js');
      const table = new Set(exportTableKeys(appSrc));
      const miss = new Set();
      for (const [, t] of tpls) {
        for (const m of t.matchAll(/(?:@|v-on:)(click|input|change|submit)="\s*(?:H\.)?([A-Za-z_$][\w$]*)\s*[(\[]/g))
          if (!table.has(m[2])) miss.add(m[2]);
      }
      // 注册表：app.js 的 var VUE_VIEWS = { notes: NotesView } 是唯一开关
      const reg = /var VUE_VIEWS = \{([^}]*)\}/.exec(appSrc);
      const views = reg ? [...reg[1].matchAll(/(\w+)\s*:\s*(\w+)/g)].map(m => ({ tab: m[1], comp: m[2] })) : [];
      const tickErrs = [];
      if (!reg) tickErrs.push('app.js 里找不到 var VUE_VIEWS = {…} 注册表');
      for (const v of views) {
        const f = viewFiles.find(p => new RegExp('export const ' + v.comp + '\\b').test(fs.readFileSync(p, 'utf8')));
        if (!f) { tickErrs.push(v.tab + '：注册表里的 ' + v.comp + ' 在 js/ 下找不到定义'); continue }
        const src = fs.readFileSync(f, 'utf8');
        const tpl = /template: `([\s\S]*?)`\n/.exec(src);
        if (!/V\.tick/.test(src)) tickErrs.push(v.tab + '：视图没读 V.tick（render() 后视图不会动，静默失效）');
        if (tpl) {
          const noTick = [...tpl[1].matchAll(/<([a-z][\w-]*-[\w-]+)\b([^>]*)>/g)]
            .filter(m => !/:tick="tick"/.test(m[2])).map(m => m[1]);
          if (noTick.length) tickErrs.push(v.tab + '：子组件没收 :tick="tick"（props 不变 → 子组件不重渲染）：' + noTick.join(' '));
        }
      }
      if (bareComputed.length)
        bad('闸门⑮ 组件里的 computed 没包 live()（数据变了视图不动）', bareComputed.join(' | '));
      else if (miss.size) bad('闸门⑮ 模板里的 handler 不在导出表（点了没反应）', [...miss].join(' '));
      else if (tickErrs.length) bad('闸门⑮ Vue tick 依赖断了', tickErrs.join(' | '));
      else {
        const names = new Set();
        for (const [, t] of tpls)
          for (const m of t.matchAll(/(?:@|v-on:)(?:click|input|change|submit)="\s*(?:H\.)?([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
        ok('闸门⑮ Vue 模板 ' + tpls.length + ' 个编译通过；注册表 ' + views.length
          + '  视图的 tick 链完整；模板 handler ' + names.size + ' 个全在导出表');
      }
    }
  }
}

// ---------- 输出 ----------
for (const s of oks) console.log('ok   ' + s);
for (const s of fails) console.log('FAIL ' + s);
process.exit(fails.length ? 1 : 0);
