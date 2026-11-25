(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    __enote.vue.host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST; __enote.ST=null; await render();
    var h=document.querySelector(".pane[data-tab=mine]").innerHTML;
    L(JSON.stringify({hasStatgrid:h.indexOf("statgrid")>=0,hasCard:h.indexOf("card")>=0,
      len:h.length, mid:h.slice(300,700)}));
    __enote.ST=saved; await render(); __enote.vue.host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
