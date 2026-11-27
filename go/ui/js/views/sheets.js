/* 六个「字符串弹层」翻成真组件（S3 步骤 16c）：排序筛选、错过的提醒、记一笔、添加待办、
   运行日志、AI 调用记录。它们是 app.js 里最后一批 HTML 字符串，也是最后 21 处内联
   `onclick` 的所在地 —— 字符串里的 handler 绕过闸门①b（Vue 模板 handler）与闸门⑮
   （模板里的 H.xxx ⊆ setHost），正是 P12「点了没反应」那一类；模板里看得见结构，闸门
   才看得见结构。

   形态与迁移前逐字一致：
   - 页面形态（page）：`.panel.page` = `.phead` + `.pbody#sheetBody`，组件挂在 `.pbody` 里，
     模板是多根片段（与 views/shots.js 一样）。
   - 卡片形态：`.panel` = `.grip` + `.pclose` + `#sheetBody`，组件挂在 `#sheetBody` 里。
     与迁移前唯一的结构差别是多出 `#sheetBody` 这一层包装（迁移前内容直接是 `.panel` 的
     子节点）；CSS 里唯一受影响的选择器 `.sheet .panel>h2` 已补上 `#sheetBody>h2`。

   前面几步踩过、写在这里省得再踩的坑：
   1) 读模块状态一律 computed()（见 js/vue.js）：MISSED / LOGDATA 是 {v:} 容器，整包赋值
      就让读它们的 computed 失效 → 数据换了视图跟着动。
   2) 模板里用原始值 + {{ }}，不要再 esc（Vue 插值是 textContent，再 esc 会双重转义）。
   3) 元素之间的纯空白节点会被 Vue 的 whitespace:'condense' 删掉；元素与文本之间的那个
      空格会保留成一个空格。原来字符串里 `ic('camera')+'选图片…'` 直接写 `/>选图片…`。
   4) 模板里用 H.xxx 的组件必须把 H 返回出去（闸门⑮ 强制），漏了是「点了没反应」。
   5) 组件不接 tick prop（步骤 17l 删掉了这条管道）：以前「声明了必须收、没声明禁止收」
      的双向规则（收了会透传成 DOM 属性，与迁移前的 DOM 漂移）整类消失。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { EmptyState, Ico, CdChip } */
import { Vue } from '../vue.js'
import { EmptyState } from '../components.js'
import { Ico, CdChip } from '../components/leaf.js'

const { computed, inject } = Vue

/* 排序与筛选：三到四组分段按钮，组由当前 tab 决定。按钮是「图标 + 文字」，图标走 <ico>、
   文字走 {{ }}（步骤 16c 时这两样是一整串 HTML 走 v-html，16d 翻成真模板）。
   没有图标的筛选项渲染出一个 v-if 的注释节点（<!---->），它不是元素：textContent、
   布局与点击都一致，DOM 等价性比对里按注释节点归一化掉。 */
export const SortSheetView = {
  name: 'SortSheetView',
  components: { Ico },
  setup(){
    const H = inject('H');
    return {
      H,
      groups: computed(function(){
        var p = H.P(), tab = H.tab;
        // 选项是 [值, 图标名, 文案]：图标是 <ico>，文案是 {{ }}（步骤 16d 之前是
        // ic('clock')+'按到期' 一整串 HTML 走 v-html）。筛选组没有图标 → 空串。
        var sorts = tab === 'todos'
          ? [['due', 'clock', '按到期'], ['pri', 'bolt', '重要优先'], ['new', 'sort', '最新']]
          : tab === 'files'
            ? [['new', 'sort', '最新'], ['size', 'db', '大小'], ['name', 'file', '名称'], ['kind', 'folder', '类型']]
            : [['new', 'sort', '最新在前'], ['old', 'sort', '最早在前'], ['title', 'file-text', '标题']];
        var gs = [{ key: 'sort', label: '排序', opts: sorts, cur: p.sort }];
        if(tab === 'notes'){
          gs.push({ key: 'src', label: '来源', opts: [['all','','全部'],['text','','文字'],['image','','图片']], cur: p.src });
          gs.push({ key: 'status', label: '状态', opts: [['all','','全部'],['done','','已解析'],['raw','','仅原文'],['error','','失败']], cur: p.status });
          gs.push({ key: 'file', label: '附件', opts: [['all','','全部'],['yes','','有附件'],['no','','无附件']], cur: p.file });
        }else if(tab === 'todos'){
          gs.push({ key: 'done', label: '状态', opts: [['open','','未完成'],['done','','已完成'],['all','','全部']], cur: p.done });
          gs.push({ key: 'pri', label: '优先级', opts: [['all','','全部'],['high','','重要'],['normal','','普通'],['low','','低']], cur: p.pri });
        }else if(tab === 'files'){
          // the server knows more kinds (slides/audio/video/archive); the common ones keep the row readable
          gs.push({ key: 'kind', label: '类型', opts: [['all','','全部'],['image','','图片'],['pdf','','PDF'],['doc','','文档'],
            ['sheet','','表格'],['text','','文本'],['file','','其他']], cur: p.kind });
        }
        return gs;
      })
    }
  },
  template: `
<h2>排序与筛选</h2>
<div style="height:6px"></div>
<template v-for="g in groups" :key="g.key">
<label>{{ g.label }}</label>
<div class="seg"><button v-for="o in g.opts" :key="o[0]" :class="o[0]===g.cur?'on':''" @click="H.setPref(g.key,o[0])"><ico v-if="o[1]" :n="o[1]"/>{{ o[2] }}</button></div>
</template>
<div class="acts"><button class="btn" @click="H.resetPrefs()">重置</button><button class="btn pri" @click="H.closeSheet()">完成</button></div>
`
};

/* 错过的提醒：整行 = 看笔记上下文，勾 ✓ = 直接完成（划线动画跑完这条才从清单里摘掉），
   「这批我知道了」= 待办不动、只承认看过了。行结构复用待办页的 .todo/.cb/.ttx，
   划线淡出动画和样式就都是那一套（类名冻结，D15）。
   ✓ 的动画是 toggle() 直接往行元素上加类（justdone / leaving），Vue 在这 900ms 里不重绘
   （animLock 挡着轮询），所以与迁移前一致；动画跑完 missedDone 会重开这个弹层。 */
export const MissedSheetView = {
  name: 'MissedSheetView',
  components: { EmptyState, Ico, CdChip },
  setup(){
    const H = inject('H');
    return {
      H,
      items: computed(() => {
        var m = H.MISSED || H.S.missed;
        return (m && m.items) || [];
      })
    }
  },
  template: `
<empty-state v-if="!items.length" icon="check-circle" title="这批处理完了" sub="到点的待办会照常提醒"/>
<div class="list card" v-else>
  <div class="todo msrow" v-for="t in items" :key="t.id" @click="H.closeSheet();H.jump(t.nid)"><div class="cb" @click="H.missedDone($event,t.nid,t.id,$event.currentTarget)"><ico n="check"/></div><div class="tx"><span class="ttx">{{ t.text }}<small><span class="due over"><ico n="calendar"/>{{ H.fmtTime(t.due) }}</span><cd-chip :t="t"/><a href="#" @click.prevent="H.jump(t.nid)">{{ t.ntitle || '查看笔记' }}</a></small></span></div></div>
</div>
<div class="pfoot"><div class="count">点整行看笔记上下文<br>勾 ✓ 直接完成</div><button class="btn" @click="H.missedGoTodos()">去待办页</button><button class="btn pri" @click="H.missedDismiss()"><ico n="check"/>这批我知道了</button></div>
`
};

/* 记一笔：文本框 + 保存 / 选图 / 录音 / 选本地文件。输入框不写 :value（迁移前的字符串
   里就没有 value 属性，写了会让 innerHTML 序列化多一个属性；见 views/folders.js 第 3 条）。

   四个按钮是「一篇笔记的四种原料」（P18）：文字 / 图片（本机 OCR）/ 语音（本机 ASR）/
   本地文件。语音不再有自己的页面，它是这个弹层里的一层：点 🎤 展开暂存区，多段识别
   全进 STT.v.segs（可编辑 / 删 / 回放 / 撤销），点发送一次性合并成一条 kind=voice 的笔记，
   每段原音频各自挂附件。圆钮的心智见 js/voiceflow.js 文件头。 */
export const AddSheetView = {
  name: 'AddSheetView',
  components: { Ico },
  setup(){
    const H = inject('H');
    /* 面板被关掉（返回键 / 点遮罩 / 切页）时把还在录的那一段收掉：AudioRecord 留在
       后台会被系统杀掉，而且用户看不到还在录。 */
    if (Vue.onBeforeUnmount) {
      Vue.onBeforeUnmount(function(){ if (H.STT && H.STT.listening) H.voiceStop() });
    }
    return { H,
      f: computed(() => (H.FORMS && H.FORMS.add) || { text: '' }),
      /* STT 是 {v:} 容器（js/voiceflow.js），宿主给的是盒子里的 v；没装配上时给一份
         同形状的空值，面板渲染成空的而不是抛错（闸门⑮ 负责把漏装配报红）。 */
      st: computed(() => H.STT || { segs: [], listening: false, handsFree: false,
        secs: 0, partial: '', error: '' }),
      segs: computed(() => (H.STT && H.STT.segs) || [])
    }
  },
  /* P18：面板里从上到下三样东西 —— 文字、三个原料按钮、语音暂存区。语音不再藏在
     「录音（离线）」按钮后面（先点一下才能用只是多一道墙），它和图片、文件一样是
     随手可用的原料。按钮行按需求排序：选图片 / 选文件 / 保存并解析（主操作在最后）。 */
  template: `
<h2>记一笔</h2><label>文字</label><textarea id="addText" :value="f.text" @input="H.formSet('add','text',$event.target.value)" placeholder="随手记，或粘贴一段内容。含时间/任务的句子会被自动提取成待办"></textarea><div class="acts"><button class="btn" @click="H.pickImage()"><ico n="camera"/>选图片</button><button class="btn" @click="H.pickFile()"><ico n="clipfile"/>选文件</button><button class="btn pri" @click="H.addNote()">保存并解析</button></div>
<div class="vpane"><div class="vhead"><span>语音暂存</span><small>{{ segs.length }} 段 · 说完一段再录下一段</small></div><div class="vseg" v-for="(s,i) in segs" :key="i"><textarea class="vtx" :value="s.text" @input="H.voiceEdit(i,$event.target.value)"></textarea><button class="vmini" @click="H.voicePlay(i)"><ico n="play"/></button><button class="vmini" @click="H.voiceDelSeg(i)"><ico n="trash"/></button></div><div class="vpart" v-if="st.partial">{{ st.partial }}</div><div class="verr" v-if="st.error">{{ st.error }}</div><div class="vbar"><button class="vside" :disabled="!segs.length" @click="H.voiceUndo()"><ico n="refresh"/>撤销</button><button class="vrec" :class="{live: st.listening}" @pointerdown.prevent="H.voiceDown()" @pointerup="H.voiceUp()" @pointercancel="H.voiceStop()"><ico :n="st.listening ? 'stop' : 'mic'"/></button><button class="vside pri" :disabled="!segs.length" @click="H.voiceSend()"><ico n="send"/>发送</button></div><div class="vhint">{{ st.listening ? (st.handsFree ? '免手持录音中 ' + st.secs + 's · 点一下圆钮结束本段' : '松手结束本段') : '按住说话；点一下圆钮 = 免手持（静音不自动断句）' }}</div></div>
<audio id="stt-audio" preload="none"></audio>
`
};

/* 添加待办：nid 是「给哪条笔记加」，由 app.js 的 addTodoSheet(nid) 存进 SHEETARG，
   组件挂载时读一次（弹层每次打开都是新实例，不需要响应式）。 */
export const AddTodoSheetView = {
  name: 'AddTodoSheetView',
  setup(){
    const H = inject('H');
    return {
      H,
      nid: H.sheetArg,
      f: computed(() => (H.FORMS && H.FORMS.todo) || { text:'', date:'', time:'', pri:'normal' })
    }
  },
  template: `
<h2>添加待办</h2><label>事项</label><input id="tText" :value="f.text" @input="H.formSet('todo','text',$event.target.value)" placeholder="要做什么"><div class="grid2"><div><label>日期</label><input type="date" id="tDate" :value="f.date" @input="H.formSet('todo','date',$event.target.value)"></div><div><label>时间</label><input type="time" id="tTime" :value="f.time" @input="H.formSet('todo','time',$event.target.value)"></div></div><label>优先级</label><select id="tPri" :value="f.pri" @change="H.formSet('todo','pri',$event.target.value)"><option value="normal">普通</option><option value="high">重要</option><option value="low">低</option></select><div class="acts"><button class="btn pri" @click="H.addTodo(nid)">添加</button></div>
`
};

/* 运行日志：数据由 app.js 的 showLog() 取好再打开弹层（迁移前是「取完才弹」，
   组件里自己 fetch 会变成「先弹出一个空的再填」，那是行为改动，不是重构）。 */
export const LogSheetView = {
  name: 'LogSheetView',
  setup(){
    const H = inject('H');
    return {
      H,
      r: computed(() => H.logData || {})
    }
  },
  template: `
<h2>运行日志</h2><div class="meta"><span class="chip">OCR {{ r.ocrReady ? 'ready' : '…' }}</span><span class="chip">语音 {{ r.sttReady ? 'ready' : '…' }}</span><span class="chip">{{ r.server || '' }}</span></div><pre>{{ r.log }}</pre>
`
};

/* AI 调用记录：同上，数据由 showDebug() 取好。calls 的截断（前 10 条）与 clip 的 200
   字截断都留在原处，模板只负责画。 */
export const DebugSheetView = {
  name: 'DebugSheetView',
  setup(){
    const H = inject('H');
    return {
      H,
      calls: computed(() => (H.debugData && H.debugData.calls) ? H.debugData.calls.slice(0, 10) : [])
    }
  },
  template: `
<h2>AI 调用记录</h2>
<div class="empty" v-if="!calls.length">还没有调用记录</div>
<div class="card" v-for="(c,i) in calls" :key="i"><div class="meta"><span class="chip">{{ c.model }}</span><span class="chip">{{ c.ms }}ms</span><span class="chip">HTTP {{ c.httpCode }}</span></div><div class="body" style="font-size:var(--fs-sm)">输入：{{ H.clipText(c.user,200) }}</div><pre>{{ c.err ? ('错误：' + c.err) : c.raw }}</pre></div>
`
};
