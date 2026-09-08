import { describe, expect, it } from 'vitest'
import { mountAutoTrackSfc } from '../support/autotrack-fixture.js'
import { transformAutoTrackSfc } from '../../autotrack/vite.js'

describe('无埋点不得改变 Vue listener 的业务语义', () => {
  it.each(['save!', 'save as Handler', '(save as Handler)!', 'save satisfies Handler', 'save<string>'])('TypeScript 函数引用保持 Vue 的原始调用：%s', (handler) => {
    const source = `<script setup lang="ts">import { save } from 'fixture'; type Handler = (...args: any[]) => unknown</script><template><button @click="${handler}" /></template>`
    expect(transformAutoTrackSfc(source).code).toBe(source)
    const run = (instrument: boolean) => {
      const calls: unknown[][] = []
      const save = (...values: unknown[]) => { calls.push(values); return values.length }
      const fixture = mountAutoTrackSfc(source, () => { throw new Error('不应采集') }, { fixture: { save } }, instrument)
      try { return { result: fixture.fire(0, 'onClick', 'event', 'second'), calls } }
      finally { fixture.unmount() }
    }
    const original = run(false)
    expect(original.calls).toEqual([['event', 'second']])
    expect(run(true)).toEqual(original)
  })

  it('动态元数据和组件 getter 的读取次数、发生时机与原始 Vue 一致', () => {
    const run = (instrument: boolean) => {
      const calls: string[] = []
      const model = { get title() { calls.push('title'); return '业务标题' }, get range() { calls.push('range'); return ['a', 'b'] } }
      const source = `<script>import { model, calls } from 'fixture'; export default { get custom() { calls.push('options-getter'); return 1 }, setup() { return { model, save: () => calls.push('business') } } }</script><template><picker :range="model.range" :data-title="model.title" @change="save($event)" /></template>`
      const fixture = mountAutoTrackSfc(source, () => undefined, { fixture: { model, calls } }, instrument)
      const afterRender = [...calls]
      fixture.fire(0, 'onChange', {})
      fixture.unmount()
      return { afterRender, calls }
    }
    expect(run(true)).toEqual(run(false))
  })

  it.each([
    '<script>import component from "fixture"; export default component</script>',
    '<script>export default { setup() {}, get methods() { throw new Error("业务 getter") } }</script>',
    '<script>import methods from "fixture"; export default { methods }</script>',
  ])('不能安全插入 dispatcher 的组件保持整份源码不变', (script) => {
    const source = `${script}<template><button @click="save($event)" /></template>`
    const result = transformAutoTrackSfc(source)
    expect(result.code).toBe(source)
    expect(result.warnings.some((warning) => warning.code === 'complex_component_options')).toBe(true)
  })

  it('严格模式函数保留指令位置，空值和 handler 数组引用不被包装', () => {
    for (const handler of ["function(e) { 'use strict'; return this }", 'handlers', 'empty']) {
      const source = `<script setup>const handlers = [() => 1, () => 2]; const empty = null</script><template><button @click="${handler}" /></template>`
      expect(transformAutoTrackSfc(source).code).toBe(source)
    }
  })

  it.each([
    'save', 'actions.save', 'save($event)', 'actions.save($event)',
    '(first, second) => save(first, second)', 'function(first, second) { return save(first, second) }',
    'ready() ? save : cancel', 'ready() ? save($event) : cancel($event)',
    'ready() ? e => save(e) : e => cancel(e)', 'count++',
  ])('对照原始 listener：%s', (handler) => {
    const run = (instrument: boolean) => {
      const calls: unknown[] = []
      const actions = { save: function(this: unknown, ...args: unknown[]) { calls.push(['actions', this === actions, args]); return args.length } }
      const save = (...args: unknown[]) => { calls.push(['save', args]); return args.length }
      const cancel = (...args: unknown[]) => { calls.push(['cancel', args]); return args.length }
      let condition = true
      const ready = () => { calls.push(['condition']); condition = !condition; return condition }
      const source = `<script setup>import { save, cancel, actions, ready } from 'fixture'; let count = 0</script><template><button @click="${handler}" /></template>`
      const fixture = mountAutoTrackSfc(source, () => { throw new Error('采集失败') }, { fixture: { save, cancel, actions, ready } }, instrument)
      const returned = [fixture.fire(0, 'onClick', 'event', 'extra'), fixture.fire(0, 'onClick', 'event2', 'extra2')]
        .map((value) => typeof value === 'function' ? ['function', value('later')] : value)
      fixture.unmount()
      return { calls, returned }
    }
    expect(run(true)).toEqual(run(false))
  })

  it('业务抛出的异常保持原对象，采集失败不能阻断业务', () => {
    const failure = new Error('业务异常')
    for (const instrument of [false, true]) {
      const fixture = mountAutoTrackSfc(`<script setup>import { save } from 'fixture'</script><template><button @click="save($event)" /></template>`,
        () => { throw new Error('采集异常') }, { fixture: { save: () => { throw failure } } }, instrument)
      let caught: unknown
      try { fixture.fire(0, 'onClick', {}) } catch (error) { caught = error }
      expect(caught).toBe(failure)
      fixture.unmount()
    }
  })
})
