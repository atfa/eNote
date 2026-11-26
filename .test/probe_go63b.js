(async function(){
  var L=function(m){console.log("G63B "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.Android);z++){ await W(250) }
    var res=[];
    window.shotsImported=function(r){ res.push(r) };
    Android.importShots("");
    for(var i=0;i<40 && !res.length;i++){ await W(300) }
    L("空串参数 → "+JSON.stringify(res[0]||{}));
    res=[];
    Android.importShots("[1,2]");
    for(var j=0;j<40 && !res.length;j++){ await W(300) }
    L("数组参数 → "+JSON.stringify(res[0]||{}));
    L("done=1");
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
