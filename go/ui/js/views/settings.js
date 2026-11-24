/* 设置页（S3 步骤 10）。它是**弹层**（pageSheetVue('settings','设置')），不是 tab。
   模式同 views/clip.js：结构在模板里，纯展示块（采集 / 本地 OCR / 用法 / 保活长说明）
   整块 v-html 复用 app.js 的叶子函数，两条路径共用同一份字符串，零漂移面。

   前面几步踩过、写在这里省得再踩的坑：
   1) 读模块状态一律 live()：S / ST / remindPending 是普通模块变量，refresh() 整体替换，
      computed 不依赖 tick 就永远缓存 → 从系统设置页回来后开关状态是旧的。
   2) 模板里用原始值 + {{ }}，不要再 esc（Vue 插值是 textContent）。
   3) 一个元素里只放一个 {{ }}（两个插值 = 两个文本节点，VDIFF 序列化器 trim 后拼会丢空格）。
   4) 模板里用 H.xxx 的组件必须在 setup() 返回里暴露 H（闸门⑮ 强制）。
   5) class 用拼接，不用「静态 class + 对象语法」：遗留写的是 'btn sm '（带尾空格）这类
      拼接结果，Vue 合并 class 的顺序不同，VDIFF 比的是 class 属性字符串。

   两个设置页特有的坑：
   a) 输入框的 value 用 :value.attr（Vue 3.4+ 的 .attr 修饰符）。直接写 :value 走的是
      DOM property，innerHTML 序列化出来**没有** value 属性，遗留字符串有 → VDIFF 红；
      写 :value.attr 才与遗留的字符串属性一致（步骤 8 的 folderQ 是反例：那里连属性都不该有）。
      值一律 `x || ''`：遗留 esc(undefined) 得到 value=""，Vue 的 .attr 遇到 null/undefined
      会 removeAttribute，两边就差一个属性。
   b) 开关 .sw 的 onclick="toggleAI(this)" 传的是元素本身（函数内部 el.classList.toggle），
      Vue 里用 $event.currentTarget 拿同一个元素，两条路径共用同一个函数。 */
import { V, H, Vue, live } from '../vue.js'

const { computed } = Vue

export const SettingsSheetView = {
  name: 'SettingsSheetView',
  setup(){
    return {
      H,
      tick: computed(() => V.tick),
      s: live(() => H.S.settings),
      // 提醒卡：副标题的插值切分必须与遗留拼接一一对应（三个文本节点）
      notifyGranted: live(() => H.notifyGranted()),
      notifyBtnCls: live(() => 'btn sm ' + (H.notifyGranted() ? 'gh' : '')),
      notifyBtnText: live(() => H.notifyGranted() ? '已开启' : '开启通知'),
      // 后台卡
      keepAlive: live(() => H.keepAliveOn()),
      batteryIgn: live(() => H.batteryIgnoring()),
      keepSub: live(() => H.keepAliveOn()
        ? (H.batteryIgnoring() ? '已开启 · 已豁免电池优化' : '已开启 · 建议再豁免电池优化')
        : '关闭 · 只在打开 app 时可靠，后台可能收不到提醒'),
      keepSwCls: live(() => 'sw' + (H.keepAliveOn() ? ' on' : '')),
      keepNote: live(() => H.settingsKeepAliveNoteHTML()),
      themes: live(function(){
        var cur = H.S.settings.theme || 'light';
        var label = { light: '亮色', dark: '暗色', auto: '跟随系统' };
        return ['light', 'dark', 'auto'].map(function(m){
          return {
            m: m, cls: m === cur ? 'on' : '', label: label[m],
            icon: H.ic(m === 'light' ? 'sun' : m === 'dark' ? 'moon' : 'monitor')
          };
        });
      }),
      aiSwCls: live(() => 'sw' + (H.S.settings.useAI ? ' on' : '')),
      // 数据卡 / 运行状态卡：整块（含按钮）复用叶子函数，见 views/stats.js 头部
      // 「插值切分必须与遗留拼接一一对应」那条
      dataCard: live(() => H.settingsDataCardHTML()),
      runCard: live(() => H.settingsRunCardHTML(H.S.info)),
      collect: live(() => H.settingsCollectHTML()),
      ocrCard: live(() => H.settingsOcrCardHTML(H.S.info)),
      usage: live(() => H.settingsUsageHTML())
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
  <div :class="keepSwCls" @click="H.toggleKeepAlive($event.currentTarget)"></div></div>
  <template v-if="keepAlive">
    <div class="kv" style="margin-top:var(--s2)" v-if="batteryIgn"><span>电池优化</span><span style="color:var(--ok)">已豁免，不会被冻结</span></div>
    <template v-else>
      <div style="margin-top:var(--s2);font-size:var(--fs-sm);color:var(--dim);line-height:1.8">部分系统会在后台冻结应用，连闹钟一起丢掉。标准做法是把它加进电池优化白名单：<br>① 点下面的按钮；<br>② 在列表里找到「懒得记」；<br>③ 选「不限制 / 允许后台活动」。<br>如果系统另外还有「后台高耗电」「自启动」之类的开关，一并允许。</div>
      <div class="acts"><button class="btn pri" @click="H.askBattery()">去关闭电池优化</button><button class="btn gh" @click="H.askNotify()">检查通知权限</button></div>
    </template>
  </template>
  <div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)" v-html="keepNote"></div>
</div>
<div class="pgroup">外观</div>
<div class="card"><div class="seg" style="margin-top:var(--s0)"><button v-for="t in themes" :key="t.m" :class="t.cls" @click="H.setTheme(t.m)" v-html="t.icon+t.label"></button></div><div style="font-size:var(--fs-xs);color:var(--dim);margin-top:var(--s2)">默认亮色；选「跟随系统」时随手机夜间模式切换，状态栏与导航栏同步变色</div></div>
<div class="pgroup">AI 模型（BYOK）</div>
<div class="card">
  <div class="row between" style="margin-top:var(--s0)"><div><b>启用 AI 解析</b><div style="font-size:var(--fs-xs);color:var(--dim)">关闭后只保存原文，不调用模型</div></div>
  <div :class="aiSwCls" @click="H.toggleAI($event.currentTarget)"></div></div>
  <label>API Base URL（OpenAI 兼容）</label><input id="sUrl" :value.attr="s.baseUrl || ''" placeholder="https://your-server:8080/v1">
  <label>API Key</label><input id="sKey" :value.attr="s.apiKey || ''" placeholder="sk-...">
  <div class="fhint">明文存在本机 app 私有目录（别的 app 读不到），这里显示的就是已保存的 key，换 key 直接改这一栏</div>
  <label>模型名</label><input id="sModel" :value.attr="s.model || ''">
  <div class="grid2"><div><label>超时（秒）</label><input id="sTimeout" :value.attr="s.timeoutS || 90"></div><div><label>最大 tokens</label><input id="sMax" :value.attr="s.maxTokens || 2048"></div></div>
  <label>温度 temperature</label><input id="sTemp" :value.attr="s.temperature == null ? '0.2' : s.temperature">
  <div class="acts"><button class="btn pri" @click="H.saveSettings()">保存</button><button class="btn" @click="H.testLLM()">测试连接</button></div>
  <div id="llmOut"></div>
</div>
<div class="pgroup">采集</div><div class="card" v-html="collect"></div>
<div class="pgroup">本地 OCR</div><div class="card" v-html="ocrCard"></div>
<div class="pgroup">数据</div><div class="card" v-html="dataCard"></div>
<div class="pgroup">运行状态</div><div class="card" v-html="runCard"></div>
<div class="pgroup">用法</div><div class="card" v-html="usage"></div>`
};

export default SettingsSheetView;
