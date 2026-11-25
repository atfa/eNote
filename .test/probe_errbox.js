(async function(){
  var L=function(m){console.log("EB "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var dump=function(tag){
    var es=[].slice.call(document.querySelectorAll("#view .errbox"));
    L(tag+" n="+es.length+" "+es.map(function(e){return JSON.stringify(e.textContent.slice(0,26))+"vis="+(e.offsetParent?"y":"n")}).join(" | "));
  };
  try{
    dump("静息");
    var of=window.fetch;
    window.fetch=function(){return Promise.reject(new Error("探针制造的失败"))};
    var q=document.getElementById("q");
    q.value="失败探针二"; q.dispatchEvent(new Event("input",{bubbles:true}));
    await W(1400); dump("失败后");
    window.fetch=of;
    document.getElementById("qClear").click(); await W(1600); dump("恢复后");
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
