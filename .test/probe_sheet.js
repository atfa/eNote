(async function(){
  var L=function(m){console.log("SF "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var st=function(){
    var s=document.getElementById("sheet"), p=document.getElementById("panel"), b=document.getElementById("sheetBody");
    var t=p?p.querySelector(".phead .pt"):null;
    return "sheet="+(s?s.className:"none")+" apps="+Object.keys(__enote.vue.sheets).length
      +" body="+(b?b.innerHTML.length:-1)+" kind="+(p?p.getAttribute("data-kind"):"none")
      +" title="+(t?t.textContent:"none");
  };
  try{
    L("base "+st());
    settingsSheet(); await W(500); L("settings "+st());
    closeSheet(); await W(600); L("closed "+st());
    showLog(); await W(400); L("log "+st());
    closeSheet(); await W(400);
    sortSheet(); await W(400); L("sort "+st());
    closeSheet(); await W(400);
    settingsSheet(); sortSheet(); await W(700); L("race "+st());
    closeSheet(); await W(500); L("end "+st()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,120)) }
})()
