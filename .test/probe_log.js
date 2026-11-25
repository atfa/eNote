(async function(){
  var L=function(m){console.log("LG "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var sh=function(){
    var s=document.getElementById("sheet");
    return "sheet="+(s&&s.className.indexOf("on")>=0?"on":"none")
      +" kind="+(document.querySelector("#sheet .sheet")?document.querySelector("#sheet .sheet").dataset.kind:"null")
      +" body="+((document.getElementById("panel")||{}).textContent||"").length;
  };
  var toastTxt=function(){ var t=document.getElementById("toast"); return t?JSON.stringify(t.textContent.slice(0,20)):"none" };
  try{
    L("base "+sh());
    await __enoteActions.showLog(); await W(500);
    L("运行日志 "+sh()+" 首行="+JSON.stringify(((document.getElementById("panel")||{}).textContent||"").slice(0,26)));
    __enoteActions.closeSheet(); await W(400);
    await __enoteActions.showDebug(); await W(500);
    L("AI记录 "+sh());
    __enoteActions.closeSheet(); await W(400);
    __enoteActions.settingsSheet(); await W(700);
    L("设置页 "+sh()+" 保存按钮="+((document.querySelector("#sheet .acts .btn.pri")||{}).textContent||"no"));
    document.querySelector("#sheet .acts .btn.pri").click(); await W(900);
    L("保存后 toast="+toastTxt()+" "+sh());
    document.querySelector("#sheet .acts .btn:not(.pri)").click();
    await W(120);
    var out=document.getElementById("llmOut")||document.querySelector("#sheet .llmout");
    L("测试连接中 "+(out?JSON.stringify(out.textContent.slice(0,24)):"noout"));
    await W(6000);
    L("测试连接后 "+(out?JSON.stringify(out.textContent.slice(0,40)):"noout"));
    __enoteActions.closeSheet(); await W(400);
    L("end "+sh()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
