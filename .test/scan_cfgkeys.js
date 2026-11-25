/* Go 配置结构体里的 json key，UI 侧（js + index.html + test.sh）有没有人读。 */
const fs = require("fs"), path = require("path");
let code = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.(js|html)$/.test(f.name)) code += fs.readFileSync(p, "utf8");
  }
})("go/ui");
code += fs.readFileSync("test.sh", "utf8");
console.log("UI 代码字节:", code.length);
const cfg = fs.readFileSync("go/config.go", "utf8");
const keys = [...cfg.matchAll(/json:"([A-Za-z0-9_]+)(?:,omitted)?"/g)].map(m => m[1]);
const uniq = [...new Set(keys)];
const unused = uniq.filter(k => !new RegExp("\\b" + k + "\\b").test(code));
console.log("config json key=" + uniq.length + " UI 里没出现=" + unused.length, unused.join(" "));
