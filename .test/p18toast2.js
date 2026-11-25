(async function(){
  for(var i=0;i<120 && !(window.__enote&&window.__enote.toast);i++){ await new Promise(function(r){setTimeout(r,100)}) }
  var E=window.__enote;
  for(var j=0;j<30;j++){ E.toast("已存 3 条笔记"); await new Promise(function(r){setTimeout(r,900)}) }
})()
