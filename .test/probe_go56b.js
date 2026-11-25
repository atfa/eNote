(async function(){
  var L=function(m){console.log("G56B "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    var ad=await __enote.api("/api/add",{text:"步骤五六探针乙 交周报 周五 18:00"});
    var n=null;
    for(var y=0;y<40;y++){ await W(700); var g=await __enote.api("/api/note?id="+ad.id); n=g.note; if(n && n.status!=="queued" && n.status!=="parsing") break }
    L("建好 状态="+n.status+" todos="+JSON.stringify((n.todos||[]).map(function(t){return {id:String(t.id).slice(0,4),text:t.text,done:t.done}})));
    var td=(n.todos||[])[0];
    var t1=await __enote.api("/api/todo",{action:"toggle",noteId:n.id,todoId:td.id});
    await W(400);
    var g2=await __enote.api("/api/note?id="+n.id);
    L("toggle1 ok="+t1.ok+" todos="+JSON.stringify((g2.note.todos||[]).map(function(t){return {id:String(t.id).slice(0,4),done:t.done}})));
    var t2=await __enote.api("/api/todo",{action:"toggle",noteId:n.id,todoId:td.id});
    await W(400);
    var g3=await __enote.api("/api/note?id="+n.id);
    L("toggle2 ok="+t2.ok+" todos="+JSON.stringify((g3.note.todos||[]).map(function(t){return {id:String(t.id).slice(0,4),done:t.done}})));
    await __enote.api("/api/delete",{id:n.id});
    __enoteActions.refresh(); await W(800);
    L("清理 loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
