(async function(){
  var L=function(m){console.log("CB "+m)};
  try{
    var d=await api("/api/state");
    L("serverClip="+d.info.clip);
    __enote.state.tab="notes";
    await refresh(true);
    L("pageClip="+window.__enote.state.S.info.clip);
    L("banner="+(document.querySelector(".clipbanner")?"yes":"none"));
    L("tab="+window.__enote.state.tab);
    L("viewcls="+(document.querySelector("#view")?document.querySelector("#view").className.slice(0,60):"none"));
    L("html="+(document.querySelector("#view")?document.querySelector("#view").innerHTML.slice(0,80).replace(/\s+/g," "):"none"));
  }catch(e){ L("ERR="+e.name+": "+e.message) }
})()
