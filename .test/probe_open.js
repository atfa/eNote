(async function(){
  var L=function(m){console.log("OF "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    var S=__enote.state.S, n=S.notes[0];
    L("notes="+S.notes.length);
    missedGoTodos(); await W(600);
    L("tabTodos="+__enote.state.tab);
    jump(n.id); await W(1100);
    var el=document.getElementById("n"+n.id);
    L("jumpTab="+__enote.state.tab+" open="+String(!!__enote.state.open[n.id])+" el="+String(!!el));
    var r=await api("/api/todo",{action:"add",noteId:n.id,text:"探针待办",due:"",priority:"normal"});
    await refresh(true); await W(800);
    var t=null; S.notes.forEach(function(x){ (x.todos||[]).forEach(function(y){ if(!t) t={nid:x.id,tid:y.id} }) });
    L("added="+String(!!r.ok)+" todoFound="+(t?"yes":"none"));
    if(t){
      openTodo(t.nid,t.tid); await W(2000);
      var te=document.getElementById("t"+t.nid+"_"+t.tid);
      L("openTodoTab="+__enote.state.tab+" todoEl="+String(!!te)+" flash="+String(te?te.classList.contains("flash"):false));
      await api("/api/todo",{action:"delete",noteId:t.nid,todoId:t.tid});
      await refresh(true); await W(600);
      L("cleaned="+(S.notes.filter(function(x){return x.id===t.nid})[0].todos||[]).length);
    }
    openNote(n.id); await W(1100);
    L("openNoteTab="+__enote.state.tab+" el="+String(!!document.getElementById("n"+n.id)));
    toCalendar("nope","nope",{stopPropagation:function(){}});
    toAlarm("nope","nope",{stopPropagation:function(){}});
    L("guardOk=yes loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,90)) }
})()
