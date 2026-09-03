<template>
  <view class="page">
    <text class="title">GrowingIO SDK 生命周期 Demo</text>
    <text class="description">App 与 Page 生命周期已接入 SDK bridge；默认禁用采集，避免向未配置的 collector 发送数据。</text>
    <text class="status">真机验证前，请在开发机运行 pnpm mock:collector，将 analytics.ts 中的账号、数据源和可访问的 collector 地址改为测试值，并显式开启 dataCollect。</text>
  </view>
</template>

<script>
import { gio } from '../../analytics'
import { createPageLifecycleBridge } from '../../../runtime/page-bridge'

let nextPageInstance = 1

export default {
  data() {
    return { gioPageBridge: null }
  },
  onLoad(query) {
    this.gioPageBridge = createPageLifecycleBridge(gio, `index-${nextPageInstance++}`)
    this.gioPageBridge.onLoad('pages/index/index', query, null)
  },
  onShow() {
    this.gioPageBridge?.onShow('GrowingIO SDK 生命周期 Demo')
  },
  onHide() {
    this.gioPageBridge?.onHide()
  },
  onUnload() {
    this.gioPageBridge?.onUnload()
  },
  onTabItemTap(options) {
    this.gioPageBridge?.onTabItemTap(options)
  },
}
</script>

<style>
.page {
  padding: 32rpx;
}

.title {
  display: block;
  font-size: 40rpx;
  font-weight: 600;
}

.description,
.status {
  display: block;
  margin-top: 24rpx;
  color: #4a5568;
  line-height: 1.6;
}
</style>
