(async function(){
  var L=function(m){console.log("P20DOM "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  try{
    settingsSheet();
    await sleep(1500);
    var out={};
    ["sUrl","sKey","sModel","sTimeout","sMax","sTemp"].forEach(function(id){
      var el=q("#"+id); out[id]= el ? el.outerHTML : "(none)";
    });
    out.cs = (function(){var el=q("#sUrl");var c=getComputedStyle(el);
      return ["color","backgroundColor","borderRadius","fontSize","padding","borderColor","width"].map(function(k){return k+"="+c[k]}).join(";")})();
    out.box = (function(){var el=q("#sUrl");var r=el.getBoundingClientRect();
      return Math.round(r.width)+"x"+Math.round(r.height)+"@"+Math.round(r.x)+","+Math.round(r.y)})();
    L(JSON.stringify(out));
    closeSheet();
  }catch(e){ L("ERR "+String(e)) }
})()
