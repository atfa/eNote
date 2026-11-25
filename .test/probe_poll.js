(async function(){
  var L=function(m){console.log("PL "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var cards=function(){return document.querySelectorAll("#view .pane[data-tab=notes] .card").length};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && cards());z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+cards()+" 历史探针笔记="+__enote.state.S.notes.filter(function(n){return JSON.stringify(n).indexOf("轮询探针")>=0}).length);
    var c0=document.querySelector("#view .pane[data-tab=notes] .card");
    c0.__plmark=1;
    var n0=cards();
    var nmark=__enote.state.S.notes.filter(function(n){return JSON.stringify(n).indexOf("轮询探针")>=0}).length;
    await W(6500);
    var c1=document.querySelector("#view .pane[data-tab=notes] .card");
    L("静置 6.5s（3 轮轮询）：首张卡是同一个节点="+(c1&&c1.__plmark===1)+" 卡片="+cards()+"（uptimeS 在排除表里，不该重建 DOM）");
    L("prefsLoaded：搜索框 value="+JSON.stringify(document.querySelector("#q").value)+" 偏好 P().q="+JSON.stringify(__enote.vue.host.P().q));
    var tag="轮询探针";
    var r=await __enote.api("/api/add",{text:tag});
    L("api/add ok="+!!r.ok+" id="+((r.note&&r.note.id)||r.id||"?"));
    await W(5000);
    L("外部加数据后 5s（轮询自动重绘）：卡片="+cards()+"（之前 "+n0+"）");
    var hit=__enote.state.S.notes.filter(function(n){return JSON.stringify(n).indexOf(tag)>=0});
    L("找到带标记的笔记 "+hit.length+" 条（含上一轮没清掉的）");
    for(var i=0;i<hit.length;i++){ await __enote.api("/api/delete",{id:hit[i].id}) }
    await W(4000);
    L("删掉 "+hit.length+" 条之后 4s：卡片="+cards()+"（期望 "+(n0+1-hit.length)+"：本轮加的 1 条 - 清掉的 "+hit.length+" 条）");
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
