(function(){
  var sels=[".topbar .tb","#fab",".search input",".card",".t",".chip",".seg button",".btn",".sw",".skel",".ttx a",".tabbar .tab",".sec",".li",".empty",".dlg .h",".sheet .h",".strip",".stat",".field input","textarea","button"];
  var props=["font-size","font-family","text-decoration-line","color","margin-top","margin-left","padding-top","padding-left","border-top-width","line-height","letter-spacing","font-weight"];
  var out=[];
  sels.forEach(function(s){
    var el=document.querySelector(s);
    if(!el){ out.push(s+"=无"); return }
    var c=getComputedStyle(el);
    out.push(s+"{"+props.map(function(p){return p+":"+c.getPropertyValue(p)}).join(";")+"}");
  });
  console.log("PROBESTYLE "+out.join(" ~ ").replace(/;/g,"|"));
})()
