import * as Vue from 'vue'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { transformAutoTrackSfc } from '../../autotrack/vite.js'
import { CHANGE_ELEMENTS, TEMPLATE_ELEMENTS } from '../../autotrack/contract.js'
import type { AppCapabilityProfile } from '../../platform/capabilities.js'

// 这里只描述受控测试宿主，绝不把测试通过写入生产平台的能力表。
export const testAutoTrackProfile: AppCapabilityProfile = {
  platform: 'Android', appLifecycle: false, pageLifecycle: false, autoClick: true, tabBar: true,
  changeInput: true, changePicker: true, appClosedBestEffort: false,
  autoChange: Object.fromEntries(CHANGE_ELEMENTS.map((element) => [element, true])) as AppCapabilityProfile['autoChange'],
}

type TestNode = { type: string; style: { display: string }; props: Record<string, unknown>; children: TestNode[]; parent: TestNode | null; text?: string }
function makeNode(type: string): TestNode { return { type, style: { display: '' }, props: {}, children: [], parent: null } }

export function mountAutoTrackSfc(source: string, dispatch: (...args: unknown[]) => unknown, modules: Record<string, unknown> = {}, instrument = true) {
  const transformed = instrument ? transformAutoTrackSfc(source, '@sdk/runtime') : { code: source, warnings: [], changed: false }
  const { descriptor } = parse(transformed.code)
  const script = compileScript(descriptor, { id: 'gio-test', genDefaultAs: '__Component' })
  const isTS = (descriptor.scriptSetup?.lang ?? descriptor.script?.lang) === 'ts'
  // 与 Vite Vue 插件一致，TypeScript 模板必须显式配置表达式解析插件。
  const template = compileTemplate({ source: descriptor.template?.content ?? '', filename: 'fixture.vue', id: 'gio-test', compilerOptions: { isTS, expressionPlugins: isTS ? ['typescript'] : [], bindingMetadata: script.bindings, isCustomElement: (tag) => (TEMPLATE_ELEMENTS as readonly string[]).includes(tag) } })
  if (template.errors.length > 0) throw new Error(String(template.errors[0]))
  const javascript = ts.transpileModule(`${script.content}\n${template.code}\n__Component.render=render;\nexport default __Component`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const output = { exports: {} as { default: Vue.Component } }
  const requireModule = (name: string): unknown => {
    if (name === 'vue') return Vue
    if (name === '@sdk/runtime') return { dispatchAutoTrack: dispatch }
    if (name in modules) return modules[name]
    throw new Error(`unexpected_fixture_import:${name}`)
  }
  new Function('require', 'module', 'exports', javascript)(requireModule, output, output.exports)
  const renderer = Vue.createRenderer<TestNode, TestNode>({
    createElement: makeNode, createText: (text) => ({ ...makeNode('#text'), text }), createComment: (text) => ({ ...makeNode('#comment'), text }),
    setText: (node, text) => { node.text = text }, setElementText: (node, text) => { node.text = text; node.children = [] },
    parentNode: (node) => node.parent, nextSibling: (node) => node.parent?.children[(node.parent.children.indexOf(node)) + 1] ?? null,
    insert: (node, parent, anchor = null) => {
      if (node.parent !== null) node.parent.children.splice(node.parent.children.indexOf(node), 1)
      const at = anchor === null ? parent.children.length : parent.children.indexOf(anchor)
      parent.children.splice(at, 0, node); node.parent = parent
    },
    remove: (node) => { node.parent?.children.splice(node.parent.children.indexOf(node), 1); node.parent = null },
    patchProp: (node, key, _previous, value) => { node.props[key] = value },
  })
  const root = makeNode('root')
  const app = renderer.createApp(output.exports.default)
  const instance = app.mount(root)
  function elements(): TestNode[] {
    const nodes: TestNode[] = []
    const visit = (parent: TestNode): void => { for (const child of parent.children) { nodes.push(child); visit(child) } }
    visit(root)
    return nodes
  }
  function fire(at: number, name: string, ...events: unknown[]): unknown {
    const handler = elements().filter((element) => typeof element.props[name] === 'function')[at]?.props[name]
    if (typeof handler !== 'function') throw new Error(`fixture_handler_missing:${name}:${at}`)
    return handler(...events)
  }
  return { transformed, instance, elements, fire, unmount: () => app.unmount() }
}
