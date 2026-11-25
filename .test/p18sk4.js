(async function(){
  var L=function(m){console.log("P18SK "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  function cs(el){var c=getComputedStyle(el),o={};
    ["width","height","border-radius","background-color","background-image","margin","opacity","display","padding"].forEach(function(p){o[p]=c.getPropertyValue(p)});return o}
  try{
    __enote.vue.host.tabPick("mine"); await sleep(900);
    var saved=__enote.ST; __enote.ST=null;
    var hit=null;
    for(var i=0;i<40 && !hit;i++){
      await sleep(5);
      var q=document.querySelectorAll(".pane[data-tab=mine] .skel");
      if(q.length){
        var rows=[];
        [].forEach.call(q[0].querySelectorAll(".van-skeleton-paragraph"),function(k){rows.push({cls:k.className,box:cs(k)})});
        if(!rows.length) [].forEach.call(q,function(e){rows.push({cls:e.className,box:cs(e)})});
        hit={n:q.length,cls:q[0].className,root:cs(q[0]),rows:rows};
      }
    }
    L(JSON.stringify({hit:hit}));
    __enote.ST=saved; await render(); __enote.vue.host.tabPick("notes");
  }catch(e){ L("ERR "+String(e)) }
})()
