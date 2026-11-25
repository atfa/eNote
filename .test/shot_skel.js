(async function(){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  __enote.vue.host.tabPick("files");
  await sleep(900);
  var t=setInterval(function(){ __enote.vue.host.FA.loaded=false; render(); }, 250);
  setTimeout(function(){ clearInterval(t) }, 9000);
  __enote.vue.host.FA.loaded=false; await render();
  console.log("SHOT skel " + document.querySelectorAll(".pane[data-tab=files] .skel").length);
})()
