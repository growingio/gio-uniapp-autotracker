import { NodeTypes, parse, type ElementNode, type RootNode, type TemplateChildNode } from '@vue/compiler-dom'

export type AutoTrackTransformWarning = Readonly<{
  code: 'dynamic_event' | 'missing_handler' | 'event_modifiers' | 'custom_component' | 'unsupported_event' | 'complex_handler'
  offset: number
}>
export type AutoTrackTemplateTransform = Readonly<{ code: string; warnings: readonly AutoTrackTransformWarning[]; changed: boolean }>
export type VueSfcTransform = Readonly<{ code: string; warnings: readonly AutoTrackTransformWarning[]; changed: boolean }>

type Replacement = Readonly<{ start: number; end: number; value: string }>

const supportedElements = new Set([
  'view', 'text', 'image', 'button', 'navigator', 'uni-link', 'scroll-view', 'swiper', 'swiper-item',
  'input', 'textarea', 'switch', 'slider', 'radio', 'radio-group', 'checkbox', 'checkbox-group',
  'picker', 'picker-view', 'picker-view-column', 'label', 'icon', 'progress', 'rich-text', 'form', 'editor',
])
const changeElements = new Set(['input', 'textarea', 'switch', 'slider', 'radio-group', 'checkbox-group', 'picker', 'picker-view', 'swiper'])
const inputChangeEvents = new Set(['change', 'blur', 'confirm'])

function escape(value: string): string { return JSON.stringify(value) }
function templateLiteral(value: string): string {
  return `\`${value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')}\``
}

type StaticProbeMetadata = Readonly<{
  ignored: boolean
  trackValue: boolean
  sensitive: boolean
  textValue: string | null
  index: number | null
  hyperlink: string | null
}>

function staticProbeMetadata(element: ElementNode): StaticProbeMetadata {
  let ignored = false
  let trackValue = false
  let sensitive = false
  let textValue: string | null = null
  let index: number | null = null
  let hyperlink: string | null = null
  let inputType: string | null = null
  let hasBoundType = false
  for (const prop of element.props) {
    if (prop.type === NodeTypes.ATTRIBUTE) {
      if (prop.name === 'data-growing-ignore') ignored = true
      if (prop.name === 'data-growing-track') trackValue = true
      if (prop.name === 'data-growing-sensitive') sensitive = true
      if (prop.name === 'data-title') textValue = prop.value?.content ?? null
      if (prop.name === 'data-src') hyperlink = prop.value?.content ?? null
      if (prop.name === 'data-index') {
        const candidate = Number(prop.value?.content)
        index = Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : null
      }
      if (prop.name === 'type') inputType = prop.value?.content?.toLowerCase() ?? ''
      continue
    }
    if (prop.name === 'bind' && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic && prop.arg.content === 'type') hasBoundType = true
  }
  if ((element.tag === 'input' || element.tag === 'textarea') && (hasBoundType || inputType === 'password' || inputType === 'file')) sensitive = true
  return { ignored, trackValue, sensitive, textValue, index, hyperlink }
}

function probeCall(kind: 'click' | 'change', xpath: string, metadata: StaticProbeMetadata): string {
  const fields = ['schemaVersion:1', `kind:${templateLiteral(kind)}`, `xpath:${templateLiteral(xpath)}`]
  if (metadata.ignored) fields.push('ignored:true')
  if (metadata.trackValue) fields.push('trackValue:true')
  if (metadata.sensitive) fields.push('sensitive:true')
  if (metadata.textValue !== null) fields.push(`textValue:${templateLiteral(metadata.textValue)}`)
  if (metadata.index !== null) fields.push(`index:${metadata.index}`)
  if (metadata.hyperlink !== null) fields.push(`hyperlink:${templateLiteral(metadata.hyperlink)}`)
  return `{${fields.join(',')}}`
}

/** Vue treats a bare method reference as an event listener; after prefixing it must still be called. */
function rewrittenHandler(probe: string, original: string): string {
  const expression = original.trim()
  const isMethodReference = methodReference(expression)
  return isMethodReference ? `${probe};${expression}($event)` : `${probe};${original}`
}

function methodReference(expression: string): boolean {
  return /^[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*$/.test(expression)
}

function isArrowListener(expression: string): boolean {
  return /^(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(expression.trim())
}

function isConditionalListener(expression: string): boolean {
  const match = /^.+?\?\s*(.+?)\s*:\s*(.+)$/.exec(expression.trim())
  return match !== null && (methodReference(match[1] ?? '') || isArrowListener(match[1] ?? ''))
    && (methodReference(match[2] ?? '') || isArrowListener(match[2] ?? ''))
}

function handlerRewrite(probe: string, original: string): string | null {
  const expression = original.trim()
  if (isArrowListener(expression) || isConditionalListener(expression)) {
    // These expressions produce an event listener value. Invoke that value after the probe so its
    // parameter, return value and thrown error retain the original listener semantics.
    return `($event)=>{${probe};return (${expression})($event)}`
  }
  if (expression.includes('=>') || expression.includes('?')) return null
  return rewrittenHandler(probe, original)
}

function openingTagEnd(element: ElementNode): number | null {
  const source = element.loc.source
  let quote: '"' | "'" | null = null
  for (let offset = 0; offset < source.length; offset += 1) {
    const character = source[offset]
    if (quote !== null) {
      if (character === quote) quote = null
      continue
    }
    if (character === '"' || character === "'") { quote = character; continue }
    if (character === '>') return element.loc.start.offset + offset
  }
  return null
}

function selectedChangeEvent(element: ElementNode): string | null {
  // When one input declares more than one completion callback, use one deterministic probe rather
  // than letting change/blur/confirm create three indistinguishable VIEW_CHANGE records.
  for (const name of ['change', 'blur', 'confirm']) {
    if (element.props.some((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'on'
      && prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION && prop.arg.isStatic && prop.arg.content === name)) return name
  }
  return null
}

function visit(nodes: readonly TemplateChildNode[], parentPath: string, replacements: Replacement[], warnings: AutoTrackTransformWarning[]): void {
  const occurrences = new Map<string, number>()
  for (const node of nodes) {
    if (node.type !== NodeTypes.ELEMENT) continue
    const element = node as ElementNode
    const index = (occurrences.get(element.tag) ?? 0) + 1
    occurrences.set(element.tag, index)
    const xpath = `${parentPath}/${element.tag}[${index}]`
    const metadata = staticProbeMetadata(element)
    const selectedInputChangeEvent = selectedChangeEvent(element)
    let hasClickHandler = false
    let hasDynamicEvent = false
    for (const prop of element.props) {
      if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'on') continue
      if (prop.arg === undefined || prop.arg.type !== NodeTypes.SIMPLE_EXPRESSION || !prop.arg.isStatic) { hasDynamicEvent = true; warnings.push({ code: 'dynamic_event', offset: prop.loc.start.offset }); continue }
      if (prop.arg.content !== 'click' && prop.arg.content !== 'tap' && !inputChangeEvents.has(prop.arg.content)) continue
      if (prop.arg.content === 'click' || prop.arg.content === 'tap') hasClickHandler = true
      if (prop.exp === undefined || prop.exp.type !== NodeTypes.SIMPLE_EXPRESSION) { warnings.push({ code: 'missing_handler', offset: prop.loc.start.offset }); continue }
      if (prop.modifiers.length > 0) { warnings.push({ code: 'event_modifiers', offset: prop.loc.start.offset }); continue }
      const probe = `__gioAutoTrack(${probeCall(prop.arg.content === 'click' || prop.arg.content === 'tap' ? 'click' : 'change', xpath, metadata)},$event)`
      const rewritten = handlerRewrite(probe, prop.exp.content)
      if (rewritten === null) { warnings.push({ code: 'complex_handler', offset: prop.loc.start.offset }); continue }
      if (!supportedElements.has(element.tag)) { warnings.push({ code: 'custom_component', offset: prop.loc.start.offset }); continue }
      if (inputChangeEvents.has(prop.arg.content)) {
        const supportsEvent = prop.arg.content === 'change' ? changeElements.has(element.tag) : element.tag === 'input' || element.tag === 'textarea'
        if (!supportsEvent) { warnings.push({ code: 'unsupported_event', offset: prop.loc.start.offset }); continue }
        if (selectedInputChangeEvent !== prop.arg.content) continue
      }
      if (prop.exp.content.includes('__gioAutoTrack')) continue
      replacements.push({
        start: prop.exp.loc.start.offset,
        end: prop.exp.loc.end.offset,
        value: rewritten,
      })
    }
    if (element.tag === 'uni-link' && !hasClickHandler && !hasDynamicEvent && !metadata.ignored) {
      const end = openingTagEnd(element)
      if (end !== null) {
        const localEnd = end - element.loc.start.offset
        const insertAt = element.loc.source[localEnd - 1] === '/' ? end - 1 : end
        replacements.push({
          start: insertAt,
          end: insertAt,
          value: ` @click="__gioAutoTrack(${probeCall('click', xpath, metadata)},$event)"`,
        })
      }
    }
    visit(element.children, xpath, replacements, warnings)
  }
}

/** AST-based template transform; only prefaces a known static handler and never replaces its expression. */
export function transformAutoTrackTemplate(template: string): AutoTrackTemplateTransform {
  let root: RootNode
  try { root = parse(template) } catch { return { code: template, warnings: [], changed: false } }
  const replacements: Replacement[] = []
  const warnings: AutoTrackTransformWarning[] = []
  visit(root.children, '', replacements, warnings)
  let code = template
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    code = `${code.slice(0, replacement.start)}${replacement.value}${code.slice(replacement.end)}`
  }
  return { code, warnings, changed: replacements.length > 0 }
}

function injectDispatcherImport(source: string, runtimeImport: string): string {
  const imported = `import { dispatchAutoTrack as __gioAutoTrack } from ${escape(runtimeImport)}`
  if (source.includes('dispatchAutoTrack as __gioAutoTrack')) return source
  // Template expressions resolve setup bindings directly, while an Options API script exposes
  // only component instance members. Keep the import in a setup block for both SFC forms.
  const script = /<script\s+setup(?:\s[^>]*)?>/i.exec(source)
  if (script === null) return `<script setup>\n${imported}\n</script>\n${source}`
  const offset = script.index + script[0].length
  return `${source.slice(0, offset)}\n${imported}\n${source.slice(offset)}`
}

/** Transforms only Vue3 SFC templates and injects the dispatcher import once when a probe was added. */
export function transformAutoTrackSfc(source: string, runtimeImport = 'gio-uniapp-autotracker'): VueSfcTransform {
  const match = /<template(?:\s[^>]*)?>([\s\S]*?)<\/template>/i.exec(source)
  if (match === null || match.index === undefined) return { code: source, warnings: [], changed: false }
  const template = match[1] ?? ''
  const transformed = transformAutoTrackTemplate(template)
  if (!transformed.changed) return { code: source, warnings: transformed.warnings, changed: false }
  const start = match.index + match[0].indexOf(template)
  const withTemplate = `${source.slice(0, start)}${transformed.code}${source.slice(start + template.length)}`
  return { code: injectDispatcherImport(withTemplate, runtimeImport), warnings: transformed.warnings, changed: true }
}

export type UniAppAutoTrackVitePlugin = Readonly<{
  name: string
  enforce: 'pre'
  transform: (source: string, id: string) => Readonly<{ code: string }> | null
}>

export type UniAppAutoTrackViteContext = Readonly<{ warn?: (message: string) => void }>

export type UniAppAutoTrackViteOptions = Readonly<{
  enabled?: boolean
  runtimeImport?: string
}>

function resolveViteOptions(options: string | UniAppAutoTrackViteOptions | undefined): Readonly<{ enabled: boolean; runtimeImport: string }> {
  if (typeof options === 'string') return { enabled: true, runtimeImport: options }
  return { enabled: options?.enabled !== false, runtimeImport: options?.runtimeImport ?? 'gio-uniapp-autotracker' }
}

export function gioUniappAutoTrack(options?: string | UniAppAutoTrackViteOptions): UniAppAutoTrackVitePlugin {
  const resolved = resolveViteOptions(options)
  return {
    name: 'gio-uniapp-autotrack',
    enforce: 'pre',
    transform: function (this: UniAppAutoTrackViteContext | undefined, source, id) {
      if (id.endsWith('.nvue')) {
        this?.warn?.(`[gio-uniapp-autotrack] .nvue is not instrumented in 1.0: ${id}`)
        return null
      }
      if (!resolved.enabled || !id.endsWith('.vue')) return null
      const transformed = transformAutoTrackSfc(source, resolved.runtimeImport)
      return transformed.changed ? { code: transformed.code } : null
    },
  }
}
