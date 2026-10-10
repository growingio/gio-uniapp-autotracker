<template>
  <button id="boundary-emit-inner" data-growing-ignore @tap="emitClick($event)">自定义组件 emit：只执行业务</button>
</template>

<script>
export default {
  emits: ['click'],
  methods: { emitClick(event) { this.$emit('click', event) } },
}
</script>

<style>
button { margin-top: 16rpx; background: #1677ff; color: #fff; font-size: 26rpx; }
</style>
