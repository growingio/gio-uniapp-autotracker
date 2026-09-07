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
      <view class="tap-card" data-title="父节点无 id" @tap="onParentWithoutId"><text id="child-only-id">点击这个有 id 的子节点</text></view>
      <text class="expected">预期：#onParentWithoutId，不能借用 child-only-id</text>

      <button id="zero-index" data-index="0" @tap="onZeroIndex">data-index=0</button>
      <text class="expected">预期：zero-index#onZeroIndex，事件中没有 index</text>
    </view>

    <view class="section">
      <text class="section-title">2. 动态模板与 handler 语义</text>
      <template v-for="(item, index) in items" :key="item.id">
        <button :id="item.id" :data-title="item.title" :data-index="index + 1" @tap="onListAction(item.title)">{{ item.title }}</button>
      </template>
      <text class="expected">预期：sku-1/sku-2#onListAction，运行时读取各自 title 与一基 index</text>

      <button v-for="item in noIdItems" :key="item" :data-title="item" @tap="onNoIdListAction(item)">无 id：{{ item }}</button>
      <text class="expected">预期：两项均为 #onNoIdListAction，不生成结构路径</text>

      <view class="toggle-row"><text>v-if 用例</text><switch :checked="showIf" data-growing-ignore @change="onToggleIf" /></view>
      <button v-if="showIf" id="conditional-if" @tap="onConditionalIf">v-if 当前可见</button>
      <text class="expected">预期：只有按钮实际存在并被点击时产生 conditional-if#onConditionalIf</text>

      <view class="toggle-row"><text>v-show 用例</text><switch :checked="showVShow" data-growing-ignore @change="onToggleVShow" /></view>
      <button v-show="showVShow" id="conditional-show" @tap="onConditionalShow">v-show 当前可见</button>
      <text class="expected">预期：只有可达并被点击时产生 conditional-show#onConditionalShow</text>

      <button @tap="enabled ? onAction('条件分支：开') : onInputComplete">无 id 的条件 handler</button>
      <text class="expected">预期：开关开启为 #onAction，关闭为 #onInputComplete</text>
    </view>

    <view class="section">
      <text class="section-title">3. 三种 Vue 写法</text>
      <text class="hint">三个按钮的业务计数每次只能增加 1，用来确认插桩没有重复调用原 handler。</text>
      <button id="options-action" @tap="onOptionsAction">Options API methods</button>
      <text class="expected">预期：options-action#onOptionsAction</text>
      <auto-track-script-setup />
      <auto-track-setup-alias />
    </view>

    <view class="section">
      <text class="section-title">4. input / textarea 与隐私</text>
      <text class="case-title">显式采集输入值</text>
      <input id="nickname" v-model="nickname" data-growing-track data-title="昵称" placeholder="输入昵称后失焦" @blur="onInputComplete" />
      <text class="expected">预期：nickname#onInputComplete，textValue 为输入内容</text>

      <text class="case-title">未放行输入值</text>
      <input id="untracked-input" v-model="untrackedText" placeholder="输入后失焦" @blur="onInputComplete" />
      <text class="expected">预期：仍有 VIEW_CHANGE，但没有 textValue</text>

      <text class="case-title">密码和显式敏感输入</text>
      <input id="password" v-model="password" type="password" data-growing-track placeholder="密码不会生成自动事件" @blur="onInputComplete" />
      <input id="sensitive-input" v-model="sensitiveText" data-growing-sensitive data-growing-track placeholder="敏感标记不会生成自动事件" @blur="onInputComplete" />
      <text class="expected">预期：两个业务 handler 都执行，但没有 VIEW_CHANGE，日志不出现输入原文</text>

      <text class="case-title">textarea 同时声明 blur / confirm</text>
      <textarea id="note" v-model="note" data-growing-track placeholder="输入备注后完成" @blur="onInputComplete" @confirm="onInputComplete" />
      <text class="expected">预期：只选择 blur 插桩，业务事件仍按原声明执行</text>
    </view>

    <view class="section">
      <text class="section-title">5. 所有 change 组件</text>
      <view class="toggle-row"><text>订阅开关（含 false）</text><switch id="subscription" :checked="enabled" data-growing-track data-title="订阅开关" @change="onSwitchChange" /></view>
      <text class="expected">预期：subscription#onSwitchChange，textValue 保留 true/false</text>

      <text class="case-title">slider（请拖回 0）</text>
      <slider id="volume" :value="volume" data-growing-track @change="onVolumeChange" />
      <text class="expected">预期：volume#onVolumeChange，textValue 保留 0</text>

      <text class="case-title">radio-group</text>
      <radio-group id="choice" data-growing-track @change="onChoiceChange"><label class="choice"><radio value="A" />A</label><label class="choice"><radio value="B" />B</label></radio-group>
      <text class="expected">预期：choice#onChoiceChange，textValue 为 A 或 B</text>

      <text class="case-title">checkbox-group</text>
      <checkbox-group id="tags" data-growing-track @change="onTagsChange"><label class="choice"><checkbox value="A" />A</label><label class="choice"><checkbox value="B" />B</label></checkbox-group>
      <text class="expected">预期：tags#onTagsChange，多值以 || 拼接</text>

      <text class="case-title">picker 对象 range</text>
      <picker id="city" :range="cities" range-key="name" :value="city" data-growing-track @change="onCityChange"><view class="tap-card">当前城市：{{ cities[city].name }}</view></picker>
      <text class="expected">预期：city#onCityChange，优先输出城市名称</text>

      <text class="case-title">picker-view 两列</text>
      <picker-view id="columns" class="picker-columns" :value="columns" data-growing-track @change="onColumnsChange">
        <picker-view-column><view v-for="item in regions" :key="item">{{ item }}</view></picker-view-column>
        <picker-view-column><view v-for="item in periods" :key="item">{{ item }}</view></picker-view-column>
      </picker-view>
      <text class="expected">预期：columns#onColumnsChange，显示值以 || 拼接</text>

      <text class="case-title">swiper 手动与 autoplay</text>
      <swiper id="banner" class="banner" data-title="轮播文案" :autoplay="autoplay" @change="onSwiperChange"><swiper-item><view class="banner-item">第一张</view></swiper-item><swiper-item><view class="banner-item">第二张</view></swiper-item></swiper>
      <button @tap="onToggleAutoplay">自动轮播：{{ autoplay ? '开启' : '关闭' }}</button>
      <text class="expected">预期：手动滑动生成 banner#onSwiperChange；未放行的 autoplay 不生成事件</text>
    </view>

    <view class="section">
      <text class="section-title">6. ignore、uni-link 与 tabBar</text>
      <button data-growing-ignore data-title="必须忽略的按钮" @click="onIgnoredAction">忽略采集，保留业务 handler</button>
      <view id="target-ignore" class="tap-card" @tap="onIgnoredChildAction"><text data-growing-ignore>点击带 ignore 的子节点</text></view>
      <text class="expected">预期：两项业务计数增加，但都没有 VIEW_CLICK</text>

      <uni-link :href="linkHref" data-title="uni-link 动态链接">打开路由页验证 uni-link</uni-link>
      <text class="expected">预期：#openURL，hyperlink 为动态 href；内部与外层监听最终只发送一次</text>

      <text class="hint">点击底部任意标签验证 tabBar：xpath 固定为 #onTabItemTap，index 从 1 开始，hyperlink 为 pagePath。</text>
    </view>
  </scroll-view>
</template>

<script>
import AutoTrackScriptSetup from '@/components/auto-track-script-setup/auto-track-script-setup.vue'
import AutoTrackSetupAlias from '@/components/auto-track-setup-alias/auto-track-setup-alias.vue'
import UniLink from '@/components/uni-link/uni-link.vue'

export default {
  components: { AutoTrackScriptSetup, AutoTrackSetupAlias, UniLink },
  data() {
    return {
      gioPageTitle: '无埋点实机验收',
      nickname: '', untrackedText: '', password: '', sensitiveText: '', note: '',
      enabled: false, volume: 0, city: 0, columns: [0, 0], autoplay: false,
      showIf: true, showVShow: true, actionCount: 0,
      cities: [{ name: '杭州' }, { name: '上海' }],
      regions: ['浙江', '江苏'], periods: ['上午', '下午'],
      items: [{ id: 'sku-1', title: '商品一' }, { id: 'sku-2', title: '商品二' }],
      noIdItems: ['无 id 商品一', '无 id 商品二'],
      linkHref: '/pages/route/route?from=uni-link&case=dynamic',
      lastAction: '尚未操作。',
    }
  },
  methods: {
    mark(message) { this.actionCount += 1; this.lastAction = `第 ${this.actionCount} 次：${message}` },
    onAction(name) { this.mark(name) },
    onListAction(name) { this.mark(`动态列表：${name}`) },
    onNoIdListAction(name) { this.mark(`无 id 列表：${name}`) },
    onParentWithoutId() { this.mark('父节点无 id') },
    onZeroIndex() { this.mark('data-index=0') },
    onOptionsAction() { this.mark('Options API methods') },
    onConditionalIf() { this.mark('v-if 按钮') },
    onConditionalShow() { this.mark('v-show 按钮') },
    onToggleIf(event) { this.showIf = event.detail.value; this.mark(`v-if：${this.showIf ? '显示' : '隐藏'}`) },
    onToggleVShow(event) { this.showVShow = event.detail.value; this.mark(`v-show：${this.showVShow ? '显示' : '隐藏'}`) },
    onInputComplete() { this.mark('输入完成（页面不展示输入原文）') },
    onVolumeChange(event) { this.volume = event.detail.value; this.mark(`滑块：${this.volume}`) },
    onChoiceChange(event) { this.mark(`单选：${event.detail.value}`) },
    onTagsChange(event) { this.mark(`多选：${event.detail.value.join('、')}`) },
    onCityChange(event) { this.city = Number(event.detail.value); this.mark(`城市：${this.cities[this.city].name}`) },
    onColumnsChange(event) { this.columns = event.detail.value; this.mark(`多列下标：${this.columns.join('、')}`) },
    onSwiperChange(event) { this.mark(`轮播：${event.detail.current}，来源：${event.detail.source || '代码'}`) },
    onToggleAutoplay() { this.autoplay = !this.autoplay; this.mark(`自动轮播：${this.autoplay ? '开启' : '关闭'}`) },
    onSwitchChange(event) { this.enabled = event.detail.value; this.mark(`订阅开关：${this.enabled ? '开启' : '关闭'}`) },
    onIgnoredAction() { this.mark('ignore 按钮业务已执行') },
    onIgnoredChildAction() { this.mark('target ignore 业务已执行') },
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
