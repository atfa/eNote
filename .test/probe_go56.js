(async function(){
  var L=function(m){console.log("G56 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
    var st=await __enote.api("/api/settings");
    L("GET /api/settings（api.go handleSettings）：baseUrl 类型="+typeof st.settings.baseUrl+" theme="+st.settings.theme+" useAI="+st.settings.useAI);
    var th=await __enote.api("/api/theme",{mode:st.settings.theme});
    L("POST /api/theme（handleTheme）：ok="+th.ok+" theme="+th.theme+" 带 settings="+(th.settings?typeof th.settings.theme:"无"));
    var cl=await __enote.api("/api/clip/list");
    var sh=await __enote.api("/api/shots/list");
    L("GET /api/clip/list + /api/shots/list：clips="+(cl.clips?cl.clips.length:"无")+" shots="+(sh.shots?sh.shots.length:"无"));
    var ad=await __enote.api("/api/add",{text:"步骤五六探针 交周报 周五 18:00"});
    L("POST /api/add（handleAdd → enqueue）：ok="+ad.ok+" id="+String(ad.id||"").slice(0,6));
    var n=null;
    for(var y=0;y<40;y++){ await W(700); var g=await __enote.api("/api/note?id="+ad.id); n=g.note; if(n && n.status!=="queued" && n.status!=="parsing") break }
    L("GET /api/note（handleNote）：状态="+n.status+" 标题="+JSON.stringify(n.title)+" 待办="+(n.todos?n.todos.length:0));
    var td=(n.todos||[])[0];
    if(td){
      var t1=await __enote.api("/api/todo",{action:"toggle",noteId:n.id,todoId:td.id});
      var g2=await __enote.api("/api/note?id="+n.id);
      var t2=await __enote.api("/api/todo",{action:"toggle",noteId:n.id,todoId:td.id});
      var g3=await __enote.api("/api/note?id="+n.id);
      L("POST /api/todo toggle（handleTodo）：第一次 ok="+t1.ok+" done="+g2.note.todos[0].done+" 复原 ok="+t2.ok+" done="+g3.note.todos[0].done);
    }
    var del=await __enote.api("/api/delete",{id:n.id});
    __enoteActions.refresh(); await W(900);
    var g4=await __enote.api("/api/note?id="+n.id);
    L("POST /api/delete（handleDelete）：ok="+del.ok+" 再读="+g4.ok+" 卡片="+document.querySelectorAll("#view .card").length+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
