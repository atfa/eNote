(async function(){
  var L=function(m){console.log("PROBE "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    L("host="+(__enote.vue.host?"ok":"NULL"));
    L("apps="+Object.keys(__enote.vue.apps).join(","));
    __enote.state.tab="notes";
    await sleep(400);
    L("cards="+document.querySelectorAll('.pane[data-tab=notes] .card').length);
    L("strip="+document.querySelectorAll('.pane[data-tab=notes] .topbar').length);
    L("srErr="+typeof __enote.vue.host.srErr);
  }catch(e){ L("ERR="+(e&&e.message)) }
  L("done=1");
})()
