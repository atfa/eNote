(async function(){
  var L=function(m){console.log("GP "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return __enote.state.S};
  var api=function(b){return fetch("/api/todo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json()})};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var secs=function(){return [].slice.call(document.querySelectorAll("#view .sec")).map(function(e){return e.textContent.replace(/\s+/g,"")}).join("|")};
  var txts=function(){return [].slice.call(document.querySelectorAll("#view .todo .tx")).map(function(e){return e.textContent.replace(/\s+/g,"").slice(0,6)}).join("|")};
  try{
    var nid=S().notes[0].id, made=[], p=function(n){return String(n).padStart(2,"0")};
    var f=function(d){var x=new Date(d);return x.getFullYear()+"-"+p(x.getMonth()+1)+"-"+p(x.getDate())};
    var y=f(Date.now()-864e5), td=f(Date.now()), tm=f(Date.now()+864e5), wk=f(Date.now()+3*864e5);
    var spec=[[y+"T09:00","逾期项","low"],[td+"T09:00","今天低","low"],[td+"T10:00","今天高","high"],
              [td+"T11:00","今天中","normal"],[tm+"T09:00","明天项","normal"],[wk+"T09:00","本周项","normal"],
              ["","无日期项","normal"]];
    for (var i=0;i<spec.length;i++){
      var r=await api({action:"add",noteId:nid,text:spec[i][1],due:spec[i][0],priority:spec[i][2]});
      made.push(r.id||r.todoId||"?");
    }
    await W(1400); pick("todos"); await W(1400);
    L("建 "+made.length+" 条 分组="+secs());
    L("默认顺序 "+txts());
    __enoteActions.setPref("sort","pri"); await W(1400);
    L("按优先级 "+txts());
    __enoteActions.setPref("sort","due"); await W(1200);
    L("按到期 "+txts());
    for (var j=0;j<made.length;j++){ if(made[j]!=="?") await api({action:"delete",noteId:nid,todoId:made[j]}); }
    await W(1400); L("清理后 待办行="+document.querySelectorAll("#view .todo").length+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
