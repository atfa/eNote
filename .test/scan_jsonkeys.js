/* go/*.go 结构体上的 json tag，UI（js + index.html + test.sh）里有没有人读。
   Go 侧自己读的字段（Go 代码里出现）单独统计，因为「后端算出来给 UI 用」才是这条闸门的靶子。 */
const fs = require("fs"), path = require("path");
let code = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "vendor") walk(p) }
    else if (/\.(js|html)$/.test(f.name)) code += fs.readFileSync(p, "utf8");
  }
})("go/ui");
code += fs.readFileSync("test.sh", "utf8");
let go = "";
for (const f of fs.readdirSync("go")) if (f.endsWith(".go")) go += fs.readFileSync(path.join("go", f), "utf8");
const keys = [...new Set([...go.matchAll(/json:"([A-Za-z0-9_]+)/g)].map(m => m[1]))];
const unused = keys.filter(k => !new RegExp("\\b" + k + "\\b").test(code));
console.log("json tag=" + keys.length + "  UI 里没出现=" + unused.length);
console.log(unused.join(" "));
