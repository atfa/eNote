/* 把「UI 没读的 json tag」再分一层：Go 里读不读、在不在 llm.go（LLM 线协议）。 */
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
const goFiles = fs.readdirSync("go").filter(f => f.endsWith(".go"));
const goText = {}, goAll = {};
for (const f of goFiles) { goText[f] = fs.readFileSync(path.join("go", f), "utf8"); goAll[f] = goText[f] }
const llm = (goText["llm.go"] || "") + (goText["llm_test.go"] || "");
const keys = [...new Set([...Object.values(goText).join("\n").matchAll(/json:"([A-Za-z0-9_]+)/g)].map(m => m[1]))];
const rows = [];
for (const k of keys) {
  if (new RegExp("\\b" + k + "\\b").test(code)) continue;      // UI 读了
  const inLlm = new RegExp('json:"' + k).test(llm);
  const goUsers = goFiles.filter(f => {
    const t = goText[f];
    const def = new RegExp('json:"' + k + '"', "g");
    const total = (t.match(new RegExp("\\b" + k + "\\b", "g")) || []).length;
    const ndef = (t.match(def) || []).length;
    return total > ndef;   // 除了 tag 定义本身，还有别的出现
  });
  rows.push([k, inLlm ? "LLM线协议" : "-", goUsers.join(",") || "无"].join("  "));
}
console.log(rows.join("\n"));
