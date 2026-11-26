(async function(){
  var L=function(m){console.log("G64 "+m)};
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
    var had0=(await api("/api/state")).notes.map(function(n){ return n.id });
    Android.importShots(JSON.stringify({mode:"split",raw:true,shots:shots}));
    for(var i=0;i<160 && !res.length;i++){ await W(500) }
    L("split 结果="+JSON.stringify(res[0]||{}).slice(0,200));
    var st1=await api("/api/state");
    var fresh=st1.notes.filter(function(n){ return had0.indexOf(n.id)<0 });
    L("新笔记="+fresh.length+" 来源="+fresh.map(function(n){return n.source}).join(",")
      +" 状态="+fresh.map(function(n){return n.status}).join(","));
    for(var q=0;q<fresh.length;q++){
      var one=await api("/api/note?id="+fresh[q].id);
      var n=one.note||{};
      L("笔记"+q+" ocrText="+(n.ocrText||"").replace(/\n/g,"|").slice(0,80)
        +" 含GGEAMNCG="+((n.ocrText||"").indexOf("GGEAMNCG")>=0?1:0)
        +" 附件="+((n.attachments||[]).length));
    }
    res=[];
    window.uiDialogSeen="";
    var old=window.uiDialog;
    window.uiDialog=function(t,m,k){ window.uiDialogSeen=t+"/"+m+"/"+k; if(old) return old.apply(null,arguments); return true };
    window.alert("步骤六四原生弹框");
    for(var j=0;j<40 && !window.uiDialogSeen;j++){ await W(200) }
    L("alert 转发到页面对话框 → "+(window.uiDialogSeen||"没收到"));
    window.uiDialog=old;
    var del=fresh.map(function(n){ return n.id });
    var okd=[];
    for(var k2=0;k2<del.length;k2++){ var r2=await api("/api/delete",{id:del[k2]}); okd.push(r2.ok) }
    L("清理笔记 "+del.length+" 条 → "+okd.join(","));
    var rm=await api("/api/shots/remove",{ids:(sl.shots||[]).map(function(s){return s.id})});
    L("清暂存 → "+JSON.stringify(rm));
    var st3=await api("/api/state");
    L("清理后 notes="+st3.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
