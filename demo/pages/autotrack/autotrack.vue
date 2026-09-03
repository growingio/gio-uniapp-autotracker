<template>
  <scroll-view class="page" scroll-y>
    <view class="section">
      <text class="title">无埋点 / VIEW_CLICK / VIEW_CHANGE</text>
      <text class="hint">此页依赖 vite.config.ts 中的 gioUniappAutoTrack。所有示例仍会执行自己的业务 handler；采集由编译期插桩调用 dispatcher，不将原生事件写入队列。</text>
    </view>
    <view class="section">
      <text class="section-title">点击与 dataset</text>
      <button data-title="普通无埋点按钮" data-index="1" data-src="/pages/autotrack/autotrack?case=plain" @click="onAction('普通点击')">普通点击</button>
      <view class="tap-card" data-title="嵌套卡片" data-index="2" @tap="onAction('嵌套卡片')"><text>点击这张带 dataset 的卡片</text></view>
      <button data-growing-ignore data-title="必须忽略的按钮" @click="onAction('已忽略点击')">data-growing-ignore（业务仍执行）</button>
    </view>
    <view class="section">
      <text class="section-title">变更与隐私</text>
      <text class="label">显式允许采集值的普通输入</text>
      <input v-model="nickname" data-growing-track data-title="昵称" placeholder="输入昵称后失焦" @blur="onInputComplete" />
      <text class="label">密码输入（永不采集值）</text>
      <input v-model="password" type="password" data-growing-track data-title="密码" placeholder="输入后失焦" @blur="onInputComplete" />
      <switch :checked="enabled" data-growing-track data-title="订阅开关" @change="onSwitchChange" />
    </view>
    <view class="section"><text class="result">{{ lastAction }}</text><text class="hint">开启采集后，普通点击和带 track 标记的变更应产生事件；ignore 与 password 不应携带可识别的值。</text></view>
  </scroll-view>
</template>

<script>
export default {
  data() { return { nickname: '', password: '', enabled: false, lastAction: '尚未操作。' } },
  methods: {
    onAction(name) { this.lastAction = `业务 handler 已执行：${name}` },
    onInputComplete() { this.lastAction = '输入完成；请对照控制台或 collector，密码值不应出现在事件中。' },
    onSwitchChange(event) { this.enabled = event.detail.value; this.lastAction = `订阅开关已变为：${this.enabled ? '开启' : '关闭'}` },
  },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.section-title,.hint,.label,.result { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.section-title { font-size:28rpx;font-weight:600; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.label { margin-top:20rpx;font-size:25rpx;color:#333; } input { margin-top:10rpx;padding:16rpx;border:1rpx solid #ddd;border-radius:8rpx;background:#fff; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.tap-card { margin-top:16rpx;padding:24rpx;border:1rpx solid #91caff;border-radius:10rpx;color:#1677ff; }.result { color:#1677ff;font-size:26rpx;line-height:1.5; }
</style>
