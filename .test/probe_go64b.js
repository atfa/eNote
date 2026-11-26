(async function(){
  var L=function(m){console.log("G64B "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var b=document.querySelector(".van-dialog__confirm")||document.querySelector(".van-dialog button");
  L("对话框在="+(document.querySelector(".van-dialog")?1:0)+" 按钮="+(b?b.textContent.trim():"没有"));
  if(b){ b.click(); L("已点确定") }
  L("done=1");
})()
