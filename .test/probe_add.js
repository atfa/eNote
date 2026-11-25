(async function(){
  var L=function(m){console.log("AD "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var sh=function(){var s=document.getElementById("sheet"),b=document.getElementById("sheetBody");
    return "sheet="+(s?"on":"none")+" body="+(b?b.innerHTML.length:-1)};
  var tt=function(){var t=document.querySelector(".van-toast__text");return t?t.textContent:"none"};
  var S=function(){return __enote.state.S};
  var nN=function(){return S().notes.length};
  var nT=function(){return S().notes.reduce(function(a,n){return a+(n.todos?n.todos.length:0)},0)};
  var type=function(id,v){var e=document.getElementById(id);if(!e)return "noinput";
    e.value=v;e.dispatchEvent(new Event("input",{bubbles:true}));return "typed"};
  var clickBtn=function(txt){var bs=[].slice.call(document.querySelectorAll("#sheetBody button"));
    var b=bs.filter(function(x){return x.textContent.indexOf(txt)>=0})[0];if(!b)return "nobtn";b.click();return "clicked"};
  try{
    L("base "+sh()+" notes="+nN()+" todos="+nT());
    document.getElementById("fab").click(); await W(500);
    L("记一笔 "+sh()+" addText="+(document.getElementById("addText")?"yes":"no"));
    L("  输入 "+type("addText","步骤四十探针笔记"));
    L("  "+clickBtn("保存并解析")+" → toast="+tt());
    await W(1200); L("  addNote 后 notes="+nN()+" "+sh());
    var nid=S().notes[0].id;
    addTodoSheet(nid); await W(500);
    L("addtodo "+sh()+" tText="+(document.getElementById("tText")?"yes":"no")+" h2="+document.querySelector("#sheetBody h2").textContent);
    L("  输入 "+type("tText","买牛奶"));
    L("  "+clickBtn("添加")+" → toast="+tt());
    await W(1200); L("  addTodo 后 todos="+nT()+" notes="+nN()+" "+sh());
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
