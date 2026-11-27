// go/ui/js/voiceflow.js — 「记一笔」面板里的语音暂存区（P18）。
//
// 交互心智（与方案一致）：「记一笔」面板一打开就摆着这块暂存区（不再要先点「录音」
// 才展开 —— 语音和文字、图片、文件一样都是原料，多一次点击只是多一道墙），底部大圆钮。
//   - 按住说话：按下开始本段，松手结束本段。
//   - 点按 = 免手持开关：点一下开始本段，再点一下结束本段（静音再长也不自动切段，
//     VAD 断句会把思考的停顿切断，所以断句权只在圆钮上）。
//     免手持时圆钮呈红色脉冲 + 计时秒数 + 「点击结束」文案。
// 每段识别完进暂存区（可编辑 / 单条删除 / 回放 = 从 /sttaudio 放原音频），
// 实时部分结果上屏在圆钮上方。点「发送」把全部段合并成一条笔记交给 Go（kind=voice），
// 原音频各自挂附件（之后可「重新识别语音」）。点「撤销」删除上一段。
//
// 本模块只碰 window 桥（window.Android.startVoice / stopVoice / askMic / micGranted，
// 以及 Java 推回来的 onSttPartial / onSttEnd / micResult）与本模块自己的状态。
// 语音模式是面板内的一层视图，不新增独立页面：状态经宿主（H.STT / H.voiceXxx）给
// views/sheets.js 的 AddSheetView 读，所以这里不 import 任何视图。
//
// 循环依赖契约（同 js/shotflow.js 文件头）：顶层不许读 app.js / pollflow.js 的导出，
// api / toast / refresh 全部只在函数体里用（模块求值期它们可能还没初始化）。
import { Vue } from './vue.js'
import { api, toast } from './netflow.js'
import { refresh } from './pollflow.js'

const { reactive } = Vue

/* 语音暂存区状态：segs = [{text, path, name}，…]。全部是面板内局部状态，不走 SSE
   （引擎的实时部分结果是 UI 局部，进不了 store）。 */
var STT = reactive({
  v: {
    segs: [],       // 已定稿的段（每段 = 一次圆钮起停）
    listening: false,
    handsFree: false,
    secs: 0,
    partial: '',
    error: '',
    busy: false     // 发送中
  }
});

/* 每段上限 2 分钟：到点自动结束本段（再长用户体验与引擎内存都不合适）。 */
var MAX_SECS = 120;
/* 短于这个毫秒数的按下算「点按」= 转免手持；长按松手才算一段。 */
var TAP_MS = 300;

var timer = 0;     // 计时器（不进 reactive：Interval id 不是渲染依赖）
var pressAt = 0;   // 本次按下的时刻，用来分辨点按 / 按住

/* 发完 / 打开面板时清掉上一次的实时行与错误（暂存段不清：用户在面板上改字时不该丢内容） */
function voiceReset(){ STT.v.partial = ''; STT.v.error = '' }

/* 权限引导：先请求，结果回调 window.micResult */
function voiceAskMic(){
  if (window.Android && Android.askMic) Android.askMic();
}

/* Java -> window.micResult（录音权限结果） */
window.micResult = function(ok){
  if (!ok) { STT.v.error = '需要录音权限才能说话'; return }
  STT.v.error = '';
  toast('权限已授予，点圆钮开始说话');
};

/* ---------------- 录音会话（Java 侧引擎） ---------------- */

function startTimer(){
  stopTimer();
  timer = setInterval(function(){
    STT.v.secs++;
    if (STT.v.secs >= MAX_SECS) { voiceStop() }   // 到点自动收段
  }, 1000);
}
function stopTimer(){
  if (timer) { clearInterval(timer); timer = 0 }
}

/* 开始一段（调用方只在确定能录时进这里） */
function voiceStart(){
  if (!window.Android || !Android.startVoice) { STT.v.error = '语音只在 app 内可用'; return false }
  if (!Android.micGranted()) { voiceAskMic(); return false }
  STT.v.error = '';
  STT.v.listening = true;
  STT.v.partial = '';
  STT.v.secs = 0;
  try { Android.startVoice() }
  catch (e) { STT.v.error = '启动录音失败'; STT.v.listening = false; return false }
  startTimer();
  return true;
}

/* 结束本段：真正的收尾在 Java 的 onSttEnd（它带回该段文本 + 原音频路径） */
function voiceStop(){
  detachUp();
  pressAt = 0;
  stopTimer();
  if (!STT.v.listening) return;
  STT.v.listening = false;
  STT.v.handsFree = false;
  if (window.Android && Android.stopVoice) {
    try { Android.stopVoice() } catch (e) { /* 已经停了 */ }
  }
}

/* 收起软键盘。圆钮的 pointerdown 带 .prevent（不让它抢走焦点），代价是输入框的焦点
   一直留着 —— 用户实测：正在编辑那段文字时直接按住说话，键盘会一直挂在屏幕上不消失。
   软键盘没有「自己收」的机会，只能显式 blur 当前焦点元素。 */
function blurEditing(){
  var a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function') a.blur();
}

/* 圆钮按下：正在录 = 结束本段；否则开始录（先按「按住」算，松手时再判点按） */
function voiceDown(){
  blurEditing();
  if (STT.v.listening) { voiceStop(); return }
  STT.v.handsFree = false;
  if (!voiceStart()) return;
  pressAt = Date.now();
  /* 手指滑出按钮 / 在面板外松手时 pointerup 不会回到按钮上，所以挂窗口一次性监听 */
  window.addEventListener('pointerup', voiceUp);
  window.addEventListener('pointercancel', voiceUp);
}
function detachUp(){
  window.removeEventListener('pointerup', voiceUp);
  window.removeEventListener('pointercancel', voiceUp);
}

/* 松手：短按 = 转免手持继续录（这就是「点一下开始」），长按 = 本段结束 */
function voiceUp(){
  detachUp();
  if (!STT.v.listening) { pressAt = 0; return }
  var held = pressAt ? Date.now() - pressAt : TAP_MS;
  pressAt = 0;
  if (held < TAP_MS) { STT.v.handsFree = true; return }
  voiceStop();
}

/* Java -> window.onSttPartial：实时部分结果上屏（不进暂存区） */
window.onSttPartial = function(text){
  STT.v.partial = String(text || '');
};

/* Java -> window.onSttEnd：本段定稿。text = 段内文本，error = 错误，path = 原音频文件
   （inbox 下的 voice_*.wav，发送时给 Go 挂成附件，保留「重新识别语音」的能力）。 */
window.onSttEnd = function(text, error, path){
  var txt = String(text || '').trim();
  if (txt) {
    STT.v.segs.push({ text: txt, path: path || '', name: path ? String(path).split('/').pop() : '' });
  } else if (error) {
    STT.v.error = String(error);
  }
  STT.v.listening = false;
  STT.v.handsFree = false;
  STT.v.partial = '';
  stopTimer();
};

/* ---------------- 暂存区操作 ---------------- */

function voiceDelSeg(i){ STT.v.segs.splice(i, 1) }
function voiceUndo(){ if (STT.v.segs.length) STT.v.segs.pop() }
function voiceEdit(i, v){ var s = STT.v.segs[i]; if (s) s.text = String(v) }

/* 回放本段：走 /sttaudio?p=（会话刚结束的音频还不在附件表里，只有路径）。
   端点只发 inbox 目录内的文件（go/shots.go handleSttAudio）。 */
function voicePlay(i){
  var s = STT.v.segs[i];
  if (!s || !s.path) { toast('该段没有音频记录'); return }
  var a = document.getElementById('stt-audio');
  if (!a) { toast('回放失败'); return }
  try {
    a.src = '/sttaudio?p=' + encodeURIComponent(s.path);
    var p = a.play();
    if (p && p.catch) p.catch(function(){ toast('回放失败') });
  } catch (e) { toast('回放失败') }
}

/* 发送：全部段合并成一条笔记（kind=voice），音频各自挂附件 */
async function voiceSend(){
  if (STT.v.listening) voiceStop();
  if (!STT.v.segs.length) { toast('还没有语音内容'); return }
  if (STT.v.busy) return;
  var audios = STT.v.segs.map(function(s){
    return { text: s.text || '', path: s.path || '', name: s.name || '' };
  });
  STT.v.busy = true;
  STT.v.error = '';
  try {
    var r = await api('/api/voice', { audios: audios });
    if (r && r.ok) {
      STT.v.segs = [];
      toast('已发送，AI 解析中…');
      setTimeout(refresh, 500); setTimeout(refresh, 3000); setTimeout(refresh, 9000);
      voiceReset();
    } else {
      STT.v.error = (r && r.error) || '发送失败';
    }
  } catch (e) {
    STT.v.error = '发送失败: ' + e;
  }
  STT.v.busy = false;
}

export { STT, voiceDown, voiceUp, voiceStop, voiceUndo,
  voiceEdit, voicePlay, voiceDelSeg, voiceSend }
