(async function(){
  var L=function(m){console.log("PN "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var vis=function(){return [].slice.call(document.querySelectorAll("#view .pane")).filter(function(d){return d.style.display!=="none"}).map(function(d){return d.dataset.tab}).join(",")};
  var cnt=function(){return [].slice.call(document.querySelectorAll("#view .pane")).map(function(d){return d.dataset.tab+":"+(d.children.length)}).join(" ")};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelectorAll("#view .pane").length);z++){ await W(250) }
    L("就绪 loads="+window.__enoteAppLoads+" pane 数="+document.querySelectorAll("#view .pane").length+" 可见="+vis());
    L("注册表 VUE_VIEWS keys="+Object.keys(__enote.vue.views).sort().join(",")+" VUE_SHEETS keys="+Object.keys(__enote.vue.VUE_SHEETS).sort().join(","));
    L("isVue 四个 tab="+["notes","todos","files","mine"].map(function(t){return t+"="+__enote.vue.isVue(t)}).join(" "));
    L("isVueSheet 三个弹层="+["settings","clip","log"].map(function(t){return t+"="+__enote.vue.isVueSheet(t)}).join(" "));
    for(var i=0;i<4;i++){
      var t=["todos","files","mine","notes"][i];
      document.querySelector(".tabbar .tab[data-tab="+t+"]").click();
      await W(700);
      L("切到 "+t+"：可见="+vis()+" 各 pane 子节点="+cnt());
    }
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
