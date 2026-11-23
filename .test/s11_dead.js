#!/usr/bin/env node
// 步骤 11：反复删掉「只被已删除的遗留渲染器调用」的函数，直到不动点。
// 判定：从「导出表 / HOST / 观测缝 / 内联 handler / Vue 模板 H.xxx / 顶层代码」出发做可达性，
// 到不了的函数就是死的。三段注册表本身不算调用者（它们只是登记名字）。
const fs = require("fs");
const path = "go/ui/js/app.js";
const idx = fs.readFileSync("go/ui/index.html", "utf8");
const viewFiles = ["vue.js","components.js","views/notes.js","views/todos.js","views/files.js",
  "views/shots.js","views/folders.js","views/clip.js","views/stats.js","views/settings.js"];
const views = viewFiles.map(f => fs.readFileSync("go/ui/js/" + f, "utf8")).join("\n");
const re = n => new RegExp("(?<![\\w$])" + n.replace(/\$/g, "\\$") + "(?![\\w$])", "g");

function analyze(app) {
  const lines = app.split("\n");
  const defs = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:async )?function ([A-Za-z_$][\w$]*)/);
    if (!m) continue;
    let depth = 0, j = i, started = false;
    for (; j < lines.length; j++) {
      for (const ch of lines[j]) { if (ch === "{") { depth++; started = true } else if (ch === "}") depth-- }
      if (started && depth <= 0) break;
    }
    defs[m[1]] = { body: lines.slice(i, j + 1).join("\n"), start: i, end: j };
  }
  const names = Object.keys(defs);
  const seg = (a, b) => { const i = app.indexOf(a); if (i < 0) return ""; const j = app.indexOf(b, i); return j < 0 ? "" : app.slice(i, j) };
  const hostTxt = seg("var HOST = setHost({", "\n});");
  const seamStart = app.indexOf("window.__enote.vue = {");
  const seamTxt = seamStart < 0 ? "" : app.slice(seamStart, app.indexOf("setInterval(function(){ if(!document.hidden)", seamStart));
  const expTxt = seg("window.__enoteActions = {", "\n};");
  const inFn = new Set();
  for (const n of names) for (let k = defs[n].start; k <= defs[n].end; k++) inFn.add(k);
  let top = lines.filter((l, i) => !inFn.has(i + 1)).join("\n");
  top = top.replace(hostTxt, "").replace(seamTxt, "").replace(expTxt, "");
  const hrefs = [...views.matchAll(/\bH\.([A-Za-z_$][\w$]*)/g)].map(x => x[1]);
  const inline = [...idx.matchAll(/on\w+="([^"]*)"/g)]
    .flatMap(x => [...x[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)].map(y => y[1]));
  const roots = new Set([...names.filter(n => re(n).test(top)), ...hrefs, ...inline,
    ...names.filter(n => re(n).test(expTxt)), ...names.filter(n => re(n).test(seamTxt))]);
  const live = new Set(), stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (live.has(n) || !defs[n]) continue;
    live.add(n);
    const b = defs[n].body;
    for (const d of names) if (d !== n && re(d).test(b)) stack.push(d);
  }
  return { defs, names, dead: names.filter(n => !live.has(n)), live: live.size };
}

let app = fs.readFileSync(path, "utf8");
for (let pass = 0; pass < 10; pass++) {
  const { defs, dead, live, names } = analyze(app);
  console.log("pass", pass, "defs", names.length, "live", live, "dead", dead.length, dead.join(" "));
  if (!dead.length) break;
  let lines = app.split("\n");
  // 从后往前删，行号不失效；函数上方的整块 // 注释一起删（它只解释这个函数）
  for (const n of dead.sort((a, b) => defs[b].start - defs[a].start)) {
    let i = defs[n].start, j = defs[n].end, k = i;
    while (k > 0 && lines[k - 1].trim().startsWith("//")) k--;
    lines.splice(k, j - k + 1);
  }
  app = lines.join("\n");
  fs.writeFileSync(path, app);
}
const fin = analyze(fs.readFileSync(path, "utf8"));
console.log("最终 defs", fin.names.length, "live", fin.live, "dead", fin.dead.length, fin.dead.join(" "));
