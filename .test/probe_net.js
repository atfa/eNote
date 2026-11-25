(async function(){
  var L=function(m){console.log("NT "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var tt=function(){var t=document.querySelector(".van-toast__text");return t?JSON.stringify(t.textContent):"none"};
  var pick=function(t){var el=document.querySelector(".tabbar .tab[data-tab="+t+"]");if(el)el.click()};
  var eb=function(){var e=document.querySelector("#view .errbox");return e?JSON.stringify(e.textContent.replace(/\s+/g," ")):"none"};
  try{
    __enote.toast("步骤四十七 toast"); await W(300);
    L("toast 出现="+tt());
    await W(2600); L("2.6s 后 toast="+tt());
    var r=await __enote.api("/api/stats");
    L("api /api/stats keys="+Object.keys(r).slice(0,6).join(","));
    __enote.test.failApi="/api/stats";
    pick("notes"); await W(600); pick("stats"); await W(1600);
    L("注入失败后 我的页错条="+eb());
    __enote.test.failApi="";
    var btns=[].slice.call(document.querySelectorAll("#view .btn")).filter(function(b){return b.textContent.indexOf("重试")>=0});
    L("重试按钮="+(btns.length?"yes":"no"));
    if(btns[0]){ btns[0].click(); await W(2200); }
    L("清缝后 错条="+eb()+" 数字卡="+document.querySelectorAll("#view .num").length);
    __enote.test.failApi="/api/stats";
    var of=window.fetch; window.fetch=function(u,o){return String(u).indexOf("/api/stats")>=0?new Promise(function(){}):of(u,o)};
    pick("notes"); await W(500); pick("stats"); await W(15000);
    L("永久挂起（apiTimeout 超时）错条="+eb());
    window.fetch=of; __enote.test.failApi="";
    pick("notes"); await W(800); L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
