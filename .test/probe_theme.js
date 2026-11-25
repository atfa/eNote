(function(){
  var out = [];
  function t(name, fn){ try { out.push(name + "=" + fn()) } catch(e){ out.push(name + "=ERR:" + e.message) } }
  t("htmlTag", function(){ return document.documentElement.outerHTML.slice(0, 60).replace(/\s+/g, " ") });
  t("themeAttr", function(){ return String(document.documentElement.getAttribute("data-theme")) });
  t("meta", function(){ var m = document.querySelector("meta[name=theme-color]"); return m ? m.getAttribute("content") : "none" });
  t("settingsTheme", function(){ return String(window.__enote.state.S.settings.theme) });
  t("setThemeDark", function(){ setTheme("dark"); return "ok" });
  setTimeout(function(){
    t("afterDark", function(){ return String(document.documentElement.getAttribute("data-theme")) });
    t("metaAfter", function(){ var m = document.querySelector("meta[name=theme-color]"); return m ? m.getAttribute("content") : "none" });
    t("back", function(){ setTheme("light"); return "ok" });
    setTimeout(function(){
      t("final", function(){ return String(document.documentElement.getAttribute("data-theme")) });
      console.log("TH " + out.join(" | "));
    }, 800);
  }, 900);
})()
