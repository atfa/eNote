// go/ui/js/bus.js —— SSE 事件总线（步骤 73：轮询 2s 降级为事件推送 + 30s 心跳）。
//
// 页面由 Go 进程内服务器提供（http://127.0.0.1:PORT/），所以 Go 侧能直接把
// 「数据变了」沿 /api/events 推过来：外部改数据（后台 OCR、剪贴板监听、
// 分享/截图导入）不用再等下一次轮询。事件是粗粒度四个（notes/clips/shots/
// settings），任何事件都只走 refresh(true)，重绘与否交给 pollflow 的 stateSig
// 指纹闸门 —— 事件丢了不慌，EventSource 自动重连，onopen 会全量刷新兜底。
//
// 本模块不自带 on/emit 注册表：全项目只有一个消费者（refresh），再抽象一层
// 是过度设计；真到有第二个消费者那天再拆都有数。
import { refresh } from './pollflow.js';

var ES = (typeof EventSource === 'function') ? new EventSource('/api/events') : null;
var RECV = 0, LAST = '', ONLINE = 0;

/* 突发合并：一次导入 N 条笔记会连发 N 个 notes 事件，逐个 refresh 是 N 次 /api/state。
   指纹闸门能保证「没变不重绘」，但请求本身还是 12KB/次，合并成 150ms 尾巴一拍
   最高兴：单事件最多晚 150ms（原轮询是 2000ms），导入风暴只发 1 次。 */
var PEND = {}, TMR = null;
function poke(){
  RECV++;
  if (TMR) return;
  TMR = setTimeout(function(){
    TMR = null;
    var any = false, k;
    for (k in PEND) { any = true; break }
    PEND = {};
    if (any && !document.hidden) refresh(true);
  }, 150);
}

if (ES) {
  ES.onopen = function(){ ONLINE = 1; refresh(true); };   /* 重连成功：全量刷新兜底 */
  ES.onmessage = function(e){ LAST = String(e.data); poke(LAST); };
  ES.onerror = function(){
    /* 网络断了会自动重试；断线期间的数据靠 onopen 兜底刷新，这里不折腾 */
  };
} else if (typeof console === 'object') {
  console.log('bus: EventSource 不可用，退回 2s 轮询');
}

/* 诊断缝：测试要断言「SSE 真的接上了」（data-change 走事件而非轮询），
   bus.online 是 EventSource 就绪位，bus.recv 是收到的事件数。 */
window.__enoteBus = { online: function(){ return ONLINE }, recv: function(){ return RECV },
                      last: function(){ return LAST }, es: ES };