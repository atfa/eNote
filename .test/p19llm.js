(async function(){
  var L=function(m){console.log("P19LLM "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  try{
    settingsSheet();
    await sleep(1500);
    var out={};
    var el=function(){return document.querySelector("#llmOut")};
    out.initial = el() ? el().outerHTML : "(none)";
    var p = __enote.vue.host.testLLM();
    await sleep(80);
    out.busy = el().outerHTML;
    await p;
    await sleep(120);
    out.done = el().outerHTML;
    out.count = document.querySelectorAll("#llmOut .body").length;
    L(JSON.stringify(out));
    closeSheet();
  }catch(e){ L("ERR "+String(e)) }
})()
