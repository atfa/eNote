(async function(){
  var L=function(m){console.log("BX "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    var H=__enote.vue.host;
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length);
    L("S 同一份对象：host.S===state.S="+(H.S===__enote.state.S)+" notes="+H.S.notes.length);
    L("盒子 TAB：host.tab="+H.tab+" state.tab="+__enote.state.tab);
    var vis=function(){return [].slice.call(document.querySelectorAll("#view .pane")).filter(function(d){return d.style.display!=="none"}).map(function(d){return d.dataset.tab}).join(",")};
    document.querySelector(".tabbar .tab[data-tab=todos]").click(); await W(800);
    L("点待办页签之后：host.tab="+H.tab+" state.tab="+__enote.state.tab+" 可见面板="+vis());
    document.querySelector(".tabbar .tab[data-tab=notes]").click(); await W(700);
    L("切回笔记之后：host.tab="+H.tab+" 可见面板="+vis());
    H.searchInput("笔记"); await W(800);
    L("盒子 QB：searchInput 之后 host.q="+JSON.stringify(H.q)+" 搜索框 value="+JSON.stringify(document.querySelector("#q").value)+" 清除按钮在="+document.querySelector("#searchBox").classList.contains("has"));
    H.searchClear(); await W(700);
    L("searchClear 之后 host.q="+JSON.stringify(H.q)+" 搜索框 value="+JSON.stringify(document.querySelector("#q").value));
    var n0=H.S.notes[0];
    openNote(n0.id); await W(800);
    L("盒子 OPENB：open 里这条的展开位="+JSON.stringify(__enote.state.open[n0.id])+" 键数="+Object.keys(__enote.state.open).length+" 与点开的笔记一致="+(__enote.state.open[n0.id]===true));
    closeSheet(); await W(500);
    __enoteActions.settingsSheet(); await W(800);
    L("盒子 SHEETARGB：开设置弹层前 host.sheetArg="+JSON.stringify(H.sheetArg));
    var sb=document.querySelector("#sheet");
    L("盒子 SHEETARGB：弹层开着 host.sheetArg="+JSON.stringify(H.sheetArg)+" 弹层节点="+(sb?"在":"无")+" 另外三个盒子 host.remindPending="+JSON.stringify(H.remindPending)+" host.stErr="+JSON.stringify(H.stErr)+" host.srErr="+JSON.stringify(H.srErr));
    closeSheet(); await W(500);
    var s0=H.S;
    __enote.state.S={notes:[],settings:s0.settings,info:s0.info};
    await W(800);
    L("reassign 不换引用：state.S===旧引用="+(__enote.state.S===s0)+" host.S===旧引用="+(H.S===s0)+" notes 被换成="+H.S.notes.length);
    await __enoteActions.refresh(); await W(1000);
    L("refresh 之后数据回来：notes="+H.S.notes.length+" 卡片="+document.querySelectorAll("#view .card").length);
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
