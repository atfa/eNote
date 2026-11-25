(async function(){
  var L=function(m){console.log("SR "+m)};
  var W=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var st=function(){
    var q=document.getElementById("q"), sb=document.getElementById("searchBox");
    var SR=__enote.state.SR;
    return "q="+(q?JSON.stringify(q.value):"noinput")+" box="+(sb?sb.className:"none")
      +" SR.notes="+(SR.notes?SR.notes.length:"null")+" total="+SR.total
      +" cards="+document.querySelectorAll("#view .card").length
      +" srErr="+JSON.stringify(__enote.vue.app ? "" : "");
  };
  try{
    L("base "+st());
    var q=document.getElementById("q");
    q.value="步骤四十一"; q.dispatchEvent(new Event("input",{bubbles:true}));
    await W(1400); L("输入后 "+st());
    document.getElementById("qClear").click(); await W(1400); L("清除后 "+st());
    q=document.getElementById("q");
    q.value="zzz不可能有的词"; q.dispatchEvent(new Event("input",{bubbles:true}));
    await W(1400); L("空结果 "+st()+" empty="+(document.querySelector("#view .empty")?"yes":"no"));
    document.getElementById("qClear").click(); await W(1400);
    var of=window.fetch;
    window.fetch=function(){return Promise.reject(new Error("探针制造的失败"))};
    var q2=document.getElementById("q");
    q2.value="失败探针"; q2.dispatchEvent(new Event("input",{bubbles:true}));
    await W(1400);
    var eb=document.querySelector("#view .errbox");
    L("搜索失败 errbox="+(eb?JSON.stringify(eb.textContent.slice(0,40)):"none")
      +" cards="+document.querySelectorAll("#view .card").length);
    window.fetch=of;
    document.getElementById("qClear").click(); await W(1400);
    L("恢复后 "+st()+" errbox="+(document.querySelector("#view .errbox")?"yes":"no"));
    L("end "+st()+" loads="+window.__enoteAppLoads);
  }catch(e){ L("ERR="+e.name+": "+String(e.message).slice(0,140)) }
})()
