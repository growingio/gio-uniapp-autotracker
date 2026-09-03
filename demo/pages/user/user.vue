<template>
  <scroll-view class="page" scroll-y>
    <view class="section">
      <text class="title">用户身份 / setUserId</text>
      <text class="hint">demo 已在初始化时启用 idMapping，因此 userKey 会随身份保存。身份切换会建立新的 session 边界。</text>
    </view>
    <view class="section">
      <text class="label">用户 ID</text>
      <input v-model="userId" data-growing-track data-title="用户 ID" placeholder="例如 demo-user-001" @blur="onInputBlur" />
      <text class="label">用户 Key（可选）</text>
      <input v-model="userKey" data-growing-track data-title="用户 Key" placeholder="例如 email" @blur="onInputBlur" />
      <button data-title="设置用户身份" @click="setUser">设置用户身份</button>
      <button class="secondary" data-title="清除用户身份" @click="clearUser">清除用户身份</button>
      <button class="secondary" data-title="设置用户属性" @click="setAttributes">设置示例用户属性</button>
      <button class="secondary" data-title="设置杭州位置" @click="setLocation">设置杭州位置</button>
      <button class="secondary" data-title="清除位置" @click="clearLocation">清除位置</button>
      <button class="secondary" data-title="验证非法身份值" @click="invalidUser">验证非字符串 userId</button>
      <button class="secondary" data-title="验证越界位置" @click="invalidLocation">验证越界位置</button>
    </view>
    <view class="section"><text class="result">{{ result }}</text></view>
  </scroll-view>
</template>

<script>
export default {
  data() {
    return { userId: 'demo-user-001', userKey: 'demo-key', result: '尚未操作。' }
  },
  methods: {
    onInputBlur() {},
    setUser() {
      const ok = gdp('setUserId', this.userId, this.userKey || null)
      this.result = ok ? '身份已更新；下一条事件会使用新的 userId。' : '身份未更新：userId 不能为空或 SDK 尚未就绪。'
    },
    clearUser() {
      const ok = gdp('clearUserId')
      this.result = ok ? '用户身份已清除。' : '清除失败：SDK 尚未就绪。'
    },
    setAttributes() {
      const ok = gdp('setUserAttributes', { membership: 'demo', source: 'user_page' })
      this.result = ok ? '用户属性事件已入队。' : '未入队：先开启采集开关。'
    },
    setLocation() { this.result = gdp('setLocation', 30.2741, 120.1551) ? '位置已设置；后续事件会携带经纬度。' : '位置未设置。' },
    clearLocation() { this.result = gdp('clearLocation') ? '位置已清除；后续事件不再携带经纬度。' : '位置清除失败：SDK 尚未就绪。' },
    invalidUser() { this.result = gdp('setUserId', 12345) ? '异常：非字符串 userId 被接受。' : '非字符串 userId 已正确拒绝，既有身份不会被清除。' },
    invalidLocation() { this.result = gdp('setLocation', 91, 120) ? '异常：越界位置被接受。' : '越界位置已正确拒绝，既有位置不会变化。' },
  },
}
</script>

<style>
.page { height: 100%; padding: 20rpx; box-sizing: border-box; }.section { margin-bottom: 20rpx; padding: 24rpx; border-radius: 12rpx; background: #fff; }.title,.hint,.label,.result { display:block; }.title { font-size:36rpx;font-weight:600;color:#222; }.hint { margin-top:14rpx;font-size:24rpx;color:#666;line-height:1.6; }.label { margin-top:20rpx;font-size:25rpx;color:#333; } input { margin-top:10rpx;padding:16rpx;border:1rpx solid #ddd;border-radius:8rpx;background:#fff; } button { margin-top:16rpx;background:#1677ff;color:#fff;font-size:26rpx; }.secondary { background:#fff;color:#1677ff;border:1rpx solid #1677ff; }.result { color:#1677ff;font-size:26rpx;line-height:1.5; }
</style>
