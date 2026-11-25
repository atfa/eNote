(function(){
  var h = window.__enote.vue.host, out = [];
  function t(name, fn){ try { out.push(name + "=" + fn()) } catch(e){ out.push(name + "=ERR:" + e.message) } }
  var due = new Date(Date.now()+7200000).toISOString().slice(0,16);
  t("cdText", function(){ return h.cdText(due) });
  t("cdCls", function(){ return h.cdCls(due) });
  t("keepAliveOn", function(){ return h.keepAliveOn() });
  t("exactGranted", function(){ return h.exactGranted() });
  t("notifyGranted", function(){ return h.notifyGranted() });
  t("batteryIgnoring", function(){ return h.batteryIgnoring() });
  t("syncReminders", function(){ syncReminders(); return "ok" });
  t("remindPending", function(){ return window.__enote.state.remindPending });
  t("loads", function(){ return window.__enoteAppLoads });
  console.log("REM " + out.join(" | "));
})()
