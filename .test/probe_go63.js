(async function(){
  var L=function(m){console.log("G63 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" 桥="+(window.Android&&Android.importShots?"在":"没了"));
    var res=[];
    window.shotsImported=function(r){ res.push(r) };
    var sl=await api("/api/shots/list");
    var shots=(sl.shots||[]).map(function(s){ return {path:s.path,name:s.name,mime:s.mime} });
    L("暂存截图="+shots.length+" 名称="+shots.map(function(s){return s.name}).join(","));
    if(!shots.length){ L("没有暂存截图"); L("done=1"); return }
    var had0=(await api("/api/state")).notes.map(function(n){ return n.id });
    Android.importShots(JSON.stringify({mode:"split",raw:true,shots:shots.slice(0,2)}));
    for(var i=0;i<120 && !res.length;i++){ await W(500) }
    L("split 结果="+JSON.stringify(res[0]||{}).slice(0,220));
    var st1=await api("/api/state");
    var fresh1=st1.notes.filter(function(n){ return had0.indexOf(n.id)<0 });
    L("split 后新笔记="+fresh1.length+" 来源="+fresh1.map(function(n){return n.source}).join(",")
      +" 状态="+fresh1.map(function(n){return n.status}).join(",")
      +" 附件="+(fresh1.map(function(n){return (n.attachments||[]).length}).join(",")));
    var ids1=fresh1.map(function(n){ return n.id });
    res=[];
    Android.importShots(JSON.stringify({mode:"merge",raw:true,shots:shots.slice(0,2)}));
    for(var j=0;j<120 && !res.length;j++){ await W(500) }
    L("merge 结果="+JSON.stringify(res[0]||{}).slice(0,220));
    var had1=st1.notes.map(function(n){ return n.id });
    var st2=await api("/api/state");
    var fresh2=st2.notes.filter(function(n){ return had1.indexOf(n.id)<0 });
    L("merge 后新笔记="+fresh2.length+" 来源="+fresh2.map(function(n){return n.source}).join(",")
      +" 附件="+(fresh2.map(function(n){return (n.attachments||[]).length}).join(",")));
    res=[];
    Android.importShots(JSON.stringify({mode:"split",raw:true,shots:[]}));
    for(var k=0;k<40 && !res.length;k++){ await W(300) }
    L("空 shots → "+JSON.stringify(res[0]||{}));
    Android.importShots("{坏掉的参数");
    for(var m=0;m<40 && !res.length;m++){ await W(300) }
    L("坏参数 → "+JSON.stringify(res[0]||{}));
    var del=ids1.concat(fresh2.map(function(n){ return n.id }));
    var okd=[];
    for(var q=0;q<del.length;q++){ var r=await api("/api/delete",{id:del[q]}); okd.push(r.ok) }
    L("清理笔记 "+del.length+" 条 → "+okd.join(","));
    var rm=await api("/api/shots/remove",{ids:(sl.shots||[]).map(function(s){return s.id})});
    L("清暂存 → "+JSON.stringify(rm));
    var st3=await api("/api/state");
    L("清理后 notes="+st3.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
