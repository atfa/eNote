(async function(){
  var L=function(m){console.log("RD "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" tab="+__enote.state.tab+" 卡片="+document.querySelectorAll("#view .card").length);
    var exp=[].slice.call(document.querySelectorAll("#view .card .btn.exp"));
    L("syncExpand：展开按钮="+exp.length+" 可见="+exp.filter(function(b){return b.style.display!=="none"}).length+" 隐藏="+exp.filter(function(b){return b.style.display==="none"}).length);
    L("paintStatus：状态点 class="+JSON.stringify((document.querySelector("#brandBtn .dot")||{}).className));
    L("markReady 缝 typeof="+typeof __enote.markReady);
    var st="未测";
    await Promise.race([__enote.ready.then(function(){st="ready 已兑现"}),W(3000).then(function(){st="ready 3s 没兑现"})]);
    L("首屏记号："+st);
    var ms=[].slice.call(document.querySelectorAll("#view .pane[data-tab=notes] .metrics .m"));
    L("strip：笔记页指标条 "+ms.length+" 格 = "+JSON.stringify(ms.map(function(d){return d.textContent.replace(/\s+/g," ")}).join(" | ")));
    document.querySelector(".tabbar .tab[data-tab=todos]").click(); await W(800);
    var ms2=[].slice.call(document.querySelectorAll("#view .pane[data-tab=todos] .metrics .m"));
    L("strip：待办页指标条 "+ms2.length+" 格 = "+JSON.stringify(ms2.map(function(d){return d.textContent.replace(/\s+/g," ")}).join(" | ")));
    document.querySelector(".tabbar .tab[data-tab=mine]").click(); await W(900);
    document.querySelector(".tabbar .tab[data-tab=notes]").click(); await W(700);
    L("切回 notes：卡片="+document.querySelectorAll("#view .card").length+" 状态点="+JSON.stringify((document.querySelector("#brandBtn .dot")||{}).className));
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
