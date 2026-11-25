(async function(){
  var L=function(m){console.log("P21ATTR "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  try{
    __enote.vue.host.fabAct();
    await sleep(1000);
    var el=q("#addText");
    var attrs=[]; Array.prototype.forEach.call(el.attributes,function(a){attrs.push(a.name+"="+a.value)});
    var out={attrs:attrs.join(" | "), hasOwnValue:Object.prototype.hasOwnProperty.call(el,"value"),
      protoValue:"value" in el, underscore:String(el._value), domValue:el.value,
      parentHTML:el.parentElement.outerHTML.slice(0,200)};
    L(JSON.stringify(out));
    closeSheet();
  }catch(e){ L("ERR "+String(e)) }
})()
