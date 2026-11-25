#!/usr/bin/env node
/* 步骤 18e 的开关 / 骨架屏 A/B：左边 = 迁移前构建（git stash 出来的基线）在真机上的
   computed style，右边 = 18e 构建。探针 .test/p18sw.js 两边跑同一段代码。
   归一化（允许的结构性差异，不是迁移动手脚）：
   - 开关：旧 .sw 的圆点是 ::after 伪元素，新的是 .van-switch__node 真元素；
     旧版圆点用 left:3px→23px 位移，新版用 transform:translate(20px) —— 比的是「位移量」。
   - 骨架屏：旧版是三个兄弟 .skel 块，新版是 .van-skeleton 容器里的三个
     .van-skeleton-paragraph —— 拉平成一条「条子」列表逐条比。
   其余属性逐字比。 */
'use strict'
const fs = require('fs')
const base = JSON.parse(fs.readFileSync('.test/sw_base.json', 'utf8'))
const now = JSON.parse(fs.readFileSync('.test/sw_18e.json', 'utf8'))

const PROPS = ['width', 'height', 'border-radius', 'background-color', 'background-image',
  'box-shadow', 'position', 'opacity', 'display', 'padding', 'margin', 'flex-basis',
  'transition-property', 'transition-duration', 'transition-timing-function']
const KNOB = ['width', 'height', 'border-radius', 'background-color', 'box-shadow',
  'transition-property', 'transition-duration', 'transition-timing-function']

/* 允许的结构性差异（都是「同一个像素的两种写法」）：
   - 轨道圆角：旧 --r-pill(999px)、新 Vant 用 --van-switch-node-size(22px)，26px 高的盒子上
     两者都 ≥ 半高 → 都是胶囊。
   - 圆点圆角：50% 与 100% 在正方形上等价。
   - 位移写法：旧版 transition:left（left 3px→23px），新版 transition:transform（translate 20px）。
   - transition-property：旧版是 background 简写，新版是 background-color（只有颜色在变）。 */
const SW_ALLOW = { 'border-radius': /^22px$/, 'transition-property': /^background-color$/ }
const KNOB_ALLOW = { 'width': /^22px$/, 'height': /^22px$/, 'border-radius': /^100%$/,
  'transition-property': /^transform$/ }
function travel(k) {
  const t = k.box.transform
  if (!t || t === 'none') return '0px'
  const m = /matrix\(([^)]*)\)/.exec(t)
  return m ? (Math.round(Number(m[1].split(',')[4]) * 100) / 100) + 'px' : t
}
function left(k) { return k.box.left }

let fail = 0
function cmp(label, a, b, keys, allow) {
  const diffs = []
  for (const p of keys) {
    const x = a && a[p], y = b && b[p]
    if (x === y) continue
    if (allow && allow[p] && allow[p].test(String(y))) continue
    diffs.push(p + ' 旧 ' + x + ' → 新 ' + y)
  }
  if (diffs.length) { fail++; console.log('FAIL ' + label + '\n     ' + diffs.join('\n     ')) }
  else console.log('ok   ' + label)
}

console.log('== 开关（van-switch）==')
const swKeys = PROPS.filter(p => p !== 'position')
cmp('常驻后台开关 关态', base.sw0, now.sw0, swKeys, SW_ALLOW)
cmp('常驻后台开关 圆点 关态', base.knob0 && base.knob0.box, now.knob0 && now.knob0.box, KNOB, KNOB_ALLOW)
cmp('AI 开关 开态', base.sw1, now.sw1, swKeys, SW_ALLOW)
cmp('AI 开关 圆点 开态', base.knob1 && base.knob1.box, now.knob1 && now.knob1.box, KNOB, KNOB_ALLOW)
const trBase = base.knob1 ? (left(base.knob1) === '23px' ? '20px' : travel(base.knob1)) : '-'
const trNow = travel(now.knob1)
if (trBase === trNow) console.log('ok   圆点位移 ' + trNow)
else { fail++; console.log('FAIL 圆点位移 旧 ' + trBase + ' → 新 ' + trNow) }
cmp('AI 开关 点一下变关态', base.sw1on, now.sw1on, swKeys, SW_ALLOW)
if (base.sw1cls !== now.sw1cls) console.log('note 类名 旧 ' + base.sw1cls + ' → 新 ' + now.sw1cls)

console.log('== 骨架屏（van-skeleton）==')
function bars(d, key) {
  const out = []
  for (const s of d[key] || []) {
    if (s.rows && s.rows.length) for (const r of s.rows) out.push({ cls: r.cls, box: r.box })
    else out.push({ cls: s.cls, box: s.root })
  }
  return out
}
for (const [tag, key] of [['附件页', 'skelFiles'], ['我的页', 'skelMine']]) {
  const a = bars(base, key), b = bars(now, key)
  if (a.length !== b.length) { fail++; console.log('FAIL ' + tag + ' 骨架条数 旧 ' + a.length + ' → 新 ' + b.length); continue }
  a.forEach((x, i) => {
    cmp(tag + ' 骨架第 ' + (i + 1) + ' 条', x.box, b[i].box,
      PROPS.filter(p => p !== 'transition-property' && p !== 'transition-duration' && p !== 'transition-timing-function'))
  })
}
console.log(fail ? '有 ' + fail + ' 项差异' : '全部一致')
process.exit(fail ? 1 : 0)
