(async function(){
  var L=function(m){console.log("G62 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var mode=location.hash.replace("#","")||"add";
    if(mode==="add"){
      var due=new Date(Date.now()+86400000).toISOString().slice(0,16);
      var a=await api("/api/add",{text:"步骤六二探针：明早交报告"});
      L("add id="+a.id);
      var nid=a.id;
      for(var i=0;i<60;i++){ var n=await api("/api/note?id="+nid); if(n.note&&n.note.status==="done") break; await W(500) }
      var note=(await api("/api/note?id="+nid)).note;
      L("note status="+note.status+" 已有待办="+(note.todos||[]).length);
      var t=await api("/api/todo",{action:"add",noteId:nid,text:"交报告",due:due,priority:"high"});
      var tn=t.note||t;
      L("todo add due="+due+" keys="+Object.keys(t).join(",")+" 待办="+(tn.todos||[]).length);
      var list=(tn.todos||[]).map(function(x){ return x.id+"@"+x.due });
      L("REMINDIDS "+list.join(",")+" NOTE "+nid);
    } else if(mode==="del"){
      var nid2=location.hash.slice(4);
      var r=await api("/api/delete",{ids:[nid2]});
      L("delete removed="+JSON.stringify(r));
    }
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
