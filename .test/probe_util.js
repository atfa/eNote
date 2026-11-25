(async function(){
  var L=function(m){console.log("UT "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    for(var z=0;z<80 && !(window.__enote && window.__enoteActions && document.querySelector("#view") && document.querySelectorAll("#view svg use").length);z++){ await W(250) }
    L("就绪：use="+document.querySelectorAll("#view svg use").length+" loads="+window.__enoteAppLoads);
    var uses=[].slice.call(document.querySelectorAll("#view svg use"));
    L("ic：#view 里的图标 use="+uses.length+" 第一个 href="+JSON.stringify(uses[0]?uses[0].getAttribute("href"):"none"));
    var tb=[].slice.call(document.querySelectorAll(".tabbar svg use"));
    L("ic：底栏 use="+tb.length+" hrefs="+tb.map(function(u){return u.getAttribute("href")}).join(","));
    __enoteActions.settingsSheet(); await W(900);
    var sh=document.querySelector("#sheet"), body=document.querySelector("#sheetBody");
    L("$：设置弹层 #sheet="+(sh?"yes":"no")+" #sheetBody 子节点="+(body?body.children.length:-1));
    __enoteActions.closeSheet(); await W(600);
    L("$：关掉后 #sheet="+(document.querySelector("#sheet")?"yes":"no"));
    var m=await import(location.origin+"/js/domutil.js");
    L("domutil 同一份模块（页面里 import 得到）keys="+Object.keys(m).sort().join(","));
    L("esc 语义="+JSON.stringify(m.esc("a<b>&\""))+"（DOM 文本里就是字面 &amp;，与迁移前逐字一致）");
    L("clip 语义="+JSON.stringify(m.clip("abcdefgh",4))+" ic 语义="+JSON.stringify(m.ic("x","y")));
    L("$ 语义="+JSON.stringify(m.$("#view").tagName+" "+m.$("#view").id));
    var SP=__enote.vue.host.SHOTPROG;
    SP.on=true; SP.total=3; SP.what=m.esc("AI 正在解析（3 条）<b>&\""); SP.secs=2;
    await W(400);
    var ovl=document.querySelector("#shotOvlRoot");
    L("esc 走进度层：#shotOvlRoot 文本="+JSON.stringify(ovl.textContent.replace(/\s+/g," ").trim().slice(0,70)));
    L("esc 走进度层：层里有没有被解析成元素（b 标签数）="+ovl.querySelectorAll("b").length);
    SP.on=false; SP.what=""; await W(300);
    L("收起来后 #shotOvlRoot 文本长度="+(ovl.textContent||"").trim().length);
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
