(async function(){
  var L=function(m){console.log("DLG "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var st=function(){
    var d=document.getElementById("dlg"), t=document.getElementById("dlgT"), b=document.getElementById("dlgB"),
        no=document.getElementById("dlgNo"), yes=document.getElementById("dlgYes");
    return "dlg="+(d?"on":"none")+" title="+(t?t.textContent:"-")+" body="+(b?b.textContent:"-")
      +" yes="+(yes?yes.textContent+"."+yes.className:"-")+" no="+(no?(no.offsetWidth>0?no.textContent:"hidden"):"-")
      +" tab="+__enote.state.tab;
  };
  try{
    L("base "+st());
    uiDialog("提示","只有确定按钮", ""); await W(400); L("alert "+st());
    document.getElementById("dlgYes").click(); await W(300); L("alert 确定后 "+st());
    uiDialog("确认","要回传结果的", "77"); await W(400); L("confirm "+st());
    L("uiBack 关对话框返回 "+uiBack()); await W(300); L("关掉后 "+st());
    settingsSheet(); await W(500);
    L("面板开着 uiBack 返回 "+uiBack()); await W(600); L("面板关掉后 "+st());
    __enote.state.tab = "mine"; await W(500);
    L("我的页 uiBack 返回 "+uiBack()); await W(500); L("回笔记页 "+st());
    L("笔记页 uiBack 返回 "+uiBack()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
