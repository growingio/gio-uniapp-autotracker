import { NodeTypes, parse, type ElementNode, type TemplateChildNode } from '@vue/compiler-dom'
import { parse as parseSfc } from '@vue/compiler-sfc'
import { parse as parseScript } from '@babel/parser'
import { CHANGE_ELEMENTS, TEMPLATE_ELEMENTS } from './contract.js'
import { containsProbe, expression, metadataExpression, node, rewriteHandler, walk } from './vite-handler.js'

export type AutoTrackTransformWarning = Readonly<{
  code: 'sfc_parse_error' | 'template_parse_error' | 'dynamic_event' | 'missing_handler' | 'event_modifiers' | 'custom_component' | 'unsupported_event' | 'complex_handler' | 'event_name_fallback' | '.nvue_not_instrumented'
  offset: number
}>
export type AutoTrackTemplateTransform = Readonly<{ code: string; warnings: readonly AutoTrackTransformWarning[]; changed: boolean }>
export type VueSfcTransform = AutoTrackTemplateTransform

type Replacement = Readonly<{ start: number; end: number; value: string }>
const inputEvents = ['change', 'blur', 'confirm']
const marker = '#__GIO_AUTOTRACK_V2__'
function literal(value: string): string { return JSON.stringify(value) }
function attribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;') }
function apply(source: string, replacements: Replacement[]): string {
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) source = source.slice(0, replacement.start) + replacement.value + source.slice(replacement.end)
  return source
}
function bound(element: ElementNode, name: string): string | null {
  for (const prop of element.props) {
    if (prop.type === NodeTypes.ATTRIBUTE && prop.name === name) return literal(prop.value?.content ?? '')
    if (prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION
      && prop.arg.isStatic && prop.arg.content === name && prop.exp?.type === NodeTypes.SIMPLE_EXPRESSION) return metadataExpression(prop.exp.content)
  }
  return null
}
function hasBound(element: ElementNode, name: string): boolean {
  return element.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind'
    && (prop.arg === undefined || prop.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !prop.arg.isStatic || prop.arg.content === name))
}
function sensitive(element: ElementNode): boolean {
  if (element.tag !== 'input' && element.tag !== 'textarea') return false
  return hasBound(element, 'type') || hasBound(element, 'password') || element.props.some((prop) => prop.type === NodeTypes.ATTRIBUTE
    && ((prop.name === 'type' && ['password', 'safe-password', 'file'].includes(prop.value?.content.toLowerCase() ?? ''))
      || (prop.name === 'password' && prop.value?.content !== 'false')))
}
function staticText(element: ElementNode): string | null {
  let value = ''
  for (const child of element.children) {
    if (child.type === NodeTypes.TEXT) value += child.content
    else if (child.type === NodeTypes.ELEMENT) { const nested = staticText(child); if (nested === null) return null; value += nested }
    else if (child.type !== NodeTypes.COMMENT) return null
  }
  return value.trim()
}

// picker-view 本身没有 range 属性；从固定列的简单选项模板取得 range，复杂渲染保留下标回退。
function pickerColumns(element: ElementNode): { range: string; key: string | null } | null {
  const ranges: string[] = []
  const keys: (string | null)[] = []
  for (const column of element.children) {
    if (column.type === NodeTypes.TEXT && column.content.trim() === '' || column.type === NodeTypes.COMMENT) continue
    if (column.type !== NodeTypes.ELEMENT || column.tag !== 'picker-view-column' || column.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && ['for', 'if'].includes(prop.name))) return null
    const options = column.children.filter((child) => child.type !== NodeTypes.COMMENT && !(child.type === NodeTypes.TEXT && child.content.trim() === ''))
    const option = options[0]
    const loop = option?.type === NodeTypes.ELEMENT ? option.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'for') : undefined
    if (options.length === 1 && option?.type === NodeTypes.ELEMENT && loop?.type === NodeTypes.DIRECTIVE && loop.exp?.type === NodeTypes.SIMPLE_EXPRESSION) {
      const match = /^\s*\(?\s*([\w$]+)(?:\s*,\s*[\w$]+)?\s*\)?\s+(?:in|of)\s+([\s\S]+)$/.exec(loop.exp.content)
      const range = match?.[2] === undefined ? null : metadataExpression(match[2])
      const content = option.children.filter((child) => !(child.type === NodeTypes.TEXT && child.content.trim() === ''))
      if (match === null || range === null || content.length !== 1 || content[0]?.type !== NodeTypes.INTERPOLATION || content[0].content.type !== NodeTypes.SIMPLE_EXPRESSION) return null
      const label = content[0].content.content.trim()
      if (label !== match[1] && !new RegExp(`^${match[1]?.replace(/\$/g, '\\$')}\\.[A-Za-z_$][\\w$]*$`).test(label)) return null
      ranges.push(range)
      keys.push(label === match[1] ? null : label.slice(label.indexOf('.') + 1))
    } else {
      const labels: string[] = []
      for (const child of options) {
        if (child.type !== NodeTypes.ELEMENT || child.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && ['for', 'if'].includes(prop.name))) return null
        const label = staticText(child)
        if (label === null) return null
        labels.push(literal(label))
      }
      ranges.push(`[${labels.join(',')}]`)
      keys.push(null)
    }
  }
  return ranges.length > 0 && keys.every((key) => key === keys[0]) ? { range: `[${ranges.join(',')}]`, key: keys[0] ?? null } : null
}
function probeFields(element: ElementNode, kind: 'click' | 'change', name: string): string {
  const fields = ['schemaVersion:2', 'source:"template"', `kind:${literal(kind)}`, `eventName:${literal(name)}`, `elementType:${literal(element.tag)}`]
  const names = { 'data-title': 'textValue', 'data-index': 'index', 'data-src': 'hyperlink', 'data-growing-ignore': 'ignored', 'data-growing-track': 'trackValue', 'data-growing-sensitive': 'sensitive' }
  for (const [prop, field] of Object.entries(names)) {
    if (field === 'sensitive' && sensitive(element)) continue
    const value = bound(element, prop)
    if (value !== null) fields.push(`${field}:${value}`)
  }
  if (sensitive(element)) fields.push('sensitive:true')
  if (element.tag === 'uni-link' && bound(element, 'data-src') === null) {
    const href = bound(element, 'href')
    if (href !== null) fields.push(`hyperlink:${href}`)
  }
  if (kind === 'change' && element.tag === 'picker') {
    const range = bound(element, 'range')
    const key = bound(element, 'range-key')
    if (range !== null) fields.push(`pickerRange:${range}`)
    if (key !== null) fields.push(`pickerRangeKey:${key}`)
  }
  if (kind === 'change' && element.tag === 'picker-view') {
    const columns = pickerColumns(element)
    if (columns !== null) { fields.push(`pickerRange:${columns.range}`); if (columns.key !== null) fields.push(`pickerRangeKey:${literal(columns.key)}`) }
  }
  return `{${fields.join(',')}}`
}
function openingEnd(element: ElementNode): number | null {
  let quote = ''
  for (let i = 0; i < element.loc.source.length; i++) {
    const char = element.loc.source[i]
    if (quote) { if (char === quote) quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '>') return element.loc.start.offset + (element.loc.source[i - 1] === '/' ? i - 1 : i)
  }
  return null
}
function visit(nodes: readonly TemplateChildNode[], dispatcher: string, replacements: Replacement[], warnings: AutoTrackTransformWarning[]): void {
  for (const element of nodes) {
    if (element.type !== NodeTypes.ELEMENT) continue
    const selected = inputEvents.find((name) => element.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'on' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic && prop.arg.content === name))
    let hasClick = false
    let hasDynamic = false
    for (const prop of element.props) {
      if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'on') continue
      const warn = (code: AutoTrackTransformWarning['code']): void => { warnings.push({ code, offset: prop.loc.start.offset }) }
      if (prop.arg?.type !== NodeTypes.SIMPLE_EXPRESSION || !prop.arg.isStatic) { hasDynamic = true; warn('dynamic_event'); continue }
      const nativeName = prop.arg.content
      const click = nativeName === 'click' || nativeName === 'tap'
      if (click) hasClick = true
      if (prop.exp?.type !== NodeTypes.SIMPLE_EXPRESSION || prop.exp.content.trim() === '') { warn('missing_handler'); continue }
      const parsed = expression(prop.exp.content)
      if (parsed !== null && containsProbe(parsed, dispatcher)) continue
      if (prop.modifiers.length > 0) { warn('event_modifiers'); continue }
      if (!(TEMPLATE_ELEMENTS as readonly string[]).includes(element.tag)) { warn('custom_component'); continue }
      if (!click && (!inputEvents.includes(nativeName) || !(CHANGE_ELEMENTS as readonly string[]).includes(element.tag)
        || (nativeName !== 'change' && element.tag !== 'input' && element.tag !== 'textarea'))) { warn('unsupported_event'); continue }
      if (!click && (element.tag === 'input' || element.tag === 'textarea') && nativeName !== selected) continue
      const rewritten = rewriteHandler(prop.exp.content, nativeName, dispatcher, (name) => `${dispatcher}(${probeFields(element, click ? 'click' : 'change', name)},$event)`)
      if (rewritten === null) { warn('complex_handler'); continue }
      if (rewritten.fallback) warn('event_name_fallback')
      const before = element.loc.source[prop.exp.loc.start.offset - element.loc.start.offset - 1]
      const escaped = attribute(rewritten.code)
      replacements.push({ start: prop.exp.loc.start.offset, end: prop.exp.loc.end.offset, value: before === '"' || before === "'" ? escaped : `"${escaped}"` })
    }
    if (element.tag === 'uni-link' && !hasClick && !hasDynamic) {
      const end = openingEnd(element)
      if (end !== null) replacements.push({ start: end, end, value: ` @click="${attribute(`${dispatcher}(${probeFields(element, 'click', 'openURL')},$event)`)}"` })
    }
    visit(element.children, dispatcher, replacements, warnings)
  }
}

export function transformAutoTrackTemplate(template: string, dispatcher = 'gioAutoTrack'): AutoTrackTemplateTransform {
  const warnings: AutoTrackTransformWarning[] = []
  let root
  try { root = parse(template, { onError: (error) => { warnings.push({ code: 'template_parse_error', offset: error.loc?.start.offset ?? 0 }) } }) }
  catch { return { code: template, warnings: [{ code: 'template_parse_error', offset: 0 }], changed: false } }
  if (warnings.length > 0) return { code: template, warnings, changed: false }
  const replacements: Replacement[] = []
  visit(root.children, dispatcher, replacements, warnings)
  return { code: apply(template, replacements), warnings, changed: replacements.length > 0 }
}

export function transformAutoTrackSfc(source: string, runtimeImport = 'gio-uniapp-autotracker/autotrack'): VueSfcTransform {
  const parsed = parseSfc(source)
  if (parsed.errors.length > 0) return { code: source, changed: false, warnings: parsed.errors.map((error) => ({ code: 'sfc_parse_error', offset: typeof error === 'object' && 'loc' in error ? error.loc?.start.offset ?? 0 : 0 })) }
  const { template, script, scriptSetup } = parsed.descriptor
  if (template === null) return { code: source, warnings: [], changed: false }
  if (template.src || (template.lang && template.lang !== 'html') || scriptSetup?.src || script?.src) return { code: source, changed: false, warnings: [{ code: 'sfc_parse_error', offset: template.loc.start.offset }] }
  let existing: string | null = null
  let setupDefault: { start: number; end: number } | null = null
  try {
    for (const block of [scriptSetup, script]) {
      if (block === null) continue
      const ast = parseScript(block.content, { sourceType: 'module', plugins: ['typescript'] })
      for (const entry of ast.program.body) {
        if (block === script && scriptSetup === null && entry.type === 'ExportDefaultDeclaration') {
          let hasSetup = entry.declaration.type !== 'ObjectExpression'
          walk(entry.declaration, (value) => { if ((value.type === 'SpreadElement' || ['ObjectMethod', 'ObjectProperty'].includes(value.type)) && (value.type === 'SpreadElement' || node(value.key)?.name === 'setup' || value.computed || node(value.key)?.value === 'setup')) hasSetup = true })
          if (hasSetup && entry.declaration.start != null && entry.declaration.end != null) setupDefault = { start: entry.declaration.start, end: entry.declaration.end }
        }
        if (entry.type !== 'ImportDeclaration' || entry.source.value !== runtimeImport || !entry.leadingComments?.some((comment) => comment.value.trim() === marker)) continue
        for (const specifier of entry.specifiers) if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && specifier.imported.name === 'dispatchAutoTrack') existing = specifier.local.name
      }
    }
  } catch { return { code: source, warnings: [{ code: 'sfc_parse_error', offset: scriptSetup?.loc.start.offset ?? script?.loc.start.offset ?? 0 }], changed: false } }
  const names = new Set(source.match(/[A-Za-z_$][\w$]*/g) ?? [])
  let dispatcher = 'gioAutoTrack'
  for (let suffix = 1; [...names].some((name) => name.startsWith(dispatcher)); suffix++) dispatcher = `gioAutoTrack${suffix}`
  dispatcher = existing ?? dispatcher
  const transformed = transformAutoTrackTemplate(template.content, dispatcher)
  const warnings = transformed.warnings.map((warning) => ({ ...warning, offset: warning.offset + template.loc.start.offset }))
  if (!transformed.changed) return { code: source, warnings, changed: false }
  const replacements: Replacement[] = [{ start: template.loc.start.offset, end: template.loc.end.offset, value: transformed.code }]
  if (existing === null) {
    const imported = `\n/* ${marker} */\nimport { dispatchAutoTrack as ${dispatcher} } from ${literal(runtimeImport)}\n`
    if (scriptSetup !== null) replacements.push({ start: scriptSetup.loc.start.offset, end: scriptSetup.loc.start.offset, value: imported })
    else if (script !== null && setupDefault !== null) {
      // 普通 setup 必须原样保留（包括 reactive、异步和 render 返回值），通过独立 methods 绑定暴露探针。
      const component = `${dispatcher}Component`
      const original = script.content.slice(setupDefault.start, setupDefault.end)
      const wrapped = `((${component})=>({...${component},methods:{...${component}.methods,${dispatcher}}}))(${original})`
      replacements.push({ start: script.loc.start.offset, end: script.loc.start.offset, value: imported })
      replacements.push({ start: script.loc.start.offset + setupDefault.start, end: script.loc.start.offset + setupDefault.end, value: wrapped })
    } else replacements.push({ start: 0, end: 0, value: `<script setup${script?.lang ? ` lang="${attribute(script.lang)}"` : ''}>${imported}</script>\n` })
  }
  return { code: apply(source, replacements), warnings, changed: true }
}

export type UniAppAutoTrackViteContext = Readonly<{ warn?: (message: string) => void }>
export type UniAppAutoTrackVitePlugin = Readonly<{ name: string; enforce: 'pre'; transform: (this: UniAppAutoTrackViteContext | void, source: string, id: string) => Readonly<{ code: string }> | null }>
export type UniAppAutoTrackViteOptions = Readonly<{ enabled?: boolean; runtimeImport?: string }>
export function gioUniappAutoTrack(options?: string | UniAppAutoTrackViteOptions): UniAppAutoTrackVitePlugin {
  const runtimeImport = typeof options === 'string' ? options : options?.runtimeImport ?? 'gio-uniapp-autotracker/autotrack'
  return {
    name: 'gio-uniapp-autotrack', enforce: 'pre',
    transform(source, id) {
      if (typeof options !== 'string' && options?.enabled === false) return null
      if (id.endsWith('.nvue')) { this?.warn?.(`[gio-uniapp-autotrack] ${id}:0 .nvue_not_instrumented`); return null }
      if (!id.endsWith('.vue')) return null
      const result = transformAutoTrackSfc(source, runtimeImport)
      for (const warning of result.warnings) this?.warn?.(`[gio-uniapp-autotrack] ${id}:${warning.offset} ${warning.code}`)
      return result.changed ? { code: result.code } : null
    },
  }
}
