/* 图标精灵图里没人用的 symbol。用法两种：模板里写死 href="#i-x"，
   或数据里写 icon: 'x'（模板拼 '#i-'+name），所以两种都算引用。 */
const fs = require("fs"), path = require("path");
const html = fs.readFileSync("go/ui/index.html", "utf8");
const ids = [...html.matchAll(/<symbol id="([^"]+)"/g)].map(m => m[1]);
let code = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "vendor") walk(p) }
    else if (/\.(js|html|css)$/.test(f.name)) code += fs.readFileSync(p, "utf8")
  }
})("go/ui/js");
code += html + fs.readFileSync("test.sh", "utf8");
const unused = ids.filter(id => {
  const n = id.replace(/^i-/, "");
  return !code.includes("#" + id) && !code.includes("'" + n + "'") && !code.includes('"' + n + '"');
});
console.log("sprite symbol=" + ids.length + " 没用到的=" + unused.length);
console.log(unused.join(" "));
