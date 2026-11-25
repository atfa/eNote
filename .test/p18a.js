(function(){
  var A=window.__enote&&window.__enote.vue&&window.__enote.vue.apps;
  var app=A&&A.notes;
  var c=app&&app._instance&&app._instance.appContext.components;
  console.log("PROBE vanPopup="+(c&&c["van-popup"]?"有":"无")+" vanToast="+(c&&c["van-toast"]?"有":"无")+" vanDialog="+(c&&c["van-dialog"]?"有":"无")+" vantVer="+(window.vant&&window.vant.version)+" rootKids="+(document.getElementById("notes")?document.getElementById("notes").children.length:-1)+" sheetKids="+(document.getElementById("sheetBody")?document.getElementById("sheetBody").children.length:-1));
})()
