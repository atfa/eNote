(async function(){
  var E=window.__enote, A=E.actions||{};
  var L=function(m){console.log("PROBEVD2 "+m)};
  var vis=function(){ var e=document.getElementById("dlgYes"); return !!(e&&e.offsetParent) };
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var cs=function(tag){ var b=document.getElementById("dlg"); if(!b){L(tag+" 无节点"); return}
    var c=getComputedStyle(b);
    L(tag+" cls="+(""+b.className).replace("van-popup van-popup--center van-dialog enote-dialog","BOX")
      +" animDur="+c.animationDuration+" animName="+c.animationName
      +" transDur="+c.transitionDuration+" transProp="+c.transitionProperty
      +" op="+c.opacity+" disp="+b.style.display);
  };
  A.settingsSheet();
  for(var i=0;i<40 && !document.getElementById("sUrl");i++){ await sleep(50) }
  var byText=function(sel,txt){ var hit=null; [].slice.call(document.querySelectorAll(sel)).forEach(function(b){ if(b.textContent.trim()===txt) hit=b }); return hit };
  var cb=byText("#sheet .btn","清空全部"); if(cb) cb.click();
  for(var j=0;j<15 && !vis();j++){ await sleep(200) }
  cs("打开后");
  document.getElementById("dlgNo").click();
  await sleep(60); cs("取消后60ms");
  await sleep(600); cs("取消后660ms");
  L("vis="+(vis()?1:0));
})()
