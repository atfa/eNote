(async function(){
  var L=function(m){console.log("G61 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var a=await __enote.api("/api/shots/list");
    L("GET /api/shots/list（Java 拆分后暂存区）：暂存="+a.shots.length+" 名称="+a.shots.map(function(x){return x.name}).join(","));
    var ids=a.shots.map(function(x){return JSON.stringify(x.id)}).join(",");
    if(ids){ var b=await __enote.api("/api/shots/remove",{ids:JSON.parse("["+ids+"]")}); L("POST /api/shots/remove：removed="+b.removed); }
    var c=await __enote.api("/api/shots/list");
    L("清理后：暂存="+c.shots.length+" 卡片="+document.querySelectorAll("#view .card").length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
