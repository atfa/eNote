(async function(){
  var L=function(m){console.log("P21FORM "+m)};
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  var q=function(s){return document.querySelector(s)};
  var type=function(id,v){var el=q(id);el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}))};
  try{
    var out={};
    __enote.vue.host.fabAct();
    await sleep(900);
    out.addOpen=!!q("#addText");
    out.addInitial=JSON.stringify(__enote.vue.host.FORMS.add);
    type("#addText","步骤 21 探针笔记");
    await sleep(120);
    out.addForm=__enote.vue.host.FORMS.add.text;
    out.addDom=q("#addText").value;
    __enote.vue.host.addNote();
    await sleep(1200);
    out.addToast=(q("#toast")?q("#toast").textContent:"");
    await sleep(2500);
    var hit=null;
    Array.prototype.forEach.call(document.querySelectorAll("#view .card .h .t"),function(x){ if(/步骤 21 探针笔记/.test(x.textContent)) hit=x.textContent });
    out.noteFound=hit?1:0;
    var nid=null;
    Array.prototype.forEach.call(document.querySelectorAll("#view .card"),function(x){ if(/步骤 21 探针笔记/.test(x.textContent)) nid=x.id });
    out.cardId=nid;
    addTodoSheet(nid?nid.replace(/^n/,""):"");
    await sleep(900);
    out.todoOpen=!!q("#tText");
    out.todoInitial=JSON.stringify(__enote.vue.host.FORMS.todo);
    type("#tText","步骤 21 探针待办");
    type("#tDate","2030-01-02");
    type("#tTime","03:04");
    var sel=q("#tPri"); sel.value="high"; sel.dispatchEvent(new Event("change",{bubbles:true}));
    await sleep(150);
    out.todoForm=JSON.stringify(__enote.vue.host.FORMS.todo);
    __enote.vue.host.addTodo(nid?nid.replace(/^n/,""):"");
    await sleep(1200);
    out.todoToast=(q("#toast")?q("#toast").textContent:"");
    await sleep(1500);
    var td=null;
    Array.prototype.forEach.call(document.querySelectorAll("#view .li .tx .ttx"),function(x){ if(/步骤 21 探针待办/.test(x.textContent)) td=x.textContent });
    out.todoFound=td?1:0;
    out.todoHtml=td?td.parentElement.outerHTML.slice(0,200):"";
    L(JSON.stringify(out));
  }catch(e){ L("ERR "+String(e)) }
})()
