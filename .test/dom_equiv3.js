#!/usr/bin/env node
/* 步骤 16c 的 DOM 等价性比对：六个「字符串弹层」翻成 Vue 组件之后，真机渲染出的
   #sheetBody 与迁移前字符串函数的输出逐字比。

   用法：
     ./.test/probe_sheets.sh > .test/live_sheets.txt
     node .test/dom_equiv3.js          # 解析探针输出到 .test/live_sheets.json 并比对
   旧侧：git show HEAD:go/ui/js/app.js 里被删掉的那批字符串函数，原样抠出来在沙箱里跑
   （sheet / pageSheet 换成捕获函数，api 换成探针 dump 的那份真数据）。
   归一化规则与 .test/dom_equiv2.js 一致（那边逐条写了为什么允许），这里只多一条：
   卡片形态的旧字符串带 .grip + .pclose（迁移前由 sheet() 拼），新侧这两样在外壳里，
   #sheetBody 里没有 → 从旧串里删掉。 */
'use strict'
const fs = require('fs'), cp = require('child_process')

const raw = fs.readFileSync('.test/live_sheets.txt', 'utf8')
const m = /PD3 (\{[\s\S]*\})/.exec(raw)
if (!m) { console.log('FAIL 探针输出里找不到 PD3'); process.exit(1) }
const live = JSON.parse(m[1])
fs.writeFileSync('.test/live_sheets.json', JSON.stringify(live, null, 1), 'utf8')

const OLD = cp.execSync('git show HEAD:go/ui/js/app.js', { encoding: 'utf8' })
function grab(sig) {
  const i = OLD.indexOf(sig)
  if (i < 0) throw new Error('HEAD app.js 里找不到 ' + sig)
  let k = OLD.indexOf('{', i), d = 0
  for (; k < OLD.length; k++) {
    if (OLD[k] === '{') d++
    else if (OLD[k] === '}') { d--; if (!d) break }
  }
  return OLD.slice(i, k + 1)
}
const names = ['P', 'ic', 'esc', 'now', 'fmtTime', 'spanText', 'cdText', 'cdCls', 'dueMs',
  'cdChip', 'emptyState', 'group', 'clip', 'sortSheet', 'missedSheet', 'addSheet',
  'addTodoSheet', 'showLog', 'showDebug']
const code = names.map(n => grab(OLD.includes('async function ' + n + '(')
  ? 'async function ' + n + '(' : 'function ' + n + '(')).join('\n')

/* 每次用例换一次环境（tab / prefs / MISSED / api 都是模块变量，沙箱里当参数传进去）。 */
function run(tabName, prefs, MISSED, payload, fn, args) {
  let cap = null
  const env = new Function('prefs', 'tab', 'S', 'MISSED', 'api', 'sheet', 'pageSheet',
    code + '\nreturn { ' + names.filter(n => n !== 'P' && n !== 'tab').join(', ') + ', P }')
    (prefs, tabName, { missed: MISSED }, MISSED,
      async (url) => payload,
      (html) => { cap = html; return Promise.resolve() },
      (title, html) => { cap = html; return Promise.resolve() })
  return Promise.resolve(env[fn].apply(null, args || [])).then(() => cap)
}

function norm(s) {
  if (s == null) return null
  return String(s)
    .replace(/<!---->/g, '')
    .replace(/ class="([^"]*)"/g, (mm, cls) => {
      const keep = cls.split(/\s+/).filter(c => c && c !== 'enter' && c !== 'justdone')
      return keep.length ? ' class="' + keep.join(' ') + '"' : ''
    })
    .replace(/ onclick="[^"]*"/g, '')
    .replace(/<use ([^>]*?)\/>/g, '<use $1></use>')
    .replace(/ style="([^"]*)"/g, (mm, css) =>
      ' style="' + css.split(';').map(s => s.trim()).filter(Boolean)
        .map(d => d.replace(/\s*:\s*/, ':')).join(';') + '"')
    .replace(/<svg([^>]*)><use([^>]*)><\/use><\/svg>/g, '<svg$1><use$2></use></svg>')
    // esc() 把 " 转成 &quot; 再塞进 innerHTML；Vue 的 {{ }} 写的是 textContent，序列化
    // 回来 " 保持原样。两边 textContent 相同，只是转义写法不同 → 统一按 textContent 比。
    .replace(/&quot;/g, '"')
    .replace(/>\s+</g, '><')
    .trim()
}
// 卡片形态：迁移前 sheet() 把 .grip + .pclose 拼在内容前面，现在它们在外壳里
const CARD_HEAD = /^<div class="grip"><\/div><button class="pclose"[^>]*>✕<\/button>/

const cases = [
  ['排序页 · 笔记', 'sort_notes', 'notes', 'prefs_notes', null, null, 'sortSheet', []],
  ['排序页 · 待办', 'sort_todos', 'todos', 'prefs_todos', null, null, 'sortSheet', []],
  ['排序页 · 附件', 'sort_files', 'files', 'prefs_files', null, null, 'sortSheet', []],
  ['记一笔', 'add', 'notes', 'prefs_notes', null, null, 'addSheet', []],
  ['添加待办', 'addtodo', 'notes', 'prefs_notes', null, null, 'addTodoSheet', ['n123']],
  ['运行日志', 'log', 'notes', 'prefs_notes', 'logData', null, 'showLog', []],
  ['AI 调用记录', 'debug', 'notes', 'prefs_notes', 'debugData', null, 'showDebug', []],
  ['错过的提醒', 'missed', 'notes', 'prefs_notes', null, 'missedState', 'missedSheet', []],
  ['错过的提醒 · 空态', 'missed_empty', 'notes', 'prefs_notes', null,
    { count: 0, items: [] }, 'missedSheet', []]
]

;(async () => {
  let bad = 0
  for (const [label, key, tabName, prefsKey, payloadKey, missed, fn, args] of cases) {
    const prefs = {}
    prefs[tabName] = live[prefsKey] || {}
    const payload = payloadKey ? live[payloadKey] : {}
    // missed 那一列给的是「探针 dump 出来的状态键名」（或直接给对象），统一取真值
    const ms = typeof missed === 'string' ? live[missed] : missed
    const oldHtml = await run(tabName, prefs, ms || { count: 0, items: [] },
      payload, fn, args)
    const old = norm(oldHtml === null ? null
      : (oldHtml || '').replace(CARD_HEAD, ''))
    const now = norm(live[key])
    if (old === null) { console.log('FAIL ' + label + '：旧侧字符串函数没产出 HTML'); bad++; continue }
    if (live[key + '_err']) { console.log('FAIL ' + label + '：探针抛错 ' + live[key + '_err']); bad++; continue }
    if (old === now) { console.log('ok   ' + label); continue }
    bad++
    console.log('FAIL ' + label)
    let i = 0
    while (i < old.length && i < now.length && old[i] === now[i]) i++
    console.log('  旧: …' + old.slice(Math.max(0, i - 60), i + 120))
    console.log('  新: …' + now.slice(Math.max(0, i - 60), i + 120))
  }
  console.log(bad ? '有 ' + bad + ' 项不一致' : '全部一致')
  process.exit(bad ? 1 : 0)
})()
