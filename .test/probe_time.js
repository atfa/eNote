(async function(){
  var L=function(m){console.log("TM "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return __enote.state.S};
  var api=function(b){return fetch("/api/todo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json()})};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var p=function(n){return String(n).padStart(2,"0")};
  var f=function(d){var x=new Date(d);return x.getFullYear()+"-"+p(x.getMonth()+1)+"-"+p(x.getDate())};
  var dues=function(){return [].slice.call(document.querySelectorAll("#view .due")).map(function(e){
    return e.textContent.replace(/\s+/g,"")+(e.className.indexOf("over")>=0?"[over]":(e.className.indexOf("today")>=0?"[today]":""))}).join("|")};
  try{
    var meta=document.querySelector("#view .card .meta");
    L("笔记卡时间（fmtTime）="+JSON.stringify(meta?meta.textContent.replace(/\s+/g," "):"none"));
    var nid=S().notes[0].id, made=[];
    var spec=[[f(Date.now()-864e5)+"T09:00","逾期时间项"],[f(Date.now())+"T23:50","今天时间项"],["","无到期项"]];
    for (var i=0;i<spec.length;i++){
      var r=await api({action:"add",noteId:nid,text:spec[i][1],due:spec[i][0],priority:"normal"});
      made.push(r.id||r.todoId||"?");
    }
    await W(1400); pick("todos"); await W(1400);
    L("到期段（fmtTime + now 比对）="+dues());
    L("待办行="+document.querySelectorAll("#view .todo").length+" 分组="+
      [].slice.call(document.querySelectorAll("#view .sec")).map(function(e){return e.textContent.replace(/\s+/g,"")}).join("|"));
    __enoteActions.clipSheet(); await W(1400);
    var cm=[].slice.call(document.querySelectorAll("#sheet .climeta")).map(function(e){return e.textContent.replace(/\s+/g," ")}).slice(0,3).join(" / ");
    L("剪贴板计数条（relTime）="+JSON.stringify(cm||"none")+" 条数="+document.querySelectorAll("#sheet .cliprow").length);
    __enoteActions.closeSheet(); await W(400);
    for (var j=0;j<made.length;j++){ if(made[j]!=="?") await api({action:"delete",noteId:nid,todoId:made[j]}); }
    await W(1200); pick("notes"); await W(900);
    L("end notes="+S().notes.length+" 待办行="+document.querySelectorAll("#view .todo").length+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
