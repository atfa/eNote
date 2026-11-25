(async function(){
  var L=function(m){console.log("P21DOM "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var cs=function(id){var el=q(id);if(!el)return "(none)";var c=getComputedStyle(el);
    return ["color","backgroundColor","borderRadius","fontSize","padding","borderColor","height","width"].map(function(k){return k+"="+c[k]}).join(";")};
  var box=function(id){var el=q(id);if(!el)return "(none)";var r=el.getBoundingClientRect();
    return Math.round(r.width)+"x"+Math.round(r.height)+"@"+Math.round(r.x)+","+Math.round(r.y)};
  try{
    var out={};
    __enote.vue.host.fabAct();
    await sleep(1000);
    out.addText = q("#addText") ? q("#addText").outerHTML : "(none)";
    out.addCs = cs("#addText"); out.addBox = box("#addText");
    closeSheet();
    await sleep(500);
    __enote.vue.host.addTodoSheet("n-demo");
    await sleep(1000);
    ["tText","tDate","tTime","tPri"].forEach(function(id){
      out[id] = q("#"+id) ? q("#"+id).outerHTML : "(none)";
      out[id+"_cs"] = cs("#"+id); out[id+"_box"] = box("#"+id);
    });
    out.selIndex = q("#tPri") ? q("#tPri").selectedIndex : -1;
    out.selValue = q("#tPri") ? q("#tPri").value : "";
    closeSheet();
    L(JSON.stringify(out));
  }catch(e){ L("ERR "+String(e)) }
})()
