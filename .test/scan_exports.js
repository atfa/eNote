/* 探针导出表（window.__enoteActions）里没人用的 key。
   表是简写形式（`addNote, addTodo, ...`），所以按逗号切词。
   引用侧：test.sh（探针载荷主力）、tools/ui_test.js（门禁签名）、go/web_test.go、
   .test/*.js（我自己的 A/B 探针）、app.js 自己（内联 handler 字符串）。 */
const fs = require("fs");
const app = fs.readFileSync("go/ui/js/app.js", "utf8");
const i = app.indexOf("window.__enoteActions = {");
const j = app.indexOf("\n};", i);
const body = app.slice(i + "window.__enoteActions = {".length, j);
const keys = [...body.matchAll(/([A-Za-z_$][\w$]*)/g)].map(m => m[1])
  .filter((v, ix, a) => a.indexOf(v) === ix);
const refFiles = ["test.sh", "tools/ui_test.js", "go/web_test.go", "go/ui/js/app.js"]
  .concat(fs.readdirSync(".test").filter(f => /\.js$/.test(f)).map(f => ".test/" + f));
const refs = refFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");
const unused = keys.filter(k => {
  const esc = k.replace(/\$/g, "\\$");
  return !new RegExp("\\b" + esc + "\\b").test(refs.replace(/window\.__enoteActions = \{[\s\S]*?\n\};/, ""));
});
console.log("导出表 key=" + keys.length + " 全库（除表体）没提到的=" + unused.length);
console.log(unused.join(" | "));
