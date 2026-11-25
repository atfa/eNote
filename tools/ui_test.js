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
// setHost({...}) 的键：name: value 与 get name() 两种写法都算。
function setHostKeys(src) {
  const i = src.indexOf('setHost({');
  if (i < 0) return [];
  let d = 0, j = i + 8, k = j;
  for (; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) break }
  }
  const body = src.slice(j + 1, k).replace(/\/\*[\s\S]*?\*\//g, '');
  const keys = [];
  for (const m of body.matchAll(/(?:^|[,{])\s*(?:get\s+)?([A-Za-z_$][\w$]*)\s*[(:]/g)) keys.push(m[1]);
  return keys;
}

function exportTableBody(src) {
  const m = /window\.__enoteActions\s*=\s*\{/.exec(src);
  if (!m) return null;
  let depth = 0, end = -1;
  for (let i = m.index + m[0].length - 1; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { end = i; break; }
  }
  if (end < 0) return 'UNCLOSED';
  return src.slice(m.index + m[0].length, end);
}

function exportTableKeys(src) {
  const body = exportTableBody(src);
  if (body === null || body === 'UNCLOSED') return body;
  const keys = new Set();
  for (const part of splitTopLevel(body, ',')) {
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
//
// 步骤 11 把基线从 70 降到 73 的实测值：迁移期同一个按钮在「遗留字符串渲染器」和
// 「Vue 模板」里各写一份，闸门把两份都数进去，所以 88 这个数是虚高的；遗留渲染器删完
// 只剩 73（内联 30 + 模板 43），这才是「界面上真有的控件数」。基线跟着降到 73 ——
// 它守的是「迁移时整条控件被丢掉」，虚高的基线会让这一步永远红，而红一次就没人看了。
const HANDLER_BASELINE = 73;   // 步骤 11 删光遗留渲染器后的实测值（内联 30 + Vue 模板 43）
const total = handlerCount + vueCount;
if (STRICT && total < HANDLER_BASELINE) {
  bad('handler 总数从 ' + HANDLER_BASELINE + ' 掉到 ' + total
    + '（内联 ' + handlerCount + ' + Vue 模板 ' + vueCount + '）',
    '迁移视图时整条控件被丢掉是静默的：老 handler 删了，新模板里那一条没写上');
} else if (STRICT) {
  ok('handler 总数 ' + total + '（内联 ' + handlerCount + ' + Vue 模板 ' + vueCount
    + '）≥ 基线 ' + HANDLER_BASELINE + (vueCount ? '，Vue 模板部分已解析' : '，尚无 Vue 模板'));
}

// ---------- 闸门①d handler 字符串参数（步骤 10）----------
// 我的页的行是 liHTML('settings','设置','…','settingsSheet()')：handler 作为**字符串参数**
// 传给叶子函数，最后拼成 onclick。闸门① 只扇 onclick="…" 字面量，扇不到这种写法：
// 转 module（步骤 2）后 settingsSheet / scanShotsNow / rescanShots / clearShots 四个名字
// 不再是全局，我的页上那四行点了就是 ReferenceError，而闸门与签名全绿。
// 本闸门扇「整串就是一个调用」的字符串字面量，名字必须在导出表里（= 在 window 上）。
const handlerArgRe = /(['"`])\s*((?:[A-Za-z_$][\w$]*)\s*\([^'"`]*\))\s*\1/g;
const argMissing = new Map();
let argCount = 0;
for (const [f, src] of jsSources) {
  for (const m of src.matchAll(handlerArgRe)) {
    const name = m[2].match(/^([A-Za-z_$][\w$]*)/)[1];
    argCount++;
    if (BUILTIN.has(name) || domain.has(name)) continue;
    argMissing.set(name + '@' + f, (argMissing.get(name + '@' + f) || 0) + 1);
  }
}
if (argMissing.size) {
  bad('handler 字符串参数调了导出表里没有的函数（点了没反应）',
    [...argMissing].map(([k, v]) => k + '×' + v).join(', '));
} else {
  ok('handler 字符串参数 ' + argCount + ' 处全部能在导出表里解析');
}

// ---------- 闸门①e 导出表的右值必须是 app.js 里真存在的名字（步骤 10）----------
// 闸门① 只查「handler 名 ⊆ 导出表 key」，表体里那个值的右值没人查。步骤 10 的
// exportJSON 就是这么漏过去的：表里写了 `exportJSON,`，而 app.js 里从来没定义过这个函数
// —— module 求值到那一行就抛 ReferenceError，整页 JS 死在首屏（真机症状：页面全白，
// 静态闸门与签名全绿）。这条把整类封掉：凡右值是裸标识符的，必须有声明。
function declaredNames(src) {
  const s = new Set();
  // 注释里出现的 function X 也会被收进来：本集合只用来宽免，宽一点只会漏报不会误报。
  for (const re of [
    /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*(?:export\s+)?(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g
  ]) for (const m of src.matchAll(re)) s.add(m[1]);
  // import 的本地名：import { a, b as c } / import d from / import * as ns from
  for (const m of src.matchAll(/(?:^|\n)\s*import\s+([^'";]*?)\s*from\s*['"]/g)) {
    for (const sp of m[1].split(/[{},]/)) {
      const parts = sp.trim().split(/\s+as\s+/);
      const local = (parts[parts.length - 1] || '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(local)) s.add(local);
    }
  }
  // 顶层解构：const { a, b: c } = … / const [a, b] = …
  for (const m of src.matchAll(/(?:^|\n)\s*(?:var|let|const)\s*[{[]([^\]}]*)[\]}]\s*=/g)) {
    for (const sp of m[1].split(',')) {
      const local = sp.trim().split(':').pop().trim().replace(/^\.\.\./, '');
      if (/^[A-Za-z_$][\w$]*$/.test(local)) s.add(local);
    }
  }
  return s;
}
if (table instanceof Set) {
  const declared = declaredNames(uiCode);
  const body = exportTableBody(uiCode).replace(/\/\*[\s\S]*?\*\//g, '');
  const undef = [];
  for (const part of splitTopLevel(body, ',')) {
    const p = part.trim();
    let v = null;
    const short = p.match(/^([A-Za-z_$][\w$]*)$/);                    // 简写 { api }
    if (short) v = short[1];
    else {
      const kv = p.match(/^['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*([A-Za-z_$][\w$]*)$/);  // { api: api }
      if (kv) v = kv[2];
    }
    // 右值是箭头函数 / 字符串 / 模板的不在本闸门范围（求值期不会抛 ReferenceError）
    if (v && !declared.has(v)) undef.push(v);
  }
  if (undef.length) {
    bad('导出表右值调了 app.js 里没声明的名字（module 求值就抛，整页 JS 死在首屏）：'
      + undef.join(', '), '表体是求值期代码：少一个函数定义 = 整页白屏，不是那一个按钮失灵');
  } else {
    ok('导出表 ' + table.size + ' 个成员的右值全部有声明（表体是 module 求值期）');
  }
}

// ---------- 闸门①c 组件必须真的会重绘（响应式读状态的前提）----------
// 组件不持有数据、直接读模块状态（S/SR/P()/open）。步骤 17e 起这些容器是 reactive 的，
// 读它们的 computed() 就是重绘触发源；步骤 17l 删掉了 tick prop 管道，视图里连 tick
// 这个字都不该再出现。渲染路径没读到任何响应式依赖的话，点了删除 → 数据换了 → 视图
// 一动不动，而且不报错。这条是响应式渲染的存在前提，必须静态钉住。
const viewFiles = jsSources.filter(([f]) => /(^|\/)views\/[\w-]+\.js$/.test(f));
if (viewFiles.length) {
  const noTick = viewFiles.filter(([, s]) => !/computed\s*\(/.test(s)).map(([f]) => f);
  if (noTick.length) {
    bad('Vue 视图文件里没有一个 computed()：' + noTick.join(', '),
      '模块状态只有经 computed() 读才会被追踪，直接读 = 渲染期不订阅（点了没反应，且不报错）');
  } else {
    ok('Vue 视图 ' + viewFiles.length + ' 个，渲染路径都走 computed()（重绘有触发源）');
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

// 闭集：载荷能碰到的页面全局。函数 11 个（步骤 2 导出表里测试用得着的那批）
// + 状态 10 个（只能以 __enote.state.X 出现，裸名就是假绿）。
// SR 是步骤 5 加的：notesFiltered() 第一优先级读它，夹具不暴露它就画不出笔记空态。
// folderFilter 是步骤 8 加的：选文件夹页的搜索框过滤要在 Vue 路径上真跑一次。
const CLOSED_FN = ['api', 'refresh', 'render', 'missedDismiss', 'missedSheet', 'folderPick',
  'folderSave', 'folderSheet', 'shotPick', 'shotSheet', 'folderFilter', 'closeSheet',
  // 步骤 8：进度层的入口/出口（测试直接调它们，比等一次真 AI 导入稳定）
  'shotOverlay', 'shotOvlSub',
  // 步骤 9：剪贴板页交互用例的入口（其余动作靠真点击 .clipitem / 按钮，不调函数）
  'clipSheet',
  // 步骤 13：待办页筛选三态用例。sortSheet 是排序筛选面板的入口（seg 按钮在面板里，
  // 要点「全部 / 已完成」就得先开面板），resetPrefs 是用例末尾的复原（不恢复默认筛选
  // 会改变后面所有用例看到的列表）。两者都是导出表里的 DOM handler。
  'sortSheet', 'resetPrefs',
  // 步骤 10 的 settingsSheet 在步骤 11 移出闭集：设置页交互用例是从「我的」页真点
  // 「设置」那一行进来的（比直接调函数强），VDIFF 的 settings 那一遍（唯一调它的载荷）
  // 随遗留基准一起删。闭集里留着没人引用的名字会让闸门② 认不出「改名」，所以要同步缩小。
  ];
const STATE_NAMES = ['tab', 'S', 'MISSED', 'open', 'shotSel', 'shotList', 'SR',
  // 步骤 8：文件夹页夹具要整体注入 folderAll/folderSel/folderQ（闭合集 17 → 20，
  // 与 app.js 的 __enote.state、go/web_test.go 的名单三处同步）。
  // 步骤 9 再加 CLIPS / clipSel（闭合集 20 → 22）：剪贴板页夹具走真钩子，但交互用例
  // 要读这两个名字断言勾选态。
  'folderAll', 'folderSel', 'folderQ', 'clipList', 'clipSel',
  // 步骤 10 加 ST（闭合集 22 → 23）：我的页 / 设置页的夹具要注入 /api/stats 的返回，
  // 没 setter 就是 D21 那个坑（赋值只写 window，模块里的 ST 一动不动）。
  'ST'];
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

// 两种写法都要扫：老的是 python -c '…sys.argv[1]…' '<js>' > "$TMPDIR/x.json"，
// 新的是 heredoc 里 js = r'''…'''（截图页 / 笔记页交互用例）。只扫前一种时 heredoc
// 载荷里的全局名完全不在闸门视野里 —— 闭集加了新名字却报「没人引用」就是这种漏网。
const jsevalPayloads = [...testSh.matchAll(/sys\.argv\[1\][^\n]{0,80}?\}\)\)'[ \t]*(?:\\\n)?[ \t]*'([\s\S]*?)' > "\$TMPDIR\/[a-z]+\.json"/g)]
  .map(m => m[1])
  .concat([...testSh.matchAll(/js = r'''([\s\S]*?)'''/g)].map(m => m[1]));
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
  const notExported = table instanceof Set
    ? CLOSED_FN.filter(n => !table.has(n)) : ['(导出表没解析出来，闸门② 在假绿)'];
  // 顺序有讲究：裸状态名先报。它同时也是「闭集外」，但只说「闭集外」会把人往
  // 「新增要改闸门」的方向带，而真正的坑是「写到 window 上、模块没动」这种假绿。
  if (bareStateAll.length) bad('载荷里裸写了状态名', bareStateAll.join(', ') + '：裸名是往 window 上写，模块里的 ' + bareStateAll[0].split('@')[0] + ' 一动不动（假绿），要走 __enote.state.' + bareStateAll[0].split('@')[0]);
  else if (extra.length) bad('jseval 载荷引用了闭集外的全局名', extra.join(', ') + `（闭集 = 函数 ${CLOSED_FN.length} 个 + 状态 ${STATE_NAMES.length} 个走桥，新增要同步改闸门②）`);
  else if (unused.length) bad('闭集里有名字没人引用了', unused.join(', ') + '（闭集要同步缩小，否则改名后闸门② 查不出来）');
  // 闭集里的名字必须在导出表里真的存在。闸门② 以前只做两向检查（载荷引用 ⊆ 闭集、
  // 闭集 ⊆ 引用），从不和闸门① 解析出的导出表求交 —— 「闭集里写了个导出表没有的名字」
  // 正好落在盲区：静态全绿，真机上 ReferenceError（步骤 13 的 sortSheet：它是
  // $('#sortBtn').onclick = sortSheet 挂上去的，不是内联 handler，闸门① 从来不管它）。
  else if (notExported.length) bad('闭集里的函数不在导出表里（jseval 载荷调它就是 ReferenceError）',
    notExported.join(', ') + '：闸门① 只查内联 handler，onclick 之外挂上去的函数要手动进 __enoteActions');
  else if (renderCalls !== renderAwaited) bad('载荷里的 render 没全部 await', renderAwaited + '/' + renderCalls + '：render() 的契约是 Promise（D13），不 await 就断言不到新 DOM；包装也得是 async function');
  else ok('jseval 载荷 ' + jsevalPayloads.length + ' 个：引用全局名 == 闭集（函数 ' + CLOSED_FN.length
    + ' 个全在导出表）+ 状态 6 个全走 __enote.state + render ' + renderCalls + ' 处全部 await');
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
  hex: 0,    // tokens.css 之外的裸 hex。tokens.css 自已是调色板定义，那 55 处必须是字面值，
             // 把它们算进棘轮会把信号淡掉：新增一个硬编码颜色被新增一个 token 抵消就查不出来。
             // 62（拆分前全量）→ 12（只统计 tokens.css 之外）→ 8（--teal 从 fallback 转正）
             // → 0（步骤 13：#fff 7 处收进 --on-solid，#000 1 处收进 --mask-opaque）。
  px: 0,     // 刻度相关属性里的裸 px：391 →（密度 10px→8px）341 →（stats/settings）292
             // →（base/components 全量迁移）57 → 0（步骤 13：css 57 + js 内联 style 48 全部上刻度，
             // 9px / 11px / 13.5px 这些刻度外的值就近归档，映射表在 tokens.css 顶部）。
};
const cssFiles = SPLIT
  ? walkDirPairs(path.join(uiDir, 'css'), 'css/')
  : [['ui.html', (ui.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1]]];
const cssText = cssFiles.map(x => x[1]).join('\n');
const cssBody = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
const leakBody = cssFiles.filter(x => !/tokens\.css$/.test(x[0])).map(x => x[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
function count(re, s) { const m = s.match(re); return m ? m.length : 0; }
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const SCALE_RE = /(?:margin|padding|gap|border-radius|font-size)[^;{}"']*/g;
/* 步骤 13：扫描范围从 css/** 扩到 js/** 的内联 style。Vue 模板把结构搬进 js 之后，
   新样式越来越多直接写在 style="…" 里，旧闸门只看 css/** 就完全看不见它们 ——
   闸门还在、账本已经不管这一页。只抽 style="…" 的内容，不整扫 js：整扫会把
   $('#fab') 这种选择器当成颜色（实测假阳性 #fab），把信号淡掉。vendor 的 vue.js 不参与。 */
const jsStyleSrc = SPLIT
  ? walkJs(uiDir).filter(x => !/vue\.js$/.test(x[0])).map(x => x[1]).join('\n')
  : '';
const jsInline = (jsStyleSrc.match(/(?::?style)="([^"]*)"/g) || []).join('\n');
const jsHex = count(HEX_RE, jsInline);
const jsPx = count(/\d+px\b/g, (jsInline.match(SCALE_RE) || []).join('\n'));
const hexCount = count(HEX_RE, leakBody) + jsHex;
const hexTokens = count(/#[0-9a-fA-F]{3,8}\b/g, cssFiles.filter(x => /tokens\.css$/.test(x[0])).map(x => x[1]).join('\n'));
const scaleDecls = (cssBody.match(SCALE_RE) || []).join('\n');
const pxCount = count(/\d+px\b/g, scaleDecls) + jsPx;
if (!SPLIT) bad('闸门③ 没扫到 js 内联 style', '扫描范围失效了，闸门③ 自己在假绿');
else if (jsInline.indexOf('var(--') < 0) bad('闸门③ js 内联 style 里一个 var(-- 也没有', '抽 style="…" 的正则失效了，闸门③ 在假绿');
if (hexCount > RATCHET.hex) bad('裸 hex 比基线多了', hexCount + ' > ' + RATCHET.hex + '，新样式必须用 token（css 外 js 内联另有 ' + jsHex + ' 处）');
else ok('裸 hex ' + hexCount + ' ≤ 基线 ' + RATCHET.hex + '（tokens.css 内 ' + hexTokens + ' 处定义不计；js 内联 ' + jsHex + ' 处已计入）');
if (pxCount > RATCHET.px) bad('裸 px 比基线多了', pxCount + ' > ' + RATCHET.px + '，新样式必须用 --s*/--r*/--fs-*（css 外 js 内联另有 ' + jsPx + ' 处）');
else ok('裸 px ' + pxCount + ' ≤ 基线 ' + RATCHET.px + '（含 js 内联 style ' + jsPx + ' 处）');

// ---------- 闸门④ 调色板 5 处必须一致 ----------
// 同一套背景色今天写在 5 个地方，改一处漏四处就是状态栏和页面颜色不一致。
const bgLight = (cssText.match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [, ''])[1].toLowerCase();
const darkBlock = cssText.match(/html\[data-theme=dark\]\s*\{([\s\S]*?)\}/) || [, ''];
const bgDark = (darkBlock[1].match(/--bg:\s*(#[0-9a-fA-F]{3,8})/) || [, ''])[1].toLowerCase();
const themeJava = read('src/dev/xduo/enote/Theme.java');
const jLight = (themeJava.match(/BG_LIGHT\s*=\s*0xFF([0-9a-fA-F]{6})/) || [, ''])[1].toLowerCase();
const jDark = (themeJava.match(/BG_DARK\s*=\s*0xFF([0-9a-fA-F]{6})/) || [, ''])[1].toLowerCase();
const meta = (ui.match(/<meta\s+name="theme-color"\s+content="(#[0-9a-fA-F]{3,8})"/) || [, ''])[1].toLowerCase();
/* 步骤 13：app.js 切主题时会把 meta theme-color 改成字面量（状态栏跟着变），那是第 6 处
   调色板副本。棘轮把 js 内联 style 的 hex 清零了，这两个是调色板定义本身（不是样式值），
   所以不靠棘轮管，靠这里逐字比；找不到那句就报「闸门在假绿」，不许静默空跑。 */
const jsTheme = read('go/ui/js/app.js');
const jsThemeColors = jsTheme.match(/mc\.setAttribute\('content',\s*t === 'dark' \? '(#[0-9a-fA-F]{6})' : '(#[0-9a-fA-F]{6})'/) || [, '', ''];
const pal = [];
if (!bgLight) pal.push('tokens 里找不到亮色 --bg');
if (!bgDark) pal.push('tokens 里找不到暗色 --bg');
if (!jsThemeColors[1]) pal.push("app.js 里找不到 meta theme-color 的切换语句（闸门④ 在假绿）");
else {
  if (jsThemeColors[1].toLowerCase() !== bgDark) pal.push('app.js 暗色 theme-color ' + jsThemeColors[1] + ' ≠ --bg ' + bgDark);
  if (jsThemeColors[2].toLowerCase() !== bgLight) pal.push('app.js 亮色 theme-color ' + jsThemeColors[2] + ' ≠ --bg ' + bgLight);
}
if (jLight && bgLight && '#' + jLight !== bgLight) pal.push('Theme.java BG_LIGHT=#' + jLight + ' ≠ --bg ' + bgLight);
if (jDark && bgDark && '#' + jDark !== bgDark) pal.push('Theme.java BG_DARK=#' + jDark + ' ≠ --bg ' + bgDark);
if (meta && bgLight && bgDark && meta !== bgLight && meta !== bgDark) pal.push('meta theme-color ' + meta + ' 两个 --bg 都不是');
if (pal.length) bad('调色板一致性被破坏', pal.join('；'));
else ok('调色板一致：--bg ' + bgLight + '/' + bgDark + ' = Theme.java = meta theme-color = app.js 切换值');

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
  /* 层叠顺序的同一类问题，步骤 18a：vendored vant.css 带三条全局规则
     （a{text-decoration:none}、input,button,textarea{color:inherit;font:inherit}、
     ol,ul{margin:0;padding:0;list-style:none}），它在我们的 CSS 之前加载，平手时后写的赢。
     base.css 里那两条「写回现状」是 18a 像素零变化的前提（真机 computed style 逐字节比对：
     4 页 + 设置弹层、20 个选择器 × 13 个属性），删掉它们 = 顶栏/底栏/fab/搜索框的字形与行高静默变。 */
  const baseCss = fs.readFileSync(path.join(uiDir, 'css/base.css'), 'utf8');
  const html = fs.readFileSync(path.join(uiDir, 'index.html'), 'utf8');
  const van = [];
  if (!/^button,input,textarea\{font-family:Arial;line-height:normal\}/m.test(baseCss))
    van.push('base.css 缺 button,input,textarea{font-family:Arial;line-height:normal}');
  if (!/^a\{text-decoration:underline\}/m.test(baseCss))
    van.push('base.css 缺 a{text-decoration:underline}');
  if (html.indexOf('/vendor/vant.css') < 0 || html.indexOf('/vendor/vant.css') > html.indexOf('/css/tokens.css'))
    van.push('index.html 的 /vendor/vant.css 必须在我们的 CSS 之前');
  if (van.length) bad('Vant 全局样式中和失效（像素会变）', van.join(' | '));
  else if (flips.length) bad('CSS 拆分造成层叠顺序翻转', flips.slice(0, 6).join('；'));
  else ok('CSS 拆分无新增层叠冲突（基线内 ' + CASCADE_BASELINE.size + ' 条，共 ' + bySelector.size
    + ' 个选择器）；Vant 的三条全局规则已被 base.css 写回现状（真机 computed style 逐字节比对过）');
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
  /* vendor 的 CSS 也是定义方：Vant 在 :root 里定义了 2557 个 --van-*，我们映射表里
     引用它们（var(--van-text-color) 这类）不是笔误，是消费它的默认值。
     只补进 defined（认它定义过），不补进 used（不拿它的使用情况算我们的闲置 token）。 */
  for (const f of fs.readdirSync(path.join(uiDir, 'vendor'), { withFileTypes: true })) {
    if (!/\.css$/.test(f.name)) continue;
    const src = fs.readFileSync(path.join(uiDir, 'vendor', f.name), 'utf8');
    for (const m of src.matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]);
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
  /* vendor 的 CSS 也算「用的人」：步骤 18b 起 tokens.css 里那张 Vant 映射表
     （--van-toast-*）的消费方就是 vendor/vant.css —— 只扫自己人会把它报成闲置 token。
     它只进 used，不进 defined：Vant 自己那 2557 个 --van-* 定义不算我们的刻度。 */
  const vdir = path.join(uiDir, 'vendor');
  for (const f of fs.readdirSync(vdir, { withFileTypes: true })) {
    if (!/\.css$/.test(f.name)) continue;
    const src = fs.readFileSync(path.join(vdir, f.name), 'utf8');
    for (const m of src.matchAll(/var\((--[\w-]+)/g)) used.add(m[1]);
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
      /* 步骤 17h：live() 已删。所有 computed 一律裸写，靠真依赖追踪；
         再出现 live( 就是退回「靠 V.tick 全量失效」的老路（每次 render 全量重算），直接红。
         另一半契约：computed 的体不许只返回容器本身（computed(() => H.FA)）——
         原地改键时值没变，Vue 判定「没变化」跳过渲染，症状是「数据变了视图不动」。 */
      const viewCode = new Map();   // 视图文件 → 注掉后的代码（下面 H.xxx 全量扫要用）
      /* 只查「原地改键」那批容器（reassign / 逐键赋值）；ST / MISSED / SHOTFLAGS / LOGDATA /
         DEBUGDATA 是 {v:} 容器且整包赋值，每次都是新对象，返回它本身没问题。 */
      const CONTAINER_GETTERS = new Set(['S', 'SR', 'FA', 'prefs', 'SHOTPROG', 'SHOTS', 'CLIP',
        'FOLD', 'open']);
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        const code = stripComments(src);
        viewCode.set(path.relative(root, f), code);
        for (const m of code.matchAll(/\blive\s*\(/g))
          bareComputed.push(path.relative(root, f) + '：还活着一个 live()（17h 已删，用裸 computed）')
        for (const m of code.matchAll(/computed\(\s*(?:\(\)\s*=>|function\s*\(\s*\)\s*\{?)\s*H\.(\w+)\s*\)\s*[,}]/g))
          if (CONTAINER_GETTERS.has(m[1]))
            bareComputed.push(path.relative(root, f) + '：computed 直接返回容器 H.' + m[1] +
              '（原地改键不会让 computed 值变化 → 不重渲染，返回快照）')
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
      // 模板里写 H.foo(...) 的 foo 走 setHost 的宿主对象，裸名 foo(...) 走 window（导出表）。
      // 两条解析路径不同，必须分开判 —— 混在一起时「导出表有、setHost 没有」的函数会绿着抛错，
      // 抛进 render() 的 catch 就静默回退字符串渲染器，Vue 路径一行没跑（步骤 5 实测踩过）。
      const host = new Set(setHostKeys(appSrc));
      const miss = new Set(), missHost = new Set(), usedHost = new Set();
      for (const [, t] of tpls) {
        // 组号：m[1]=事件名（click/input/…，恒真）、m[2]=H. 前缀、m[3]=函数名。
        // 早先写的 (m[1] ? missHost : miss).add(m[2]) 收进去的是「click」这种事件名，
        // 加上下面那行过滤方向反了（删的是「在集合里的」），两条合起来让这条检查恒绿：
        // 反向实验② 实测从 setHost 里删掉模板用到的函数，闸门一点反应没有。
        for (const m of t.matchAll(/(?:@|v-on:)(click|input|change|submit)="\s*(H\.)?([A-Za-z_$][\w$]*)\s*[(\[]/g)) {
          if (VUE_BUILTIN.has(m[3])) continue;   // $emit / $event 这类内建，步骤 10 的 <stats-li> 用 $emit('go')
          (m[2] ? missHost : miss).add(m[3]);
        }
      }
      // setup() 里的 H.xxx 与模板里的走同一个宿主对象，失效方式也一样（抛错 → render()
      // 静默回退字符串渲染器），所以扫整个视图文件而不只是模板：TodoRow 的 H.cbInnerHTML
      // 就写在 setup() 里，只扫模板时它不在闸门视野里。
      for (const [, code] of viewCode) {
        for (const m of code.matchAll(/\bH\.([A-Za-z_$][\w$]*)/g)) { missHost.add(m[1]); usedHost.add(m[1]) }
      }
      // 留下「不在集合里」的（早先方向反了，把在集合里的删掉，于是恒绿）
      for (const n of [...missHost]) if (host.has(n)) missHost.delete(n);
      for (const n of [...miss]) if (table.has(n)) miss.delete(n);
      // 装配本身：模板里的 <x-y> 没在视图的 components: 里注册 → Vue 只当未知自定义元素，
      // prod 构建不报错，整块 DOM 直接没；__enote.vue 没设 → 测试无法断言走了哪条路径。
      // 两条都是「全绿而看不出问题」，所以静态钉住。
      const wiring = [];
      if (!/window\.__enote\.vue\s*=/.test(appSrc)) wiring.push('app.js 没设 window.__enote.vue（测试缝缺失：isVue(tab) 无从断言，VDIFF 比 DOM 区分不了两条路径）');
      // 模板里的自定义元素必须在视图的 components: 里注册：没注册时 Vue 只当未知自定义元素，
      // prod 构建不报错，症状是整块 DOM 直接没（步骤 5 的 <note-card> 就是这么静默掉的）。
      const compSrc = fs.existsSync(path.join(uiDir, 'js/components.js'))
        ? fs.readFileSync(path.join(uiDir, 'js/components.js'), 'utf8') : '';
      const globalComps = new Set([...compSrc.matchAll(/export const (\w+)/g)].map(m => m[1]));
      for (const [f, t] of tpls) {
        const src = fs.readFileSync(path.join(root, f), 'utf8');
        const cm = /components:\s*\{([^}]*)\}/.exec(src);
        const names = new Set(cm ? cm[1].split(',').map(x => x.trim()).filter(Boolean) : []);
        for (const m of t.matchAll(/<([a-z][\w-]*-[\w-]+)\b/g)) {
          const pascal = m[1].replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
          // 只认视图自己的 components: 注册表：全局注册（app.component）这条路径本项目没用，
          // 留着 globalComps 当豁免就会漏掉「导出了但没注册」这一整类（实测 <strip-bar> 就是这么漏的）。
          // 例外：van-* 走 app.use(Vant)（withHost 里一处，上面两条断言在守），不是 app.component。
          if (m[1].indexOf('van-') === 0) continue;
          if (!names.has(pascal))
            wiring.push(f + '：模板用了 <' + m[1] + '> 但视图没在 components: 里注册');
        }
      }
      /* 步骤 17k：宿主接口 H 走 provide/inject。三条契约：
         a) 组件文件不许再 import { H } from vue.js —— 那是「编译期绑死 app.js 那张表」，
            而 H 是 vue.js 里的模块级 let，组件管不到它何时被 setHost 赋值；
         b) setup 里出现 H 就必须先 inject('H') —— 漏了是 ReferenceError，整模块不执行
            （页面白屏，静态闸门以前全看不见）；
         c) 三个挂载点（mountView / mountSheet / shell.js 的 mount）必须 withHost(app) ——
            漏了 inject 拿到 undefined，模板里 H.xxx 全炸。 */
      for (const f of viewFiles) {
        const rel = path.relative(root, f);
        const code = stripComments(fs.readFileSync(f, 'utf8'));
        if (/\bimport\s*\{[^}]*\bH\b[^}]*\}\s*from/.test(code))
          wiring.push(rel + "：还 import 着 H（步骤 17k：组件里 inject('H')，宿主由 withHost(app) 提供）");
        for (const chunk of code.split(/\n(?=export const )/)) {
          const si = chunk.indexOf('setup(');
          if (si < 0) continue;
          let seg = chunk.slice(si);
          const ti = seg.search(/\n\s*template:/);
          if (ti > 0) seg = seg.slice(0, ti);
          if (/\bH\b/.test(seg) && !/inject\(\s*'H'\s*\)/.test(seg))
            wiring.push(rel + "：setup 用了 H 但没 inject('H')（模块级 H 已删，这是 ReferenceError）");
        }
      }
      /* 步骤 17l 的教训：脚本删 tick 管道时把 V 从 app.js 的 import 里摘了，而宿主对象里
         还写着 `V: V` —— 整模块 ReferenceError、页面白屏，静态闸门全绿，真机才拓到。
         反向实验：删掉 app.js import 里的 V，闸门必红。 */
      for (const [f, src0] of jsSources) {
        const rel = path.relative(root, f);
        if (/vue\.js$/.test(f)) continue;
        const code = stripComments(src0);
        const importsV = /import\s*\{[^}]*\bV\b[^}]*\}\s*from\s*['"][^'"]*vue\.js/.test(code);
        const usesV = /(?<![\w.$'"])V\s*[.,]/.test(code) || /[{,]\s*V\s*[,}]/.test(code);
        if (usesV && !importsV)
          wiring.push(rel + "：代码里用 V 却没从 vue.js import 它（模块加载就 ReferenceError，整页白屏）");
      }
      const vueSrc = fs.readFileSync(path.join(uiDir, 'js/vue.js'), 'utf8');
      const shellSrc = fs.readFileSync(path.join(uiDir, 'js/shell.js'), 'utf8');
      for (const [fn, id] of [['mountView', "'view:' + tab"], ['mountSheet', "'sheet:' + name"]]) {
        const m = new RegExp('export function ' + fn + '[\\s\\S]*?app\\.mount').exec(vueSrc);
        if (!m || !/withHost\(app[,)]/.test(m[0]))
          wiring.push('vue.js ' + fn + " 没 withHost(app, …)（组件 inject('H') 会拿到 undefined）");
        else if (!m[0].includes('hostFor(' + id + ')'))
          wiring.push('vue.js ' + fn + ' 的宿主没按 ' + id + ' 收窄（步骤 17m：每个 app 只拿自己那棵树的 key）');
      }
      {
        const mm = /function mount\(id, def\)[\s\S]*?app\.mount/.exec(shellSrc);
        if (!mm || !/withHost\(app[,)]/.test(mm[0]))
          wiring.push("shell.js 的 mount 没 withHost(app, …)（外壳树与 <teleport> 里的进度层拿不到宿主）");
        else if (!mm[0].includes("hostFor('shell:' + id)"))
          wiring.push("shell.js 的 mount 没按 shell:<容器 id> 收窄宿主（步骤 17m）");
      }
      /* 步骤 18a：Vant 的注册在 withHost 里一处，三个挂载点全过它。 */
      if (!/app\.use\(Vant\)/.test(vueSrc))
        wiring.push('vue.js 的 withHost 没 app.use(Vant)（van-* 组件全部解析不到）');
      if (!/window\.vant/.test(vueSrc))
        wiring.push('vue.js 没取 window.vant（Vant 的 UMD 全局名是小写 vant）');
      /* 步骤 17m：宿主按 app 收窄。app.js 的 HOST_KEYS 逐 app 列出那棵组件树读到的 key，
         三个方向都查（都反向验证过）：
           a) 表里的 key 必须真在 setHost 的宿主对象上 —— 拼错的 key 运行时是 undefined；
           b) 组件树里读到的 H.xxx 必须在表里 —— 漏一个就是那一片渲染成空；
           c) 表里不许列这棵树没读的 key，表里也不许有没挂载点的 app —— 表是依赖清单，
              白列 = 清单在骗人。
         组件树 = 从 app 根出发沿 components: { A, B } 的传递闭包（与闸门㉔ 同源）。 */
      function parseHostKeys(src) {
        const i = src.indexOf('var HOST_KEYS = {');
        if (i < 0) return null;
        let d = 0, j = src.indexOf('{', i), k = j;
        for (; k < src.length; k++) {
          if (src[k] === '{') d++;
          else if (src[k] === '}') { d--; if (!d) break }
        }
        const body = src.slice(j + 1, k).replace(/\/\*[\s\S]*?\*\//g, '');
        const out = new Map();
        for (const m of body.matchAll(/'([\w:]+)':\s*\[([^\]]*)\]/g))
          out.set(m[1], m[2].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean));
        return out;
      }
      const hostKeys = parseHostKeys(appSrc);
      if (!hostKeys) wiring.push('app.js 没有 var HOST_KEYS = {（步骤 17m：宿主收窄表）');
      else {
        const compKids = new Map(), compKeys = new Map();
        for (const [f, src0] of jsSources) {
          if (/vue\.js$/.test(f)) continue;
          for (const chunk of src0.split(/\n(?=export const )/)) {
            const m = /^export const (\w+)/.exec(chunk);
            if (!m) continue;
            const code = stripComments(chunk);
            const cm = /components:\s*\{([^}]*)\}/.exec(code);
            compKids.set(m[1], cm ? cm[1].split(/[,\s]+/)
              .map(s => s.replace(/[^A-Za-z0-9_$]/g, '')).filter(s => /^[A-Z]/.test(s)) : []);
            compKeys.set(m[1], new Set([...code.matchAll(/\bH\.(\w+)/g)].map(x => x[1])));
          }
        }
        const roots = new Map();
        const vm = /var VUE_VIEWS = \{([^}]*)\}/.exec(appSrc);
        const sm = /var VUE_SHEETS = \{([\s\S]*?)\};/.exec(appSrc);
        for (const grp of [vm, sm]) if (grp) for (const e of grp[1].split(',')) {
          const p = e.split(':');
          if (p.length === 2) roots.set((grp === vm ? 'view:' : 'sheet:') + p[0].trim(), p[1].trim());
        }
        for (const m of shellSrc.matchAll(/mount\('(\w+)',\s*(\w+)\)/g)) roots.set('shell:' + m[1], m[2]);
        for (const [appId, r] of roots) {
          const seen = new Set(), stack = [r];
          while (stack.length) {
            const n = stack.pop();
            if (seen.has(n)) continue;
            seen.add(n);
            for (const c of (compKids.get(n) || [])) stack.push(c);
          }
          const need = new Set();
          for (const n of seen) for (const k of (compKeys.get(n) || [])) need.add(k);
          const declared = hostKeys.get(appId);
          if (!declared) {
            wiring.push(`HOST_KEYS 表里没有 ${appId}（这个 app 拿到全量宿主，收窄失效）`);
            continue;
          }
          const D = new Set(declared);
          const miss = [...need].filter(k => !D.has(k));
          if (miss.length)
            wiring.push(`HOST_KEYS['${appId}'] 少了 ${miss.join(', ')}（${r} 那棵树读它，运行时是 undefined、那一片渲染成空）`);
          const extra = [...D].filter(k => !need.has(k));
          if (extra.length)
            wiring.push(`HOST_KEYS['${appId}'] 列了 ${r} 那棵树没读的 ${extra.join(', ')}`);
          for (const k of D) if (!host.has(k))
            wiring.push(`HOST_KEYS['${appId}'] 的 ${k} 不在 setHost 宿主对象上（narrowHost 只能给 undefined）`);
        }
        for (const appId of hostKeys.keys())
          if (!roots.has(appId)) wiring.push(`HOST_KEYS 表里的 ${appId} 没有对应挂载点（表在骗人）`);
      }
      if (wiring.length) bad('闸门⑮ Vue 装配缺失', wiring.join(' | '));
      // 注册表：app.js 的 var VUE_VIEWS = { notes: NotesView } 是唯一开关
      const reg = /var VUE_VIEWS = \{([^}]*)\}/.exec(appSrc);
      const views = reg ? [...reg[1].matchAll(/(\w+)\s*:\s*(\w+)/g)].map(m => ({ tab: m[1], comp: m[2] })) : [];
      // 步骤 8：弹层（sheet）是第二张注册表 VUE_SHEETS，tick 链规则一模一样。弹层不走
      // render()（它只画 tab pane），靠 app.js 的 handler 调 sheetPaint() bump tick；
      // 注册表里缺一个条目 = 那个弹层永远走遗留路径（静默），模板里的 :tick 全没人查。
      const sreg = /var VUE_SHEETS = \{([^}]*)\}/.exec(appSrc);
      const sheets = sreg ? [...sreg[1].matchAll(/(\w+)\s*:\s*(\w+)/g)].map(m => ({ tab: m[1] + '(弹层)', comp: m[2] })) : [];
      const tickErrs = [];
      if (!reg) tickErrs.push('app.js 里找不到 var VUE_VIEWS = {…} 注册表');
      if (!sreg) tickErrs.push('app.js 里找不到 var VUE_SHEETS = {…} 注册表（步骤 8 起弹层也要登记）');
      const mounted = views.concat(sheets);
      // 组件 → 是否声明 tick prop。步骤 17l 把整条 tick prop 管道删了（17h 之后没人读它）：
      // 现在两边都禁止 —— 组件不得声明 tick，模板不得传 :tick（多传的 prop 会透传成根元素
      // 属性：真机实测 <empty-state> 收 :tick 时 Vue 路径是 <div class="empty" tick="27">，
      // 遗留路径是 <div class="empty">，VDIFF 比属性，空态一比就红 —— 就是当年这条双向规则）。
      const tickProp = new Map();
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        for (const chunk of src.split(/\n(?=export const )/)) {
          const d = /^export const (\w+)\s*=\s*\{/.exec(chunk);
          if (!d) continue;
          const arr = /props:\s*\[([^\]]*)\]/.exec(chunk);
          const obj = /props:\s*\{([\s\S]{0,400}?)\n\s{2}\}/.exec(chunk);
          const has = (arr && /\btick\b/.test(arr[1])) || (obj && /^\s*tick\s*:/m.test(obj[1]));
          if (has) tickErrs.push(path.basename(f) + '：' + d[1] + ' 又声明了 tick prop（步骤 17l 已删这条管道）');
          tickProp.set(d[1], !!has);
        }
      }
      let tickTpls = 0;
      // 组件注册名必须真的存在：`components: { A, B }` 是速记属性，名字拼错 / 删了定义留下
      // 引用，静态闸门以前全看不见，真机上是整模块 ReferenceError（页面白屏、导出表检查红），
      // 代价是两次完整真机跑（步骤 10 踩过：删掉 StatsKv 定义忘了删引用）。
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from/g)]
          .map(m => m[1]).join(',').split(',')
          .map(s => s.trim().split(/\s+as\s+/).pop()).filter(Boolean);
        for (const cm of src.matchAll(/components:\s*\{([^}]*)\}/g)) {
          for (const n of cm[1].split(',')) {
            const id = n.trim();
            if (!id) continue;
            const declared = new RegExp(String.raw`(^|\n)\s*(export\s+)?(const|let|function|class)\s+` + id + String.raw`\b`).test(src)
              || imports.includes(id);
            if (!declared)
              tickErrs.push(path.basename(f) + '：components: 里的 ' + id
                + ' 没有定义（模块加载就 ReferenceError，整页 JS 死在首屏）');
          }
        }
      }
      // 一个模板里的嵌套组件标签逐个查 tick 契约（步骤 17l：任何组件都不再接 :tick）。
      // 扫的是文件里的**全部**模板。上一版用非全局正则，每个视图文件只看第一个模板：
      // files.js 查的是 AttachCard，FilesView 整段没查；todos.js 同理（TodoRow 挡住
      // TodosView），所以步骤 6 的 <empty-state> 缺 :tick 一直没人管。
      function scanTick(src, label) {
        for (const tpl of src.matchAll(/template: `([\s\S]*?)`\n/g)) {
          tickTpls++;
          for (const m of tpl[1].matchAll(/<([a-z][\w-]*-?[\w-]*)\b([^>]*)>/g)) {
            if (!/:tick=/.test(m[2])) continue;
            const pascal = m[1].replace(/(^|-)(\w)/g, (_, __, c) => c.toUpperCase());
            tickErrs.push(label + '：<' + m[1] + '> 还收 :tick（步骤 17l 删了 tick prop 管道；'
              + (tickProp.has(pascal) ? '组件没声明它 → 透传成 DOM 属性，与遗留渲染漂移' : '组件不接它') + '）');
          }
        }
      }
      const mountedFiles = new Set();
      for (const v of mounted) {
        const f = viewFiles.find(p => new RegExp('export const ' + v.comp + '\\b').test(fs.readFileSync(p, 'utf8')));
        if (!f) { tickErrs.push(v.tab + '：注册表里的 ' + v.comp + ' 在 js/ 下找不到定义'); continue }
        mountedFiles.add(f);
        const src = fs.readFileSync(f, 'utf8');
        scanTick(src, v.tab);
      }
      // 扫描范围扩到 js/ 下全部模板（含 components.js）：组件模板里也会嵌套别的组件，
      // tick 契约一样成立。上一版只扫挂载视图所在的文件，components.js 里那 5 个模板
      // 没人管（Tony 审计指出）。
      for (const f of viewFiles) {
        if (mountedFiles.has(f)) continue;
        scanTick(fs.readFileSync(f, 'utf8'), path.relative(root, f));
      }
      // 注册表完整性：视图文件导出的每个 *View 都必须在 VUE_VIEWS ∪ VUE_SHEETS 里。上一版只数条目数，
      // 反向实验：删掉注册表里的 files: FilesView 闸门仍绿，只把打印变成「注册表 2」。
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/^export const (\w+View)\b/gm))
          if (!mounted.some(v => v.comp === m[1]))
            tickErrs.push(path.relative(root, f) + '：导出的 ' + m[1]
              + ' 没进 VUE_VIEWS / VUE_SHEETS 注册表（视图存在但永远不会被挂载，render() 走遗留路径）');
      }
      // 模板里写 H.xxx 的组件必须在 setup() 的返回里带上 H：模板表达式编译成 _ctx.H.xxx(...)，
      // setup 没返回 H 时，渲染期不碰它就不报错，点一下才抛
      // 「Cannot read properties of undefined (reading 'shotSelAll')」，症状是按钮点了没反应。
      // 实测：ShotsView 的 全选 就是这么静默死掉的（步骤 8，被「截图页交互」用例抓到）。
      // 反向实验：删掉 ShotItem 的 return { H, … } 里的 H，闸门必红。
      const noH = [];
      let hExposed = 0;
      for (const f of viewFiles) {
        const src = fs.readFileSync(f, 'utf8');
        for (const m of src.matchAll(/export const (\w+)\s*=\s*\{([\s\S]*?)\n\};/g)) {
          const tpl = /template:\s*`([\s\S]*)`/.exec(m[2]);
          if (!tpl || !/\bH\./.test(tpl[1])) continue;
          if (/return\s*\{[\s\S]*?[^.\w]H\s*[,}]/.test(m[2])) hExposed++;
          else noH.push(path.relative(root, f) + '：' + m[1]
            + ' 的模板用了 H.xxx，但 setup() 没返回 H（点击时抛 undefined → 按钮点了没反应）');
        }
      }
      // 步骤 13 的账：把 `live(() => …)` 换成普通函数 `() => …`，所有静态闸门全绿，而模板
      // 按属性读它时渲染出的是函数源码（Vue 只对 computed ref 解包），用户侧就是
      // 「点了没反应」/ 页面上出现一串 `() => …`。两个方向都钉住：
      //   ① setup() 返回里是普通函数的名字，模板里必须以调用形式用（K(…）；裸读 = 渲染源码。
      //   ② setup() 返回里是 live()/computed 的名字，模板里不许当函数调（K(…）—— computed 已解包，
      //      调它抛「K is not a function」，同样是指了没反应。
      // 组件扫描要同时认 `export const X = {…};`（components.js / 弹层）和 `export default {…}`
      // （四个 tab 视图，文件 以 `\n}` 结尾、无分号）：上一版只认前者，对四个视图**一个也没扫到**
      // —— 反向实验（notes.js 的 srErr 换成普通函数）实测闸门全绿，就是这条假绿。
      // 括号配对用计数，不用非贪婪正则（会在第一个嵌套 `}` 处断）。
      function compsOf(src) {
        const out = [];
        for (const m of src.matchAll(/export (?:const (\w+)\s*=\s*|default\s*)\{/g)) {
          const open = src.indexOf('{', m.index);
          let d = 0, end = -1;
          for (let i = open; i < src.length; i++) {
            if (src[i] === '{') d++;
            else if (src[i] === '}' && --d === 0) { end = i; break }
          }
          if (end > 0) out.push([m[1] || '(default)', src.slice(open + 1, end)]);
        }
        return out;
      }
      const liveBad = [];
      let liveChecked = 0;
      for (const f of viewFiles) {
        for (const [cname, cbody] of compsOf(fs.readFileSync(f, 'utf8'))) {
          const tpl = /template:\s*`([\s\S]*)`/.exec(cbody);
          const ri = cbody.search(/\breturn\s*\{/);
          if (!tpl || ri < 0) continue;
          const open = cbody.indexOf('{', ri);
          let d = 0, end = -1;
          for (let i = open; i < cbody.length; i++) {
            if (cbody[i] === '{') d++;
            else if (cbody[i] === '}' && --d === 0) { end = i; break }
          }
          if (end < 0) { liveBad.push(path.relative(root, f) + '：' + cname
            + ' 的 setup() return 大括号不配对（闸门⑮ 在假绿）'); continue }
          liveChecked++;
          const plain = [], comp = [];
          for (const e of stripComments(cbody.slice(open + 1, end)).matchAll(/(^|[,\s{])([A-Za-z_$][\w$]*)\s*:\s*([^\n]*)/g)) {
            const val = e[3];
            if (/^live\s*\(/.test(val)) comp.push(e[2]);
            else if (/^(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(val) || /^function\b/.test(val)) plain.push(e[2]);
          }
          for (const k of plain) {
            for (const occ of tpl[1].matchAll(new RegExp('\\b' + k + '\\b(\\s*\\()?', 'g'))) {
              if (!occ[1]) { liveBad.push(path.relative(root, f) + '：' + cname + '.' + k
                + ' 是普通函数，模板里按属性读它（渲染出函数源码 → 页面上出现 "() => …"，要的是 live()）'); break }
            }
          }
          for (const k of comp) {
            if (new RegExp('\\b' + k + '\\s*\\(').test(tpl[1])) liveBad.push(path.relative(root, f) + '：'
              + cname + '.' + k + ' 是 live()/computed，模板里当函数调用了（computed 已解包，调它抛 not a function）');
          }
        }
      }
      if (!liveChecked) liveBad.push('闸门⑮ 一个组件的 setup() 也没扫到（视图写法改名了？闸门在假绿）');
      if (bareComputed.length)
        bad('闸门⑮ 组件用裸 computed 且不许返回容器本身（数据变了视图不动）', bareComputed.join(' | '));
      else if (missHost.size) bad('闸门⑮ 模板里的 H.xxx 不在 setHost（Vue 渲染抛错→静默回退字符串）', [...missHost].join(' '));
      else if (miss.size) bad('闸门⑮ 模板里的 handler 不在导出表（点了没反应）', [...miss].join(' '));
      else if (tickErrs.length) bad('闸门⑮ Vue tick 依赖断了', tickErrs.join(' | '));
      else if (noH.length) bad('闸门⑮ 模板用 H.xxx 的组件没在 setup() 返回 H', noH.join(' | '));
      else if (liveBad.length) bad('闸门⑮ live()/普通函数用反了（数据变了视图不动）', liveBad.join(' | '));
      else {
        const names = new Set();
        for (const [, t] of tpls)
          for (const m of t.matchAll(/(?:@|v-on:)(?:click|input|change|submit)="\s*(?:H\.)?([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
        ok('闸门⑮ Vue 模板 ' + tpls.length + ' 个编译通过；注册表 ' + views.length + ' 视图 + '
          + sheets.length + ' 弹层的 tick 管道已断（扫 ' + tickTpls + ' 个模板，无一处 :tick、无一个 tick prop）；模板 handler ' + names.size + ' 个全在导出表；'
          + '视图里的 H.xxx ' + usedHost.size + ' 个全在 setHost；'
          + (hostKeys ? '宿主按 app 收窄：' + hostKeys.size + ' 个 app、表里共 '
            + [...hostKeys.values()].reduce((a, v) => a + v.length, 0) + ' 个 key（三向核对过）'
            : '宿主收窄表缺失')
          + '；模板用 H 的 ' + hExposed
          + ' 个组件全在 setup() 返回里暴露了 H；live()/普通函数两个方向用法都对');
      }
    }
  }
}

/* ================= 签名段（步骤 11：原 tools/ui_sig_test.js 的 84 项并入） =================
   这一段的定位和上面十二道闸门不同：闸门查「结构」（handler 能不能解析、注册表完不完整），
   签名段查「行为契约还在」—— 每条断言都对应一次真实用户反馈或线上踩坑（P6 切页动画、
   P12 点了没反应、逾期差 8 小时、图标被换回矢量…），断言写成对源码的正则，是因为
   这些行为在真机上不可测（要肉眼判断「有没有闪」「对齐没对齐」）。
   整段包在 IIFE 里：原文件是顶层脚本，const 名（src / code / panel / data / icon …）
   与上面十二道闸门大面积撞车，撞了就是 SyntaxError，套一层作用域最省事。
   步骤 11 同时删掉 tools/ui_sig_test.js：静态闸门从三份（ui_test / ui_sig_test / go test）
   收敛到两份（ui_test / go test），test.sh 少一个必跑项。 */
(function sigSection(){
  // 拼接视图：go/ui/ 下除 vendor/ 之外的 css/js/html 按路径排序拼接（等价拆分前那一个 ui.html）
  const src = ui;
  function sig(name, pass) { if (pass) ok(name); else bad(name, '签名断言失败（行为契约不在了）'); }
  // 步骤 11：遗留字符串形式（strip()+missedBanner()+…）随渲染器一起删，只剩组件标签。
  // strip-bar 的闭合标签要容许（`<strip-bar :tick="tick"></strip-bar>`），旧正则用 \s*
  // 卡在那里，转 Vue 当天就假红过一次。
  const TOP_FORMS = [
    // 步骤 13 在 strip-bar 与 missed-banner 之间插了「服务端搜索失败」的 errbox（可重试），
    // 第一个窗口从 80 放到 320：顺序仍是硬要求，只是不再要求两者紧邻。
    /<strip-bar[\s\S]{0,320}?<missed-banner[\s\S]{0,400}?<shot-banner[\s\S]{0,400}?<clip-banner/,
  ];
  const notesTopOrder = (s) => TOP_FORMS.some((re) => re.test(s));
  // 横幅被引用的次数：字符串调用 clipBanner() 和组件标签 <clip-banner> 都计数
  const bannerRefs = (s, name) => {
    const kebab = name.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase());
    return (s.match(new RegExp(name + '\\(\\)', 'g')) || []).length
      + (s.match(new RegExp('<' + kebab + '[ />]', 'g')) || []).length;
  };
  // 卡片片段：函数调用形式或组件标签形式。
  // \b 是必需的：不带它，factsBlock 改名成 factsBlockRenamed 也能对上（前缀匹配），
  // 反向实验验出来签名会假绿。
  const frag = (s, fn, tag) => new RegExp('\\b' + fn + '\\(').test(s) || new RegExp('<' + tag + '[ />]').test(s);
  /* 轮询指纹（步骤 11：原 sigOf 已删，改成 stateSig + SIG_SKIP 排除表）。
     从 app.js 抽真源码来测，避免复制粘贴走样 —— 排除表是行为契约，测的必须是线上那份。 */
  const mSkip = src.match(/var SIG_SKIP = \{[^}]*\};/);
  const mSig = src.match(/function stateSig\(d\)\{[\s\S]*?\n\}/);
  if (!mSkip || !mSig) { bad('轮询指纹', 'app.js 里找不到 SIG_SKIP / stateSig'); return; }
  // 名字不能叫 stateSig：eval 里声明的函数要和外层区分开，同名会撞
  // 「Identifier 'stateSig' has already been declared」（踩过）。
  /* 步骤 17e：app.js 的 SHOTFLAGS 变成 {v:…} 容器（整包赋值要可追踪），mock 跟着换形状。 */
  const SHOTFLAGS = { v: { enabled: 1, folders: 2, granted: 1 } };
  const sigFn = eval(mSkip[0] + ';' + mSig[0] + '; stateSig');

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

  const s0 = sigFn(base()), s1 = sigFn(base());
  eq('同一个 state 两次指纹相同', s0, s1, true);

  let d = base(); d.notes[0].status = 'parsing';
  eq('笔记状态变化', s0, sigFn(d), false);

  d = base(); d.notes[1].todos.push({ id: 't2' });
  eq('待办增删', s0, sigFn(d), false);

  d = base(); d.notes[0].title = '甲改';
  eq('标题变化', s0, sigFn(d), false);

  d = base(); d.notes[0].attachments.push({ id: 'y' });
  eq('附件增删', s0, sigFn(d), false);

  d = base(); d.notes.push({ id: 'c', title: '丙', status: 'done', updatedAt: 'x', todos: [], attachments: [] });
  eq('新增笔记', s0, sigFn(d), false);

  d = base(); d.info.open = 1;
  eq('未完成数变化', s0, sigFn(d), false);

  d = base(); d.settings.theme = 'dark';
  eq('主题变化', s0, sigFn(d), false);

  /* 步骤 11 的契约翻转：原 sigOf 手工挑字段，「列表不展示的字段变化」期望不重绘；
     stateSig 是「整份序列化 + 排除表」，这类变化现在会多画一次 —— 多画一次是可见的、
     Vue 的 patch 很便宜，而漏字段的不重绘是静默的（踩过：漏 i.shot 时首页横幅永不出现）。
     真正钉住的是排除表：uptimeS 每秒都变，留着它 = 每 2s 全量重绘（就是当初的闪烁）。 */
  d = base(); d.notes[0].content = '正文变了（列表不显示正文，现在会重绘一次）';
  eq('未展示字段变化 → 多画一次（新契约，原 sigOf 期望不重绘）', s0, sigFn(d), false);

  d = base(); d.info.uptimeS = 99999;
  eq('uptimeS 变化不重绘（排除表：它每秒都变）', s0, sigFn(d), true);

  d = base(); d.info.tz = { zone: 'Asia/Shanghai', offsetSec: 28800 };
  eq('tz 变化不重绘（排除表：界面不展示）', s0, sigFn(d), true);

  d = base(); d.info.shot = 7;
  eq('新截图条数变化要重绘（原 sigOf 漏过这一项，首页横幅就不出现）', s0, sigFn(d), false);

  d = base(); d.info.server = 'https://other.test';
  eq('服务端地址变化要重绘（状态点/未配置提示都依赖它）', s0, sigFn(d), false);

  /* 截图开关不在 /api/state 里（它是 JS 侧 var SHOTFLAGS，由 Android.shotFlags 异步回填），
     所以只能单独拼进指纹。踩过：选完文件夹我的页还显示旧数字。反向实验：把 stateSig 末尾
     那个 [sf.enabled, sf.folders, sf.granted] 数组删掉，这两条一起红。 */
  SHOTFLAGS.v.folders = 3;
  eq('截图文件夹数变化要重绘（踩过：选完文件夹我的页还显示旧数字）', s0, sigFn(base()), false);
  SHOTFLAGS.v.enabled = 0;
  eq('截图监控开关变化要重绘（横幅按开关分状态显示）', s0, sigFn(base()), false);
  SHOTFLAGS.v.enabled = 1; SHOTFLAGS.v.folders = 2;
  eq('截图开关改回来指纹也改回来（不是恒变）', s0, sigFn(base()), true);

  for (const [cname, cpass, cnote] of checks) {
    if (cpass) ok('轮询指纹：' + cname + ' → 期望' + cnote);
    else bad('轮询指纹：' + cname + ' → 期望' + cnote);
  }
  // 轮询必须是安静模式，否则又回到每秒重绘
  const quiet = /setInterval\(function\(\)\{ if\(!document\.hidden\) refresh\(true\); \}/.test(src);
  sig('轮询走 refresh(true) 安静模式', quiet);
  // 附件卡不能再有无条件入场动画（那是闪一下的来源）
  const acard = /^\.acard\{[^}]*animation:/m.test(src);
  sig('附件卡没有无条件动画', !acard);
  // P6：整页切页入场动画已删除，切页必须是瞬时的（enterT 那套「播完移除」也随之消失）
  const noPageEnter = !/enterT = setTimeout/.test(src) && !/main\.enter/.test(src);
  sig('不再有整页切页入场动画', noPageEnter);

  // ---------- 底部 5 按钮 / 自绘对话框 / 返回键 ----------
  const java = read('src/dev/xduo/enote/MainActivity.java');
  const keepalive = read('src/dev/xduo/enote/KeepAlive.java');

  // “记一笔”在导航栏第三格，形成 5 个按钮。
  // 步骤 15：底栏不再是 index.html 里的静态标记，是 js/shell.js 的 TabBar 模板 —— 契约不变
  // （fab 夹在 todos 与 files 之间），只是真相换了个地方，扫描源跟着搬。
  const bar = read('go/ui/js/shell.js').match(/export const TabBar[\s\S]*?template: `([\s\S]*?)`\n/);
  const inBar = bar && /class="tab"[^>]*todos[\s\S]*?<button class="fab" id="fab"[\s\S]*?data-tab="files"/.test(bar[1]);
  sig('“记一笔”在底栏第三格（5 个按钮）', inBar);

  // 指示条必须 left:0，否则它和按钮差一个 padding，看起来左对齐
  const indLeft = /\.tabbar \.ind\{position:absolute;left:0/.test(src);
  sig('导航指示条居中对齐（left:0）', indLeft);

  // 原生 confirm/alert 会顶着一行“网址为 http://127.0.0.1 的网页显示：”
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const native = /\bconfirm\(|\balert\(/.test(code);
  sig('页面不再用原生 confirm/alert', !native);
  const jsDlg = /public boolean onJsConfirm\(/.test(java) && /public boolean onJsAlert\(/.test(java);
  sig('Java 把 alert/confirm 转发给页面对话框', jsDlg);

  // 面板要有关闭按钮（步骤 15 之后外壳在 shell.js 的 SheetHost 模板里）
  const pclose = /class="pclose" @click="H\.closeSheet\(\)"/.test(read('go/ui/js/shell.js'));
  sig('浮动面板有关闭按钮', pclose);

  // 返回键 / 侧滑返回：先关面板、回笔记页，主页上连返两次才退 app
  const back = /window\.uiBack = function\(\)/.test(src)
    && /evaluateJavascript\("window\.uiBack \? uiBack\(\) : 0"/.test(java);
  sig('返回键先关面板再退 app', back);
  const back2 = /public void onBackPressed\(\)/.test(java) && /再返回一次退出/.test(java);
  sig('侧滑返回走同一逻辑，主页连返两次才退出', back2);

  // “我的”页是最后一页，左滑不该拉伸回弹
  const noStretch = /setOverScrollMode\(View\.OVER_SCROLL_NEVER\)/.test(java);
  sig('WebView 关闭横向拉伸回弹', noStretch);

  // “我的”页去掉装饰动画
  const heroPlain = !/main\.enter \.hero\{animation/.test(src) && !/main\.enter \.stat\{animation/.test(src);
  sig('我的页没有装饰性入场动画', heroPlain);

  // S2 之后间距/字号/圆角都走刻度 token，断言要守的是结构契约，不是字面 px。
  // tok('14px','--s3') 生成 (14px|var(--s3))：迁移前后都绿，两边都写死会假红。
  function tok(lit, token) { return '(' + lit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '|var\\(' + token + '\\))'; }

  // 页面内容左右留白（卡片不贴屏幕边）
  const pad = new RegExp('main#view\{padding:0 ' + tok('14px', '--s3') + ' ' + tok('104px', '--clear-bottom') + '\}').test(src);
  sig('页面左右有留白', pad);

  // 主题开关只在设置面板里，“我的”页不重复列一项
  const oneTheme = !/themeSheet\(\)/.test(code) && /外观[\s\S]{0,400}setTheme/.test(src);
  sig('主题入口只保留设置面板里那一个', oneTheme);

  // 涟漪只能在被裁剪的按钮里：选择器带上 .li 时，水波会画到 viewport 上，铺满全屏 = 闪屏
  const ripSel = (src.match(/closest\('([^']*)'\)/) || [])[1] || '';
  const ripOk = ripSel.length > 0 && !/\.li\b/.test(ripSel)
    && /\.tabbar \.fab\{[^}]*position:relative/.test(src) && /\.seg button\{[^}]*overflow:hidden/.test(src);
  sig('涟漪不会溢出按钮（不闪屏）', ripOk);

  // ---------- R11 到期倒计时 ----------
  // 每个未完成待办都要有倒计时徽标，并且是就地改写文本（整页重绘会闪）
  const cd = /function cdText\(due\)/.test(src) && /data-due="/.test(src)
    && /setInterval\(tickCD, \d+\)/.test(src) && /function tickCD\(\)/.test(src);
  sig('待办显示到期倒计时，且按秒级定时就地更新', cd);
  const cdWords = /不足/.test(src) && /逾期/.test(src) && /天'/.test(src) && /小时'/.test(src) && /分钟'/.test(src);
  sig('倒计时文案：不足N天/小时/分钟、逾期N…', cdWords);
  // 笔记页与待办页都要挂上（步骤 16a：cdChip() 字符串函数成了 leaf.js 的 <cd-chip>，
  // 笔记页的 TodoDue 与待办页的 TodoRow 各用一次）
  const cdBoth = (read('go/ui/js/components/leaf.js').match(/<cd-chip/g) || []).length >= 2;
  sig('笔记页与待办页都显示倒计时', cdBoth);

  // ---------- 勾选完成的动画反馈 ----------
  const anim = /\.todo\.justdone \.ttx::after,[^{]*\{[\s\S]*?animation:strike/.test(src)
    && /\.todo\.leaving\{/.test(src) && /\.todo\.enter\{animation:todoenter/.test(src)
    && /row\.classList\.add\('leaving'\)/.test(src);
  sig('勾选 → 划线动画 → 原位淡出 → 新位置高亮入场', anim);
  // 动画期间不能被轮询重绘打断
  const lock = /if\(Date\.now\(\) < animLock\)\{ paintStatus\(\); return \}/.test(src);
  sig('动画期间轮询不重绘（不打断划线动画）', lock);

  // ---------- R5 我的页统计 + 全屏设置面板 ----------
  /* 步骤 11：chartHTML / statHTML / statsHeroHTML 三个遗留渲染器删了，柱状图与统计卡
     是 StatsChart / StatsView 的 computed（css/stats.css 的 .chart 原样复用）。
     契约不变：数据必须来自 /api/stats，图必须是纯 CSS（无 canvas/svg）。 */
  const stats = /api\/stats/.test(src) && /function statsNow\(\)/.test(src)
    && /export const StatsChart/.test(src) && /<stats-chart/.test(src)
    && /^\.chart\{/m.test(src) && /function statCls\(/.test(src);
  sig('我的页统计来自 /api/stats，近 7 天为纯 CSS 柱状图', stats);
  const go = read('go/stats.go');
  const goweb = read('go/web.go')
    + read('go/shots.go');
  const gopipe = read('go/pipeline.go');
  const goRoutes = /m\.HandleFunc\("\/api\/stats", handleStats\)/.test(read('go/web.go'))
    && /func stats\(\) statsRes/.test(go) && /func handleImport/.test(read('go/backup.go'));
  sig('Go 侧 /api/stats + /api/import + /api/clear 已注册', goRoutes);
  // 步骤 10：settingsSheet() 变成分发器（注册表里有 settings 就走 pageSheetVue），所以
  // 签名不再钉「函数体第一句就是 pageSheet」，只钉「这个函数里真的调了 pageSheet('设置'」。
  // 步骤 16c：字符串卡片形态的 pageSheet/sheet 双路径收敛成 sheetVue 一条，钉它存在。
  const panel = /function sheetVue\(name, full\)/.test(src) && /\.panel\.page\{/.test(src)
    && /settingsSheet\(\)\{[\s\S]{0,400}?pageSheetVue\('settings', '设置'/.test(src);
  sig('设置是全屏面板（顶栏固定 + 分组）', panel);
  const secs = ['外观', 'AI 模型', '采集', '本地 OCR', '数据', '运行状态']
    .every(function (t) { return src.indexOf(t) > 0 });
  sig('设置面板分组齐全（外观/AI/采集/OCR/数据/状态）', secs);
  const data = /function importJSON\(\)/.test(src) && /function clearAllNotes\(\)/.test(src)
    && /Android\.pickJSON\(\)/.test(src) && /REQ_IMPORT/.test(java) && /api\/import/.test(java);
  sig('导出 / 导入（选文件→POST /api/import）/ 清空 全通', data);

  // ---------- 时区：Go 用 UTC 会算错「逾期」 ----------
  const tz = /nativeInit\(String filesDir, int tzOffsetSec, String tzId\)/.test(
      read('src/dev/xduo/enote/Bridge.java'))
    && /func applyTZ\(offSec int, id string\)/.test(read('go/app.go'))
    && /time\.Local = time\.FixedZone/.test(read('go/app.go'));
  sig('Java 把时区传给 Go，逾期/按天统计不再差 8 小时', tz);

  // ---------- 改名 + 竖琴图标 ----------
  const man = read('AndroidManifest.xml');
  const named = /android:label="懒得记"/.test(man) && !/android:label="eNote"/.test(man)
    && /<title>懒得记<\/title>/.test(src);
  sig('应用名改为「懒得记」', named);
  // 启动图标：用户自己提供的那套 PNG（android-launcher-icons.zip），不是矢量重绘版。
  // 我一度把整套换成矢量，用户明确要求还原 —— 这里锁死，别再动它。
  const densities = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
  const icon = densities.every(d =>
      fs.existsSync(path.join(root, `res/drawable-${d}/ic_launcher_background.png`)) &&
      fs.existsSync(path.join(root, `res/drawable-${d}/ic_launcher_foreground.png`)) &&
      fs.existsSync(path.join(root, `res/mipmap-${d}/ic_launcher.png`)))
    && !fs.existsSync(path.join(root, 'res/drawable/ic_launcher_background.xml'))   // 别又换成矢量
    && !fs.existsSync(path.join(root, 'res/drawable/ic_launcher_foreground.xml'))
    && /@drawable\/ic_launcher_background/.test(
        read('res/mipmap-anydpi-v26/ic_launcher.xml'))
    && /@drawable\/ic_launcher_foreground/.test(
        read('res/mipmap-anydpi-v26/ic_launcher.xml'))
    && /android:roundIcon="@mipmap\/ic_launcher"/.test(man)
    && fs.existsSync(path.join(root, 'go/icon.png'))
    && /\/icon\.png/.test(goweb) && src.includes('src="/icon.png"');
  sig('启动图标：用户提供的 PNG 图层（5 套密度 + 自适应 XML）', icon);

  // 「重要」标签不能比时间标签高出一截：两者都要 inline-block + 固定行高
  // 三种小标签（.chip 重要 / .due 到期 / .cd 倒计时）盒模型必须完全一致，容器 flex 居中
  function ruleBody(cls) {
    const m = src.match(new RegExp('^\\.' + cls + '\\{([^}]*)\\}', 'm'));
    return m ? m[1] : '';
  }
  // 三类胶囊（chip / due / cd）必须共用同一套盒模型，高度才会一致——这是「重要」标签
  // 和时间标签对齐的根因。条目写成断言函数，刻度 token 和旧字面值都接受。
  const NEED = [
    b => b.includes('display:inline-flex'),
    b => b.includes('align-items:center'),
    b => /font-size:(10\.5px|var\(--fs-xs\))/.test(b),
    b => b.includes('line-height:1.4'),
    b => /padding:(1px|var\(--hair\)) (7px|var\(--s2\))/.test(b),
    b => /border:(1px|var\(--hair\)) solid/.test(b),
  ];
  const chipH = ['chip', 'due', 'cd'].every(c => NEED.every(f => f(ruleBody(c))))
    && /^\.tx small\{display:flex;flex-wrap:wrap;align-items:center;gap:(4px|var\(--s1\))/m.test(src);
  sig('「重要」与时间标签同高（统一盒模型 + flex 居中）', chipH);

  // 导出 JSON 是整页跳转，返回键得先回退网页历史，不然回不到 app
  const backHist = /if \(w\.canGoBack\(\)\) \{ w\.goBack\(\); return; \}/.test(java);
  sig('返回键先回退网页历史（导出页能退出）', backHist);

  // ---- R12/R13/R14 ----
  const gollm = read('go/llm.go');
  const gostore = read('go/store.go');
  const gosearch = read('go/search.go');
  const bridge = read('src/dev/xduo/enote/Bridge.java');

  // 关键信息：六问框架进提示词，落到 Note.Facts，卡片渲染，搜索能命中
  const facts = /facts/.test(gollm) && /何时/.test(gollm) && /何人/.test(gollm) && /何地/.test(gollm)
    && /何事/.test(gollm) && /为何/.test(gollm) && /下一步/.test(gollm)
    && /Facts\s+\[\]Fact/.test(gostore) && /func cleanFacts/.test(gollm)
    && /关键信息/.test(gosearch)
    /* 步骤 16：卡片渲染从 factsBlock() 字符串翻成 <note-facts> 组件（components/leaf.js），
       契约是「关键信息这块 DOM 真的在模板里」，两种形态都认。 */
    && frag(src, 'factsBlock', 'note-facts') && /class="facts"/.test(src)
    && /class="fh"/.test(src) && /class="fq"/.test(src) && /class="fa"/.test(src);
  sig('关键信息：六问提取 + 落库 + 卡片渲染 + 可搜索', facts);

  // 到期提醒：系统日历 + 系统闹钟 intent（零权限），有 due 才显示按钮
  const remind = /ACTION_INSERT[\s\S]{0,400}CalendarContract\.Events/.test(java)
    && /CalendarContract\.EXTRA_EVENT_BEGIN_TIME/.test(java) && /CalendarContract\.EXTRA_EVENT_END_TIME/.test(java)
    && /com\.android\.alarm\.permission\.SET_ALARM/.test(man)
    && /AlarmClock\.ACTION_SET_ALARM/.test(java) && /EXTRA_SKIP_UI/.test(java)
    && /addToCalendar/.test(bridge) && /setAlarm/.test(bridge)
    /* 步骤 16：按钮由 <remind-btns> 组件出（components/leaf.js），「有 due 且未完成才显示」
       这条契约从 `if(!t.due||t.done) return ''` 搬进模板的 v-if。 */
    && /name: 'RemindBtns'/.test(src) && /toCalendar\(/.test(src) && /toAlarm\(/.test(src)
    && /v-if="t\.due && !t\.done"/.test(src)
    && (src.match(/<remind-btns\b/g)||[]).length >= 2;   // 笔记卡片 + 待办页两处都要有
  sig('待办可一键写入系统日历 / 设为闹钟（intent，无权限）', remind);

  // logo 铺满按钮：UA button{padding} 会挤出一圈白框
  const logo = /\.iconbtn\{[^}]*padding:0/.test(src) && /img\.brand\{width:100%;height:100%/.test(src);
  sig('顶栏 logo 铺满按钮（去掉白底外框留白）', logo);


  // ---- R7/P6 剪贴板采集 ----
  // 后台读剪贴板在 Android 10+ 被系统禁止（只有默认输入法/有焦点 app 可以），
  // 所以方案定稿为前台监听：MainActivity onResume 注册 ClipboardManager 监听，
  // Go 侧 clip.json 暂存 + 去重，UI 横幅 + 批量勾选 + 一键解析。
  const goclip = read('go/clip.go');
  const mainact = read('src/dev/xduo/enote/MainActivity.java');
  const clip = /func clipAdd/.test(goclip) && /func clipParse/.test(goclip)
    && /5\*time\.Second/.test(goclip) && /clip\.json/.test(goclip)
    && /nativeClipAdd/.test(goclip)
    && /addPrimaryClipChangedListener/.test(mainact) && /drainClipboard/.test(mainact)
    && /onResume\(\)/.test(mainact)
    && !/ClipWatchService/.test(man)            // 无障碍方案已移除（读不到内容）
    && /export const ClipBanner/.test(src) && /function clipSheet/.test(src)
    && /\/api\/clip\/parse/.test(src) && /\/api\/clip\/list/.test(src)
    && bannerRefs(src, 'clipBanner') >= 1;   // 横幅挂在笔记页顶部（步骤 11 后笔记页只有一份模板，
                                             // 遗留那三份分支的「三处都挂」由闸门⑮ 的模板扫描兜）
  sig('剪贴板前台采集 + 暂存去重 + 横幅/批量页/一键解析', clip);

  // Android 10+ 只让「当前焦点窗口」读剪贴板，onResume 比窗口拿焦点早，那一次必然被拒
  // （ClipboardService: Denying clipboard access ... not in focus，返回 null 而不报错）。
  // 修：onWindowFocusChanged 里重试 + 退避重试，再加顶栏 📋 手动入口兼底。
  const clipFocus = /onWindowFocusChanged/.test(mainact) && /clipWaitingFocus/.test(mainact)
    && /clipTries/.test(mainact)
    && /public void clipImport/.test(read('src/dev/xduo/enote/Bridge.java'))
    && /id="clipBtn"/.test(src) && /Android\.clipImport/.test(src) && /window\.onClipRead/.test(src)
    // 后台监听器只记录「剪贴板变了」（读才受限），回来读不到时页面给一键入口
    && /markClipChanged/.test(keepalive) && /clipHint/.test(keepalive)
    && /Android\.clipHint/.test(src) && /剪贴板刚有更新/.test(src);
  sig('剪贴板焦点重试（通知点进来读得到的修复）+ 顶栏 📋 手动导入', clipFocus);

  // 恒真式去重签名（kindSig 忽略 c 自己）让第一条之后的复制全被当重复丢弃：
  // 签名必须用存储项自己的字段，并且有「三次不同复制存三条」的回归护栏。
  const clipSig = /func \(c \*Clip\) sig\(\) string/.test(goclip)
    && /last\.sig\(\) == sig/.test(goclip) && !/kindSig\(kind, text, path\) == sig/.test(goclip);
  const clipSigTest = /TestClipAddKeepsDistinctCopies/.test(read('go/clip_test.go'));
  sig('剪贴板去重签名用存储项自己的字段（恒真式回归）', clipSig && clipSigTest);

  // 计数以页面列出的条目为准（全局 clipSel 只增不减会把旧 id 算进去）；条目可单条删除
  const clipDel = /function clipRemove/.test(src) && /\/api\/clip\/remove/.test(src)
    && /class="clipdel"/.test(src) && /function clipDelSel/.test(src)
    && /已选 /.test(src) && /CLIP\.sel = keep/.test(src);
  sig('剪贴板计数按页面条目算 + 单条/批量删除', clipDel);

  // 监控到变化要主动发通知，不是等用户下拉界面；常驻通知兼作条数状态条
  const clipNotify = /CLIP_NOTIFY_ID/.test(keepalive) && /static void notifyClip/.test(keepalive)
    && /CHANNEL_CLIP/.test(keepalive) && /updateNotification/.test(keepalive)
    && /notifyClip/.test(read('src/dev/xduo/enote/Bridge.java'))
    && /剪贴板暂存 /.test(keepalive);
  sig('剪贴板主动通知 + 常驻通知显示暂存条数', clipNotify);

  // tab 切换不再有整页浮现动画（用户要求：干净利落，避免闪烁）
  const cleanTab = !/main\.enter/.test(src) && !/@keyframes fadein/.test(src)
    && /\.todo\.enter/.test(src);              // 完成待办的高亮动画保留
  sig('切页无整页浮现动画（完成动画保留）', cleanTab);

  // 待办行左侧竖条：所有行统一 3px 透明占位，重要行只改颜色 → checkbox 对齐
  const priBar = /border-left:3px solid transparent/.test(src)
    && /\.pri-high\{border-left-color:var\(--bad\)\}/.test(src)
    && new RegExp('padding:' + tok('9px', '--s2') + ' ' + tok('2px', '--s0') + ' ' + tok('9px', '--s2') + ' ' + tok('8px', '--s2')).test(src);
  sig('待办竖条统一占位（checkbox 对齐）', priBar);

  // P6.5 常驻后台：设置页开关 + 引导 + 前台服务/电池优化接口都存在
  const ka = /function toggleKeepAlive\(el\)/.test(src)
    && /Android\.setKeepAlive\(on\)/.test(src)
    && /function askBattery\(\)/.test(src)
    && /常驻后台/.test(src)
    && /去关闭电池优化/.test(src);
  sig('设置页有常驻后台开关和电池优化引导', ka);

  // 提醒通知带真实 id，点进来能定位到那条待办
  const route = /list\.push\(\{id:n\.id\+'\|'\+t\.id, noteId:n\.id, todoId:t\.id,/.test(src)
    && /function openTodo\(nid, tid\)/.test(src);
  sig('通知点击带 noteId/todoId 并定位待办', route);

  // P8 补看错过的提醒：横幅只在有内容时出现，点开是清单，点一条能跳回笔记
  const missed = /export const MissedBanner/.test(src)
    && /function missedSheet\(\)/.test(src)
    && /function loadMissed\(\)/.test(src)
    && /api\/missed/.test(src)
    && /v-if="m && m\.count"/.test(src);   // 没有就不占位（遗留是 return ''，Vue 是整条不渲染）
  sig('错过的提醒横幅 + 清单（没有内容时不占位）', missed);

  // 横幅用 warn 色跟「剪贴板」横幅区分开；图标顶对齐，两行文案时不会被拉低
  const missedCss2 = /\.missed\{[^}]*var\(--warn-s\)/.test(src)
    && /\.missed\{[^}]*align-items:flex-start/.test(src)
    && new RegExp('\.missed \.mi\{[^}]*margin-top:' + tok('2px', '--s0')).test(src)
    && /\.msrow\{/.test(src);
  sig('错过的提醒用 warn 色（区别于剪贴板横幅）', missedCss2);

  // 按钮文字必须和按钮居中：.btn 是 inline-flex，text-align 管不到 flex 子项，得用 justify-content
  const btnCenter = /\.btn\{[^}]*display:inline-flex;[^}]*justify-content:center/.test(src)
    && /\.dacts \.btn\{/.test(src);
  sig('所有按钮文字居中（inline-flex + justify-content）', btnCenter);

  // 二级页面 = 整页，不是底部弹层：不要 grip，也不要有 border-top 的那条缝
  const pageSheetCss = /\.panel\.page\{[^}]*border-top:0/.test(src)
    && /\.panel\.page \.grip\{display:none\}/.test(src);
  const noGripInPageSheet = !/p\.innerHTML = '<div class="grip"><\/div><div class="phead">/.test(src);
  sig('二级页面贴顶（无 grip / 无分隔缝）', (pageSheetCss && noGripInPageSheet));

  // 切页不重绘：每个 tab 一个常驻面板 + 各自记住滚动位置
  const panes = /var panes = \{\}, paneBuilt = \{\}/.test(src)
    && /function paneFor\(t\)/.test(src)
    && /function invalidatePanes\(keep\)/.test(src)
    && /tabScroll = \{notes:0, *todos:0, *files:0, *mine:0\}/.test(src)
    && /if\(fresh\)\{[^}]{0,200}render\(\);\s*\} else \{\s*showPane\(\)/.test(src)
    && /tabScroll\[lastTab\] = window\.scrollY/.test(src);
  sig('切页复用面板 + 恢复各自的滚动位置', panes);

  // 附件页统计行到列表的留白跟笔记页一致（.agrid margin-top）。
  // S2 密度把 10px 换成 var(--s2)=8px，断言要的是「两页留白一致」，不是那个字面 px，
  // 所以两个都接受；具体数值由 tools/ui_test.js 的刻度棘轮守。
  const fileGap = /\.agrid\{display:grid;[^}]*margin-top:(10px|var\(--s2\))\}/.test(src);
  sig('附件页统计行到列表的留白和笔记页一致', fileGap);

  // checklist 圆框：未勾选的圈直径要跟勾选后的实心圆一样大（以前 border 画圈是整 18px，偏大）
  const cbSize = /\.cb\{flex:0 0 18px;height:18px/.test(src)
    && /\.cb:before\{[^}]*width:15px;height:15px/.test(src)     // 圈和实心圆都是 15px
    && /\.cb\.on:before\{background:var\(--grad\)/.test(src)
    && !/\.cb\{[^}]*border:1\.5px solid var\(--dim2\)/.test(src);
  sig('checklist 圆框 18px（不再过大）', cbSize);

  // 交互入口用到的状态表必须真的声明过（expand 曾因 expAnim 未声明而静默失效）
  const decl = /var expAnim = \{\}/.test(src)
    /* 步骤 17f：tab / open 改成从 reactive 盒子取初值，闸门认两种写法
       （这条闸门要的是「声明过」，不是初值字面量）。 */
    && /var tab = ('notes'|TAB\.v), open = (\{\}|OPENB\.v)/.test(src)
    && /var seen = \{\}/.test(src);
  sig('expAnim / open / seen 都有声明（点击不再静默失效）', decl);

  // 启动自检：真跑一遍各页渲染 + 展开详情，出错打到控制台（test.sh 会因此失败）
  const selfCheck = /function selfCheck\(\)/.test(src) && /SELFCHECK FAIL/.test(src)
    && /probe\('expand'/.test(src);
  sig('启动自检覆盖各页渲染与「展开详情」', selfCheck);

  // 正文三行以内不显示「展开详情」：按钮靠实测高度决定显隐
  const expRule = /function syncExpand\(\)/.test(src) && /full - three > 1/.test(src)
    && /btn\.exp/.test(src) && /syncExpand\(\);/.test(src) && /\.exp/.test(src);
  sig('展开按钮只在正文超过三行时出现', expRule);

  // 三行截断必须是 max-height（pre-wrap 下 line-clamp 不生效，正文会整段显示）
  const clampRule = /\.body\.clamp\{max-height:calc\(3 \* 1\.65em \+ 18px\)/.test(src)
    && !/-webkit-line-clamp:3/.test(src) && /\.body:not\(\.clamp\)\{max-height:none/.test(src);
  sig('正文三行截断用 max-height（line-clamp 对 pre-wrap 无效）', clampRule);

  // ---- P11 截图捕获 ----
  const shotsGo = read('go/shots.go');
  const shotsJava = read('src/dev/xduo/enote/Shots.java');
  const manifest = read('AndroidManifest.xml');

  const shotBannerOrder = notesTopOrder(src)
    && /export const ShotBanner/.test(src);
  sig('首页横幅顺序：错过提醒 → 新截图 → 剪贴板', shotBannerOrder);

  const shotGrid = /\.shotgrid\{display:grid;grid-template-columns:repeat\(3,1fr\)/.test(src)
    && /function shotSheet\(\)/.test(src) && /function loadShots\(\)/.test(src)
    && /shotSelAll\(true\)/.test(src) && /合并成一条笔记/.test(src) && /各存一条/.test(src);
  sig('截图暂存页：3 列网格 + 多选 + 合并/各存/原样存/忽略', shotGrid);

  // 处理期间必须明确写"别黑屏、别退出"（用户要求），并且真的保持屏幕常亮
  const shotWarn = /不要锁屏/.test(src) && /不要退出 App|也不要退出 App/.test(src)
    && /请保持屏幕常亮/.test(src) && /FLAG_KEEP_SCREEN_ON/.test(java)
    && /keepScreenOn/.test(bridge);
  sig('导入进度层有"别黑屏/别退出"提示，且真的保持常亮', shotWarn);

  // 进度层一直挂到 AI 解析结束（OCR+入队太快，收早了提示就白写了）
  const shotWait = /function waitShotsDone\(/.test(src) && /AI 正在解析/.test(src)
    && /noteIds/.test(read('src/dev/xduo/enote/Shots.java'));
  sig('进度层等到 AI 解析结束才收起', shotWait);

  // 文件夹可多选：首次向导 + 设置页入口，默认勾上截图目录
  const shotFolders = /function folderSheet\(\)/.test(src) && /function folderSave\(\)/.test(src)
    && /function folderPickShots\(\)/.test(src) && /只能选截图目录|只选截图目录/.test(src)
    && /setShotFolders/.test(bridge) && /RELATIVE_PATH/.test(shotsJava)
    && /BUCKET|looksLikeShot/.test(shotsJava);
  sig('监控文件夹可多选（MediaStore 枚举，默认勾截图目录）', shotFolders);

  // 首次不回捞历史 + 5 分钟重叠窗口 + sha1 去重 + 上限
  const shotWater = /first run, watermark set to now/.test(shotsJava)
    && /OVERLAP_SEC = 300/.test(shotsJava) && /SHA-1/.test(shotsJava)
    && /MAX_PER_SCAN = 50/.test(shotsJava) && /shotKeepMax\s+= 200/.test(shotsGo)
    && /Ignored/.test(shotsGo);
  sig('水位：首次不回捞 / 5 分钟重叠 / sha1 去重 / 忽略表', shotWater);

  // 多张合成一条笔记：kind=images，N 个附件，一次 LLM
  const shotMerge = /case "images":/.test(read('go/pipeline.go'))
    && /strings\.Join\(parts/.test(read('go/pipeline.go'))
    && /kind", "images"/.test(shotsJava);
  sig('合并模式：多附件一条笔记 + 只调一次 LLM', shotMerge);

  const shotRoutes = ['/api/shots/list', '/api/shots/add', '/api/shots/remove', '/api/shots/ignore']
    .every(r => goweb.indexOf(r) >= 0) && /m\.HandleFunc\("\/shotimg"/.test(goweb);
  sig('截图接口齐全（list/add/remove/ignore + /shotimg）', shotRoutes);

  const shotPerm = /READ_MEDIA_IMAGES/.test(manifest) && /READ_EXTERNAL_STORAGE/.test(manifest)
    && /maxSdkVersion="32"/.test(manifest) && /mediaGranted/.test(shotsJava);
  sig('存储/媒体权限按版本分开声明', shotPerm);

  // 初次运行要主动问一次"选哪些文件夹"，而不是只挂个横幅等用户自己点
  const shotIntro = /function shotIntroOnce\(\)/.test(src)
    && /localStorage\.getItem\('shotIntro'\)/.test(src)
    && /setItem\('shotIntro','1'\)/.test(src)
    && /要不要自动收集截图/.test(src);
  sig('初次运行主动引导选监控文件夹（只问一次）', shotIntro);

  // 长列表页的确定按钮必须固定在底部（用户反馈：滚到底才能点确定太难用）
  const stickyFoot = /\.pfoot\{position:sticky;bottom:0/.test(src)
    && /id="folderCount"/.test(src)
    && (src.match(/class="pfoot"/g) || []).length >= 3;   // 文件夹 / 截图 / 剪贴板
  sig('文件夹页/截图页/剪贴板页的操作按钮固定在底部', stickyFoot);

  // 已选数量实时显示 + 已选项排到最前（勾一个立刻重排并改数字）
  // 步骤 8：folderPick 现在先走 Vue 分发（return sheetPaint()），遗留路径才是 folderRender()；
  // 两条都是「改完立刻重画」，所以两个名字都算。slice 要盖到分发那一行之后（注释变长了）。
  const pickBody = (src.split('function folderPick(')[1] || '').slice(0, 400);
  const liveCount = /个已选 · 共 /.test(src)
    && /已选（且未消失）的排最前/.test(src)
    && /saveText/.test(src)                     // 底部「开始监控」文案跟着已选数变
    && /sheetPaint\(\)/.test(pickBody);
  sig('文件夹页实时显示已选数量、已选项排到最前', liveCount);

  // 选完文件夹回到「我的」要立刻看到新统计：强制重建当前页 + 重算统计
  // 步骤 8：必须切 'function folderSave(){'。只切 'function folderSave' 会先命中新加的
  // folderSaveText()，slice(0,900) 落在它身上 → 四项全 false，而 folderSave 本体完好（假红）。
  const saveBody = (src.split('function folderSave(){')[1] || '').slice(0, 900);
  const afterSave = /paneDirty\[tab\] = 1/.test(saveBody)
    && /setTab\(\)/.test(saveBody)
    && /statsNow\(\)/.test(saveBody)
    && /shotFlags\(function\(\)\{/.test(saveBody);
  sig('选完文件夹回到我的页立刻刷新统计', afterSave);

  // 只有一张截图时不该摆两个等价按钮（用户反馈）：一张只留「创建笔记」
  /* 步骤 17d：截图页迁到真响应式后 live() 变 computed()，签名两种写法都认（迁移期两种都在）。 */
  const oneBtn = /one: (live|computed)\(\(\) => selCount\.value <= 1\)/.test(src)
    && /<= 1 \? '创建笔记' : '合并成一条笔记'/.test(src)
    && /id="shotSplit"/.test(src) && /id="shotRaw"/.test(src)
    && /display:none/.test(src);
  sig('只选一张时只显示「创建笔记」一个按钮', oneBtn);

  // 清理暂存不能删掉笔记正在用的文件（缩略图 404 的根因）
  const keepGuard = /func \(s \*ShotStore\) dropUnlessKept/.test(goweb)
    && /keepFn func\(\) map\[string\]bool/.test(goweb)
    && /shotStore\.setKeep\(func\(\) map\[string\]bool/.test(gopipe)
    && /dropUnlessKept\(keep, x\.Path\)/.test(goweb);
  sig('清理/忽略/裁剪暂存时不删笔记在用的文件', keepGuard);

  // API Key 不打码：设置页打开就能看到已保存的 key（用户明确说不在意明文，
  // 打码反而让人以为没存住、反复重填）
  const plainKey = /func maskedSettings\(\) Settings \{\n\treturn config\.get\(\)/.test(goweb)
    && /id="sKey" :value\.attr="s\.apiKey \|\| ''"/.test(src)
    && /class="fhint"/.test(src);
  sig('API Key 明文显示在设置里（不再打码）', plainKey);

  // settings.json 必须原子写 + .bak 兜底：写到一半被杀掉不能把 key 弄丢
  const atomicCfg = /func \(c \*Config\) set\(s Settings\) error \{[\s\S]{0,1400}os\.Rename\(tmp, c\.path\)/.test(goweb)
    || /os\.Rename\(tmp, c\.path\)/.test(read('go/config.go'));
  sig('settings.json 原子写（.tmp + rename + .bak 兜底）', atomicCfg);

  // 首页横幅（剪贴板/截图/错过的提醒）不在 /api/search 结果里：
  // 搜索结果没变但条数变了时必须强制重绘，否则删光剪贴板、扫到新截图后横幅都不刷新
  const forcePaint = /async function searchNow\(force\)/.test(src)
    && /if\(k === SRK && !force\)/.test(src)
    && /searchNow\(dirty\)/.test(src);
  sig('横幅变化会强制重绘（searchNow(force)）', forcePaint);

  // 错过的提醒面板：只能看没法处理过（用户反馈），要有「完成」和「我知道了」
  const missedOps = /function missedDone\(/.test(src) && /function missedDismiss\(/.test(src)
    && /这批我知道了/.test(src) && /class="todo msrow"/.test(src);
  sig('错过的提醒面板：每行可完成 + 「这批我知道了」', missedOps);

  // 面板里的跳转必须用真存在的函数：goTab/goNote 不存在，点了没反应（用户反馈）
  /* 步骤 17f：tab 的赋值走 syncBox 镜像，签名两种写法都认。 */
  const missedJump = /function missedGoTodos\(\)\{\s*closeSheet\(\); tab = (?:syncBox\(TAB, )?'todos'\)?; setTab\(true\)/.test(src)
    && /@click\.prevent="H\.jump\(t\.nid\)"/.test(src) && !/function goTab\(/.test(src) && !/function goNote\(/.test(src);
  sig('错过的提醒面板：跳转用真存在的函数（setTab / jump）', missedJump);

  // 勾 ✓ 要复用待办页那套划线 + 淡出动画，不能静默改状态（用户反馈：看不出点到没有）
  const missedAnim = /function missedDone\(ev, nid, tid, el\)[\s\S]{0,240}toggle\(nid, tid, el\)/.test(src);
  sig('错过的提醒面板：勾 ✓ 复用待办页动画（划线 + 淡出）', missedAnim);

  // 截图要实时：进程一起来就监听 MediaStore，截完图 1~2 秒进暂存区
  const javaApp = read('src/dev/xduo/enote/EnoteApp.java');
  const javaShots = read('src/dev/xduo/enote/Shots.java');
  const shotWatch = /Shots\.watch\(this\)/.test(javaApp)
    && /registerContentObserver\(\s*MediaStore\.Images\.Media\.EXTERNAL_CONTENT_URI/.test(javaShots)
    && /postDelayed\(wTask, 1200\)/.test(javaShots);
  sig('相册变化实时监听（ContentObserver + 1.2s 去抖）', shotWatch);

})();

// ---------- 闸门⑰ 一页一序号 + 请求超时（步骤 13：骨架屏不许永久） ----------
// 步骤 11 真机撞到的竞态：filesNow() 用服务端搜索共用的 searchSeq 做抢占判定，
// 笔记页搜索一在飞，附件页这次请求的结果就被整次丢掉 → FA.loaded 永远 false，
// 附件页停在骨架屏只能切走再切回来。statsNow() 的 stBusy 同类：一次永不返回的
// 请求把我的页永久钉在骨架屏。测试侧轮询只是把症状盖住，产品侧的不变量由这里守：
//   ① 每一页的数据源用自己的序号，不许借用 searchSeq；
//   ② 每一页的数据源走 apiTimeout（fetch 无超时会永久挂起）；
//   ③ 失败要留下可观测的 error 状态，骨架屏上给「立即重试」（闸门⑮ 保证 H.xxx 在宿主表里）。
{
  const appSrc = read('go/ui/js/app.js');
  const filesSrc = read('go/ui/js/views/files.js');
  const statsSrc = read('go/ui/js/views/stats.js');
  const body = (head) => {
    const i = appSrc.indexOf(head);
    if (i < 0) return null;
    const j = appSrc.indexOf('\n}', i);
    return appSrc.slice(i, j < 0 ? appSrc.length : j);
  };
  const filesBody = body('async function filesNow(){');
  const statsBody = body('async function statsNow(){');
  const searchBody = body('async function searchNow(force){');
  if (!filesBody) bad('闸门⑰ 找不到 filesNow()', '函数签名改了，闸门自己在假绿');
  else {
    if (!/\+\+filesSeq/.test(filesBody)) bad('闸门⑰ filesNow 没用自己的 filesSeq', '借用 searchSeq 会被笔记页搜索整次抢占 → 附件页永久骨架屏');
    if (/searchSeq/.test(filesBody)) bad('闸门⑰ filesNow 里又出现 searchSeq', '同上：一页一序号');
    if (!/apiTimeout\(/.test(filesBody)) bad('闸门⑰ filesNow 没走 apiTimeout', 'fetch 卡死 = 这一页永久骨架屏');
    if (!/error:errText\(e\)/.test(filesBody)) bad('闸门⑰ filesNow 失败没记 FA.error', '没有可观测的失败状态，骨架屏上给不出重试');
    if (!/setTimeout\(filesNow/.test(filesBody)) bad('闸门⑰ filesNow 失败没自动重试', '用户不该靠切走再切回来恢复');
    else ok('闸门⑰ filesNow：独立序号 + 超时 + 失败自动重试');
  }
  if (!statsBody) bad('闸门⑰ 找不到 statsNow()', '函数签名改了，闸门自己在假绿');
  else {
    if (!/apiTimeout\(/.test(statsBody)) bad('闸门⑰ statsNow 没走 apiTimeout', 'fetch 卡死 = 我的页永久骨架屏');
    if (!/stSince/.test(statsBody)) bad('闸门⑰ stBusy 没有超时兜底', '一次永不返回的请求把我的页永久钉在骨架屏');
    if (!/stErr = (?:syncBox\(STERR, )?errText\(e\)\)?/.test(statsBody)) bad('闸门⑰ statsNow 失败没记 stErr', '同上：要给出可点的重试');
    else ok('闸门⑰ statsNow：stBusy 带超时 + 失败可重试');
  }
  if (searchBody && !/apiTimeout\(/.test(searchBody)) bad('闸门⑰ searchNow 没走 apiTimeout', '首页列表同样会永久停在骨架屏');
  if (!/FA\.error/.test(filesSrc) || !/H\.filesNow\(\)/.test(filesSrc)) bad('闸门⑰ 附件页骨架屏没有重试入口', 'FA.error 要在模板里可见可点');
  if (!/srErr/.test(read('go/ui/js/views/notes.js')) || !/H\.searchNow\(/.test(read('go/ui/js/views/notes.js'))) bad('闸门⑰ 首页搜索失败没有重试入口', 'srErr 要在模板里可见可点');
  if (!/stErr/.test(statsSrc) || !/H\.statsNow\(\)/.test(statsSrc)) bad('闸门⑰ 我的页骨架屏没有重试入口', 'stErr 要在模板里可见可点');
  if (filesBody && statsBody && searchBody) ok('闸门⑰ 三个页面数据源都是一页一序号 + 超时 + 可重试');
}

/* ---------- 闸门⑱：sheet 生命周期（步骤 13）----------
   pageSheetVue 会把 .panel 的 innerHTML 整块换掉：上一个 sheet（哪怕名字不同）的根节点
   从此是游离节点，app 实例 / effect / computed 缓存全都留着，渲染永远到不了它。
   closeSheet 以前手写四个名字（shots/folders/clip/settings），新增 sheet 忘了加就是
   静默泄漏 —— DOM 上、截图上都看不出，只有 mount 表知道。所以钉住：开新 sheet 与关
   sheet 都走 unmountAllSheets。
   步骤 17j：以前还要带一个 keep=['progress'] 例外（进度层挂在 body 级，要活过弹层），
   现在进度层是外壳组件 SheetHost 里的 <teleport to="#shotOvlRoot"> 子组件，常驻外壳树、
   不在 sheetApps 里，例外名单整个没用了 —— 这里钉住「不许再带例外」。 */
{
  const appSrc = read('go/ui/js/app.js');
  const vueSrc = read('go/ui/js/vue.js');
  const leaks = [];
  if (!/export function unmountAllSheets\s*\(/.test(vueSrc) || !/Object\.keys\(sheetApps\)/.test(vueSrc))
    leaks.push('vue.js 没导出 unmountAllSheets（或它不遍历 sheetApps）');
  const bodyOf = (head) => {
    const i = appSrc.indexOf(head);
    if (i < 0) return null;
    const j = appSrc.indexOf('\n}', i);
    return appSrc.slice(i, j < 0 ? appSrc.length : j);
  };
  const pv = bodyOf('function pageSheetVue(');
  if (!pv) leaks.push('找不到 pageSheetVue（闸门⑱ 在假绿）');
  else {
    if (!/unmountAllSheets\(\s*\)/.test(pv)) leaks.push('pageSheetVue 没全量拆 sheet');
    if (pv.indexOf("unmountSheet('") >= 0) leaks.push('pageSheetVue 里又写了硬编码的 unmountSheet 名单');
  }
  const cs = bodyOf('function closeSheet(');
  const sl = bodyOf('function sheetLeft(');
  if (!cs) leaks.push('找不到 closeSheet（闸门⑱ 在假绿）');
  else {
    /* 步骤 18d：拆 app 从 closeSheet 搬进了 van-popup 的 @vue:unmounted（sheetLeft），
       所以这条契约跨两个函数：closeSheet 只负责起收场动画与摘节点，sheetLeft 负责拆。 */
    if (!sl) leaks.push('找不到 sheetLeft（van-popup @vue:unmounted 的回调，闸门⑱ 在假绿）');
    else if (!/unmountAllSheets\(\s*\)/.test(sl)) leaks.push('sheetLeft 没全量拆 sheet');
    if (/unmountAllSheets\(\s*\[/.test(appSrc))
      leaks.push('unmountAllSheets 又带例外名单（步骤 17j：进度层是外壳树的 <teleport> 子组件，不在 sheetApps 里，不需要例外）');
    if (/mountSheet\('progress'/.test(appSrc))
      leaks.push('shotOverlay 还在手动 mountSheet(\'progress\')（步骤 17j 已交给 <teleport>）');
    if (sl && /unmountSheet\('/.test(sl)) leaks.push('sheetLeft 里又写了硬编码的 unmountSheet 名单（新增 sheet 会静默泄漏）');
    if (/unmountSheet\('/.test(cs)) leaks.push('closeSheet 里又写了硬编码的 unmountSheet 名单（新增 sheet 会静默泄漏）');
    const sh = read('go/ui/js/shell.js');
    /* 步骤 18d：外壳是 van-popup，显隐是 v-if + :show="true"，摘节点时 @vue:unmounted 拆 app。
       17i 那套 <transition :css="false"> 的 JS 钩子整批退役 —— 理由一模一样（Vue 的过渡
       靠双 requestAnimationFrame 排程，Chrome 不给不可见窗口出帧时永不落地，弹层关不掉、
       sheet 的 app 也不拆），只是这次连 Vue 的 <Transition> 都不用了：节点在不在是状态的
       纯函数，收场动画是 CSS 关键帧（走合成器），摘节点的定时器在后台标签页会被节流但会跑。 */
    if (!/@vue:unmounted="H\.sheetLeft"/.test(sh)) leaks.push('SheetHost 的 van-popup 没接 @vue:unmounted=H.sheetLeft（拆不掉 sheet）');
    if (/<transition/.test(sh)) leaks.push('SheetHost 用回了 <transition>：Vue 的过渡靠 rAF 排程，不可见窗口上永不落地（见 shell.js 的 SheetHost 注释）');
    if (!/shell\.sheet\.on = false/.test(cs)) leaks.push('closeSheet 没把 shell.sheet.on 置 false');
    if (!/shell\.sheet\.mounted = false/.test(cs)) leaks.push('closeSheet 没摘节点（shell.sheet.mounted = false）');
    if (!/setTimeout\(function\(\)\{ if\(!shell\.sheet\.on\)/.test(cs))
      leaks.push('closeSheet 摘节点的定时器没有状态守卫（关掉立刻重开会被迟到的定时器摘掉）');
    if (!/cssMs\('--d1'\)/.test(cs)) leaks.push('closeSheet 的收场时长没从样式表读（cssMs(\'--d1\')，样式表是时长唯一来源）');
    if (!/shell\.sheet\.mounted = true/.test(pv)) leaks.push('pageSheetVue 没让节点先存在（shell.sheet.mounted = true）');
    const ccs = read('go/ui/css/components.css');
    if (!/\.sheet\.closing \.panel\{animation:down/.test(ccs)) leaks.push('components.css 的收场动画选择器不是 .sheet.closing .panel（.closing 挂在根元素上）');
    if (!/\.sheet-ovl\.sheet-closing\{animation:van-fade-out/.test(ccs)) leaks.push('遮罩的收场动画没走 .sheet-ovl.sheet-closing（遮罩是 Vant 的 .van-overlay）');
    /* 步骤 17j：截图导入进度层住在外壳树里，靠 <teleport> 把 DOM 送到 body 级的
       #shotOvlRoot（层叠与位置零变化）。它必须住在 SheetHost（弹层的开合与它无关），
       并且组件自己声明 components —— 步骤 16d 的教训：Vue 对未注册组件只 warn。 */
    if (!/<teleport to="#shotOvlRoot">\s*<shot-progress\/>\s*<\/teleport>/.test(sh))
      leaks.push('进度层不在 SheetHost 的 <teleport to="#shotOvlRoot"><shot-progress/></teleport> 里');
    if (!/components:\s*\{[^}]*ShotProgress/.test(sh)) leaks.push('SheetHost 没在自己 components 里声明 ShotProgress');
    if (/VUE_SHEETS = \{[^}]*progress:/.test(appSrc)) leaks.push('progress 又回到 VUE_SHEETS 注册表（步骤 17j 后它不是弹层）');
  }
  if (leaks.length) bad('sheet 生命周期被破坏', leaks.join('；'));
  else ok('闸门⑱ 开/关弹层都全量拆 sheet，进度层是例外');
}

/* ---------- 闸门⑲：弹层底部条的两种布局形态（步骤 13，Tony 审查提出）----------
   .pfoot 是 flex + flex-wrap（计数整条不许断，挤不下让按钮掉到第二行），而 clip / shots
   两个弹层的底部条带内联 style="display:block"：它们的计数是独立 block div，天然独占一行，
   走 flex 会变成「计数和三个按钮挤一行」。删掉那行内联样式的人看不见这个差别（全宽下
   两种布局都放得下，窄屏才咬人），测试也不会红 —— 所以钉住：该带的必须带，不该带的不许带。 */
{
  const forms = [['go/ui/js/views/clip.js', true], ['go/ui/js/views/shots.js', true],
                 ['go/ui/js/views/folders.js', false], ['go/ui/js/views/sheets.js', false]];
  const drift = [];
  for (const [f, block] of forms) {
    const src = read(f);
    const hits = [...src.matchAll(/<div class="pfoot"([^>]*?)(?:>|\n)/g)];
    if (!hits.length) { drift.push(f + ' 找不到 class="pfoot"（闸门⑲ 在假绿）'); continue }
    for (const h of hits) {
      const isBlock = /display:\s*block/.test(h[1]);
      if (isBlock !== block)
        drift.push(f + ' 的 .pfoot 内联样式是 ' + (isBlock ? 'display:block' : 'flex（默认）')
          + '，期望 ' + (block ? 'display:block（计数独占一行）' : 'flex + flex-wrap（计数整条不许断）'));
    }
  }
  if (drift.length) bad('弹层底部条布局形态漂移', drift.join('；'));
  else ok('闸门⑲ 弹层底部条两种布局形态钉住（clip/shots 计数独占行，folders/提醒面板走 flex+wrap）');
}

/* ---------- 闸门⑳：列表条目的稳定 id 定位（步骤 14 的账）----------
   SIT / CIT 以前用 q()[0] 点第一条：DOM 顺序一变（排序、加表头、新增字段）就静默点到
   别的条目，断言全绿而测的不是目标。现在条目模板带 :id="'clipitem-'+x.id"，测试用
   getElementById 定位。这里钉两侧：模板里那句 :id 还在，且 test.sh 真的在用它 ——
   只删一侧时另一侧的 getElementById 永远找不到元素，而 payload 里「找不到」是写成
   token 输出的，没人保证两侧同时存在。找不到模式时报「闸门在假绿」，不许静默空跑。 */
{
  const pins = [
    ['go/ui/js/views/clip.js', /:id="'clipitem-'\+x\.id"/, /clipitem-/, 'ClipItem 条目'],
    ['go/ui/js/views/shots.js', /:id="'shotitem-'\+x\.id"/, /shotitem-/, 'ShotItem 卡片'],
    ['go/ui/js/components.js', /:id="'n'\+n\.id"/, /getElementById\("n"\+/, 'NoteCard 卡片'],
  ];
  const drift = [];
  for (const [f, tpl, use, name] of pins) {
    if (!tpl.test(read(f)))
      drift.push(f + ' 里找不到 ' + name + ' 的稳定 id（模板的 :id 被删了，测试侧的 getElementById 会静默找不到元素）');
    if (!use.test(testSh))
      drift.push('test.sh 里不再引用 ' + name + ' 的稳定 id（选择器改回位置索引了？）');
  }
  if (drift.length) bad('列表条目的稳定 id 定位断了', drift.join('；'));
  else ok('闸门⑳ 条目稳定 id 三处齐全（clipitem- / shotitem- / n+id：模板 :id 与 test.sh 定位两侧都在）');
}

/* ---------- 闸门㉑：test.sh 顶层注释风格 + 剪贴板夹具的跨轮收尾（步骤 14，Tony 实测撞出）----------
   两件事一起钉：
   1) test.sh 是 sh 跑的，斜杠星开头的 C 风格注释在 sh 里是命令（glob），test.sh:14 的
      set -eu 下直接 127 退出。bash -n 看不出来（语法合法），真跑到那行才炸，而且炸在套件
      最后几分钟 —— 反向实验：把收尾那段注释改成 C 风格，全量跑红在 127。JS 载荷里的
      C 风格注释都是缩进的，所以这里只禁止行首。扫的是仓库里全部 .sh（build.sh / install.sh /
      lib/*.sh / .test/*.sh 同一个坑）。
   2) 套件最后一次剪贴板写入必须是空：写夹具的步骤收尾要 clipset ' ' + clip/clear + 断空，
      否则 app 启动扫剪贴板 / 前台轮询 clipAdd 会把残留夹具重新暂存，红的是下一轮开头的
      硬基线（test.sh:280 clip=1）。见 plan.md §9.20 ⑥ / §9.4。 */
{
  const drift = [];
  // 扫仓库里所有 .sh（同一类坑在 build.sh / install.sh / lib/*.sh / .test/*.sh 一样会炸）。
  const shFiles = [];
  (function walkSh(d, rel) {
    for (const f of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (f.isDirectory()) { if (!['.git', 'node_modules', 'vendor', 'build', '.gradle'].includes(f.name)) walkSh(path.join(d, f.name), rel + f.name + '/'); }
      else if (/\.sh$/.test(f.name)) shFiles.push([rel + f.name, fs.readFileSync(path.join(d, f.name), 'utf8')]);
    }
  })(root, '');
  for (const [rel, src] of shFiles) {
    src.split('\n').forEach((l, i) => {
      if (/^\/\*/.test(l)) drift.push(rel + ':' + (i + 1) + ' 行首是 /* —— sh 里这是命令不是注释，set -eu 下 127 退出（bash -n 看不出来）');
    });
  }
  const clipClears = (testSh.match(/--es hook clipset --es arg ' '/g) || []).length;
  if (clipClears < 2)
    drift.push('test.sh 里 clipset 空白收尾只剩 ' + clipClears + ' 处：每个往剪贴板写夹具的步骤都要自己收尾清空');
  if (!/本步收尾后剪贴板暂存区不是 0/.test(testSh))
    drift.push('剪贴板夹具步的收尾没断空（找不到「本步收尾后剪贴板暂存区不是 0」）：泄漏会躲过本轮，红在下一轮的硬基线');
  if (drift.length) bad('test.sh 顶层注释风格 / 剪贴板跨轮收尾断了', drift.join('；'));
  else ok('闸门㉑ ' + shFiles.length + ' 个 .sh 顶层无 /* 伪注释（sh 会当命令 127 退出），剪贴板夹具收尾两处 clipset 空白 + 断空齐全');
}

/* ---------- 闸门㉒：ES module 的 import 名字必须真被 export（步骤 15 踩过）----------
   app.js 里写了 `import { nextTick } from './vue.js'`，而 vue.js 只在内部调用
   Vue.nextTick()、没导出它 —— 这是 module **解析期**的 SyntaxError：整份 app.js 一行都不
   执行，页面整块空白，而 node --check 与所有旧闸门全绿（它们只看单文件语法与字符串契约）。
   真机上是启动自检的 probe 报「模块解析/加载失败」才看得见，代价是一次 build + install +
   跑测（跑测还要跑到 P6.6 才红）。反向实验：删掉 vue.js 的 `export const nextTick`
   → 本闸门立刻红并点名 nextTick。 */
{
  const mods = new Map(walkJs(uiDir));
  const bad22 = [];
  const exportsOf = (src) => {
    const names = new Set();
    for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
    for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
      for (const part of m[1].split(',')) {
        const t = part.trim(); if (!t) continue;
        const as = t.split(/\s+as\s+/); names.add((as[1] || as[0]).trim());
      }
    if (/^export\s+default\b/m.test(src)) names.add('default');
    return names;
  };
  const expCache = new Map();
  let impCount = 0;
  for (const [p, src] of mods) {
    for (const m of src.matchAll(/import\s+\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = path.normalize(path.join(path.dirname(p), spec)).replace(/\\/g, '/');
      const tsrc = mods.get(target);
      if (tsrc === undefined) { bad22.push(p + ' import 的 ' + spec + ' 文件不存在'); continue; }
      if (!expCache.has(target)) expCache.set(target, exportsOf(tsrc));
      const exp = expCache.get(target);
      for (const part of m[1].split(',')) {
        const t = part.trim(); if (!t) continue;
        impCount++;
        const name = t.split(/\s+as\s+/)[0].trim();
        if (!exp.has(name)) bad22.push(p + ' import 的 ' + name + ' 不是 ' + spec
          + ' 的导出（module 解析期 SyntaxError → 整份脚本不执行、页面空白）');
      }
    }
  }
  if (bad22.length) bad('闸门㉒ import/export 对不上', bad22.join(' | '));
  else ok('闸门㉒ ' + mods.size + ' 个模块的 ' + impCount + ' 处具名 import 全部真被导出（解析期 SyntaxError 类故障）');
}

/* ---------- 闸门㉓：组件模板里 v-html 归零（S3 步骤 16d）----------
   v-html 插字符串 HTML 是混合期的折中：那段结构在模板编译、tick 依赖、闸门①b/⑮ 的
   视野之外（字符串里的 onclick 连闸门① 都扇不到，P12「点了没反应」就是这么来的）。
   步骤 16a~16d 把它们逐块翻成真组件，这里钉住「不再回来」。
   只扫模板字面量（template: `…` / template: '…'），注释里提 v-html 不算。
   反向实验：把 leaf.js 的 KvRow 改回 v-html="v" → 本闸门立刻红并点名 leaf.js。 */
{
  const hits = [];
  let tplCount = 0;
  for (const [rel, src] of walkJs(uiDir)) {
    for (const m of src.matchAll(/template:\s*(`[\s\S]*?`|'[^']*')/g)) {
      tplCount++;
      if (/v-html[=:]/.test(m[1])) hits.push(rel);
    }
  }
  if (hits.length) bad('闸门㉓ 模板里还有 v-html（字符串 HTML 绕过闸门⑮ 的模板编译与 tick 检查）',
    [...new Set(hits)].join(', '));
  else ok('闸门㉓ ' + tplCount + ' 个组件模板里 v-html 归零（字符串 HTML 全部翻成真模板）');
}

/* ---------- 闸门㉔：组件模板里的自定义标签必须在它自己的 components 里声明 ----------
   闸门⑮ 的注册表是「每个文件一份」（文件头注释里那行 components: { ... }），Vue 运行时
   认的却是组件自己的 components 选项。两者可以不一致，而后果是运行时的：模板里写了
   <ico> 而组件没声明 → Vue 只 console.warn(Failed to resolve component) 并渲染出一个
   <ico> 裸元素，图标位置空着，静态闸门与 test.sh 的文本断言都看不见（16d 真机抓到）。
   自定义标签 = 带连字符的标签 ∪ 不在原生标签表里的单词标签（本项目只有 <ico>）。 */
{
  const NATIVE = new Set(('a abbr address area article aside audio b bdi bdo blockquote body br button canvas caption '
    + 'cite code col colgroup data datalist dd del details dfn dialog div dl dt em embed fieldset figcaption figure '
    + 'footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label legend li link main '
    + 'map mark menu meta meter nav noscript object ol optgroup option output p param picture pre progress q rp rt ruby '
    + 's samp script section select small source span strong style sub summary sup table tbody td template textarea tfoot '
    + 'th thead time title tr track u ul var video wbr svg use path circle rect line g defs text tspan polyline polygon '
    + 'ellipse stop linearGradient').split(/\s+/));
  const miss24 = [];
  let compCount = 0;
  for (const [rel, src] of walkJs(uiDir)) {
    for (const m of src.matchAll(/export const (\w+) = \{([\s\S]*?)\n\};/g)) {
      const [, name, body] = m;
      const declared = new Set();
      const cm = body.match(/components:\s*\{([^}]*)\}/);
      if (cm) for (const part of cm[1].split(',')) {
        const t = part.trim(); if (!t) continue;
        const kv = t.split(':');
        const nm = (kv.length === 1 ? kv[0] : kv[1]).trim();
        declared.add(nm);
        declared.add(nm.replace(/(?<!^)(?=[A-Z])/g, '-').toLowerCase());
      }
      const used = new Set();
      for (const t of body.matchAll(/template:\s*`([\s\S]*?)`/g))
        for (const tag of t[1].matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g))
          if (tag[1].includes('-') || !NATIVE.has(tag[1])) used.add(tag[1]);
      compCount++;
      for (const tag of used)
        if (!declared.has(tag)) miss24.push(rel + ' 的 ' + name + ' 模板用了 <' + tag + '> 但自己没声明');
    }
  }
  if (miss24.length) bad('闸门㉔ 组件的 components 选项缺声明（Vue 只 warn，渲染出裸元素）',
    miss24.join(' | '));
  else ok('闸门㉔ ' + compCount + ' 个组件的自定义标签全在自己 components 里（运行时可解析）');
}

/* ---------- 闸门㉕：调试基建（S4 步骤 17a）----------
   两个 Vue 构建 + ?vue=dev 开关 + WebView 可调试，三样是一套：
   prod 构建里 devtools hook 被编译期剪掉（实测出现 0 次），所以「看组件树」必须换文件；
   更值钱的是运行时警告 —— 步骤 16d 的裸 <ico> 在 prod 里完全静默。
   这里钉住四件事：选择器在 module 之前、两个构建都在 VENDOR.md 里登记了 sha256、
   Java 侧开了 setWebContentsDebuggingEnabled、README §5.2 写着怎么用。
   （vendor 内容本身的 sha256 由 go/web_test.go 逐文件核对。） */
{
  const html = read('go/ui/index.html');
  const java = read('src/dev/xduo/enote/MainActivity.java');
  const vendor = read('go/ui/vendor/VENDOR.md');
  const readme = read('README.md');
  const miss25 = [];
  if (!html.includes('/vendor/vue.global.js')) miss25.push('index.html 没有 dev 构建路径');
  if (!html.includes('__VUE_DEV__')) miss25.push('index.html 没有构建选择器');
  if (html.indexOf('__VUE_DEV__') > html.indexOf('type="module" src="/js/app.js"'))
    miss25.push('选择器必须在 <script type=module> 之前（js/vue.js 模块求值时就要拿到 window.Vue）');
  const rows = [...vendor.matchAll(/\| 文件 \| `([^`]+)` \|[\s\S]{0,500}?\| sha256 \| `([0-9a-f]{64})` \|/g)];
  if (rows.length < 2) miss25.push('VENDOR.md 里登记的构建不足两个（每个都要有 文件 + sha256 行）');
  for (const [, name] of rows)
    if (!read('go/ui/vendor/' + name)) miss25.push('VENDOR.md 登记的 ' + name + ' 不在 vendor 目录里');
  if (!/setWebContentsDebuggingEnabled\s*\(\s*true\s*\)/.test(java))
    miss25.push('MainActivity 没开 setWebContentsDebuggingEnabled(true)（Chrome inspect 进不去）');
  if (!readme.includes('vue=dev')) miss25.push('README 没写 ?vue=dev 怎么用');
  if (!java.includes('enote/.vuedev')) miss25.push('MainActivity 的 dev 开关不是 enote/.vuedev（必须与 jseval 的 .devmode 分开）');
  if (miss25.length) bad('闸门㉕ 调试基建缺件（Vue dev 版 / devtools 入口）', miss25.join(' | '));
  else ok('闸门㉕ 调试基建齐全：' + rows.map(m => m[1]).join(' + ') + ' + ?vue=dev 开关 + WebView 可调试');
}

// ---------- 输出 ----------
for (const s of oks) console.log('ok   ' + s);
for (const s of fails) console.log('FAIL ' + s);
process.exit(fails.length ? 1 : 0);
