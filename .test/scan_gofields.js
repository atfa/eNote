/* go/*.go 结构体字段（带 json tag）里，Go 代码和 UI 都不读的。
   只统计字段名在别处出现次数为 0 的，避免把「只被 JSON 解码用」的输入结构误杀。 */
const fs = require("fs"), path = require("path");
let ui = "";
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { if (f.name !== "vendor") walk(p) }
    else if (/\.(js|html)$/.test(f.name)) ui += fs.readFileSync(p, "utf8");
  }
})("go/ui");
ui += fs.readFileSync("test.sh", "utf8");
const goFiles = fs.readdirSync("go").filter(f => f.endsWith(".go"));
const goText = {};
for (const f of goFiles) goText[f] = fs.readFileSync(path.join("go", f), "utf8");
const goAll = Object.values(goText).join("\n");
const rows = [];
for (const [f, t] of Object.entries(goText)) {
  if (f.endsWith("_test.go")) continue;
  for (const m of t.matchAll(/^\t([A-Z]\w*)\s+[\w\[\]\*{}.]+\s+`json:"([A-Za-z0-9_]+)/gm)) {
    const [, field, tag] = m;
    const goRefs = (goAll.match(new RegExp("\\." + field + "\\b", "g")) || []).length;
    const uiRefs = new RegExp("\\b" + tag + "\\b").test(ui) ? 1 : 0;
    if (goRefs === 0 && uiRefs === 0) rows.push(field + " (json:" + tag + ") " + f);
  }
}
console.log("Go 结构体字段（Go 不读、UI 不读）= " + rows.length);
console.log(rows.join("\n"));
