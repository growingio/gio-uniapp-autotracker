<template>
  <scroll-view class="page" scroll-y>
    <view class="section"><text class="title">与 uni-app x showcase 的能力对齐</text><text class="hint">这里展示真实能力边界，而非用静态 UI 假装接口已经存在。</text></view>
    <view class="section"><text class="section-title">已可演示</text><text class="item">✓ 生命周期、PAGE 上下文、自定义事件、用户身份与属性、dataCollect 开关、Vue 3 原生组件无埋点。</text></view>
    <view class="section"><text class="section-title">当前未实现</text><text class="item">— gioABTest：传统 SDK 当前没有插件或 getABTest API。</text><text class="item">— 微信分享：此 SDK 的首期范围是 Android、iOS、HarmonyOS App，未实现小程序分享采集。</text><text class="item">— .nvue、Vue 2 / Webpack：不在一期无埋点插桩范围。</text></view>
    <view class="section"><button data-title="返回首页" @click="backHome">返回首页</button></view>
  </scroll-view>
</template>

<script>
export default {
  methods: { backHome() { uni.switchTab({ url: '/pages/index/index' }) } },
}
</script>

<style>
.page { height:100%;padding:20rpx;box-sizing:border-box; }.section { margin-bottom:20rpx;padding:24rpx;border-radius:12rpx;background:#fff; }.title,.section-title,.hint,.item { display:block; }.title { font-size:34rpx;font-weight:600;color:#222; }.section-title { font-size:28rpx;font-weight:600;color:#333; }.hint,.item { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; } button { background:#1677ff;color:#fff;font-size:26rpx; }
</style>
