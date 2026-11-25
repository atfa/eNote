(async function(){
  var L=function(m){console.log("P21VER "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var qa=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
  var txt=function(el){return (el.textContent||"").replace(/\s+/g," ").trim()};
  try{
    var out={};
    __enote.vue.host.tabPick("todos");
    await sleep(1200);
    var td=null;
    qa("#view .li .tx .ttx").forEach(function(x){ if(/步骤 21 探针待办/.test(x.textContent)) td=x });
    out.todoFound=td?1:0;
    out.todoText=td?txt(td).slice(0,80):"";
    out.todoChip=td?txt(td.parentElement):"";
    __enote.vue.host.tabPick("notes");
    await sleep(1200);
    var card=null;
    qa("#view .card").forEach(function(x){ if(/步骤 21 探针笔记/.test(x.textContent)) card=x });
    out.noteFound=card?1:0;
    out.noteText=card?txt(card).slice(0,90):"";
    if(card){ __enote.vue.host.delNote(card.id.replace(/^n/,"")); }
    await sleep(1200);
    out.dlg=q("#dlg")?txt(q("#dlg")).slice(0,60):"";
    if(q("#dlgYes")){ q("#dlgYes").click(); }
    await sleep(1500);
    var card2=null;
    qa("#view .card").forEach(function(x){ if(/步骤 21 探针笔记/.test(x.textContent)) card2=x });
    out.afterDel=card2?1:0;
    __enote.vue.host.tabPick("todos");
    await sleep(1200);
    var td2=null;
    qa("#view .li .tx .ttx").forEach(function(x){ if(/步骤 21 探针待办/.test(x.textContent)) td2=x });
    out.todoAfterCascade=td2?1:0;
    L(JSON.stringify(out));
  }catch(e){ L("ERR "+String(e)) }
})()
