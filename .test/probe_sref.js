(function(){
  try { settingsSheet(); } catch(e){ console.log("SREF open ERR=" + e.name + ": " + e.message) }
  setTimeout(function(){
    console.log("SREF sheetOn=" + (document.querySelector("#panel") ? "yes" : "no"));
    try { settingsRefresh(); console.log("SREF refresh ok") }
    catch(e){ console.log("SREF refresh ERR=" + e.name + ": " + e.message) }
  }, 700);
})()
