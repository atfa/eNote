#!/usr/bin/env node
/* 步骤 21 的 A/B：记一笔 / 添加待办两个弹层里五个表单元素的 DOM 与计算样式。
   左 = 步骤 20 基线（addNote/addTodo 从 DOM 读值），右 = 步骤 21（表单值在 FORMS 里）。
   归一化（允许的写法差异，不是迁移动手脚）：
   - Vue 3.5 的 patchProp 在写 value property 之后同步写一份 value 属性
     （vendor/vue.global.js:12276：patchDOMProp 之后紧跟 patchAttr），所以 :value 绑定的
     元素序列化出来多一个 value="…"；它是默认值，与 property 相同，行为不变。
     基线那五个元素今天没有 value 属性，比之前先剥掉。 */
'use strict'
const fs = require('fs')
function load(f) {
  const m = /P21DOM (\{.*\})\s*$/.exec(fs.readFileSync(f, 'utf8'))
  return JSON.parse(m[1])
}
const norm = h => String(h).replace(/ value="[^"]*"/g, '')
const a = load('.test/f21_base.txt'), b = load('.test/f21_21.txt')
let fail = 0
for (const k of Object.keys(a)) {
  const x = norm(a[k]), y = norm(b[k])
  if (x === y) console.log('ok   ' + k + '  归一化后逐字一致（' + y.length + ' B）')
  else { fail++; console.log('FAIL ' + k + '\n  基线: ' + x + '\n  现在: ' + y) }
}
console.log(fail ? '有 ' + fail + ' 项差异' : '全部一致')
process.exit(fail ? 1 : 0)
