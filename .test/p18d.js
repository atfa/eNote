(async function(){
  var E=window.__enote, A=window.__enoteActions, L=function(m){console.log("PROBED "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  L("actions="+typeof A.settingsSheet+"/"+typeof A.closeSheet+" sheets键="+Object.keys(E.sheets||{}).join(","));
  await A.settingsSheet();
  await sleep(250);
  var d=document.getElementById("sheet");
  L("开: 节点="+(d?d.className:"无")+" 面板="+(document.getElementById("panel")?document.getElementById("panel").className:"无")+" sheets="+Object.keys(E.sheets||{}).join(",")+" 遮罩="+(document.querySelector(".van-overlay")?document.querySelector(".van-overlay").className:"无"));
  if(d){var st=getComputedStyle(d);
  L("盒: display="+st.display+" pos="+st.position+" top="+st.top+" bottom="+st.bottom+" left="+st.left+" width="+st.width+" height="+st.height+" z="+st.zIndex+" bg="+st.backgroundColor+" ovf="+st.overflowY);
  var pn=getComputedStyle(document.getElementById("panel"));
  L("面板: w="+pn.width+" maxw="+pn.maxWidth+" maxh="+pn.maxHeight+" h="+pn.height+" radius="+pn.borderRadius+" pad="+pn.padding+" bg="+pn.backgroundColor+" anim="+pn.animationName+" "+pn.animationDuration+" shadow="+pn.boxShadow);
  var ov=getComputedStyle(document.querySelector(".van-overlay"));
  L("遮罩: bg="+ov.backgroundColor+" pos="+ov.position+" z="+ov.zIndex+" op="+ov.opacity+" blur="+ov.backdropFilter);}
  A.closeSheet();
  await sleep(60);
  L("关60ms: 节点="+(document.getElementById("sheet")?document.getElementById("sheet").className:"无"));
  await sleep(400);
  L("关460ms: 节点="+(document.getElementById("sheet")?"在":"无")+" sheets="+Object.keys(E.sheets||{}).join(",")+" 遮罩="+(document.querySelector(".van-overlay")?"在":"无"));
})()
