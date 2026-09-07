import { AUTO_TRACK_SCHEMA_VERSION, CHANGE_ELEMENTS, TEMPLATE_ELEMENTS, type NormalizedAutoTrackCall } from '../autotrack/contract.js'

const templateFields = new Set(['schemaVersion', 'source', 'kind', 'eventName', 'elementType', 'pickerRange', 'pickerRangeKey', 'textValue', 'index', 'hyperlink', 'ignored', 'trackValue', 'sensitive'])
const tabFields = new Set(['schemaVersion', 'source', 'kind', 'xpath', 'index', 'textValue', 'hyperlink'])
export const MAX_RANGE_ITEMS = 1000
export const MAX_PICKER_COLUMNS = 20

export function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}
function scalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
}
function optionalScalar(value: unknown): boolean { return value == null || scalar(value) }
function text(value: unknown): string | null {
  return scalar(value) ? String(value).replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 100) : null
}
export function enabledMarker(value: unknown): boolean { return value === true || value === '' || value === 'true' }
function ownValue(value: Readonly<Record<string, unknown>>, key: string): unknown {
  const field = Object.getOwnPropertyDescriptor(value, key)
  return field !== undefined && 'value' in field ? field.value : undefined
}
function data(dataset: Readonly<Record<string, unknown>> | null, name: string): unknown {
  if (dataset === null) return undefined
  const camel = name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase())
  return Object.prototype.hasOwnProperty.call(dataset, camel) ? ownValue(dataset, camel) : ownValue(dataset, name)
}
function metadata(dataset: Readonly<Record<string, unknown>> | null, name: string, fallback: unknown): unknown {
  const value = data(dataset, name)
  return value === undefined ? fallback : value
}
function marked(dataset: Readonly<Record<string, unknown>> | null, name: string): boolean { return enabledMarker(data(dataset, name)) }
function index(value: unknown, minimum: number): number | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  if (!/^(0|[1-9]\d*)$/.test(String(value))) return null
  const result = Number(value)
  return Number.isSafeInteger(result) && result >= minimum && result < 2147483647 ? result : null
}
function sensitiveTarget(target: Readonly<Record<string, unknown>> | null): boolean {
  const kind = target?.type ?? record(target?.attr)?.type
  return typeof kind === 'string' && ['password', 'safe-password', 'file'].includes(kind.toLowerCase())
}

// 只接受有界、无 getter 的 JSON range；不序列化整个组件、响应式对象或宿主事件。
function arrayValues(value: unknown, maximum: number): readonly unknown[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null
  const result: unknown[] = []
  for (let index = 0; index < value.length; index += 1) {
    const field = Object.getOwnPropertyDescriptor(value, String(index))
    if (field === undefined || !('value' in field)) return null
    result.push(field.value)
  }
  return result
}
function validRange(value: unknown, columns: boolean): boolean {
  let count = 0
  const item = (entry: unknown): boolean => {
    count += 1
    if (count > MAX_RANGE_ITEMS) return false
    if (scalar(entry) || entry === null) return true
    const object = record(entry)
    if (object === null || ![Object.prototype, null].includes(Object.getPrototypeOf(object))) return false
    const descriptors = Object.values(Object.getOwnPropertyDescriptors(object))
    return descriptors.length <= 32 && descriptors.every((field) => 'value' in field && (field.value === null || scalar(field.value)))
  }
  const list = (entries: unknown): boolean => {
    const values = arrayValues(entries, MAX_RANGE_ITEMS)
    return values !== null && values.every(item)
  }
  if (!columns) return list(value)
  const values = arrayValues(value, MAX_PICKER_COLUMNS)
  return values !== null && values.every(list)
}
function pickerLabel(range: unknown, at: number, key: unknown): string | null {
  if (!Array.isArray(range)) return null
  const value = Object.getOwnPropertyDescriptor(range, String(at))
  if (value === undefined || !('value' in value)) return null
  const object = record(value.value)
  return text(typeof key === 'string' && object !== null ? ownValue(object, key) : value.value)
}
function scalarArray(value: unknown): string | null {
  const values = arrayValues(value, MAX_RANGE_ITEMS)
  return values !== null && values.every(scalar) ? text(values.map(String).join('||')) : null
}
function pickerValue(value: unknown, range: unknown, key: unknown): string | null {
  const at = index(value, 0)
  return at === null ? null : pickerLabel(range, at, key) ?? String(at)
}
function pickerViewValue(value: unknown, range: unknown, key: unknown): string | null {
  const values = arrayValues(value, MAX_PICKER_COLUMNS)
  if (values === null) return null
  const indices = values.map((entry) => index(entry, 0))
  if (indices.some((entry) => entry === null)) return null
  const columns = arrayValues(range, MAX_PICKER_COLUMNS)
  const labels = indices.map((at, column) => pickerLabel(columns?.[column], at as number, key))
  return text(columns !== null && columns.length === indices.length && labels.every((label) => label !== null)
    ? labels.join('||') : indices.join('||'))
}
function inputValue(detail: Readonly<Record<string, unknown>> | null, target: Readonly<Record<string, unknown>> | null): string | null {
  return text(detail?.value ?? target?.value ?? record(target?.attr)?.value)
}
function changeValue(element: unknown, detail: Readonly<Record<string, unknown>> | null, target: Readonly<Record<string, unknown>> | null, range: unknown, key: unknown): string | null {
  switch (element) {
    case 'input': case 'textarea': return inputValue(detail, target)
    case 'switch': return typeof detail?.value === 'boolean' ? String(detail.value) : null
    case 'slider': return typeof detail?.value === 'number' && Number.isFinite(detail.value) ? text(detail.value) : null
    case 'radio-group': return text(detail?.value)
    case 'checkbox-group': return scalarArray(detail?.value)
    case 'picker': return pickerValue(detail?.value, range, key)
    case 'picker-view': return pickerViewValue(detail?.value, range, key)
    case 'swiper': { const at = index(detail?.current, 0); return at === null ? null : String(at) }
    default: return null
  }
}

/** 所有隐私策略都在这里完成；下游只接收协议可用的纯 JSON 字段。 */
export function normalizeAutoTrackCall(value: unknown, nativeEvent?: unknown): NormalizedAutoTrackCall | null {
  try {
    const probe = record(value)
    if (probe === null || probe.schemaVersion !== AUTO_TRACK_SCHEMA_VERSION) return null
    if (probe.source === 'tabbar') {
      if (Object.keys(probe).some((key) => !tabFields.has(key)) || probe.kind !== 'click' || probe.xpath !== '#onTabItemTap') return null
      const at = index(probe.index, 1)
      if (at === null || typeof probe.index !== 'number' || !optionalScalar(probe.textValue) || !optionalScalar(probe.hyperlink)) return null
      return { kind: 'click', xpath: '#onTabItemTap', index: at, textValue: text(probe.textValue), hyperlink: text(probe.hyperlink) }
    }
    if (probe.source !== 'template' || Object.keys(probe).some((key) => !templateFields.has(key))
      || (probe.kind !== 'click' && probe.kind !== 'change') || typeof probe.eventName !== 'string' || probe.eventName.trim() === '') return null
    if (probe.elementType !== undefined && !(TEMPLATE_ELEMENTS as readonly unknown[]).includes(probe.elementType)) return null
    if (probe.kind === 'change' && !(CHANGE_ELEMENTS as readonly unknown[]).includes(probe.elementType)) return null
    const event = record(nativeEvent)
    const current = record(event?.currentTarget)
    const target = record(event?.target)
    const primary = current ?? target
    const currentData = record(current?.dataset)
    const targetData = record(target?.dataset)
    const dataset = current === null ? targetData : currentData
    // 必须先短路，连 detail.value、range、textValue 的 getter 都不能触碰。
    if (enabledMarker(probe.ignored) || enabledMarker(probe.sensitive)
      || marked(currentData, 'growing-ignore') || marked(targetData, 'growing-ignore')
      || marked(currentData, 'growing-sensitive') || marked(targetData, 'growing-sensitive')
      || sensitiveTarget(current) || sensitiveTarget(target)) return null
    const detail = probe.elementType === 'swiper' ? record(event?.detail) : null
    if (probe.elementType === 'swiper' && detail?.source === 'autoplay' && !marked(targetData, 'growing-track')) return null
    for (const key of ['textValue', 'index', 'hyperlink', 'ignored', 'trackValue', 'sensitive']) if (!optionalScalar(probe[key])) return null
    if (probe.pickerRangeKey !== undefined && (typeof probe.pickerRangeKey !== 'string' || probe.pickerRangeKey.trim() === '')) return null
    if ((probe.pickerRange !== undefined || probe.pickerRangeKey !== undefined) && !['picker', 'picker-view'].includes(String(probe.elementType))) return null
    if (probe.pickerRange !== undefined && !validRange(probe.pickerRange, probe.elementType === 'picker-view')) return null
    const rawId = primary?.id
    const id = typeof rawId === 'string' || typeof rawId === 'number' ? String(rawId) : ''
    const xpath = `${id}#${probe.eventName}`
    const title = metadata(dataset, 'title', probe.textValue)
    if (!optionalScalar(title)) return null
    if (probe.kind === 'click') {
      const rawIndex = metadata(dataset, 'index', probe.index)
      const link = metadata(dataset, 'src', probe.hyperlink)
      if (!optionalScalar(rawIndex) || !optionalScalar(link)) return null
      return { kind: 'click', xpath, textValue: text(title), index: index(rawIndex, 1), hyperlink: text(link) }
    }
    const tracked = enabledMarker(metadata(dataset, 'growing-track', probe.trackValue))
    const result = tracked ? changeValue(probe.elementType, detail ?? record(event?.detail), target, probe.pickerRange, probe.pickerRangeKey) : null
    return { kind: 'change', xpath, textValue: result ?? (probe.elementType === 'swiper' ? text(title) : null) }
  } catch {
    return null
  }
}
