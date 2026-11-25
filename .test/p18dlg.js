(async function(){
  for(var i=0;i<120 && !(window.__enote&&window.__enote.dom&&window.__enote.dom.main);i++){ await new Promise(function(r){setTimeout(r,100)}) }
  window.uiDialog("删除","确定删除这条笔记？此操作不可撤销。","probe1");
  function vis(){ var e=document.getElementById("dlgYes"); return !!(e&&e.offsetParent) }
  for(var j=0;j<40 && !vis();j++){ await new Promise(function(r){setTimeout(r,50)}) }
  await new Promise(function(r){setTimeout(r,500)});
  var P=["position","inset","zIndex","backgroundColor","display","alignItems","justifyContent","padding","width","maxWidth","borderRadius","border","boxShadow","fontSize","fontWeight","color","margin","marginTop","textAlign","lineHeight","height","flex","gap","wordBreak","transform","top","left"];
  var out=[];
  function dump(tag,sel){
    var e=document.querySelector(sel);
    if(!e){ out.push(tag+"|<无节点>"); return }
    var c=getComputedStyle(e);
    out.push(tag+"|"+e.tagName+"."+(e.className||""));
    for(var i=0;i<P.length;i++){ out.push("   "+P[i]+"="+c[P[i]]) }
    out.push("   text="+(e.textContent||"").trim().slice(0,24));
  }
  dump("遮罩",".van-overlay");
  dump("盒子","#dlg");
  
  dump("标题","#dlgT");
  dump("正文","#dlgB");
  dump("取消","#dlgNo");
  dump("确定","#dlgYes");
  for(var k=0;k<out.length;k++){ console.log("PROBEDLG "+out[k]) }
})()
