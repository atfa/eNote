(async function(){
  var L=function(m){console.log("G65 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var api=__enote.api;
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var st=JSON.parse(Android.shotState());
    L("shotState enabled="+st.enabled+" granted="+st.granted+" total="+st.total+" watermark="+st.watermark);
    var fs=st.folders||[];
    L("目录="+fs.length+" 明细="+fs.map(function(f){ return f.path+"#"+f.count+(f.missing?":missing":"") }).join(" | "));
    var sl=await api("/api/shots/list");
    L("暂存="+(sl.shots||[]).length+" 名称="+(sl.shots||[]).map(function(s){return s.name}).join(","));
    var rm=await api("/api/shots/remove",{ids:(sl.shots||[]).map(function(s){return s.id})});
    L("清暂存 → "+JSON.stringify(rm));
    var st2=JSON.parse(Android.shotState());
    L("清理后 shotState total="+st2.total+" 目录="+((st2.folders||[]).map(function(f){return f.path+"#"+f.count+(f.missing?":missing":"")}).join(" | ")));
    var s3=await api("/api/state");
    L("notes="+s3.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
