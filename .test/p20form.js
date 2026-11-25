(async function(){
  var L=function(m){console.log("P20FORM "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  try{
    var old=__enote.state.S.settings.model;
    settingsSheet();
    await sleep(1500);
    var out={opened:!!q("#sUrl"),inputs:document.querySelectorAll("#sUrl,#sKey,#sModel,#sTimeout,#sMax,#sTemp").length,
      urlAttr:q("#sUrl")?String(q("#sUrl").getAttribute("value")):"none",
      formModel:(__enote.vue.host.SFORM||{}).model};
    var el=q("#sModel");
    el.value="probe-model";
    el.dispatchEvent(new Event("input",{bubbles:true}));
    await sleep(120);
    out.afterType=(__enote.vue.host.SFORM||{}).model;
    out.attrAfterType=q("#sModel").getAttribute("value");
    __enote.vue.host.saveSettings();
    await sleep(900);
    out.savedModel=__enote.state.S.settings.model;
    out.toast=(q("#toast")?q("#toast").textContent:"");
    closeSheet();
    await sleep(400);
    settingsSheet();
    await sleep(1200);
    out.reopened=q("#sModel").value;
    q("#sModel").value=old;
    q("#sModel").dispatchEvent(new Event("input",{bubbles:true}));
    await sleep(120);
    __enote.vue.host.saveSettings();
    await sleep(900);
    out.restored=__enote.state.S.settings.model;
    closeSheet();
    L(JSON.stringify(out));
  }catch(e){ L("ERR "+String(e)) }
})()
