(async function(){
  var L=function(m){console.log("G57 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
    var st=await __enote.api("/api/stats");
    L("GET /api/stats（stats 拆成聚合器）：ok="+st.ok+" notes.total="+st.notes.total+" notes.done="+st.notes.done+" todos.total="+st.todos.total+" todos.open="+st.todos.open+" days="+st.days.length+" tags="+st.tags.length+" attach.count="+st.attach.count+" ai.calls="+st.ai.calls+" bytes="+st.bytes+" sources="+Object.keys(st.sources).length);
    var s1=await __enote.api("/api/search?tab=notes&limit=5");
    var s2=await __enote.api("/api/search?tab=todos&limit=5");
    L("GET /api/search（searchNotes / searchTodos）：notes total="+s1.total+" scanned="+s1.scanned+" 返回="+(s1.notes||[]).length+" | todos total="+s2.total+" 返回="+(s2.todos||[]).length+" todoIds="+Object.keys(s2.todoIds||{}).length);
    var ad=await __enote.api("/api/add",{text:"步骤五七探针 整理书架 周六 10:00"});
    var n=null;
    for(var y=0;y<40;y++){ await W(700); var g=await __enote.api("/api/note?id="+ad.id); n=g.note; if(n && n.status!=="queued" && n.status!=="parsing") break }
    var n0=(n.todos||[]).length;
    L("POST /api/add → /api/note：状态="+n.status+" 标题="+JSON.stringify(n.title)+" 待办="+n0);
    var a1=await __enote.api("/api/todo",{action:"add",noteId:n.id,text:"探针手工待办",priority:"high",due:"2026-01-01T10:00"});
    var g1=await __enote.api("/api/note?id="+n.id);
    var t=(g1.note.todos||[]).filter(function(x){return x.text==="探针手工待办"})[0];
    L("POST /api/todo add（todoAdd）：ok="+a1.ok+" 条数="+g1.note.todos.length+" 命中="+JSON.stringify(t?{pri:t.priority,due:t.due,done:t.done}:null));
    await W(300);
    var a2=await __enote.api("/api/todo",{action:"toggle",noteId:n.id,todoId:t.id});
    await W(300);
    var g2=await __enote.api("/api/note?id="+n.id);
    var t2=(g2.note.todos||[]).filter(function(x){return x.id===t.id})[0];
    L("POST /api/todo toggle（todoToggle）：ok="+a2.ok+" done="+t2.done+" doneAt="+JSON.stringify(t2.doneAt||""));
    var a3=await __enote.api("/api/todo",{action:"delete",noteId:n.id,todoId:t.id});
    await W(300);
    var g3=await __enote.api("/api/note?id="+n.id);
    L("POST /api/todo delete（todoDelete）：ok="+a3.ok+" 条数="+g3.note.todos.length+"（原来 "+n0+"）");
    var a4=await __enote.api("/api/todo",{action:"nope",noteId:n.id});
    L("未知 action：ok="+a4.ok+" error="+JSON.stringify(a4.error||""));
    await __enote.api("/api/delete",{id:n.id});
    __enoteActions.refresh(); await W(900);
    L("清理 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
