(function(){
  var out = [];
  function t(name, fn){ try { out.push(name + "=" + fn()) } catch(e){ out.push(name + "=ERR:" + e.message) } }
  t("typeofSetTheme", function(){ return typeof window.setTheme });
  t("actions", function(){ return window.__enote.actions ? Object.keys(window.__enote.actions).length : "none" });
  t("theme", function(){ return document.documentElement.getAttribute("data-theme") });
  t("notes", function(){ return (window.__enote.state.S.notes||[]).length });
  t("prefs", function(){ return JSON.stringify(window.__enote.vue.host.prefs || {}) });
  t("loads", function(){ return window.__enoteAppLoads });
  console.log("HEALTH " + out.join(" | "));
})()
