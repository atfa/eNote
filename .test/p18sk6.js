(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    var host=__enote.vue.host;
    var oldNow=host.statsNow; host.statsNow=function(){return Promise.resolve()};
    host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST; __enote.ST=null;
    await sleep(80);
    var h=document.querySelector(".pane[data-tab=mine]").innerHTML;
    L(JSON.stringify({stIsNull:__enote.ST===null,statgrid:h.indexOf("statgrid")>=0,
      skel:h.indexOf("skel")>=0,len:h.length}));
    host.statsNow=oldNow; __enote.ST=saved; await render(); host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
