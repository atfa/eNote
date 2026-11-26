(async function(){
  var L=function(m){console.log("G60 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var E=function(s){return encodeURIComponent(s)};
  var B=function(s){return s.baseUrl+"|"+s.apiKey+"|"+s.model+"|"+s.timeoutS+"|"+s.maxTokens+"|"+s.temperature+"|"+s.useAI+"|"+s.theme+"|"+Object.keys(s.ui||{}).length};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var s0=(await __enote.api("/api/state")).settings;
    L("设置基线：base="+s0.baseUrl+" key="+JSON.stringify(s0.apiKey)+" model="+s0.model+" timeout="+s0.timeoutS+" maxTok="+s0.maxTokens+" temp="+s0.temperature+" useAI="+s0.useAI+" theme="+s0.theme+" ui项="+Object.keys(s0.ui||{}).length);
    var r1=await __enote.api("/api/settings",{});
    L("POST /api/settings 空 patch（applyTo 全不盖 + fillDefaults 兜底）：ok="+r1.ok+" 一致="+(B(r1.settings)===B(s0)));
    var r2=await __enote.api("/api/settings",{apiKey:"sk…zzzz"});
    L("POST apiKey 带省略号（打码守卫）：ok="+r2.ok+" key="+JSON.stringify(r2.settings.apiKey)+" 一致="+(B(r2.settings)===B(s0)));
    var r3=await __enote.api("/api/settings",{model:s0.model,timeoutS:s0.timeoutS,maxTokens:s0.maxTokens,temperature:s0.temperature,useAI:s0.useAI});
    L("POST 逐字段同值 patch：ok="+r3.ok+" 一致="+(B(r3.settings)===B(s0)));
    var r4=await __enote.api("/api/settings",{baseUrl:"",model:"",theme:""});
    L("POST 空串 patch（fillDefaults 退回旧值）：ok="+r4.ok+" base="+r4.settings.baseUrl+" model="+r4.settings.model+" theme="+r4.settings.theme+" 一致="+(B(r4.settings)===B(s0)));
    var kw=String((((await __enote.api("/api/state")).notes||[])[0]||{}).title||"zzz").slice(0,3);
    var q1=await __enote.api("/api/search?tab=notes&q="+E(kw));
    var q2=await __enote.api("/api/search?tab=notes&src=text");
    var q3=await __enote.api("/api/search?tab=notes&src=image");
    var q4=await __enote.api("/api/search?tab=notes&file=yes");
    var q5=await __enote.api("/api/search?tab=notes&status=done");
    var q6=await __enote.api("/api/search?tab=notes&status=error&limit=2");
    L("GET /api/search（matchNote 拆分后）：q="+JSON.stringify(kw)+" total="+q1.total+" scanned="+q1.scanned+" 命中字段="+JSON.stringify(q1.where||"无")+" src=text total="+q2.total+" src=image total="+q3.total+" file=yes total="+q4.total+" status=done total="+q5.total+" status=error limit=2 total="+q6.total);
    var lg=await __enote.api("/api/log?n=400");
    var init=String(lg.log||"").split("\n").filter(function(x){return x.indexOf("appInit ")>=0});
    L("GET /api/log（appInit 装配痕迹）：appInit 行数="+init.length+" 最新="+JSON.stringify(String(init[init.length-1]||"").slice(0,86)));
    __enoteActions.refresh(); await W(900);
    L("清理 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
