/* 搬迁模块时找漏掉的依赖：目标模块里出现的、在 app.js 里被赋值/声明过的顶层名字，
   但没被 import。多声明符的 var（var a={},b={},c={}）要逐个抓，这是上次漏 paneDirty 的原因。 */
const fs = require("fs");
const app = fs.readFileSync("go/ui/js/app.js", "utf8");
const target = fs.readFileSync(process.argv[2] || "go/ui/js/shotflow.js", "utf8");
const names = new Set();
for (const m of app.matchAll(/^(?:var|let|const)\s+([^=;\n]+(?:=[^;\n]*)?)/gm)) {
  // 取声明列表里的名字：逗号分隔，去掉 = 右边的值
  for (const part of m[1].split(',')) {
    const n = part.split('=')[0].trim();
    if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n);
  }
}
for (const m of app.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
const imported = new Set();
for (const m of target.matchAll(/import\s*\{([^}]*)\}\s*from/g))
  for (const n of m[1].split(',')) imported.add(n.trim().split(/\s+as\s+/).pop());
const ids = new Set([...target.matchAll(/[A-Za-z_$][\w$]*/g)].map(m => m[0]));
const missing = [...ids].filter(n => names.has(n) && !imported.has(n) &&
  new RegExp("\\b" + n + "\\b").test(target));
console.log("app.js 顶层名字 " + names.size + " 个；" + (process.argv[2] || 'shotflow.js') +
  " 里用到但没 import 的 = " + missing.length);
console.log(missing.join(" "));
