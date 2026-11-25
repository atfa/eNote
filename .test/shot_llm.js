(async function(){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  settingsSheet();
  await sleep(1200);
  var el=document.querySelector("#sModel");
  if(el) el.scrollIntoView({block:"center"});
  __enote.vue.host.testLLM();
  await sleep(6000);
  var d=document.querySelector("#llmOut .body");
  if(d) d.scrollIntoView({block:"center"});
  console.log("SHOT llm " + (d ? d.textContent.slice(0,24) : "none"));
})()
