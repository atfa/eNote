(function(){
  var out = [];
  function t(name, fn){ try { out.push(name + "=" + fn()) } catch(e){ out.push(name + "=ERR:" + e.message) } }
  t("theme0", function(){ return document.documentElement.getAttribute("data-theme") });
  t("setThemeDark", function(){ setTheme("dark"); return "ok" });
  setTimeout(function(){
    t("theme1", function(){ return document.documentElement.getAttribute("data-theme") });
    t("meta", function(){ var m = document.querySelector("meta[name=theme-color]"); return m ? m.getAttribute("content") : "none" });
    t("setThemeBack", function(){ setTheme(window.__enote.state.S.settings.theme || "light"); return "ok" });
    setTimeout(function(){
      t("theme2", function(){ return document.documentElement.getAttribute("data-theme") });
      t("loads", function(){ return window.__enoteAppLoads });
      console.log("PREFS " + out.join(" | "));
    }, 700);
  }, 900);
})()
