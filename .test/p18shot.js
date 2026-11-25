(async function(){
  var L=function(m){console.log("SHOTDLG "+m)};
  window.uiDialog("删除笔记","这篇笔记的 3 张图片和 2 条待办会一起删掉，删掉之后找不回来。","ok");
  for(var i=0;i<80;i++){ await new Promise(function(r){setTimeout(r,100)}) }
})()
