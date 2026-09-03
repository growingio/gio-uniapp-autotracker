<template>
  <scroll-view class="page" scroll-y>
    <view class="section"><text class="title">路由 / query / referralPage</text><text class="hint">当前页面的 query 会由 Page bridge 序列化；上一个 PAGE 会成为 referralPage。请在请求体中一起核对。</text></view>
    <view class="section"><text class="section-title">当前 query</text><text class="result">{{ queryText }}</text></view>
    <view class="section">
      <button data-title="刷新路由参数" @click="openNext">继续跳转（新 query）</button>
      <button class="secondary" data-title="返回首页" @click="backHome">返回首页</button>
    </view>
  </scroll-view>
</template>

<script>
export default {
  data() { return { queryText: '无 query。' } },
  onLoad(query) { this.queryText = Object.keys(query || {}).length ? JSON.stringify(query) : '无 query。' },
  methods: {
    openNext() { uni.navigateTo({ url: `/pages/route/route?from=route&step=${Date.now()}&tag=next` }) },
    backHome() { uni.switchTab({ url: '/pages/index/index' }) },
  },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.section-title,.hint,.result { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.section-title { font-size:28rpx;font-weight:600; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.result { margin-top:14rpx;color:#1677ff;font-size:24rpx;line-height:1.5;word-break:break-all; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.secondary { background:#fff;color:#1677ff;border:1rpx solid #1677ff; }
</style>
