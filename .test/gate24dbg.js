const fs=require('fs');const src=fs.readFileSync('go/ui/js/shell.js','utf8');
const re=/export const (\w+) = \{([\s\S]*?)\n\};/g;let m;
const TPL=/template:\s*`([\s\S]*?)`/g;
while((m=re.exec(src))){
  const tags=[...m[2].matchAll(TPL)].flatMap(t=>[...t[1].matchAll(/<([a-z][a-z0-9]*(?:-[a-z0-9]+)*)/g)].map(x=>x[1]));
  console.log(m[1], JSON.stringify([...new Set(tags)]));
}
