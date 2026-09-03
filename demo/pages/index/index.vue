<template>
  <scroll-view class="page" scroll-y>
    <view class="header">
      <text class="title">GrowingIO uni-app SDK</text>
      <text class="subtitle">传统 uni-app Vue 3 feature showcase</text>
    </view>
    <view class="section">
      <text class="section-title">开始前</text>
      <text class="hint">默认 dataCollect=false，不会采集或发送数据。先启动 mock collector，并在「采集开关」页显式开启；真机须把 main.ts 中的 127.0.0.1 改为开发机局域网 IP。</text>
    </view>
    <view class="section">
      <text class="section-title">功能演示</text>
      <view v-for="item in items" :key="item.path" class="card" :data-title="item.title" :data-src="item.path" @click="go(item)">
        <text class="card-title">{{ item.title }}</text>
        <text class="card-desc">{{ item.description }}</text>
      </view>
    </view>
    <view class="section">
      <text class="section-title">当前能力边界</text>
      <text class="hint">已支持：生命周期、PAGE 上下文、自定义事件、用户身份与属性、dataCollect 开关，以及 Vue 3 原生组件无埋点。</text>
      <text class="hint">当前未实现：gioABTest、微信分享、.nvue 与 Vue 2 / Webpack 无埋点。SDK 不会伪造这些能力的成功结果。</text>
    </view>
    <view class="section">
      <text class="section-title">快捷动作</text>
      <button data-title="发送首页自定义事件" @click="trackQuick">发送 home_quick_track</button>
      <button class="secondary" data-title="带参数前往路由页" @click="goRoute">前往路由页（带参数）</button>
      <text class="hint">{{ note }}</text>
    </view>
  </scroll-view>
</template>

<script>
export default {
  data() {
    return {
      note: '建议同时打开控制台和 mock collector 观察事件。',
      items: [
        { path: 'custom-event', title: '① 自定义事件 / track', description: '发送业务事件和用户属性，观察属性归一化。' },
        { path: 'user', title: '② 用户身份 / setUserId', description: '设置、切换和清除用户身份及用户属性。' },
        { path: 'lifecycle', title: '③ 生命周期 / VISIT / PAGE / APP_CLOSED', description: '通过切页和前后台切换观察生命周期事件。' },
        { path: 'autotrack', title: '④ 无埋点 / VIEW_CLICK / VIEW_CHANGE', description: '由 Vite 插桩验证点击、变更、忽略和敏感值规则。' },
        { path: 'route', title: '⑤ 路由 / query / referralPage', description: '带 query 跳转，验证 PAGE 上下文。' },
        { path: 'datacollect', title: '⑥ 数据采集开关 / setOptions', description: '动态开启或关闭采集，并检查返回值。' },
      ],
    }
  },
  methods: {
    go(item) {
      const url = `/pages/${item.path}/${item.path}`
      if (['custom-event', 'user', 'autotrack'].includes(item.path)) uni.switchTab({ url })
      else uni.navigateTo({ url })
    },
    goRoute() {
      uni.navigateTo({ url: `/pages/route/route?from=index&tick=${Date.now()}&source=quick` })
    },
    trackQuick() {
      const queued = gdp('track', 'home_quick_track', { from: 'index', tick: Date.now() })
      this.note = queued ? '已入队 home_quick_track。' : '未入队：请先在采集开关页开启 dataCollect，并等待 SDK 就绪。'
    },
  },
}
</script>

<style>
.page { height: 100%; padding: 20rpx; box-sizing: border-box; }
.header { padding: 40rpx 20rpx; }
.title, .subtitle, .section-title, .hint, .card-title, .card-desc { display: block; }
.title { font-size: 40rpx; font-weight: 600; text-align: center; }
.subtitle { margin-top: 10rpx; font-size: 24rpx; color: #888; text-align: center; }
.section { margin-top: 20rpx; padding: 24rpx; border-radius: 12rpx; background: #fff; }
.section-title { margin-bottom: 18rpx; font-size: 28rpx; font-weight: 600; color: #333; }
.hint { font-size: 24rpx; color: #666; line-height: 1.6; }
.card { margin-top: 16rpx; padding: 24rpx; border: 1rpx solid #eee; border-radius: 10rpx; }
.card-title { font-size: 28rpx; color: #1677ff; }
.card-desc { margin-top: 8rpx; font-size: 24rpx; color: #666; line-height: 1.5; }
button { margin-top: 16rpx; background: #1677ff; color: #fff; font-size: 26rpx; }
.secondary { background: #fff; color: #1677ff; border: 1rpx solid #1677ff; }
</style>
