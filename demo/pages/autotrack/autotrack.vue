<template>
  <scroll-view class="page" scroll-y>
    <view class="section">
      <text class="title">无埋点实机验收</text>
      <text class="hint">每次操作先看 action=click/change，再看紧随其后的事件 JSON。普通元素 xpath 为 id#业务函数名，无 id 时为 #业务函数名。</text>
      <text class="hint">本 demo 使用专用验证构建开放待验收能力；正式发布状态仍以各端真机请求和 collector 接收证据为准。</text>
      <view class="status-card">
        <text class="status-title">业务 handler 执行次数：{{ actionCount }}</text>
        <text class="status-text">{{ lastAction }}</text>
      </view>
    </view>

    <view class="section">
      <text class="section-title">1. click / tap 与主目标</text>
      <text class="case-title">有 id 的 click</text>
      <button id="plain-action" data-title="普通无埋点按钮" data-index="1" data-src="/pages/autotrack/autotrack?case=plain" @click="onAction('普通点击')">普通点击</button>
      <text class="expected">预期：plain-action#onAction，index=1，并携带 hyperlink</text>

      <text class="case-title">有 id 的 tap 与嵌套子节点</text>
      <view id="tap-card" class="tap-card" data-title="嵌套卡片" data-index="2" @tap="onAction('嵌套卡片')"><text>点击内部文字</text></view>
      <text class="expected">预期：tap-card#onAction，index=2</text>

      <text class="case-title">currentTarget 无 id，target 有 id</text>
      <view class="tap-card" data-title="父节点无 id" @tap="onParentWithoutId($event)"><text id="child-only-id">点击这个有 id 的子节点</text></view>
      <text class="expected">预期：#onParentWithoutId，不能借用 child-only-id</text>

      <button id="zero-index" data-index="0" @tap="onZeroIndex($event)">data-index=0</button>
      <text class="expected">预期：zero-index#onZeroIndex，事件中没有 index</text>
      <text class="case-title">父子冒泡与连续独立点击</text>
      <view id="bubble-parent" class="tap-card" data-title="冒泡父层" @tap="onBubbleParent($event)">
        <button id="bubble-child" data-title="冒泡子层" @tap="onBubbleChild($event)">点子按钮，同时触发父层</button>
      </view>
      <text class="expected">预期：一次子按钮点击产生 bubble-child#onBubbleChild 和 bubble-parent#onBubbleParent；不同主目标各采集一次，业务计数共增加 2。</text>
      <button id="repeat-action" @tap="onRepeatAction($event)">连续点击 / 返回本页再点击</button>
      <text class="expected">预期：每次独立点击都有 repeat-action#onRepeatAction；同一次交互的重复探针不重复采集。</text>
      <button id="dedup-route" data-growing-ignore @tap="goDedupRoute($event)">前往路由页，用导航返回后再点上方按钮</button>
    </view>

    <view class="section">
      <text class="section-title">2. 动态模板与 handler 语义</text>
      <template v-for="(item, index) in items" :key="item.key">
        <button :id="item.id" :data-title="item.title" :data-index="index + 1" :data-src="item.src" @tap="onListAction(item.title)">{{ item.title }}</button>
      </template>
      <text class="expected">初始预期：sku-1/sku-2#onListAction。重排、更新、增删后再次点商品，应读取当前 id、title、一基 index 与 src，不沿用旧数据。</text>
      <button id="list-reverse" data-growing-ignore @tap="reverseItems($event)">重排列表</button>
      <button id="list-update" data-growing-ignore @tap="updateFirstItem($event)">更新首项 id / title / src（保留 key）</button>
      <button id="list-add" data-growing-ignore @tap="addItem($event)">新增一项</button>
      <button id="list-remove" data-growing-ignore @tap="removeFirstItem($event)">删除首项</button>
      <button id="list-reset" data-growing-ignore @tap="resetItems($event)">恢复初始列表</button>

      <button v-for="item in noIdItems" :key="item" :data-title="item" @tap="onNoIdListAction(item)">无 id：{{ item }}</button>
      <text class="expected">预期：两项均为 #onNoIdListAction，不生成结构路径</text>

      <view class="toggle-row"><text>v-if 用例</text><switch :checked="showIf" data-growing-ignore @change="onToggleIf($event)" /></view>
      <button v-if="showIf" id="conditional-if" @tap="onConditionalIf($event)">v-if 当前可见</button>
      <text class="expected">预期：只有按钮实际存在并被点击时产生 conditional-if#onConditionalIf</text>

      <view class="toggle-row"><text>v-show 用例</text><switch :checked="showVShow" data-growing-ignore @change="onToggleVShow($event)" /></view>
      <button v-show="showVShow" id="conditional-show" @tap="onConditionalShow($event)">v-show 当前可见</button>
      <text class="expected">预期：只有可达并被点击时产生 conditional-show#onConditionalShow</text>

      <button @tap="enabled ? onAction('条件分支：开') : onInputComplete($event)">无 id 的条件 handler</button>
      <text class="expected">预期：订阅开关开启时为 #onAction，关闭时为 #onInputComplete；只执行命中的分支，业务计数增加 1。</text>

      <text class="case-title">括号箭头回调（本次修复）</text>
      <button id="arrow-grouped" @tap="e => (onGroupedArrow(e))">箭头返回括号中的调用</button>
      <button id="arrow-object" @tap="e => ({ saved: onObjectArrow(e) })">箭头返回对象</button>
      <button id="arrow-nested" @tap="(e) => ((onNestedArrow(e)))">箭头包含多层括号</button>
      <text class="expected">预期：页面正常编译；各自产生 arrow-grouped#onGroupedArrow、arrow-object#onObjectArrow、arrow-nested#onNestedArrow。每点一次业务计数只增加 1。</text>
    </view>

    <view class="section">
      <text class="section-title">3. 三种 Vue 写法</text>
      <text class="hint">三个按钮的业务计数每次只能增加 1，用来确认插桩没有重复调用原 handler。</text>
      <button id="options-action" @tap="onOptionsAction($event)">Options API methods</button>
      <text class="expected">预期：options-action#onOptionsAction</text>
      <auto-track-script-setup />
      <auto-track-setup-alias />
    </view>

    <view class="section">
      <text class="section-title">4. input / textarea 与隐私</text>
      <text class="case-title">显式采集输入值</text>
      <input id="nickname" v-model="nickname" data-growing-track data-title="昵称" placeholder="输入昵称后失焦" @blur="onInputComplete($event)" />
      <text class="expected">预期：nickname#onInputComplete，textValue 为输入内容</text>

      <text class="case-title">未放行输入值</text>
      <input id="untracked-input" v-model="untrackedText" placeholder="输入后失焦" @blur="onInputComplete($event)" />
      <text class="expected">预期：仍有 VIEW_CHANGE，但没有 textValue</text>

      <text class="case-title">密码和显式敏感输入</text>
      <input id="password" v-model="password" password data-growing-track placeholder="仅填演示值：密码不会生成自动事件" @blur="onInputComplete($event)" />
      <input id="sensitive-input" v-model="sensitiveText" data-growing-sensitive data-growing-track placeholder="敏感标记不会生成自动事件" @blur="onInputComplete($event)" />
      <text class="expected">预期：两个业务 handler 都执行，但没有 VIEW_CHANGE，日志不出现输入原文</text>

      <text class="case-title">数字 1 与字符串 '1' 的隐私标记（本次修复）</text>
      <input id="track-string-one" data-growing-track="1" placeholder="仅填演示值：字符串 1 放行" @blur="onInputComplete($event)" />
      <input id="track-number-one" :data-growing-track="1" placeholder="仅填演示值：数字 1 放行" @blur="onInputComplete($event)" />
      <text class="expected">预期：两个输入均产生 VIEW_CHANGE，textValue 保留演示值。</text>
      <input id="sensitive-string-one" data-growing-sensitive="1" data-growing-track="1" placeholder="仅填演示值：字符串 1 敏感" @blur="onInputComplete($event)" />
      <input id="sensitive-number-one" :data-growing-sensitive="1" :data-growing-track="1" placeholder="仅填演示值：数字 1 敏感" @blur="onInputComplete($event)" />
      <text class="expected">预期：敏感标记优先于放行标记，业务计数增加，但没有 VIEW_CHANGE，输入原文不进入事件。</text>

      <text class="case-title">textarea 同时声明 blur / confirm</text>
      <textarea id="note" v-model="note" data-growing-track placeholder="输入备注后完成" @blur="onInputComplete($event)" @confirm="onInputComplete($event)" />
      <text class="expected">预期：只选择 blur 插桩，业务事件仍按原声明执行</text>
      <text class="case-title">confirm 与 SDK 的 change 选择规则</text>
      <text class="expected">传统 input 官方完成事件为 blur / confirm；change 为 SDK 分支及宿主兼容性核对，不保证 App 会触发。三事件控件若没有 change，则不会改用 blur / confirm 采集，应记录业务计数和真实触发结果，不视为该端验收通过。</text>
      <input id="input-change" data-growing-track placeholder="仅填演示值：核对宿主是否触发 change" @change="onInputChange($event)" />
      <input id="input-confirm" data-growing-track confirm-type="done" placeholder="仅填演示值，点键盘完成" @confirm="onInputConfirm($event)" />
      <textarea id="textarea-confirm" data-growing-track confirm-type="done" placeholder="textarea 单独 confirm" @confirm="onInputConfirm($event)" />
      <input id="input-all-completions" data-growing-track placeholder="同时绑定 change / blur / confirm" @change="onCompletionChange($event)" @blur="onCompletionBlur($event)" @confirm="onCompletionConfirm($event)" />
      <textarea id="textarea-all-completions" data-growing-track placeholder="textarea 同时绑定三个完成事件" @change="onCompletionChange($event)" @blur="onCompletionBlur($event)" @confirm="onCompletionConfirm($event)" />
      <text class="expected">单独事件分别采集 onInputChange / onInputConfirm；三事件控件只为 change 插桩，blur / confirm 业务仍执行。宿主未触发某个原生事件时，不会人为补发。</text>
      <text class="status-text">三事件控件业务次数：change={{ completionCounts.change }}，blur={{ completionCounts.blur }}，confirm={{ completionCounts.confirm }}</text>

      <text class="case-title">动态隐私开关</text>
      <view class="toggle-row"><text>ignore</text><switch id="privacy-ignore-toggle" :checked="privacyIgnore" data-growing-ignore @change="togglePrivacyIgnore($event)" /></view>
      <view class="toggle-row"><text>sensitive</text><switch id="privacy-sensitive-toggle" :checked="privacySensitive" data-growing-ignore @change="togglePrivacySensitive($event)" /></view>
      <view class="toggle-row"><text>track 放行值</text><switch id="privacy-track-toggle" :checked="privacyTrack" data-growing-ignore @change="togglePrivacyTrack($event)" /></view>
      <button id="privacy-dynamic-click" :data-growing-ignore="privacyIgnore" :data-growing-sensitive="privacySensitive" @tap="onDynamicPrivacyAction($event)">验证当前隐私开关的点击</button>
      <input id="privacy-dynamic-input" :data-growing-ignore="privacyIgnore" :data-growing-sensitive="privacySensitive" :data-growing-track="privacyTrack" placeholder="仅填演示值，切换后再次失焦" @blur="onInputComplete($event)" />
      <text class="expected">ignore / sensitive 任一开启则整条自动事件拦截；两者关闭时点击可采集，输入只在 track 开启时带值。反复开关使用触发时的新状态。</text>

      <picker id="false-marker-selector" :range="falseMarkerLabels" :value="falseMarkerIndex" data-growing-ignore @change="selectFalseMarker($event)"><view class="tap-card">禁用标记值：{{ falseMarkerLabels[falseMarkerIndex] }}</view></picker>
      <button id="false-marker-click" :data-growing-ignore="falseMarkers[falseMarkerIndex]" :data-growing-sensitive="falseMarkers[falseMarkerIndex]" @tap="onDynamicPrivacyAction($event)">false / 0 / "0" / "false" 不启用隐私标记</button>
      <input id="false-marker-input" :data-growing-track="falseMarkers[falseMarkerIndex]" placeholder="仅填演示值：禁用标记不放行原文" @blur="onInputComplete($event)" />
      <text class="expected">四种值都不阻止点击；输入有 VIEW_CHANGE，但没有 textValue。</text>

      <text class="case-title">动态 type / password 的保守拦截</text>
      <view class="toggle-row"><text>动态 type：{{ dynamicInputType }}</text><switch id="dynamic-type-toggle" :checked="numericInput" data-growing-ignore @change="toggleInputType($event)" /></view>
      <input id="dynamic-type-input" :type="dynamicInputType" data-growing-track placeholder="仅填演示值：动态 type 始终拦截" @blur="onInputComplete($event)" />
      <view class="toggle-row"><text>动态 password：{{ maskPassword }}</text><switch id="dynamic-password-toggle" :checked="maskPassword" data-growing-ignore @change="togglePassword($event)" /></view>
      <input id="dynamic-password-input" :password="maskPassword" data-growing-track placeholder="仅填演示值：动态 password 始终拦截" @blur="onInputComplete($event)" />
      <text class="expected">编译器无法固定类型的输入保守视为敏感；无论开关状态，业务执行但没有 VIEW_CHANGE。</text>

      <text class="case-title">清空、长文本、换行与特殊字符</text>
      <button id="text-fill-long" data-growing-ignore @tap="fillLongText($event)">填入 120 个 A</button>
      <button id="text-fill-special" data-growing-ignore @tap="fillSpecialText($event)">填入预设特殊字符和换行</button>
      <button id="text-clear" data-growing-ignore @tap="clearBoundaryText($event)">清空演示文本</button>
      <textarea id="boundary-text" v-model="boundaryText" :maxlength="-1" data-growing-track placeholder="填充后聚焦，再失焦核对" @blur="onInputComplete($event)" />
      <text class="expected">填充 / 清空只是修改页面文本，不主动发送完成事件。失焦后：长文本截到 100 字符；控制字符归为空格；空值仍有 VIEW_CHANGE，协议省略 textValue。页面不回显输入原文。</text>
    </view>

    <view class="section">
      <text class="section-title">5. 所有 change 组件</text>
      <view class="toggle-row"><text>订阅开关（含 false）</text><switch id="subscription" :checked="enabled" data-growing-track data-title="订阅开关" @change="onSwitchChange($event)" /></view>
      <text class="expected">预期：subscription#onSwitchChange，textValue 保留 true/false</text>

      <text class="case-title">slider（请拖回 0）</text>
      <slider id="volume" :value="volume" data-growing-track @change="onVolumeChange($event)" />
      <text class="expected">预期：volume#onVolumeChange，textValue 保留 0</text>

      <text class="case-title">radio-group</text>
      <radio-group id="choice" data-growing-track @change="onChoiceChange($event)"><label class="choice"><radio value="A" />A</label><label class="choice"><radio value="B" />B</label></radio-group>
      <text class="expected">预期：choice#onChoiceChange，textValue 为 A 或 B</text>

      <text class="case-title">checkbox-group</text>
      <checkbox-group id="tags" data-growing-track @change="onTagsChange($event)"><label class="choice"><checkbox value="A" :checked="selectedTags.includes('A')" />A</label><label class="choice"><checkbox value="B" :checked="selectedTags.includes('B')" />B</label></checkbox-group>
      <text class="expected">预期：tags#onTagsChange，多值以 || 拼接；把选项全部取消，仍有 VIEW_CHANGE，但省略空 textValue。</text>

      <text class="case-title">picker 对象 range</text>
      <picker id="city" :range="cities" range-key="name" :value="city" data-growing-track @change="onCityChange($event)"><view class="tap-card">当前城市：{{ cities[city].name }}</view></picker>
      <text class="expected">预期：city#onCityChange，动态 range 使用所选下标</text>

      <text class="case-title">picker-view 两列</text>
      <picker-view id="columns" class="picker-columns" :value="columns" data-growing-track @change="onColumnsChange($event)">
        <picker-view-column><view v-for="item in regions" :key="item">{{ item }}</view></picker-view-column>
        <picker-view-column><view v-for="item in periods" :key="item">{{ item }}</view></picker-view-column>
      </picker-view>
      <text class="expected">预期：columns#onColumnsChange，各列所选下标以 || 拼接</text>
      <text class="case-title">字面量 range / 固定列的文案映射</text>
      <picker id="picker-literal-string" :range="['杭州', '上海']" :value="literalCity" data-growing-track @change="onLiteralCityChange($event)"><view class="tap-card">字面量城市下标：{{ literalCity }}</view></picker>
      <picker id="picker-literal-object" :range="[{ name: '方案甲' }, { name: '方案乙' }]" range-key="name" :value="literalPlan" data-growing-track @change="onLiteralPlanChange($event)"><view class="tap-card">字面量对象下标：{{ literalPlan }}</view></picker>
      <picker-view id="picker-static-columns" class="picker-columns" :value="staticColumns" data-growing-track @change="onStaticColumnsChange($event)">
        <picker-view-column><view>华东</view><view>华南</view></picker-view-column>
        <picker-view-column><view>上午</view><view>下午</view></picker-view-column>
      </picker-view>
      <text class="expected">预期：字面量 picker 上报选中城市 / 方案名称；固定列 picker-view 上报如 华南||下午，对照上方动态 range 的下标回退。</text>

      <text class="case-title">swiper 手动与 autoplay</text>
      <swiper id="banner" class="banner" data-title="轮播文案" :autoplay="autoplay" @change="onSwiperChange($event)"><swiper-item><view class="banner-item">第一张</view></swiper-item><swiper-item><view class="banner-item">第二张</view></swiper-item></swiper>
      <button @tap="onToggleAutoplay($event)">自动轮播：{{ autoplay ? '开启' : '关闭' }}</button>
      <text class="expected">预期：手动滑动生成 banner#onSwiperChange；未放行的 autoplay 不生成事件</text>
      <swiper id="banner-tracked" class="banner" data-growing-track :autoplay="trackedAutoplay" @change="onTrackedSwiperChange($event)"><swiper-item><view class="banner-item">放行轮播：第 0 张</view></swiper-item><swiper-item><view class="banner-item">放行轮播：第 1 张</view></swiper-item></swiper>
      <button id="tracked-autoplay-toggle" data-growing-ignore @tap="toggleTrackedAutoplay($event)">放行的自动轮播：{{ trackedAutoplay ? '开启' : '关闭' }}</button>
      <text class="expected">预期：手动和 autoplay 都可生成 banner-tracked#onTrackedSwiperChange，textValue 为当前下标，保留 "0"。请在事件原始 target 含 track 标记的真机上核对。</text>
    </view>

    <view class="section">
      <text class="section-title">6. ignore、uni-link 与 tabBar</text>
      <button data-growing-ignore data-title="必须忽略的按钮" @click="onIgnoredAction($event)">忽略采集，保留业务 handler</button>
      <view id="target-ignore" class="tap-card" @tap="onIgnoredChildAction($event)"><text data-growing-ignore>点击带 ignore 的子节点</text></view>
      <text class="expected">预期：两项业务计数增加，但都没有 VIEW_CLICK</text>

      <button id="ignore-string-one" data-growing-ignore="1" @tap="onIgnoredAction($event)">字符串 '1' 忽略采集</button>
      <button id="ignore-number-one" :data-growing-ignore="1" @tap="onIgnoredAction($event)">数字 1 忽略采集</button>
      <text class="expected">预期：业务计数各增加 1，但两个按钮都不产生 VIEW_CLICK。</text>

      <uni-link :href="linkHref" :data-src="linkHref" data-title="uni-link 动态链接">打开路由页验证 uni-link</uni-link>
      <text class="expected">预期：#openURL，hyperlink 从原生 dataset.src 获取；内部与外层监听最终只发送一次</text>

      <text class="hint">点击底部任意标签验证 tabBar：xpath 固定为 #onTabItemTap，index 从 1 开始，hyperlink 为 pagePath。</text>
      <button id="boundary-route" data-growing-ignore @tap="goBoundary($event)">进入“预期不采集”边界页</button>
      <text class="hint">采集开关页另有普通点击 / 输入控件，可验证关闭时业务照常执行、恢复后 VIEW 与新 PAGE 时间一致。</text>
    </view>
  </scroll-view>
</template>

<script>
import AutoTrackScriptSetup from '@/components/auto-track-script-setup/auto-track-script-setup.vue'
import AutoTrackSetupAlias from '@/components/auto-track-setup-alias/auto-track-setup-alias.vue'
import UniLink from '@/components/uni-link/uni-link.vue'

function initialItems() {
  return [1, 2].map(index => ({ key: `sku-${index}`, id: `sku-${index}`, title: `商品${index === 1 ? '一' : '二'}`, src: `/pages/route/route?from=sku&item=${index}` }))
}

export default {
  components: { AutoTrackScriptSetup, AutoTrackSetupAlias, UniLink },
  data() {
    return {
      gioPageTitle: '无埋点实机验收',
      nickname: '', untrackedText: '', password: '', sensitiveText: '', note: '',
      enabled: false, volume: 0, city: 0, columns: [0, 0], autoplay: false,
      showIf: true, showVShow: true, actionCount: 0,
      completionCounts: { change: 0, blur: 0, confirm: 0 },
      privacyIgnore: false, privacySensitive: false, privacyTrack: false,
      falseMarkerIndex: 0, falseMarkers: [false, 0, '0', 'false'], falseMarkerLabels: ['布尔 false', '数字 0', '字符串 "0"', '字符串 "false"'],
      numericInput: false, maskPassword: true, boundaryText: '', selectedTags: [],
      literalCity: 0, literalPlan: 0, staticColumns: [0, 0], trackedAutoplay: false, itemRevision: 0, itemSerial: 2,
      cities: [{ name: '杭州' }, { name: '上海' }],
      regions: ['浙江', '江苏'], periods: ['上午', '下午'],
      items: initialItems(),
      noIdItems: ['无 id 商品一', '无 id 商品二'],
      linkHref: '/pages/route/route?from=uni-link&case=dynamic',
      lastAction: '尚未操作。',
    }
  },
  computed: { dynamicInputType() { return this.numericInput ? 'number' : 'text' } },
  methods: {
    mark(message) { this.actionCount += 1; this.lastAction = `第 ${this.actionCount} 次：${message}` },
    onAction(name) { this.mark(name) },
    onListAction(name) { this.mark(`动态列表：${name}`) },
    onNoIdListAction(name) { this.mark(`无 id 列表：${name}`) },
    onParentWithoutId() { this.mark('父节点无 id') },
    onZeroIndex() { this.mark('data-index=0') },
    onBubbleParent() { this.mark('冒泡父层业务') },
    onBubbleChild() { this.mark('冒泡子层业务') },
    onRepeatAction() { this.mark('独立点击业务') },
    goDedupRoute() { uni.navigateTo({ url: '/pages/route/route?from=autotrack&case=page-return' }) },
    reverseItems() { this.items.reverse(); this.mark('列表已重排') },
    updateFirstItem() {
      const first = this.items[0]
      if (!first) { this.mark('列表为空，请先新增或恢复'); return }
      const revision = ++this.itemRevision
      first.id = `${first.key}-r${revision}`; first.title = `演示商品第 ${revision} 版`; first.src = `/pages/route/route?from=updated&revision=${revision}`
      this.mark('首项 id / title / src 已更新，key 保持不变')
    },
    addItem() { const index = ++this.itemSerial; this.items.push({ key: `sku-${index}`, id: `sku-${index}`, title: `新增商品 ${index}`, src: `/pages/route/route?from=added&item=${index}` }); this.mark('列表新增一项') },
    removeFirstItem() { this.items.shift(); this.mark('列表删除首项') },
    resetItems() { this.items = initialItems(); this.itemRevision = 0; this.itemSerial = 2; this.mark('列表已恢复初始值') },
    onOptionsAction() { this.mark('Options API methods') },
    onGroupedArrow() { this.mark('括号箭头调用'); return this.actionCount },
    onObjectArrow() { this.mark('箭头对象返回'); return this.actionCount },
    onNestedArrow() { this.mark('多层括号箭头'); return this.actionCount },
    onConditionalIf() { this.mark('v-if 按钮') },
    onConditionalShow() { this.mark('v-show 按钮') },
    onToggleIf(event) { this.showIf = event.detail.value; this.mark(`v-if：${this.showIf ? '显示' : '隐藏'}`) },
    onToggleVShow(event) { this.showVShow = event.detail.value; this.mark(`v-show：${this.showVShow ? '显示' : '隐藏'}`) },
    onInputComplete() { this.mark('输入完成（页面不展示输入原文）') },
    onInputChange() { this.mark('独立 change 完成') },
    onInputConfirm() { this.mark('独立 confirm 完成') },
    onCompletionChange() { this.completionCounts.change++; this.mark('三事件控件 change 业务') },
    onCompletionBlur() { this.completionCounts.blur++; this.mark('三事件控件 blur 业务') },
    onCompletionConfirm() { this.completionCounts.confirm++; this.mark('三事件控件 confirm 业务') },
    togglePrivacyIgnore(event) { this.privacyIgnore = event.detail.value; this.mark('ignore 开关已更新') },
    togglePrivacySensitive(event) { this.privacySensitive = event.detail.value; this.mark('sensitive 开关已更新') },
    togglePrivacyTrack(event) { this.privacyTrack = event.detail.value; this.mark('track 开关已更新') },
    onDynamicPrivacyAction() { this.mark('动态隐私按钮业务') },
    selectFalseMarker(event) { this.falseMarkerIndex = Number(event.detail.value); this.mark('禁用标记值已更新') },
    toggleInputType(event) { this.numericInput = event.detail.value; this.mark('动态 type 已更新') },
    togglePassword(event) { this.maskPassword = event.detail.value; this.mark('动态 password 已更新') },
    fillLongText() { this.boundaryText = 'A'.repeat(120); this.mark('已填入预设长文本，请聚焦后失焦') },
    fillSpecialText() { this.boundaryText = '演示<&>"\'\n第二行\t内容'; this.mark('已填入预设特殊字符，请聚焦后失焦') },
    clearBoundaryText() { this.boundaryText = ''; this.mark('已清空文本，请聚焦后失焦') },
    onVolumeChange(event) { this.volume = event.detail.value; this.mark(`滑块：${this.volume}`) },
    onChoiceChange(event) { this.mark(`单选：${event.detail.value}`) },
    onTagsChange(event) { this.selectedTags = event.detail.value; this.mark(this.selectedTags.length ? `多选：${this.selectedTags.join('、')}` : '多选：已全部取消') },
    onCityChange(event) { this.city = Number(event.detail.value); this.mark(`城市：${this.cities[this.city].name}`) },
    onColumnsChange(event) { this.columns = event.detail.value; this.mark(`多列下标：${this.columns.join('、')}`) },
    onLiteralCityChange(event) { this.literalCity = Number(event.detail.value); this.mark(`字面量城市下标：${this.literalCity}`) },
    onLiteralPlanChange(event) { this.literalPlan = Number(event.detail.value); this.mark(`字面量对象下标：${this.literalPlan}`) },
    onStaticColumnsChange(event) { this.staticColumns = event.detail.value; this.mark(`固定列下标：${this.staticColumns.join('、')}`) },
    onSwiperChange(event) { this.mark(`轮播：${event.detail.current}，来源：${event.detail.source || '代码'}`) },
    onTrackedSwiperChange(event) { this.mark(`放行轮播下标：${event.detail.current}，来源：${event.detail.source || '代码'}`) },
    toggleTrackedAutoplay() { this.trackedAutoplay = !this.trackedAutoplay; this.mark('放行轮播自动播放已切换') },
    onToggleAutoplay() { this.autoplay = !this.autoplay; this.mark(`自动轮播：${this.autoplay ? '开启' : '关闭'}`) },
    onSwitchChange(event) { this.enabled = event.detail.value; this.mark(`订阅开关：${this.enabled ? '开启' : '关闭'}`) },
    onIgnoredAction() { this.mark('ignore 按钮业务已执行') },
    onIgnoredChildAction() { this.mark('target ignore 业务已执行') },
    goBoundary() { uni.navigateTo({ url: '/pages/autotrack-boundary/autotrack-boundary' }) },
  },
}
</script>

<style>
.page { height: 100%; padding: 20rpx; box-sizing: border-box; }
.section { margin-bottom: 20rpx; padding: 24rpx; border-radius: 12rpx; background: #fff; }
.title, .section-title, .hint, .case-title, .expected, .status-title, .status-text { display: block; }
.title { font-size: 34rpx; font-weight: 600; color: #222; }
.section-title { margin-bottom: 10rpx; font-size: 29rpx; font-weight: 600; color: #222; }
.hint { margin-top: 12rpx; font-size: 24rpx; color: #666; line-height: 1.6; }
.case-title { margin-top: 24rpx; font-size: 25rpx; font-weight: 600; color: #333; }
.expected { margin-top: 8rpx; font-size: 22rpx; color: #777; line-height: 1.5; }
.status-card { margin-top: 18rpx; padding: 18rpx; border-radius: 10rpx; background: #f0f7ff; }
.status-title { font-size: 26rpx; font-weight: 600; color: #1677ff; }
.status-text { margin-top: 8rpx; font-size: 23rpx; color: #555; }
.toggle-row { display: flex; align-items: center; justify-content: space-between; margin-top: 22rpx; }
.tap-card { margin-top: 16rpx; padding: 24rpx; border: 1rpx solid #91caff; border-radius: 10rpx; color: #1677ff; }
.choice { margin-right: 30rpx; font-size: 25rpx; }
input, textarea { width: 100%; margin-top: 10rpx; padding: 16rpx; box-sizing: border-box; border: 1rpx solid #ddd; border-radius: 8rpx; background: #fff; }
textarea { height: 150rpx; }
button { margin-top: 16rpx; background: #1677ff; color: #fff; font-size: 26rpx; }
.picker-columns { height: 240rpx; margin-top: 16rpx; border: 1rpx solid #eee; }
.banner { height: 160rpx; margin-top: 16rpx; }
.banner-item { display: flex; align-items: center; justify-content: center; height: 160rpx; background: #e6f4ff; color: #1677ff; }
</style>
