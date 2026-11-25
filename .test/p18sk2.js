(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    __enote.vue.host.tabPick("mine"); await sleep(900);
    var panes=[].map.call(document.querySelectorAll(".pane"),function(p){return p.dataset.tab});
    var saved=__enote.ST; __enote.ST=null; await render();
    var all=[].map.call(document.querySelectorAll(".skel"),function(e){return e.className});
    L(JSON.stringify({panes:panes,skelAnywhere:all,stIsNull:(__enote.ST===null),
      isVue:__enote.vue&&__enote.vue.isVue?__enote.vue.isVue("mine"):"?",
      html:(document.querySelector(".pane[data-tab=mine]")||{innerHTML:""}).innerHTML.slice(0,160)}));
    __enote.ST=saved; await render(); __enote.vue.host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
