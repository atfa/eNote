(async function(){
  var L=function(m){console.log("RL "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var mk=function(ms){return new Date(Date.now()-ms).toISOString()};
  var of=window.fetch;
  window.fetch=function(u,o){
    if(String(u).indexOf("/api/clip/list")>=0){
      return Promise.resolve(new Response(JSON.stringify({clips:[
        {id:"rl1",text:"相对时间探针一",app:"微信",createdAt:mk(30*1000)},
        {id:"rl2",text:"相对时间探针二",app:"浏览器",createdAt:mk(15*60*1000)},
        {id:"rl3",text:"相对时间探针三",app:"某笔记",createdAt:mk(5*3600*1000)},
        {id:"rl4",text:"相对时间探针四",app:"某阅读器",createdAt:mk(3*864e5)}]}),
        {status:200,headers:{"content-type":"application/json"}}));
    }
    return of(u,o);
  };
  try{
    __enoteActions.clipSheet(); await W(1500);
    var metas=[].slice.call(document.querySelectorAll("#sheet .climeta")).map(function(e){return e.textContent.replace(/\s+/g," ")});
    L("relTime 计数条="+JSON.stringify(metas));
    L("条数="+document.querySelectorAll("#sheet .cliprow").length+" 计数条="+JSON.stringify((document.querySelector("#sheet .cliptop")||{}).textContent));
    __enoteActions.closeSheet(); await W(500); window.fetch=of;
    L("end loads="+window.__enoteAppLoads);
  }catch(e){ window.fetch=of; L("ERR="+e.name+": "+String(e.message).slice(0,160)) }
})()
