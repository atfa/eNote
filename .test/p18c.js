(function(){
  var r={};
  try{
    r.vantType=typeof window.vant;
    r.installType=typeof (window.vant&&window.vant.install);
    var app=window.Vue.createApp({render:function(){return null}});
    app.use(window.vant);
    r.afterUse=Object.keys(app._instance.appContext.components).length;
  }catch(e){ r.err=String(e&&e.message).slice(0,120) }
  console.log("PROBE2 vant="+r.vantType+" install="+r.installType+" 注册数="+(r.afterUse)+" err="+r.err);
})()
