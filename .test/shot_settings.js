(async function(){
  var sleep=function(ms){return new Promise(function(r){setTimeout(r,ms)})};
  settingsSheet();
  await sleep(1500);
  console.log("SHOT settings " + (document.querySelectorAll(".sw").length));
})()
