// go/ui/js/voiceflow.js — 「记一笔」面板里的语音暂存区（P18）。
//
// 交互心智（与方案一致）：「记一笔」面板一打开就摆着这块暂存区（不再要先点「录音」
// 才展开 —— 语音和文字、图片、文件一样都是原料，多一次点击只是多一道墙），底部大圆钮。
//   - 长按开始本段，松手结束本段，上滑松手取消。
//   - 点按留给面板的提交操作。
// 每段转写可单独删除或回放，实时部分结果显示在录音按钮上方。
// 「AI 整理」把所有语音转写合成一份可编辑草稿。「解析并记录」提交手输文字和语音文字，
// 每段原音频各自挂成附件。提交逻辑在 js/addflow.js 的 addNote()。
// 点「撤销」删除上一段。
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

const { reactive } = Vue

/* 语音暂存区状态：segs = [{text, path, name}，…]。全部是面板内局部状态，不走 SSE
   （引擎的实时部分结果是 UI 局部，进不了 store）。 */
var STT = reactive({
  v: {
    segs: [],       // 已定稿的段（每段 = 一次圆钮起停）
    listening: false,
    started: false,
    cancelArmed: false,
    levels: [],
    secs: 0,
    partial: '',
    error: '',
    busy: false,    // 发送中
    settling: false,
    organizing: false,
    organized: null,
    organizedStale: false
  }
});

/* 每段上限 2 分钟：到点自动结束本段（再长用户体验与引擎内存都不合适）。 */
var MAX_SECS = 120;
var HOLD_MS = 300;
var WAVE_BARS = 24;
/* 波形以常见的语音电平为满幅，留出轻声和底噪之间的高度差。 */
var WAVE_NOISE_FLOOR = 24;
var WAVE_SOFT_KNEE = 32;
var WAVE_FULL_SCALE = 1800;
var WAVE_LOG_RANGE = Math.log1p(WAVE_FULL_SCALE / WAVE_SOFT_KNEE);
var CANCEL_SWIPE_PX = 64;
var HOLD_SLOP_PX = 16;

var timer = 0;     // 计时器（不进 reactive：Interval id 不是渲染依赖）
var pressPointer = null;
var pressButton = null;
var pressX = 0;
var pressY = 0;
var holdTimer = 0;
const suppressedClicks = new WeakSet();

/* 「这段定稿」的等待者：Java 的 onSttEnd 是异步的（引擎最后一句要等 awaitFinal），
   而「保存并解析」必须等最后一段定稿再提交，否则刚说完的那段会被丢掉。上限 SETTLE_MS：
   引擎卡住时不能把提交永久挂住（到点就带着已有的段提交）。 */
var SETTLE_MS = 2500;
var settleDone = null, settleTimer = 0;
function settleNow(){
  if (!settleDone) return;
  var d = settleDone; settleDone = null;
  if (settleTimer) { clearTimeout(settleTimer); settleTimer = 0 }
  STT.v.settling = false;
  d();
}

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
  toast('权限已授予，按住圆钮开始说话');
};

/* ---------------- 录音会话（Java 侧引擎） ---------------- */

function startTimer(){
  stopTimer();
  timer = setInterval(function(){
    STT.v.secs++;
    if (STT.v.secs >= MAX_SECS) { finishVoice(STT.v.cancelArmed) }   // 到点自动收段
  }, 1000);
}
function stopTimer(){
  if (timer) { clearInterval(timer); timer = 0 }
}

/* 开始一段（调用方只在确定能录时进这里） */
function voiceStart(){
  if (STT.v.busy || STT.v.organizing || STT.v.settling) return false;
  if (!window.Android || !Android.startVoice) { STT.v.error = '语音只在 app 内可用'; return false }
  if (!Android.micGranted()) { voiceAskMic(); return false }
  STT.v.error = '';
  STT.v.listening = true;
  STT.v.started = false;
  STT.v.levels = Array(WAVE_BARS).fill(0);
  STT.v.partial = '';
  STT.v.secs = 0;
  try { Android.startVoice() }
  catch (e) { STT.v.error = '启动录音失败'; STT.v.listening = false; return false }
  return true;
}

/* 结束本段：真正的收尾在 Java 的 onSttEnd（它带回该段文本 + 原音频路径）。
   返回 promise = 「本段定稿」（没在录时立刻 resolve），提交方 await 它。 */
function voiceStop(){ return finishVoice(false) }

function finishVoice(discard){
  detachPress();
  stopTimer();
  if (!STT.v.listening) {
    if (!settleDone) return Promise.resolve();
    return new Promise(function(res){
      var previous = settleDone;
      settleDone = function(){ previous(); res() };
    });
  }
  STT.v.listening = false;
  STT.v.started = false;
  STT.v.settling = true;
  var p = new Promise(function(res){
    settleDone = res;
    settleTimer = setTimeout(settleNow, SETTLE_MS);
  });
  try {
    if (discard) Android.cancelVoice();
    else Android.stopVoice();
  } catch (e) { settleNow() }
  return p;
}

/* 收起软键盘。圆钮的 pointerdown 带 .prevent（不让它抢走焦点），代价是输入框的焦点
   一直留着 —— 用户实测：正在编辑那段文字时直接按住说话，键盘会一直挂在屏幕上不消失。
   软键盘没有「自己收」的机会，只能显式 blur 当前焦点元素。 */
function blurEditing(){
  var a = document.activeElement;
  if (a && a !== document.body && typeof a.blur === 'function') a.blur();
}

function voiceDown(event){
  voiceHold(event);
}

/* 首页和面板都在达到长按阈值后才启动录音。 */
function voiceHold(event, openSheet){
  if (!event.isPrimary || event.button !== 0 || pressPointer !== null ||
      STT.v.listening || STT.v.busy || STT.v.organizing || STT.v.settling) return;
  suppressedClicks.delete(event.currentTarget);
  trackPress(event);
  holdTimer = setTimeout(function(){
    holdTimer = 0;
    suppressedClicks.add(pressButton);
    try { pressButton.setPointerCapture(event.pointerId) } catch (_) { /* pointer already gone */ }
    blurEditing();
    if (openSheet && !openSheet()) { detachPress(); return }
    if (!voiceStart()) detachPress();
  }, HOLD_MS);
}

/* pointerup 之后浏览器可能还发 click。收段或取消时把这次 click 吃掉，
   避免用户刚松手就提交草稿；下一次独立按下仍能点按。键盘激活不受影响。 */
function voiceClick(event, action){
  if (event.detail !== 0 && suppressedClicks.delete(event.currentTarget)) return;
  if (STT.v.listening || STT.v.settling || STT.v.busy || STT.v.organizing) return;
  if (action) action();
  else toast('按住圆钮说话');
}

function trackPress(event){
  pressPointer = event.pointerId;
  pressButton = event.currentTarget;
  pressX = event.clientX;
  pressY = event.clientY;
  window.addEventListener('pointermove', voiceMove, true);
  window.addEventListener('pointerup', voiceUp, true);
  window.addEventListener('pointercancel', voiceCancel, true);
  window.addEventListener('blur', interruptPress);
}
function detachPress(){
  clearTimeout(holdTimer);
  holdTimer = 0;
  window.removeEventListener('pointermove', voiceMove, true);
  window.removeEventListener('pointerup', voiceUp, true);
  window.removeEventListener('pointercancel', voiceCancel, true);
  window.removeEventListener('blur', interruptPress);
  pressPointer = null;
  pressButton = null;
  STT.v.cancelArmed = false;
}
function voiceMove(event){
  if (event.pointerId !== pressPointer) return;
  if (holdTimer) {
    if (Math.hypot(pressX - event.clientX, pressY - event.clientY) >= HOLD_SLOP_PX) {
      suppressedClicks.add(pressButton);
      detachPress();
    }
    return;
  }
  STT.v.cancelArmed = pressY - event.clientY >= CANCEL_SWIPE_PX;
}
function voiceCancel(event){
  if (event.pointerId === pressPointer) interruptPress();
}
function interruptPress(){
  suppressedClicks.add(pressButton);
  if (holdTimer) detachPress();
  else finishVoice(true);
}

/* 上滑到阈值后松手取消，滑回可继续录。 */
function voiceUp(event){
  if (event.pointerId !== pressPointer) return;
  if (holdTimer) { detachPress(); return }
  voiceMove(event);
  finishVoice(STT.v.cancelArmed);
}

/* Android 确认麦克风已启动后才显示录音状态，音量取自实际录到的 PCM。 */
window.onSttStarted = function(){
  if (!STT.v.listening || STT.v.started) return;
  STT.v.started = true;
  startTimer();
};
window.onSttLevel = function(peak){
  if (!STT.v.started) return;
  var signal = Math.max(0, peak - WAVE_NOISE_FLOOR);
  var level = Math.min(1, Math.log1p(signal / WAVE_SOFT_KNEE) / WAVE_LOG_RANGE);
  STT.v.levels = STT.v.levels.slice(1).concat(level);
};

/* Java -> window.onSttPartial：实时部分结果上屏（不进暂存区） */
window.onSttPartial = function(text){
  if (!STT.v.listening) return;
  STT.v.partial = String(text || '');
};

/* Java -> window.onSttEnd：本段定稿。text = 段内文本，error = 错误，path = 原音频文件
   （inbox 下的 voice_*.wav，发送时给 Go 挂成附件，保留「重新识别语音」的能力）。 */
window.onSttEnd = function(text, error, path){
  detachPress();
  var txt = String(text || '').trim();
  if (txt) {
    STT.v.segs.push({ text: txt, path: path || '', name: path ? String(path).split('/').pop() : '' });
    voiceChanged();
  } else if (error) {
    STT.v.error = String(error);
  }
  STT.v.listening = false;
  STT.v.started = false;
  STT.v.partial = '';
  stopTimer();
  settleNow();          // 让等待录音定稿的提交继续
};

/* Java -> window.onSttRefined：第二遍离线重识别的结果（通常比 onSttEnd 晚几秒）。
   只按音频路径替换同一段；已经整理过的草稿标成过期，提示重新整理。 */
window.onSttRefined = function(path, text){
  var t = String(text || '').trim();
  if (!t) return;
  for (var i = 0; i < STT.v.segs.length; i++) {
    var s = STT.v.segs[i];
    if (s.path === path && s.text !== t) {
      s.text = t;
      voiceChanged();
      return;
    }
  }
};

/* ---------------- 暂存区操作 ---------------- */

var voiceRevision = 0;
function voiceChanged(){
  voiceRevision++;
  if (STT.v.organized !== null) STT.v.organizedStale = true;
}
function voiceDelSeg(i){
  if (STT.v.organizing || STT.v.busy || !STT.v.segs[i]) return;
  STT.v.segs.splice(i, 1);
  voiceChanged();
}
function voiceUndo(){
  if (!STT.v.segs.length || STT.v.organizing || STT.v.busy) return;
  STT.v.segs.pop();
  voiceChanged();
}
function voiceOrganizedEdit(v){ STT.v.organized = String(v) }
function voiceUseOriginal(){
  STT.v.organized = null;
  STT.v.organizedStale = false;
}
async function voiceOrganize(){
  if (STT.v.organizing || STT.v.busy || STT.v.listening || STT.v.settling) return;
  var text = STT.v.segs.map(function(s){ return s.text }).join('\n\n').trim();
  if (!text) { toast('请先录一段语音'); return }
  var revision = voiceRevision;
  STT.v.organizing = true;
  STT.v.error = '';
  try {
    var r = await api('/api/voice/organize', { text: text });
    if (revision !== voiceRevision) return;
    if (!r || !r.ok || !String(r.text || '').trim()) {
      STT.v.error = (r && r.error) || '整理失败，请重试';
      return;
    }
    STT.v.organized = String(r.text);
    STT.v.organizedStale = false;
  } catch (e) {
    if (revision === voiceRevision) STT.v.error = '整理失败，请检查网络后重试';
  } finally {
    STT.v.organizing = false;
  }
}

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

/* 提交成功后清空暂存区（提交本身在 js/addflow.js 的 addNote()：文字和语音段一个按钮） */
function voiceClear(){
  STT.v.segs = [];
  voiceRevision++;
  voiceUseOriginal();
  voiceReset();
}

export { STT, voiceDown, voiceHold, voiceClick, voiceStop, voiceUndo,
  voicePlay, voiceDelSeg, voiceClear, voiceOrganize,
  voiceOrganizedEdit, voiceUseOriginal }
