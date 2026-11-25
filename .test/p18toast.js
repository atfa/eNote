(async function(){
  var E=window.__enote;
  E.toast("已存 3 条笔记");
  for(var i=0;i<40 && !document.getElementById("toast");i++){ await new Promise(function(r){setTimeout(r,50)}) }
  var t=document.getElementById("toast");
  if(!t){ console.log("PROBETOAST 无节点"); return }
  var c=getComputedStyle(t);
  console.log("PROBETOAST tag="+t.tagName+" class="+t.className+" 文案="+t.textContent.trim()+" 底="+c.backgroundColor+" 字色="+c.color+" 字号="+c.fontSize+" 圆角="+c.borderRadius+" 内距="+c.paddingTop+"/"+c.paddingLeft+" 底距="+c.bottom+" z="+c.zIndex+" 阴影="+c.boxShadow.slice(0,40)+" 字重="+c.fontWeight);
})()
