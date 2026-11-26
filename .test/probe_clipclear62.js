(async function(){
  var L=function(m){console.log("CL62 "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions);z++){ await W(250) }
    var r=await __enote.api("/api/clip/clear",{});
    var c=await __enote.api("/api/clip/list");
    L("clip/clear="+JSON.stringify(r).slice(0,60)+" 剩余="+c.clips.length);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,120)) }
})()
