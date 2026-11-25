(async function(){
  var E=window.__enote, L=function(m){console.log("PROBEVD3 "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  L("uiDialog类型="+(typeof window.uiDialog));
  window.uiDialog("测试缝","对话框外壳契约","ok");
  for(var i=0;i<20 && !document.getElementById("dlg");i++){ await sleep(50) }
  var b=document.getElementById("dlg");
  L("节点="+(b?b.id+" cls="+b.className.replace("van-popup van-popup--center van-dialog enote-dialog","BOX"):"无"));
  L("可见="+(document.getElementById("dlgYes")&&document.getElementById("dlgYes").offsetParent?1:0));
  var y=document.getElementById("dlgYes"); if(y) y.click();
  await sleep(300);
  L("关闭后="+(document.getElementById("dlg")?1:0));
})()
