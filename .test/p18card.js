(async function(){
  var A=window.__enoteActions, L=function(m){console.log("SHDUMP "+m.replace(/;/g,"|"))};
  var props=["position","top","bottom","left","right","width","height","max-width","max-height","z-index","display","align-items","justify-content","background-color","overflow-y","box-shadow","border-radius","padding-top","padding-left","border-top-width","border-top-color","animation-name","animation-duration","transform","opacity","backdrop-filter","margin","pointer-events","color","font-size"];
  function snap(sel){var el=document.querySelector(sel); if(!el) return sel+"=无"; var c=getComputedStyle(el); return sel+"{"+props.map(function(p){return p+":"+c.getPropertyValue(p)}).join(";")+"}"}
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var out=[];
  await A.showLog(); await sleep(400);
  out.push("card "+[snap("#sheet"),snap("#sheet .panel"),snap("#sheet .grip"),snap("#sheet .pclose"),snap(".van-overlay"),snap("#sheetBody")].join(" ~ "));
  A.closeSheet(); await sleep(400);
  out.push("关后 "+(document.getElementById("sheet")?"节点在":"节点无")+" 遮罩="+(document.querySelector(".van-overlay")?"在":"无"));
  L(out.join(" ## "));
})()
