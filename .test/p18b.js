(function(){
  var v=window.__enote&&window.__enote.vue;
  var keys=v&&v.apps?Object.keys(v.apps):[];
  var app=v&&v.apps&&v.apps.notes;
  var comp=app&&app._instance?Object.keys(app._instance.appContext.components):[];
  var van=comp.filter(function(n){return n.indexOf("van-")===0});
  console.log("PROBE apps="+keys.join(",")+" 组件数="+comp.length+" van组件="+van.length+" 样例="+van.slice(0,5).join(",")+" bodyKids="+document.body.children.length+" main="+(document.getElementById("main")?"有":"无")+" notes="+(document.getElementById("notes")?"有":"无"));
})()
