(async function(){
  var L=function(m){console.log("CM "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .card").length);z++){ await W(250) }
    var H=__enote.vue.host;
    var vis=function(){return [].slice.call(document.querySelectorAll("#view .pane")).filter(function(d){return d.style.display!=="none"}).map(function(d){return d.dataset.tab}).join(",")};
    L("就绪 loads="+window.__enoteAppLoads+" 卡片="+document.querySelectorAll("#view .card").length+" tab="+H.tab+" 可见面板="+vis());
    document.querySelector(".tabbar .tab[data-tab=todos]").click(); await W(800);
    L("切待办页：tab="+H.tab+" 可见面板="+vis()+" 待办行="+document.querySelectorAll(".pane[data-tab=todos] .todo").length);
    document.querySelector(".tabbar .tab[data-tab=mine]").click(); await W(900);
    L("切我的页：可见面板="+vis()+" hero 在="+!!document.querySelector(".pane[data-tab=mine] .hero"));
    __enoteActions.settingsSheet(); await W(900);
    L("设置弹层：sheet 节点="+(document.querySelector("#sheet")?"在":"无")+" 标题="+JSON.stringify((document.querySelector("#sheet .phead div")||{}).textContent||"无"));
    closeSheet(); await W(600);
    H.searchInput("笔记"); await W(900);
    L("搜索：host.q="+JSON.stringify(H.q)+" 卡片="+document.querySelectorAll("#view .card").length+" srErr="+JSON.stringify(H.srErr));
    H.searchClear(); await W(800);
    L("清空之后：卡片="+document.querySelectorAll("#view .card").length+" tab="+H.tab+" 可见面板="+vis());
    L("end loads="+window.__enoteAppLoads+" 状态点="+document.querySelector("#dot").className);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
