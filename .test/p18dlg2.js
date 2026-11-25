(async function(){
  var E=window.__enote, A=E.actions||{};
  var L=function(m){console.log("PROBED2 "+m)};
  var vis=function(){ var e=document.getElementById("dlgYes"); return !!(e&&e.offsetParent) };
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  L("actions="+(A.settingsSheet?"有":"无")+" vis0="+vis());
  A.settingsSheet();
  for(var i=0;i<40 && !document.querySelector("#sheet .btn");i++){ await sleep(50) }
  var bs=[].slice.call(document.querySelectorAll("#sheet .btn")).map(function(b){return b.textContent.trim()});
  L("sheetBtns="+bs.join("|"));
  var cb=[].slice.call(document.querySelectorAll("#sheet .btn")).filter(function(b){return b.textContent.indexOf("清空全部")>=0})[0];
  L("clearBtn="+(cb?1:0));
  if(cb){ cb.click(); }
  for(var j=0;j<30 && !vis();j++){ await sleep(200) }
  L("visAfterClear=" + vis());
  var no=document.getElementById("dlgNo");
  L("noBtn="+(no?no.textContent.trim():"无")+" noVisible="+(no?!!no.offsetParent:false));
  if(no) no.click();
  for(var k=0;k<30 && vis();k++){ await sleep(200) }
  L("visAfterCancel="+vis()+" k="+k);
  var st=(window.__enote.vue&&window.__enote.vue.host)?Object.keys(window.__enote.vue.host).length:-1;
  L("hostKeys="+st);
})()
