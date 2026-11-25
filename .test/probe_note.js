(async function(){
  var L=function(m){console.log("NF "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return __enote.state.S};
  var nN=function(){return S().notes.length};
  var allT=function(){return S().notes.reduce(function(a,n){return a+(n.todos?n.todos.length:0)},0)};
  var doneT=function(){return S().notes.reduce(function(a,n){return a+(n.todos||[]).filter(function(t){return t.done}).length},0)};
  var tt=function(){var t=document.querySelector(".van-toast__text");return t?JSON.stringify(t.textContent):"none"};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var type=function(id,v){var e=document.getElementById(id);if(!e)return "noinput";
    e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return "typed"};
  var clickBtn=function(txt){var bs=[].slice.call(document.querySelectorAll("#sheetBody button"));
    var b=bs.filter(function(x){return x.textContent.indexOf(txt)>=0})[0];if(!b)return "nobtn";b.click();return "clicked"};
  try{
    L("base notes="+nN()+" todos="+allT()+" done="+doneT());
    var nid=S().notes[0].id;
    addTodoSheet(nid); await W(500); type("tText","步骤四十四待办"); clickBtn("添加"); await W(1500);
    L("建待办 todos="+allT());
    pick("todos"); await W(900);
    var cb=document.querySelector(".todo .cb");
    L("待办行 cb="+(cb?"yes":"no")+" enter卡片="+document.querySelectorAll("#view .card.enter").length);
    cb.click(); await W(120);
    L("勾选瞬间 justdone="+(document.querySelector(".todo.justdone")?"yes":"no")
      +" cb.on="+(document.querySelector(".todo .cb.on")?"yes":"no")
      +" leaving="+(document.querySelector(".todo.leaving")?"yes":"no"));
    await W(1800);
    L("勾选后 done="+doneT()+" todos="+allT()+" 划线="+(document.querySelector(".todo.done")?"yes":"no"));
    var t0=S().notes.filter(function(n){return (n.todos||[]).length})[0];
    __enoteActions.delTodo(t0.id,t0.todos[0].id); await W(1500);
    L("delTodo 后 todos="+allT());
    pick("notes"); await W(900);
    var ex=document.querySelector("#view .card .btn.exp");
    L("展开前 clamp="+(document.querySelector("#view .card .body.clamp")?"yes":"no"));
    if(ex){ ex.click(); await W(600); }
    L("expand 后 clamp="+(document.querySelector("#view .card .body.clamp")?"yes":"no")
      +" open="+JSON.stringify(!!__enote.state.open[S().notes[0].id]));
    var rp=document.querySelector("#view .card .btn:not(.dg):not(.exp)");
    L("卡上按钮="+[].slice.call(document.querySelectorAll("#view .card .btn")).map(function(b){return b.textContent.trim()}).slice(0,6).join("/"));
    var ai=document.querySelector("#view .card .btn[title]");
    __enoteActions.reparse(S().notes[0].id); await W(400); L("reparse toast="+tt());
    __enoteActions.reocr(S().notes[0].id); await W(400); L("reocr toast="+tt());
    var dg=document.querySelector("#view .card .btn.dg");
    L("delNote 前 notes="+nN()+" 删除按钮="+(dg?"yes":"no"));
    if(dg){ dg.click(); await W(500);
      L("  对话框 dlg="+(document.getElementById("dlg")?"on":"none")
        +" title="+JSON.stringify((document.getElementById("dlgT")||{}).textContent));
      document.getElementById("dlgYes").click(); await W(1200);
      L("  delNote 后 notes="+nN()+" dlg="+(document.getElementById("dlg")?"on":"none")); }
    __enoteActions.settingsSheet(); await W(800);
    var before=S().settings.useAI;
    var sw=document.querySelector("#sheet .van-switch");
    if(sw){ sw.click(); await W(1200); }
    L("toggleAI 前 useAI="+before+" 后 useAI="+S().settings.useAI+" toast="+tt());
    __enoteActions.closeSheet(); await W(400);
    L("end notes="+nN()+" todos="+allT()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
