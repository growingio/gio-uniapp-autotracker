<template>
  <view class="syntax-card">
    <text class="syntax-title">setup() 返回别名</text>
    <button id="setup-alias-action" data-title="setup alias 按钮" @tap="submit">执行 setup alias handler</button>
    <text class="syntax-result">业务执行次数：{{ count }}</text>
    <text class="expected">预期：setup-alias-action#submit，记录模板可见名称 submit</text>
  </view>
</template>

<script>
import { ref } from 'vue'

export default {
  setup() {
    const count = ref(0)
    const saveOrder = () => { count.value += 1 }
    return { count, submit: saveOrder }
  },
}
</script>

<style>
.syntax-card { margin-top: 18rpx; padding: 18rpx; border: 1rpx solid #d9d9d9; border-radius: 10rpx; }
.syntax-title, .syntax-result, .expected { display: block; }
.syntax-title { font-size: 25rpx; font-weight: 600; }
.syntax-result { margin-top: 10rpx; font-size: 24rpx; color: #1677ff; }
.expected { margin-top: 8rpx; font-size: 22rpx; color: #777; line-height: 1.5; }
button { margin-top: 12rpx; background: #1677ff; color: #fff; font-size: 26rpx; }
</style>
