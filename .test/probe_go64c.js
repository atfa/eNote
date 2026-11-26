(async function(){
  var L=function(m){console.log("G64C "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var st=await api("/api/state");
    L("重启后 notes="+st.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    var sl=await api("/api/shots/list");
    L("暂存="+(sl.shots||[]).length);
    var bad=st.notes.filter(function(n){ return (n.source||"").indexOf("shot-")===0 });
    var okd=[];
    for(var i=0;i<bad.length;i++){ var r=await api("/api/delete",{id:bad[i].id}); okd.push(r.ok) }
    L("清掉截图笔记 "+bad.length+" 条 → "+okd.join(","));
    if((sl.shots||[]).length){ var rm=await api("/api/shots/remove",{ids:(sl.shots||[]).map(function(s){return s.id})}); L("清暂存 → "+JSON.stringify(rm)) }
    var st3=await api("/api/state");
    L("清理后 notes="+st3.notes.length+" 暂存="+((await api("/api/shots/list")).shots||[]).length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
