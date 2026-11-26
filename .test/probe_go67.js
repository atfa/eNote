(async function(){
  var L=function(m){console.log("G67 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var st=await api("/api/state");
    var imp=st.notes.filter(function(n){ return n.id==="s67-import-probe" || (n.title||"").indexOf("步骤六七导入探针")>=0 });
    L("导入来的笔记="+imp.length+" 标题="+imp.map(function(n){return n.title}).join(","));
    var okd=[];
    for(var i=0;i<imp.length;i++){ var r=await api("/api/delete",{id:imp[i].id}); okd.push(r.ok) }
    L("删导入笔记 → "+okd.join(","));
    var sh=st.notes.filter(function(n){ return (n.source||"").indexOf("share-")===0 });
    var ok2=[];
    for(var j=0;j<sh.length;j++){ var r2=await api("/api/delete",{id:sh[j].id}); ok2.push(r2.ok) }
    L("删分享笔记 "+sh.length+" 条 → "+ok2.join(","));
    var sl=await api("/api/shots/list");
    if((sl.shots||[]).length){ var rm=await api("/api/shots/remove",{ids:(sl.shots||[]).map(function(s){return s.id})}); L("清暂存 → "+JSON.stringify(rm)) }
    var st3=await api("/api/state");
    L("清理后 notes="+st3.notes.length+" 暂存="+((await api("/api/shots/list")).shots||[]).length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
