#!/usr/bin/env node
/* 步骤 19 的 A/B：设置页「测试连接」结果区 #llmOut 的三态 DOM。
   左 = 18e 基线（testLLM 拼字符串写 innerHTML），右 = 步骤 19（响应式盒子 + 模板）。
   归一化（允许的写法差异，不是迁移动手脚）：
   - v-if 留下的注释占位 <!---->（不产生元素，三套 DOM 等价工具的归一化也吃它）；
   - style 属性文本：innerHTML 解析保留原文 `margin-top:var(--s2)`，Vue 写
     el.style.cssText 后浏览器重序列化成 `margin-top: var(--s2);`（计算样式相同，
     步骤 16b 就记过这条）；
   - 大模型的回复文本与耗时每次都不一样，比的是「结构 + 前缀」。 */
'use strict'
const fs = require('fs')
function load(f) {
  const raw = fs.readFileSync(f, 'utf8')
  const m = /P19LLM (\{.*\})\s*$/.exec(raw)
  return JSON.parse(m[1])
}
function norm(h) {
  return String(h)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/style="([^"]*)"/g, (m, v) => 'style="' + v.replace(/\s+/g, ' ').replace(/\s*([:;])\s*/g, '$1').replace(/;$/, '') + '"')
    .replace(/（\d+ms/, '（Nms')
    .replace(/(✅ 成功（Nms，HTTP \d+）<br>)[\s\S]*?(<\/div>)/, '$1回复$2')
    .replace(/(❌ 失败（Nms）<br>)[\s\S]*?(<\/div>)/, '$1错误$2')
}
const a = load('.test/llm_base.txt'), b = load('.test/llm_19.txt')
let fail = 0
for (const k of ['initial', 'busy', 'done']) {
  const x = norm(a[k]), y = norm(b[k])
  if (x === y) console.log('ok   ' + k + '  归一化后逐字一致（' + y.length + ' B）')
  else { fail++; console.log('FAIL ' + k + '\n  基线: ' + x + '\n  现在: ' + y) }
}
if (a.count === b.count) console.log('ok   .body 节点数 ' + b.count)
else { fail++; console.log('FAIL .body 节点数 旧 ' + a.count + ' → 新 ' + b.count) }
console.log(fail ? '有 ' + fail + ' 项差异' : '全部一致')
process.exit(fail ? 1 : 0)
