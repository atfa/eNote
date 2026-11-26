(async function(){
  var L=function(m){console.log("G58 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var t=await __enote.api("/api/llm/test",{prompt:"用五个字回答：你好"});
    var lg=await __enote.api("/api/llmlog");
    L("POST /api/llm/test（callLLM 拆分后）：ok="+t.ok+" ms="+t.ms+" http="+t.httpCode+" error="+JSON.stringify(String(t.error||"").slice(0,46))+" 回复="+JSON.stringify(String(t.reply||"").slice(0,20))+" 日志条数="+((lg.calls||[]).length));
    var p="/data/data/dev.xduo.enote/files/probe58.txt";
    var s1=await __enote.api("/api/shots/add",{shots:[{path:p,name:"probe58.txt",size:6}]});
    var s2=await __enote.api("/api/shots/add",{shots:[{path:p,name:"probe58.txt",size:6}]});
    var s3=await __enote.api("/api/shots/add",{shots:[{path:"/data/data/dev.xduo.enote/files/没有这个.png",name:"没有这个.png",size:9},{path:"",name:"空.png",size:1}]});
    var ls=await __enote.api("/api/shots/list");
    var me=(ls.shots||[]).filter(function(x){return x.path===p})[0];
    L("POST /api/shots/add（verdict/accept）：首次 added="+s1.added+" 重复 dupes="+(s2.dupes||[]).length+" 坏图 dupes="+(s3.dupes||[]).length+" skipped="+(s3.skipped||[]).length+" 暂存="+(ls.shots||[]).length+" 命中="+(me?me.id:"无"));
    if(me){ var rm=await __enote.api("/api/shots/remove",{ids:[me.id]}); var ls2=await __enote.api("/api/shots/list");
      L("POST /api/shots/remove：removed="+rm.removed+" 暂存="+(ls2.shots||[]).length) }
    window.Android.clipSync(); await W(1500); window.Android.clipSync(); await W(1500);
    var c1=await __enote.api("/api/clip/list");
    var hits=(c1.clips||[]).filter(function(x){return (x.text||"").indexOf("步骤五八探针")>=0});
    L("clipSync ×2（clipAdd 去重）：暂存="+(c1.clips||[]).length+" 命中="+hits.length+" kind="+((hits[0]||{}).kind)+" text="+JSON.stringify(String((hits[0]||{}).text||"").slice(0,16)));
    await __enote.api("/api/clip/clear",{});
    __enoteActions.refresh(); await W(900);
    L("清理 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
