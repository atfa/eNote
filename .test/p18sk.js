(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  function cs(el){var c=getComputedStyle(el),o={};
    ["width","height","border-radius","background-color","background-image","margin","opacity","display","padding"].forEach(function(p){o[p]=c.getPropertyValue(p)});return o}
  try{
    __enote.vue.host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST; __enote.ST=null;
    await render();
    var q=document.querySelectorAll(".pane[data-tab=mine] .skel");
    var rows=[];
    [].forEach.call(q,function(e){
      [].forEach.call(e.querySelectorAll(".van-skeleton-paragraph"),function(k){rows.push({cls:k.className,box:cs(k)})});
      if(!rows.length) rows.push({cls:e.className,box:cs(e)});
    });
    L(JSON.stringify({n:q.length,rows:rows}));
    __enote.ST=saved; await render();
    __enote.vue.host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
