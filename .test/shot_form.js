(async function(){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var type=function(id,v){var el=q(id);el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))};
  __enote.vue.host.tabPick("notes");
  await sleep(900);
  __enote.vue.host.fabAct();
  await sleep(900);
  type("#addText","步骤 21 表单搬进状态：记一笔的 textarea 现在绑 FORMS.add.text");
  await sleep(600);
  console.log("SHOT add " + q("#addText").value);
})()
