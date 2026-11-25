(async function(){
  var L=function(m){console.log("P18V "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    settingsSheet(); await sleep(800);
    var el=document.querySelector(".sw");
    var c=getComputedStyle(el);
    L("size="+c.getPropertyValue("--van-switch-size")+" height="+c.getPropertyValue("--van-switch-height")
      +" width="+c.getPropertyValue("--van-switch-width")+" node="+c.getPropertyValue("--van-switch-node-size")
      +" fs="+c.fontSize+" h="+c.height+" w="+c.width+" zoom="+c.zoom+" radius="+c.borderRadius);
    var h=getComputedStyle(document.documentElement);
    L("html fs="+h.fontSize+" zoom="+h.zoom+" scale="+h.getPropertyValue("--fs-scale")+" body fs="+getComputedStyle(document.body).fontSize+" bodyzoom="+getComputedStyle(document.body).zoom);
    closeSheet();
  }catch(e){ L("ERR "+String(e)) }
})()
