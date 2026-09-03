<template>
  <scroll-view class="page" scroll-y>
    <view class="section">
      <text class="title">生命周期 / VISIT / PAGE / APP_CLOSED</text>
      <text class="hint">SDK 在 main.ts 初始化时安装全局 lifecycle mixin，自动转发 onLaunch/onShow/onHide 与页面 onLoad/onShow/onHide/onUnload。切换页面可验证 PAGE，应用退后台可验证 APP_CLOSED。</text>
    </view>
    <view class="section">
      <button data-title="发送生命周期示例事件" @click="trackAction">发送 lifecycle_demo_action</button>
      <button class="secondary" data-title="前往路由演示页" @click="goRoute">带参前往路由页</button>
      <text class="result">{{ result }}</text>
    </view>
    <view class="section"><text class="hint">APP_CLOSED 只能在真实 App 切到后台时触发；浏览器或静态检查不能替代这项验证。</text></view>
  </scroll-view>
</template>

<script>
export default {
  data() { return { result: '尚未操作。' } },
  methods: {
    trackAction() { this.result = gdp('track', 'lifecycle_demo_action', { page: 'lifecycle' }) ? '事件已入队。' : '未入队：先开启采集开关。' },
    goRoute() { uni.navigateTo({ url: `/pages/route/route?from=lifecycle&tick=${Date.now()}` }) },
  },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.hint,.result { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.result { margin-top:18rpx;color:#1677ff;font-size:26rpx; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.secondary { background:#fff;color:#1677ff;border:1rpx solid #1677ff; }
</style>
