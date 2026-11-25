(async function(){
  var L=function(m){console.log("FL "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    var S=__enote.state.S, n=S.notes[0];
    var r=await api("/api/todo",{action:"add",noteId:n.id,text:"探针闪烁",due:"",priority:"normal"});
    await refresh(true); await W(900);
    var t=null; S.notes.forEach(function(x){ (x.todos||[]).forEach(function(y){ if(!t) t={nid:x.id,tid:y.id} }) });
    if(!t){ L("noTodo"); return }
    openTodo(t.nid,t.tid);
    var seen="";
    for(var i=0;i<10;i++){ await W(200);
      var e=document.getElementById("t"+t.nid+"_"+t.tid);
      seen=seen+(e&&e.classList.contains("flash")?"1":"0"); }
    L("added="+String(!!r.ok)+" flashWindow="+seen);
    await api("/api/todo",{action:"delete",noteId:t.nid,todoId:t.tid});
    await refresh(true); await W(500);
    L("done");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,90)) }
})()
