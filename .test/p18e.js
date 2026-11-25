(function(){
  var out=[];
  try{
    var d=document.createElement("div"); d.id="vanprobe"; document.body.appendChild(d);
    var app=window.Vue.createApp({template:"<van-button id=\"vb\" type=\"primary\">点我</van-button>"});
    app.use(window.vant);
    app.mount(d);
    var b=document.getElementById("vb");
    out.push("渲染="+(b?b.outerHTML.slice(0,140):"空"));
    d.remove();
  }catch(e){ out.push("err="+String(e&&e.message).slice(0,140)) }
  console.log("PROBE4 "+out.join(" | "));
})()
