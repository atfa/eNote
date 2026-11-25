(async function(){
  var E=window.__enote, A=E.actions||{};
  var L=function(m){console.log("PROBEVD "+m)};
  var box=function(){ return document.getElementById("dlg") };
  var vis=function(){ var e=document.getElementById("dlgYes"); return !!(e&&e.offsetParent) };
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var st=function(tag){ var b=box(); L(tag+" vis="+(vis()?1:0)+" disp="+(b?b.style.display:"无")) };
  try{
    A.settingsSheet();
    for(var i=0;i<40 && !document.getElementById("sUrl");i++){ await sleep(50) }
    L("step1 设置页开="+(document.getElementById("sUrl")?1:0));
    var byText=function(sel,txt){ var hit=null; [].slice.call(document.querySelectorAll(sel)).forEach(function(b){ if(b.textContent.trim()===txt) hit=b }); return hit };
    var cb=byText("#sheet .btn","清空全部");
    L("step2 clearBtn="+(cb?1:0)); if(cb) cb.click();
    for(var j=0;j<15 && !vis();j++){ await sleep(200) }
    st("step3 打开后");
    var no=document.getElementById("dlgNo");
    L("step4 noBtn="+(no?no.textContent.trim():"无"));
    no.click();
    L("step5 已点取消");
    for(var k=0;k<15 && vis();k++){ await sleep(200) }
    st("step6 取消后 k="+k);
  }catch(e){ L("ERR "+String(e&&e.message||e)) }
  L("step9 结束");
})()
