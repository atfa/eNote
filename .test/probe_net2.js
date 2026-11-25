(async function(){
  var L=function(m){console.log("N2 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var P=function(){return document.querySelector("#view .pane[data-tab=mine]")};
  var eb=function(){var e=P().querySelector(".errbox");return e?JSON.stringify(e.textContent.replace(/\s+/g," ").trim()):"none"};
  var tiles=function(){return P().querySelectorAll(".statgrid > *").length};
  var skel=function(){return P().querySelectorAll(".skel").length};
  var retry=function(){var b=[].slice.call(P().querySelectorAll(".btn")).filter(function(x){return x.textContent.indexOf("重试")>=0});return b[0]};
  var of=window.fetch;
  for(var z=0;z<120 && !window.__enote;z++){ await W(250) }
  try{
    __enote.test.failApi="/api/stats"; await W(200);
    L("测试缝读回="+JSON.stringify(__enote.test.failApi));
    __enote.test.failApi="";
    window.fetch=function(u,o){return String(u).indexOf("/api/stats")>=0?new Promise(function(){}):of(u,o)};
    pick("mine"); await W(15000);
    L("apiTimeout 12s 超时：骨架="+skel()+" 错条="+eb());
    window.fetch=of;
    var b=retry(); L("立即重试按钮="+(b?"yes":"no"));
    if(b){ b.click(); await W(2600); }
    L("重试后 错条="+eb()+" 磁贴="+tiles());
    __enote.test.failApi="/api/stats";
    pick("notes"); await W(500); pick("mine"); await W(2200);
    L("注入失败（有旧数据时）磁贴="+tiles()+" 错条="+eb());
    __enote.test.failApi="";
    pick("notes"); await W(500); pick("mine"); await W(2200);
    L("清缝后 磁贴="+tiles()+" 错条="+eb());
    __enote.toast("步骤四十七 toast"); await W(300);
    var t=document.querySelector(".van-toast__text");
    L("toast="+JSON.stringify(t?t.textContent:"none"));
    await W(2600); t=document.querySelector(".van-toast__text");
    L("2.6s 后 toast="+(t?JSON.stringify(t.textContent):"none"));
    var r=await __enote.api("/api/stats");
    L("api /api/stats keys="+Object.keys(r).slice(0,6).join(","));
    pick("notes"); await W(600); L("end loads="+window.__enoteAppLoads);
  }catch(e){ window.fetch=of; L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
