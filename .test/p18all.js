(async function(){
  var props=["font-size","font-family","text-decoration-line","color","margin-top","margin-left","padding-top","padding-left","border-top-width","line-height","letter-spacing","font-weight","height","border-radius"];
  var pages={notes:[".card",".t",".chip","#fab",".search input",".strip",".bmenu"],
             todos:[".todo",".todo .tx",".seg button",".chip",".empty",".fab"],
             files:[".strip",".card",".li",".card .t",".bmenu"],
             mine:[".setrow",".sw",".btn",".card .t",".topbar .tb"],
             sheet:[".sheet .h",".setrow",".sw",".btn",".panel"]};
  function snap(sels){ return sels.map(function(s){ var el=document.querySelector(s); if(!el) return s+"=无"; var c=getComputedStyle(el); return s+"{"+props.map(function(p){return p+":"+c.getPropertyValue(p)}).join(";")+"}"}).join(" ~ ") }
  function click(el){ if(el) el.click() }
  var out=[];
  var tabs=document.querySelectorAll(".tabbar .tab");
  out.push("notes "+snap(pages.notes));
  click(tabs[1]); await new Promise(function(r){setTimeout(r,800)}); out.push("todos "+snap(pages.todos));
  click(tabs[2]); await new Promise(function(r){setTimeout(r,800)}); out.push("files "+snap(pages.files));
  click(tabs[3]); await new Promise(function(r){setTimeout(r,800)});
  var rows=document.querySelectorAll(".setrow");
  out.push("mine "+snap(pages.mine));
  click(rows[0]); await new Promise(function(r){setTimeout(r,800)}); out.push("sheet "+snap(pages.sheet));
  console.log("PROBEALL "+out.join(" ## ").replace(/;/g,"|"));
})()
