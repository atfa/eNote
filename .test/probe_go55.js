(async function(){
  var L=function(m){console.log("G55 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    var S=function(){return __enote.state.S};
    var find=function(){return S().notes.filter(function(x){return String(x.rawText||"").indexOf("步骤五五探针")>=0})};
    var term=function(a){return a.length && a[0].status!=="queued" && a[0].status!=="parsing"};
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
    var r2=await __enote.api("/api/add",{text:"   "});
    L("空文本（fillText 早退，不落库）：ok="+r2.ok+" error="+JSON.stringify(r2.error||"")+" 落库条数="+find().length);
    var r1=await __enote.api("/api/add",{text:"步骤五五探针 买牛奶 明天 09:00"});
    L("文本入队：ok="+r1.ok+" id="+String(r1.id||"").slice(0,6)+" error="+JSON.stringify(r1.error||""));
    for(var y=0;y<40;y++){ await W(700); __enoteActions.refresh(); await W(500); if(term(find())) break }
    var n=find();
    L("解析到终态：条数="+n.length+" 状态="+(n.length?n[0].status:"无")+" 标题="+JSON.stringify(n.length?n[0].title:"无")+" 待办="+(n.length&&n[0].todos?n[0].todos.length:0)+" 正文长度="+String(n.length?n[0].content:"").length);
    var all=find();
    for(var k=0;k<all.length;k++){ await __enote.api("/api/delete",{id:all[k].id}) }
    __enoteActions.refresh(); await W(900);
    L("清理之后：剩余="+find().length+" 卡片="+document.querySelectorAll("#view .card").length+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
