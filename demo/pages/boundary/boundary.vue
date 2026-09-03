<template>
  <scroll-view class="page" scroll-y>
    <view class="section">
      <text class="title">命令边界 / 失败安全</text>
      <text class="hint">这些调用故意覆盖 SDK 的拒绝边界。除“属性归一化”外，每次操作都应返回 false，且不会改变既有采集、身份或位置状态。</text>
    </view>
    <view class="section">
      <text class="section-title">初始化与公开命令</text>
      <button class="secondary" data-title="初始化后重复注册插件" @click="registerAfterInit">初始化后重复注册插件</button>
      <button class="secondary" data-title="调用未知公开命令" @click="unknownCommand">调用未知命令</button>
      <text class="hint">插件仅能在首次 init 前声明；SDK 不会向页面暴露 tracker，也不会接受未定义的 gdp 命令。</text>
    </view>
    <view class="section">
      <text class="section-title">参数校验</text>
      <button class="secondary" data-title="验证非法动态配置" @click="invalidOptions">验证非法 setOptions</button>
      <button class="secondary" data-title="验证非法身份值" @click="invalidUser">验证非法 userId</button>
      <button class="secondary" data-title="验证越界位置" @click="invalidLocation">验证越界位置</button>
      <button class="secondary" data-title="验证空事件名" @click="invalidEvent">验证空事件名</button>
    </view>
    <view class="section">
      <text class="section-title">属性归一化不是失败</text>
      <button data-title="发送属性过滤事件" @click="filteredAttributes">发送属性过滤事件</button>
      <text class="hint">开启采集后，该事件会入队；`kept` 与标量数组保留，嵌套对象和 NaN 会在 SDK 内剔除。请在 collector 中核对 attributes。</text>
    </view>
    <view class="section"><text class="result">{{ result }}</text></view>
  </scroll-view>
</template>

<script>
export default {
  data() { return { result: '尚未操作。' } },
  methods: {
    rejected(name, ok) { this.result = ok ? `${name}：异常，调用被接受。` : `${name}：已正确拒绝，返回 false。` },
    registerAfterInit() { this.rejected('初始化后 registerPlugins', gdp('registerPlugins', [{ name: 'gioEventAutoTracking' }])) },
    unknownCommand() { this.rejected('未知命令', gdp('not_a_public_command')) },
    invalidOptions() { this.rejected('setOptions({ dataCollect, debug })', gdp('setOptions', { dataCollect: true, debug: true })) },
    invalidUser() { this.rejected('setUserId(number)', gdp('setUserId', 12345)) },
    invalidLocation() { this.rejected('setLocation(91, 120)', gdp('setLocation', 91, 120)) },
    invalidEvent() { this.rejected('track(空事件名)', gdp('track', '', { ignored: true })) },
    filteredAttributes() {
      const ok = gdp('track', 'boundary_attribute_filter', {
        kept: 'yes',
        labels: ['demo', true, 1],
        nested: { mustBeDiscarded: true },
        nonFinite: Number.NaN,
      })
      this.result = ok
        ? '事件已入队：请在 collector 确认只保留 kept 和 labels。'
        : '未入队：先在“采集开关”页开启 dataCollect。'
    },
  },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.section-title,.hint,.result { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.section-title { font-size:28rpx;font-weight:600; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.result { color:#1677ff;font-size:26rpx;line-height:1.5; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.secondary { background:#fff;color:#1677ff;border:1rpx solid #1677ff; }
</style>
