/* 设置页（S3 步骤 10；步骤 16b 把叶子片段翻成真组件）。它是**弹层**
   （pageSheetVue('settings','设置')），不是 tab。结构在模板里；数据卡 / 运行状态卡 /
   本地 OCR 卡是 components/blocks.js 里的真组件，kv 行与 OCR 胶囊是 components/leaf.js 的
   <kv-row> / <ocr-ready>；采集卡与用法卡是纯静态文本，直接写在模板里（v-html 已清零）。

   前面几步踩过、写在这里省得再踩的坑：
   1) 读模块状态一律 computed()：S 是 reactive 的、ST 是 {v:} 容器，refresh() 整包赋值
      就让读它们的 computed 失效 → 从系统设置页回来后开关状态是新的。
   2) 模板里用原始值 + {{ }}，不要再 esc（Vue 插值是 textContent）。
   3) 一个元素里只放一个 {{ }}（两个插值 = 两个文本节点，VDIFF 序列化器 trim 后拼会丢空格）；
      需要「3 / 2」那种三段拼接时写 {{ a }} / {{ b }}，中间那个「 / 」不是纯空白，不会被吃掉。
   4) 模板里用 H.xxx 的组件必须在 setup() 返回里暴露 H（闸门⑮ 强制）。
   5) class 用拼接，不用「静态 class + 对象语法」：遗留写的是 'btn sm '（带尾空格）这类
      拼接结果，Vue 合并 class 的顺序不同，VDIFF 比的是 class 属性字符串。

   两个设置页特有的坑：
   a) 输入框的 value 用 :value.attr（Vue 3.4+ 的 .attr 修饰符）。直接写 :value 走的是
      DOM property，innerHTML 序列化出来**没有** value 属性，遗留字符串有 → VDIFF 红；
      写 :value.attr 才与遗留的字符串属性一致（步骤 8 的 folderQ 是反例：那里连属性都不该有）。
      值一律 `x || ''`：遗留 esc(undefined) 得到 value=""，Vue 的 .attr 遇到 null/undefined
      会 removeAttribute，两边就差一个属性。
   b) 开关（步骤 18e 起是 Vant 的 van-switch）不再把元素递给 handler：旧版 onclick=
      "toggleAI(this)" 靠 el.classList.toggle 改像素，状态与类名是两条线；现在类名是
      状态的纯函数（keepSwCls / aiSwCls 拼 'sw' + ' on'），:model-value 与 @update:model-value
      接同一个状态源，app.js 里那两处 DOM 写操作随之删掉。

   闸门⑮ 每个文件只取第一处 components 注册表当整份文件的名单，所以全量名单写在下面这行：
   components: { Ico, KvRow, SettingsDataCard, SettingsRunCard, SettingsOcrCard, SettingsSttCard } */
import { V, Vue } from '../vue.js'
import { Ico, KvRow } from '../components/leaf.js'
import { SettingsDataCard, SettingsRunCard, SettingsOcrCard, SettingsSttCard }
  from '../components/blocks.js'

const { computed, inject } = Vue

export const SettingsSheetView = {
  name: 'SettingsSheetView',
  components: { Ico, KvRow, SettingsDataCard, SettingsRunCard, SettingsOcrCard, SettingsSttCard },
  setup(){
    const H = inject('H');
    /* 通知权限 / 常驻后台 / 电池优化这三样是 Android 桥的「拉」式接口，本身不可观察。
       V.tick 现在是「原生状态可能变了」的纪元号：onAppResume / notifyResult 里的
       settingsRefresh() bump 一次，下面这几个 computed 显式读它才会重算。
       （步骤 17h 之前：所有 computed 靠 live() 隐式绑 tick，每次 render 全量重绘。） */
    const nat = computed(() => V.tick.v);
    return {
      H,
      s: computed(() => ({ ...H.S.settings })),
      /* 步骤 20：六个输入框绑的是 SFORM（app.js 的表单盒子），不再是 s。
         单向 :value.attr + @input 回写，不用 v-model —— 我们要的是 DOM 上真的那个
         value 属性（test.sh 断言 #sUrl 有 value 属性），v-model 写的是 property。 */
      f: computed(() => H.SFORM || { baseUrl:'', apiKey:'', model:'', timeoutS:90, maxTokens:2048, temperature:0.2 }),
      i: computed(() => ({ ...H.S.info })),
      // 提醒卡：副标题的插值切分必须与遗留拼接一一对应（三个文本节点）
      notifyGranted: computed(() => { nat.value; return H.notifyGranted() }),
      notifyBtnCls: computed(() => { nat.value; return 'btn sm ' + (H.notifyGranted() ? 'gh' : '') }),
      notifyBtnText: computed(() => { nat.value; return H.notifyGranted() ? '已开启' : '开启通知' }),
      // 后台卡
      keepAlive: computed(() => { nat.value; return H.keepAliveOn() }),
      batteryIgn: computed(() => { nat.value; return H.batteryIgnoring() }),
      keepSub: computed(() => { nat.value; return H.keepAliveOn()
        ? (H.batteryIgnoring() ? '已开启 · 已豁免电池优化' : '已开启 · 建议再豁免电池优化')
        : '关闭 · 只在打开 app 时可靠，后台可能收不到提醒' }),
      keepSwCls: computed(() => { nat.value; return 'sw' + (H.keepAliveOn() ? ' on' : '') }),
      /* 「测试连接」的结果（步骤 19 起是响应式盒子，app.js 的 testLLM() 只写状态）。
         两态的 DOM 与旧 innerHTML 逐字相同：连接中 = <span class="spin"> + 文本，
         结果 = 一行结论 + <br> + 回复/错误原文。转义交给插值（textContent），不再 esc()。 */
      llmBusy: computed(() => !!(H.llmTest && H.llmTest.busy)),
      llmLine: computed(() => { var t = H.llmTest; if(!t || t.busy) return '';
        return t.ok ? '✅ 成功（' + t.ms + 'ms，HTTP ' + t.httpCode + '）'
                    : '❌ 失败（' + (t.ms || 0) + 'ms）' }),
      llmBody: computed(() => { var t = H.llmTest; if(!t || t.busy) return '';
        return t.ok ? t.reply : (t.error || '') }),
      themes: computed(function(){
        var cur = H.S.settings.theme || 'light';
        var label = { light: '亮色', dark: '暗色', auto: '跟随系统' };
        return ['light', 'dark', 'auto'].map(function(m){
          return {
            m: m, cls: m === cur ? 'on' : '', label: label[m],
            icon: m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'monitor'
          };
        });
      }),
      aiSwCls: computed(() => 'sw' + (H.S.settings.useAI ? ' on' : ''))
    }
  },
  template: `
<div class="pgroup">提醒</div>
<div class="card">
  <div class="row between" style="margin-top:var(--s0)"><div><b>到期待办提醒</b><div style="font-size:var(--fs-xs);color:var(--dim)" v-if="notifyGranted">已排定 {{ H.remindPending }} 条 · 按系统闹钟登记，尽量不被后台清理</div><div style="font-size:var(--fs-xs);color:var(--dim)" v-else>需要通知权限 · 开启后到点用系统通知提醒</div></div>
  <button :class="notifyBtnCls" @click="H.askNotify()">{{ notifyBtnText }}</button></div>
  <div class="row between" style="margin-top:var(--s2)" v-if="!H.exactGranted()"><div><b>精确提醒</b><div style="font-size:var(--fs-xs);color:var(--dim)">允许「闹钟和提醒」后不再被系统延迟</div></div>
  <button class="btn sm" @click="H.askExact()">去开启</button></div>
</div>
<div class="pgroup">后台</div>
<div class="card">
  <div class="row between" style="margin-top:var(--s0)"><div><b>常驻后台</b><div style="font-size:var(--fs-xs);color:var(--dim)">{{ keepSub }}</div></div>
  <van-switch :class="keepSwCls" :model-value="keepAlive" @update:model-value="H.toggleKeepAlive"/></div>
  <template v-if="keepAlive">
    <div class="kv" style="margin-top:var(--s2)" v-if="batteryIgn"><span>电池优化</span><span style="color:var(--ok)">已豁免，不会被冻结</span></div>
    <template v-else>
      <div style="margin-top:var(--s2);font-size:var(--fs-sm);color:var(--dim);line-height:1.8">部分系统会在后台冻结应用，连闹钟一起丢掉。标准做法是把它加进电池优化白名单：<br>① 点下面的按钮；<br>② 在列表里找到「懒得记」；<br>③ 选「不限制 / 允许后台活动」。<br>如果系统另外还有「后台高耗电」「自启动」之类的开关，一并允许。</div>
      <div class="acts"><button class="btn pri" @click="H.askBattery()">去关闭电池优化</button><button class="btn gh" @click="H.askNotify()">检查通知权限</button></div>
    </template>
  </template>
  <div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">开启后通知栏会有一条常驻提示，这是系统允许的标准保活方式；服务每 10 分钟检查一次待办，把被系统丢掉的闹钟重新排上。仍有厂商会在后台强行冻结应用（连闹钟一起取消），app 无法绕过；那种情况下打开 app 时未完成的待办都还在「待办」页。电池优化页面的名字各厂商可能不同，这只是系统设置页，app 不侦测品牌。</div>
</div>
<div class="pgroup">外观</div>
<div class="card"><div class="seg" style="margin-top:var(--s0)"><button v-for="t in themes" :key="t.m" :class="t.cls" @click="H.setTheme(t.m)"><ico :n="t.icon"/>{{ t.label }}</button></div><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">默认亮色；选「跟随系统」时随手机夜间模式切换，状态栏与导航栏同步变色</div></div>
<div class="pgroup">AI 模型（BYOK）</div>
<div class="card">
  <div class="row between" style="margin-top:var(--s0)"><div><b>启用 AI 解析</b><div style="font-size:var(--fs-xs);color:var(--dim)">关闭后只保存原文，不调用模型</div></div>
  <van-switch :class="aiSwCls" :model-value="s.useAI" @update:model-value="H.toggleAI"/></div>
  <label>API Base URL（OpenAI 兼容）</label><input id="sUrl" :value.attr="f.baseUrl" @input="H.formInput('baseUrl', $event.target.value)" placeholder="https://your-server:8080/v1">
  <label>API Key</label><input id="sKey" :value.attr="f.apiKey" @input="H.formInput('apiKey', $event.target.value)" placeholder="sk-...">
  <div class="fhint">明文存在本机 app 私有目录（别的 app 读不到），这里显示的就是已保存的 key，换 key 直接改这一栏</div>
  <label>模型名</label><input id="sModel" :value.attr="f.model" @input="H.formInput('model', $event.target.value)">
  <div class="grid2"><div><label>超时（秒）</label><input id="sTimeout" :value.attr="f.timeoutS" @input="H.formInput('timeoutS', $event.target.value)"></div><div><label>最大 tokens</label><input id="sMax" :value.attr="f.maxTokens" @input="H.formInput('maxTokens', $event.target.value)"></div></div>
  <label>温度 temperature</label><input id="sTemp" :value.attr="f.temperature" @input="H.formInput('temperature', $event.target.value)">
  <div class="acts"><button class="btn pri" @click="H.saveSettings()">保存</button><button class="btn" @click="H.testLLM()">测试连接</button></div>
  <div id="llmOut"><div class="body" v-if="llmBusy"><span class="spin"></span> 连接中…</div><div class="body" v-else-if="llmLine" style="margin-top:var(--s2)">{{ llmLine }}<br>{{ llmBody }}</div></div>
</div>
<div class="pgroup">采集</div><div class="card"><kv-row k="剪贴板暂存" v="前台自动 + 顶栏按钮手动" vstyle="color:var(--acc2)"/><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">打开 app 时自动暂存剪贴板里的文字；在别的 app 复制后切回「懒得记」即可看到，顶栏剪贴板按钮也可以随时手动收一条。Android 10+ 只允许有焦点的窗口读剪贴板，刚点通知进来时系统会拒读，app 会等拿到焦点重试。点「解析」才发到大模型，之前内容不会离开本机。</div></div>
<div class="pgroup">本地 OCR</div><div class="card"><settings-ocr-card :i="i"/></div>
<div class="pgroup">离线语音</div><div class="card"><settings-stt-card :i="i"/></div>
<div class="pgroup">数据</div><div class="card"><settings-data-card/></div>
<div class="pgroup">运行状态</div><div class="card"><settings-run-card :i="i"/></div>
<div class="pgroup">用法</div><div class="card"><div class="body" style="margin-top:var(--s0)">· 在微信 / 浏览器 / 相册里点「分享」→ 选 懒得记<br>· 文字直接发给模型；图片先在本机用离线 OCR 识别成文字，再发给模型（图片不出门）<br>· 模型返回 JSON：标题、正文、标签、待办（含到期时间）<br>· 底部 ＋ 可手动记文字或选图片；返回键先关面板，再回笔记页</div></div>`
};

export default SettingsSheetView;
