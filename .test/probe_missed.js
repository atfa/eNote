(async function(){
  var L=function(m){console.log("MS "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    __enote.state.tab="notes";
    var nid=(__enote.state.S.notes[0]||{}).id||"x";
    __enote.state.MISSED={count:1,items:[{id:"pt1",nid:nid,text:"探针错过的待办",dueAt:"2026-01-01T08:00:00"}]};
    await refresh(true);
    await W(500);
    L("banner="+(document.querySelector(".missed")?document.querySelector(".missed").textContent.replace(/\s+/g,"").slice(0,24):"none"));
    missedSheet();
    await W(700);
    L("rows="+document.querySelectorAll(".msrow").length);
    L("foot="+(document.querySelector(".pfoot")?document.querySelector(".pfoot").textContent.replace(/\s+/g,"").slice(0,20):"none"));
    missedGoTodos();
    await W(900);
    L("tabAfter="+__enote.state.tab);
    missedSheet();
    await W(600);
    missedDismiss();
    await W(500);
    L("missedAfter="+JSON.stringify(__enote.state.MISSED));
    L("toast="+(document.querySelector(".toast")?document.querySelector(".toast").textContent.replace(/\s+/g,""):"none"));
    L("loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+e.message) }
})()
