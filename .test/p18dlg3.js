(async function(){
  var E=window.__enote, A=E.actions||{};
  var L=function(m){console.log("PROBED3 "+m)};
  var box=function(){ return document.getElementById("dlg") };
  var vis=function(){ var e=document.getElementById("dlgYes"); return !!(e&&e.offsetParent) };
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var state=function(tag){ var b=box(); L(tag+" vis="+vis()+" disp="+(b?b.style.display:"无节点")+" cls="+(b?b.className:"无节点")) };
  A.settingsSheet();
  for(var i=0;i<40 && !document.getElementById("sUrl");i++){ await sleep(50) }
  state("静息");
  var byText=function(sel,txt){ var hit=null; [].slice.call(document.querySelectorAll(sel)).forEach(function(b){ if(b.textContent.trim()===txt) hit=b }); return hit };
  var sv=byText("#sheet .btn","保存");
  L("saveBtn="+(sv?1:0)); if(sv) sv.click();
  var cb=byText("#sheet .btn","清空全部");
  L("clearBtn="+(cb?1:0)); if(cb) cb.click();
  for(var j=0;j<30 && !vis();j++){ await sleep(200) }
  state("打开后");
  var no=document.getElementById("dlgNo");
  L("noVisible="+(no?!!no.offsetParent:false)+" noText="+(no?no.textContent.trim():"无"));
  if(no) no.click();
  for(var k=0;k<25 && vis();k++){ await sleep(200) }
  state("取消后 k="+k);
})()
