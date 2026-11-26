(async function(){
  var L=function(m){console.log("G66 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var st=await api("/api/state");
    var sh=st.notes.filter(function(n){ return (n.source||"").indexOf("share-")===0 });
    L("notes="+st.notes.length+" 分享来的="+sh.length);
    for(var i=0;i<sh.length;i++){
      var one=await api("/api/note?id="+sh[i].id);
      var n=one.note||{};
      L("分享"+i+" 来源="+n.source+" 状态="+n.status+" 文字="+String(n.text||"").replace(/\n/g,"|").slice(0,60)
        +" 附件="+((n.attachments||[]).length));
    }
    var ids=sh.map(function(n){ return n.id });
    var okd=[];
    for(var k=0;k<ids.length;k++){ var r=await api("/api/delete",{id:ids[k]}); okd.push(r.ok) }
    L("清理分享笔记 "+ids.length+" 条 → "+okd.join(","));
    var st3=await api("/api/state");
    L("清理后 notes="+st3.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
