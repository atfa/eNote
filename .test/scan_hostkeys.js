const fs = require("fs"), path = require("path");
const app = fs.readFileSync("go/ui/js/app.js", "utf8");
const i = app.indexOf("var HOST = setHost({"), j = app.indexOf("\n});", i);
const host = app.slice(i, j);
const keys = new Set();
for (const m of host.matchAll(/(?:^|[,{]\s*)(?:get\s+)?([A-Za-z_$][\w$]*)\s*[:(]/gm)) keys.add(m[1]);
let tpl = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "vendor") walk(p) }
    else if (/\.js$/.test(f.name)) tpl += fs.readFileSync(p, "utf8")
  }
})("go/ui/js");
const testSh = fs.readFileSync("test.sh", "utf8");
const unused = [];
for (const k of keys) {
  const esc = k.replace(/\$/g, "\\$");
  const inTpl = new RegExp("H\\." + esc + "\\b").test(tpl);
  const inKeys = new RegExp("'" + esc + "'").test(host);
  const inTest = new RegExp("\\b" + esc + "\\b").test(testSh);
  if (!inTpl && !inKeys && !inTest) unused.push(k);
}
console.log("HOST keys=" + keys.size + " 模板/HOST_KEYS/test.sh 都没提到的=" + unused.length);
console.log(unused.join(" | "));
