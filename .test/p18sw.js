(async function(){
  var L=function(m){console.log("P18SW "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var KEYS=["width","height","top","left","border-radius","background-color","background-image",
    "box-shadow","transform","transition-property","transition-duration","transition-timing-function",
    "position","opacity","display","flex-basis","padding","margin","font-size","overflow","visibility"];
  function cs(el,ps){
    if(!el) return "(none)";
    var c=getComputedStyle(el,ps||null),o={};
    KEYS.forEach(function(p){o[p]=c.getPropertyValue(p)});
    return o;
  }
  function knob(el){
    if(!el) return "(none)";
    var n=el.querySelector(".van-switch__node");
    return n?{cls:"van-switch__node",box:cs(n)}:{cls:"::after",box:cs(el,"::after")};
  }
  try{
    var out={};
    settingsSheet();
    await sleep(900);
    var sws=document.querySelectorAll(".sw");
    out.n=sws.length;
    out.sw0cls=sws[0]&&sws[0].className; out.sw0=cs(sws[0]); out.knob0=knob(sws[0]);
    out.sw1cls=sws[1]&&sws[1].className; out.sw1=cs(sws[1]); out.knob1=knob(sws[1]);
    if(sws[1]){
      sws[1].click(); await sleep(500);
      var s2=document.querySelectorAll(".sw");
      out.sw1onCls=s2[1]&&s2[1].className; out.sw1on=cs(s2[1]); out.knob1on=knob(s2[1]);
      s2[1].click(); await sleep(400);
    }
    closeSheet(); await sleep(400);
    /* ---- 骨架屏：附件页（img 变体）+ 我的页（普通两行）---- */
    __enote.vue.host.tabPick("files"); await sleep(700);
    var FA=__enote.vue.host.FA; var wasLoaded=FA.loaded; FA.loaded=false;
    await render(); await sleep(400);
    var sk=document.querySelectorAll(".pane[data-tab=files] .skel");
    out.skelN=sk.length;
    out.skelFiles=[];
    [].forEach.call(sk,function(e){
      var rows=[].map.call(e.querySelectorAll(".skel, .van-skeleton-paragraph, .van-skeleton-title"),
        function(k){return {cls:k.className,box:cs(k)}});
      out.skelFiles.push({cls:e.className,root:cs(e),rows:rows});
    });
    FA.loaded=wasLoaded; await render(); await sleep(300);
    __enote.vue.host.tabPick("mine"); await sleep(700);
    var stSaved=__enote.ST; __enote.ST=null; await render(); await sleep(60);
    var sk2=document.querySelectorAll(".pane[data-tab=mine] .skel");
    out.skelMineN=sk2.length;
    out.skelMine=[];
    [].forEach.call(sk2,function(e){
      var rows=[].map.call(e.querySelectorAll(".skel, .van-skeleton-paragraph, .van-skeleton-title"),
        function(k){return {cls:k.className,box:cs(k)}});
      out.skelMine.push({cls:e.className,root:cs(e),rows:rows});
    });
    __enote.ST=stSaved; await render(); await sleep(300);
    __enote.vue.host.tabPick("notes");
    out.done=1;
    console.log("P18SW "+JSON.stringify(out));
  }catch(e){ console.log("P18SW ERR "+String(e)+" "+(e&&e.stack)) }
})()
