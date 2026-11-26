(async function(){
  var L=function(m){console.log("G62B "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var st=await api("/api/state");
    var nid="";
    (st.notes||[]).forEach(function(n){ if((n.content||"").indexOf("步骤六二探针")>=0) nid=n.id });
    L("命中笔记="+nid);
    var note=(await api("/api/note?id="+nid)).note;
    var ts=(note.todos||[]).map(function(x){ return x.id+"|due="+x.due+"|done="+x.done });
    L("待办 "+ts.length+" 条："+ts.join("  "));
    window.__g62nid=nid;
    L("NID "+nid);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
