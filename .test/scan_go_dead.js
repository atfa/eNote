/* go/*.go 里定义了没人调的函数（含方法）。引用侧 = 全部 go 文件（含 _test.go）+ Java +
   JS（HTTP 路由名是字符串）。JNI 导出（//export X）单独算引用。 */
const fs = require("fs"), path = require("path");
const goFiles = fs.readdirSync("go").filter(f => f.endsWith(".go")).map(f => "go/" + f);
const defs = new Map();
for (const f of goFiles) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gm)) {
    const key = m[1];
    if (!defs.has(key)) defs.set(key, []);
    defs.get(key).push(f);
  }
}
const refFiles = goFiles.concat(
  ["app/src/main/java/dev/xduo/enote/MainActivity.java", "go/mobile.go", "go/capi.go"]
    .filter(f => fs.existsSync(f)));
const ref = refFiles.map(f => fs.readFileSync(f, "utf8")).join("\n");
const dead = [];
for (const [name, where] of defs) {
  if (/^Test/.test(name)) continue;
  const hits = (ref.match(new RegExp("\\b" + name + "\\b", "g")) || []).length;
  if (hits <= where.length) dead.push(name + " @ " + where.join(","));
}
console.log("go func 定义=" + defs.size + " 没人调=" + dead.length);
console.log(dead.join("\n"));
