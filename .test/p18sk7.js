(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    var host=__enote.vue.host;
    var oldNow=host.statsNow; host.statsNow=function(){return Promise.resolve()};
    host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST; __enote.ST=null; await sleep(80);
    var apps=__enote.vue.apps||{};
    var info={hostSTIsNull:host.ST===null, appKeys:Object.keys(apps)};
    var a=apps["view:mine"];
    if(a){
      var inst=a._instance, ctx=inst&&inst.ctx, setupState=inst&&inst.setupState;
      info.hasApp=true;
      info.stInSetup = setupState && ("st" in setupState) ? String(setupState.st===null) : "n/a";
      info.setupKeys = setupState ? Object.keys(setupState).slice(0,12) : [];
    }
    L(JSON.stringify(info));
    host.statsNow=oldNow; __enote.ST=saved; await render(); host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
