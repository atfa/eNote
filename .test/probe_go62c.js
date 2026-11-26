(async function(){
  var L=function(m){console.log("G62C "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var st=await api("/api/state");
    var ids=[];
    (st.notes||[]).forEach(function(n){ if((n.content||"").indexOf("步骤六二探针")>=0) ids.push(n.id) });
    var r=await api("/api/delete",{ids:ids});
    L("delete ids="+ids.length+" 结果="+JSON.stringify(r).slice(0,80));
    var st2=await api("/api/state");
    L("清理后 notes="+st2.notes.length+" loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
