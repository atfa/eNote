(async function(){
  var L=function(m){console.log("TB "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var st=function(){
    var fab=document.querySelector(".fab .flabel"), ph=document.getElementById("q");
    var on=document.querySelector(".tabbar .tab.on");
    return "tab="+__enote.state.tab+" body="+document.body.dataset.tab+" on="+(on?on.dataset.tab:"none")
      +" fab="+(fab?JSON.stringify(fab.textContent):"none")
      +" ph="+(ph?JSON.stringify(ph.placeholder):"none")
      +" ind="+(document.querySelector(".tabbar .ind")?"yes":"no")
      +" cards="+document.querySelectorAll("#view .card").length;
  };
  var pick=function(t){ var el=document.querySelector(".tabbar .tab[data-tab="+t+"]"); if(el) el.click(); return el?"ok":"noel" };
  try{
    L("base "+st());
    L("点待办 "+pick("todos")); await W(900); L("切待办 "+st());
    pick("todos"); await W(500); L("再点同页签 "+st());
    pick("files"); await W(1400); L("切附件 "+st());
    pick("mine"); await W(1800); L("切我的 "+st()+" 统计="+(((document.querySelector("#view .statgrid")||{}).textContent)||"none").slice(0,18));
    document.getElementById("brandBtn").click(); await W(900); L("brandGo "+st());
    var b=document.querySelector(".tabbar .tab");
    b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,clientX:40,clientY:2242}));
    await W(60); L("涟漪 rip="+(document.querySelector(".rip")?"yes":"no"));
    window.dispatchEvent(new Event("resize")); await W(200); L("resize 后 ind="+(document.querySelector(".tabbar .ind")?"yes":"no"));
    pick("notes"); await W(900);
    document.getElementById("fab").click(); await W(700);
    L("fab 记一笔 sheet="+JSON.stringify(((document.getElementById("sheet")||{}).className||"none"))+" "+st());
    __enoteActions.closeSheet(); await W(400);
    L("end "+st()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
