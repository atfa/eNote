(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  function cs(el){var c=getComputedStyle(el),o={};
    ["width","height","border-radius","background-color","background-image","margin","opacity","display","padding"].forEach(function(p){o[p]=c.getPropertyValue(p)});return o}
  try{
    var host=__enote.vue.host;
    host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST;
    __enote.ST=null;
    await new Promise(function(r){requestAnimationFrame(function(){requestAnimationFrame(function(){r()})})});
    var q=document.querySelectorAll(".pane[data-tab=mine] .skel");
    var out={n:q.length,rows:[]};
    if(q.length){
      out.cls=q[0].className; out.root=cs(q[0]);
      [].forEach.call(q[0].querySelectorAll(".van-skeleton-paragraph"),function(k){out.rows.push({cls:k.className,box:cs(k)})});
    }
    L(JSON.stringify(out));
    __enote.ST=saved; await render(); host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
