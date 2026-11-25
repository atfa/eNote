(async function(){
  var L=function(m){console.log("SC "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelector("#view"));z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" tab="+__enote.state.tab);
    await W(3500);
    L("selfCheck 跑过之后 tab="+__enote.state.tab+" 图标 use="+document.querySelectorAll("#view svg use").length+" 卡片="+document.querySelectorAll("#view .card").length);
    var m=await import(location.origin+"/js/selfcheck.js");
    L("selfcheck 模块 keys="+Object.keys(m).sort().join(","));
    m.selfCheck();
    await W(500);
    L("手动再跑一次 selfCheck 完成，tab="+__enote.state.tab);
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
