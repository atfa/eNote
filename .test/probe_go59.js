(async function(){
  var L=function(m){console.log("G59 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var E=function(s){return encodeURIComponent(s)};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads);
    var a0=await __enote.api("/api/attachments");
    var a1=await __enote.api("/api/attachments?mime=application/pdf");
    var a2=await __enote.api("/api/attachments?mime=image");
    var a3=await __enote.api("/api/attachments?q="+E("不存在的关键词zzz"));
    var a5=await __enote.api("/api/attachments?note="+E("没有这条笔记"));
    var a4=await __enote.api("/api/attachments?sort=size&dir=asc&limit=1");
    var a6=await __enote.api("/api/attachments?q="+E(((a0.items||[])[0]||{}).name||"zzz"));
    L("GET /api/attachments（listAttachments 拆分后）：全量 total="+a0.total+" files="+a0.files+" missing="+a0.missing+" bytes="+a0.bytes+" scanned="+a0.scanned+" dirs="+((a0.dirs||[]).length)+" diskFiles="+a0.diskFiles+" 首条 kind="+((a0.items||[])[0]||{}).kind);
    L("过滤：mime=pdf total="+a1.total+" mime=image total="+a2.total+" q无命中 total="+a3.total+" q命中名称 total="+a6.total+" note无命中 total="+a5.total+" sort=size limit=1 条数="+((a4.items||[]).length));
    var add=await __enote.api("/api/add",{text:"步骤五九探针：明天上午十点给妈妈打电话问体检结果"});
    var nn={};
    for(var i=0;i<40;i++){ await W(500); nn=(await __enote.api("/api/note?id="+add.id)).note||{}; if(["done","raw","error"].indexOf(nn.status)>=0) break; }
    L("POST /api/add → runNote/runNoteAI：状态="+nn.status+" 标题="+JSON.stringify(String(nn.title||"").slice(0,24))+" 待办="+((nn.todos||[]).length)+" 时间="+JSON.stringify(String(nn.due||""))+" 错误="+JSON.stringify(String(nn.error||"")));
    await __enote.api("/api/delete",{ids:[add.id]});
    __enoteActions.refresh(); await W(900);
    L("清理 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
