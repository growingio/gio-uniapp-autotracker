<template>
  <scroll-view class="page" scroll-y>
    <view class="section"><text class="title">数据采集开关 / setOptions</text><text class="hint">初始值为 false。只有 { dataCollect: boolean } 是当前允许在初始化后修改的配置；开启时会重建访问边界并回放当前 PAGE。</text></view>
    <view class="section">
      <text class="state">当前选择：{{ collecting ? '开启采集' : '关闭采集' }}</text>
      <switch :checked="collecting" data-title="采集开关" @change="toggle" />
      <button data-title="发送采集开关测试事件" @click="track">发送 datacollect_test_event</button>
      <button class="secondary" data-title="验证非法 setOptions 参数" @click="invalidOptions">验证非法参数</button>
    </view>
    <view class="section"><text class="result">{{ result }}</text></view>
  </scroll-view>
</template>

<script>
export default {
  data() { return { collecting: false, result: '默认关闭，尚未操作。' } },
  methods: {
    toggle(event) {
      const next = event.detail.value
      const ok = gdp('setOptions', { dataCollect: next })
      if (ok) this.collecting = next
      this.result = ok ? `setOptions({ dataCollect: ${next} }) 成功。` : 'setOptions 失败。'
    },
    track() { this.result = gdp('track', 'datacollect_test_event', { collecting: this.collecting }) ? '事件已入队。' : '事件未入队：采集关闭或 SDK 未就绪。' },
    invalidOptions() { this.result = gdp('setOptions', { dataCollect: 'yes' }) ? '异常：非法参数被接受。' : '非法参数已正确拒绝。' },
  },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.hint,.state,.result { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.state { margin-bottom:18rpx;font-size:28rpx;color:#1677ff; } .result { color:#1677ff;font-size:26rpx;line-height:1.5; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.secondary { background:#fff;color:#1677ff;border:1rpx solid #1677ff; }
</style>
