(async function(){
  var L=function(m){console.log("AI "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var S=function(){return __enote.state.S};
  var tt=function(){var t=document.querySelector(".van-toast__text");return t?JSON.stringify(t.textContent):"none"};
  var sw=function(){
    var rows=[].slice.call(document.querySelectorAll("#sheet .row"));
    var r=rows.filter(function(x){return x.textContent.indexOf("启用 AI 解析")>=0})[0];
    return r?r.querySelector(".van-switch"):null;
  };
  try{
    __enoteActions.settingsSheet(); await W(900);
    var a=sw(); L("设置页 AI 开关="+(a?"yes":"no")+" useAI="+S().settings.useAI);
    if(a){ a.click(); await W(1300); L("翻一次 useAI="+S().settings.useAI+" toast="+tt()
      +" 类名="+JSON.stringify((sw()||{}).className)); }
    var b=sw(); if(b){ b.click(); await W(1300); L("翻回来 useAI="+S().settings.useAI+" toast="+tt()); }
    __enoteActions.closeSheet(); await W(400); L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
