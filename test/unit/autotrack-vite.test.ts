import { describe, expect, it } from 'vitest'
import { compile } from '@vue/compiler-dom'

import { gioUniappAutoTrack, transformAutoTrackSfc, transformAutoTrackTemplate } from '../../autotrack/vite.js'

describe('transformAutoTrackTemplate', () => {
  it('uses Vue AST locations to prefix a static click handler while retaining its original expression', () => {
    const result = transformAutoTrackTemplate('<view @click="submit(item)">Buy</view><input @change="change" />')
    expect(result.changed).toBe(true)
    expect(result.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`},$event);submit(item)')
    expect(result.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`change`,xpath:`/input[1]`},$event);change($event)')
  })

  it('does not rewrite dynamic, modifier, or missing handler directives', () => {
    const source = '<view v-on:[event]="go" @click.stop="go" @change></view>'
    const result = transformAutoTrackTemplate(source)
    expect(result).toMatchObject({ code: source, changed: false })
    expect(result.warnings.map((warning) => warning.code)).toStrictEqual(['dynamic_event', 'event_modifiers', 'missing_handler'])
  })

  it('keeps custom components and unsupported component events unchanged with explicit warnings', () => {
    const source = '<business-card @click="open" /><view @change="change" /><button @tap="tap" />'
    const result = transformAutoTrackTemplate(source)
    expect(result.code).toContain('<business-card @click="open" />')
    expect(result.code).toContain('<view @change="change" />')
    expect(result.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/button[1]`},$event);tap($event)')
    expect(result.warnings.map((warning) => warning.code)).toStrictEqual(['custom_component', 'unsupported_event'])
  })

  it('wraps listener-valued arrow and conditional expressions without swallowing their return path', () => {
    const result = transformAutoTrackTemplate('<view @click="() => save()" /><view @click="ready ? save : cancel" />')
    expect(result.code).toContain('($event)=>{__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`},$event);return (() => save())($event)}')
    expect(result.code).toContain('($event)=>{__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[2]`},$event);return (ready ? save : cancel)($event)}')
    expect(compile(result.code, { mode: 'module' }).code).toContain('return (() => _ctx.save())($event)')
  })

  it('keeps complex inline expressions unchanged when they cannot be safely classified', () => {
    const source = '<view @click="items.map(item => select(item))" />'
    const result = transformAutoTrackTemplate(source)
    expect(result).toMatchObject({ code: source, changed: false })
    expect(result.warnings.map((warning) => warning.code)).toStrictEqual(['complex_handler'])
  })

  it('forwards only static privacy-safe metadata and marks sensitive controls', () => {
    const result = transformAutoTrackTemplate('<input type="password" data-growing-track data-title="secret" @change="save"><view data-growing-ignore data-index="0" data-src="/detail" @click="go" /></input>')
    expect(result.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`change`,xpath:`/input[1]`,trackValue:true,sensitive:true,textValue:`secret`},$event);save($event)')
    expect(result.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`,ignored:true,index:0,hyperlink:`/detail`},$event);go($event)')
  })

  it('uses one deterministic input completion callback and supports a standalone confirm handler', () => {
    const deduped = transformAutoTrackTemplate('<input @change="change" @blur="blur" @confirm="confirm" />')
    expect(deduped.code).toContain('@change="__gioAutoTrack({schemaVersion:1,kind:`change`,xpath:`/input[1]`},$event);change($event)"')
    expect(deduped.code).toContain('@blur="blur"')
    expect(deduped.code).toContain('@confirm="confirm"')

    const confirmOnly = transformAutoTrackTemplate('<textarea @confirm="confirm" />')
    expect(confirmOnly.code).toContain('@confirm="__gioAutoTrack({schemaVersion:1,kind:`change`,xpath:`/textarea[1]`},$event);confirm($event)"')
  })

  it('adds a click-only probe for uni-link without a business handler', () => {
    const result = transformAutoTrackTemplate('<uni-link data-title="Docs" />')
    expect(result.code).toContain('<uni-link data-title="Docs"  @click="__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/uni-link[1]`,textValue:`Docs`},$event)"/>')
    expect(compile(result.code, { mode: 'module' }).code).toContain('onClick')
  })

  it('adds a setup block for an Options API SFC, so transformed template handlers can resolve the dispatcher', () => {
    const source = '<template><view @click="go">Go</view></template><script>export default {}</script>'
    const transformed = transformAutoTrackSfc(source, '@sdk/runtime')
    expect(transformed.changed).toBe(true)
    expect(transformed.code).toContain('<script setup>\nimport { dispatchAutoTrack as __gioAutoTrack } from "@sdk/runtime"\n</script>\n<template>')
    expect(transformed.code).toContain('<script>export default {}</script>')
    expect(transformed.code).toContain('__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`},$event);go($event)')
    expect(transformAutoTrackSfc(transformed.code, '@sdk/runtime').code.match(/dispatchAutoTrack as __gioAutoTrack/g)).toHaveLength(1)
  })

  it('keeps the dispatcher import inside an existing setup script', () => {
    const source = '<template><view @click="go">Go</view></template><script setup>const go = () => undefined</script>'
    const transformed = transformAutoTrackSfc(source, '@sdk/runtime')
    expect(transformed.code).toContain('<script setup>\nimport { dispatchAutoTrack as __gioAutoTrack } from "@sdk/runtime"\nconst go')
  })

  it('keeps the rewritten event handler compilable as a Vue template expression', () => {
    const transformed = transformAutoTrackTemplate('<view data-title="Buy" @click="submit(item)">Buy</view>')
    const compiled = compile(transformed.code, { mode: 'module' })
    expect(compiled.code).toContain('export function render')
    expect(compiled.code).toContain('_ctx.__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`,textValue:`Buy`},$event);_ctx.submit(_ctx.item)')
  })

  it('continues to invoke a bare method reference with the native event', () => {
    const transformed = transformAutoTrackTemplate('<view @click="go">Go</view>')
    const compiled = compile(transformed.code, { mode: 'module' })
    expect(compiled.code).toContain('_ctx.__gioAutoTrack({schemaVersion:1,kind:`click`,xpath:`/view[1]`},$event);_ctx.go($event)')
  })

  it('exposes a pre Vite plugin and ignores non-Vue input', () => {
    const plugin = gioUniappAutoTrack('@sdk/runtime')
    expect(plugin).toMatchObject({ name: 'gio-uniapp-autotrack', enforce: 'pre' })
    expect(plugin.transform('const a = 1', 'entry.ts')).toBeNull()
  })

  it('supports the documented options form and can disable transformation', () => {
    const disabled = gioUniappAutoTrack({ enabled: false })
    expect(disabled.transform('<template><view @click="go" /></template>', 'page.vue')).toBeNull()
    const defaultPlugin = gioUniappAutoTrack()
    expect(defaultPlugin.transform('<template><view @click="go" /></template>', 'page.vue')?.code).toContain('from "gio-uniapp-autotracker/autotrack"')
    const configured = gioUniappAutoTrack({ runtimeImport: '@sdk/runtime' })
    expect(configured.transform('<template><view @click="go" /></template>', 'page.vue')?.code).toContain('from "@sdk/runtime"')
  })

  it('does not instrument nvue templates and emits an explicit build warning', () => {
    const plugin = gioUniappAutoTrack()
    const warnings: string[] = []
    expect(plugin.transform.call({ warn: (message: string) => warnings.push(message) }, '<view @click="go" />', 'page.nvue')).toBeNull()
    expect(warnings).toStrictEqual(['[gio-uniapp-autotrack] .nvue is not instrumented in 1.0: page.nvue'])
  })
})
