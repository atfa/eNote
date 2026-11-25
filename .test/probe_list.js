(async function(){
  var L=function(m){console.log("LS "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return __enote.state.S};
  var titles=function(){return [].slice.call(document.querySelectorAll("#view .card .t")).map(function(e){return e.textContent.replace(/\s+/g,"").slice(0,5)}).slice(0,3).join("|")};
  var nN=function(){return S().notes.length};
  var api=function(b){return fetch("/api/todo",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)}).then(function(r){return r.json()})};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var groups=function(){return [].slice.call(document.querySelectorAll("#view .ghead")).map(function(e){return e.textContent.replace(/\s+/g,"").slice(0,10)}).join("|")};
  var todoTxt=function(){return [].slice.call(document.querySelectorAll("#view .todo .ttx")).map(function(e){return e.textContent.slice(0,4)}).slice(0,6).join("|")};
  try{
    L("base notes="+nN()+" 顺序="+titles());
    __enoteActions.setPref("sort","title"); await W(900); L("排序标题 顺序="+titles());
    __enoteActions.setPref("sort","old"); await W(900); L("排序最早 顺序="+titles());
    __enoteActions.setPref("sort","new"); await W(900); L("排序最新 顺序="+titles());
    var imgN=S().notes.filter(function(n){return /image$/.test(n.source||"")}).length;
    __enoteActions.setPref("src","image"); await W(900);
    L("筛图片 应="+imgN+" 卡片="+document.querySelectorAll("#view .card").length);
    __enoteActions.setPref("src","all"); await W(900); L("筛全部 卡片="+document.querySelectorAll("#view .card").length);
    var of=window.fetch; window.fetch=function(u,o){return (String(u).indexOf("/api/search")>=0?Promise.reject(new Error("断网")):of(u,o))};
    var qi=document.getElementById("q"); qi.value="步骤"; qi.dispatchEvent(new Event("input",{bubbles:true})); await W(1600);
    L("本地过滤 hit 卡片="+document.querySelectorAll("#view .card").length+" 空态="+JSON.stringify(!!document.querySelector("#view .empty")));
    window.fetch=of; document.getElementById("qClear").click(); await W(1600);
    L("清词后 卡片="+document.querySelectorAll("#view .card").length);
    var nid=S().notes[0].id, made=[];
    var d=new Date(Date.now()-864e5), p=function(n){return String(n).padStart(2,"0")};
    var y=d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate());
    var td=new Date(), tds=td.getFullYear()+"-"+p(td.getMonth()+1)+"-"+p(td.getDate());
    var tm=new Date(Date.now()+864e5), tms=tm.getFullYear()+"-"+p(tm.getMonth()+1)+"-"+p(tm.getDate());
    for (var i=0;i<4;i++){
      var due=[y+"T09:00",tds+"T09:00",tms+"T09:00",""][i];
      var r=await api({action:"add",noteId:nid,text:"分组"+i+"号",due:due,priority:["low","high","normal","normal"][i]});
      made.push(r.id||r.todoId||"?");
    }
    await W(1200); L("建 4 条待办 ids="+made.join(","));
    pick("todos"); await W(1200);
    L("分组 "+groups());
    L("组内顺序 "+todoTxt());
    __enoteActions.setPref("sort","pri"); await W(1200); L("按优先级 "+todoTxt());
    for (var j=0;j<made.length;j++){ if(made[j]!=="?") await api({action:"delete",noteId:nid,todoId:made[j]}); }
    await W(1200); L("清理后 待办行="+document.querySelectorAll("#view .todo").length);
    __enoteActions.setPref("sort","due"); await W(600);
    pick("notes"); await W(900); L("end notes="+nN()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
