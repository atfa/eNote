#!/usr/bin/env node
/* 步骤 16b 的 DOM 等价性比对（用法同 dom_equiv.js，看那个文件的头注释）。
   输入：.test/live_state.json（探针 dump 的同一份状态）+ .test/live_dom_blocks.jsonl。
   旧侧：git show HEAD:go/ui/js/app.js 里被删掉的那批字符串函数，原样抠出来在沙箱里跑。
   归一化规则与 dom_equiv.js 一致（注释里也逐条写了为什么允许）。 */
'use strict'
const fs = require('fs'), cp = require('child_process')

const OLD = cp.execSync('git show HEAD:go/ui/js/app.js', { encoding: 'utf8' })
function grab(src, sig) {
  const i = src.indexOf(sig)
  if (i < 0) throw new Error('HEAD app.js 里找不到 ' + sig)
  let k = src.indexOf('{', i), d = 0
  for (; k < src.length; k++) {
    if (src[k] === '{') d++
    else if (src[k] === '}') { d--; if (!d) break }
  }
  return src.slice(i, k + 1)
}
const names = ['ic', 'esc', 'fmtTime', 'fmtSize', 'relTime', 'attachMetaHTML', 'attachGlyphHTML',
  'fileStripInner', 'clipCountHTML', 'statsHeroInner', 'statsNotesCardHTML', 'statsRunInnerHTML',
  'statsRunRowsHTML', 'kvHTML', 'ocrReadyHTML', 'settingsDataCardHTML', 'settingsRunCardHTML',
  'settingsCollectHTML', 'settingsOcrCardHTML', 'settingsUsageHTML', 'settingsKeepAliveNoteHTML']
const code = names.map(n => grab(OLD, 'function ' + n + '(')).join('\n')
  + '\n' + grab(OLD, 'var KIND = ') + ';'

const st = JSON.parse(fs.readFileSync('.test/live_state.json', 'utf8'))
// 附件页的 FA 是探针在附件页 dump 的那份（我的页那份 loaded:false，strip 会算成「附件 0」）
if (fs.existsSync('.test/live_fa.json')) {
  const fa = JSON.parse(fs.readFileSync('.test/live_fa.json', 'utf8'))
  if (fa && fa.items) st.FA = fa
}
const live = fs.readFileSync('.test/live_dom_blocks.jsonl', 'utf8').trim().split('\n').map(l => JSON.parse(l))
const dom = Object.assign({}, ...live)

const box = new Function('ST', 'S', 'FA', 'clipList', 'clipSel', `
${code}
return { ${names.join(', ')} }
`)(st.ST, { info: st.info, ocrInfo: st.ocrInfo, settings: st.settings }, st.FA, st.clipList, st.clipSel)

function norm(s) {
  if (s == null) return null
  return String(s)
    .replace(/<!---->/g, '')
    .replace(/ class="([^"]*)"/g, (m, cls) => {
      const keep = cls.split(/\s+/).filter(c => c && c !== 'enter' && c !== 'justdone')
      return keep.length ? ' class="' + keep.join(' ') + '"' : ''
    })
    .replace(/ style="display: none;"/g, '')
    .replace(/ onclick="[^"]*"/g, '')
    .replace(/<use ([^>]*?)\/>/g, '<use $1></use>')
    // uptimeS 每秒 +1：状态是探针开头 dump 的，DOM 是几秒后抓的，差几秒不是结构差异。
    .replace(/\/ \d+s</g, '/ Ns<')
    // style 属性：遗留路径是字符串拼的 innerHTML，属性文本逐字保留；Vue 把静态 style
    // 解成对象再写 el.style.cssText，浏览器重序列化成 `margin-top: var(--s0);`。
    // 两边计算样式相同，只是属性文本的空格/分号写法不同 → 归一化成 `k:v;k:v`。
    .replace(/ style="([^"]*)"/g, (m, css) =>
      ' style="' + css.split(';').map(s => s.trim()).filter(Boolean)
        .map(d => d.replace(/\s*:\s*/, ':')).join(';') + '"')
    .replace(/<svg([^>]*)><use([^>]*)><\/use><\/svg>/g, '<svg$1><use$2></use></svg>')
    .replace(/>\s+</g, '><')
    .trim()
}

const A = st.FA && st.FA.items ? st.FA.items : []
const firstGlyph = A.filter(a => !(a.kind === 'image' && !a.missing))[0]
const cases = [
  ['我的页 hero', dom.hero, box.statsHeroInner(st.info, st.ST) && '<div class="hero">' + box.statsHeroInner(st.info, st.ST) + '</div>'],
  ['我的页 笔记状态卡', dom.notesCard, st.ST && '<div class="card">' + box.statsNotesCardHTML(st.ST) + '</div>'],
  ['我的页 运行信息卡', dom.runCard, '<div class="card">' + box.statsRunInnerHTML(st.info) + '</div>'],  ['附件页 统计条', dom.strip, '<div class="strip">' + box.fileStripInner() + '</div>'],
  ['附件卡 元信息行', dom.ameta, firstGlyph && '<div class="ameta">' + box.attachMetaHTML(firstGlyph) + '</div>'],
  ['附件卡 图标块', dom.aglyph, firstGlyph && '<div class="aglyph">' + box.attachGlyphHTML(firstGlyph) + '</div>'],
  ['剪贴板 计数条', dom.clipFoot, '<div class="count" id="clipFoot" style="margin-bottom:var(--s2)">' + box.clipCountHTML() + '</div>'],
  ['设置页 采集卡', dom.collect, '<div class="card">' + box.settingsCollectHTML() + '</div>'],
  ['设置页 本地 OCR 卡', dom.ocrCard, '<div class="card">' + box.settingsOcrCardHTML(st.info) + '</div>'],
  ['设置页 数据卡', dom.dataCard, '<div class="card">' + box.settingsDataCardHTML() + '</div>'],
  ['设置页 运行状态卡', dom.setRunCard, '<div class="card">' + box.settingsRunCardHTML(st.info) + '</div>'],
  ['设置页 用法卡', dom.usage, '<div class="card">' + box.settingsUsageHTML() + '</div>'],
  ['设置页 保活长说明', dom.keepNote, '<div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">' + box.settingsKeepAliveNoteHTML() + '</div>']
]

let bad = 0
for (const [name, liveHtml, oldHtml] of cases) {
  if (!liveHtml || !oldHtml) { console.log('SKIP ' + name + '（现场没有这一项：' + (liveHtml ? '旧侧空' : 'DOM 里没有') + '）'); continue }
  const a = norm(liveHtml), b = norm(oldHtml)
  if (a === b) { console.log('ok   ' + name + '（' + a.length + ' B 逐字一致）'); continue }
  bad++
  console.log('FAIL ' + name)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.log('  首个差异 @' + i)
      console.log('  新: ' + JSON.stringify(a.slice(Math.max(0, i - 70), i + 90)))
      console.log('  旧: ' + JSON.stringify(b.slice(Math.max(0, i - 70), i + 90)))
      break
    }
  }
}
console.log(bad ? bad + ' 处不一致' : '全部一致')
process.exit(bad ? 1 : 0)
