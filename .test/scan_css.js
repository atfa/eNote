/* CSS 里定义了但界面代码里没人用的 class（不含 Vant 的 .van-*、不含 keyframes 帧名）。 */
const fs = require("fs"), path = require("path");
const cssFiles = [];
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (/\.css$/.test(f.name)) cssFiles.push(p);
  }
})("go/ui/css");
const cls = new Map();
for (const p of cssFiles) {
  const src = fs.readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of src.matchAll(/\.([A-Za-z][\w-]*)/g)) {
    if (!cls.has(m[1])) cls.set(m[1], []);
    cls.get(m[1]).push(p);
  }
}
let code = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "vendor") walk(p) }
    else if (/\.(js|html)$/.test(f.name)) code += fs.readFileSync(p, "utf8")
  }
})("go/ui/js");
code += fs.readFileSync("go/ui/index.html", "utf8");
code += fs.readFileSync("test.sh", "utf8");
code += fs.readFileSync("go/web_test.go", "utf8");
const unused = [...cls.keys()].filter(c =>
  !/^van-/.test(c) && !new RegExp("\\b" + c.replace(/-/g, "\\-") + "\\b").test(code));
console.log("CSS class 定义=" + cls.size + " 代码里没出现=" + unused.length);
console.log(unused.map(c => c + "(" + cls.get(c).map(p => p.split("/").pop()).join(",") + ")").join(" "));
