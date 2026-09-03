import type { AutoTrackCall } from '../autotrack/contract.js'

export interface AutoTrackTarget {
  autoTrack(call: AutoTrackCall): boolean
}

let target: AutoTrackTarget | null = null
const seenNativeEvents = new WeakMap<object, Set<string>>()

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : null
}

function dataValue(dataset: Readonly<Record<string, unknown>> | null, ...names: string[]): unknown {
  if (dataset === null) return undefined
  for (const name of names) if (name in dataset) return dataset[name]
  return undefined
}

function isEnabledMarker(value: unknown): boolean {
  return value === true || value === '' || value === 'true'
}

function snapshotCall(call: AutoTrackCall, nativeEvent: unknown): AutoTrackCall {
  const event = record(nativeEvent)
  const currentTarget = record(event?.currentTarget)
  const dataset = record(currentTarget?.dataset)
  const ignored = call.ignored === true || isEnabledMarker(dataValue(dataset, 'growingIgnore', 'growing-ignore'))
  const trackValue = call.trackValue === true || isEnabledMarker(dataValue(dataset, 'growingTrack', 'growing-track'))
  const inputType = typeof currentTarget?.type === 'string' ? currentTarget.type.toLowerCase() : ''
  const sensitive = call.sensitive === true || isEnabledMarker(dataValue(dataset, 'growingSensitive', 'growing-sensitive'))
    || inputType === 'password' || inputType === 'safe-password' || inputType === 'file'
  const detail = record(event?.detail)
  const dynamicTitle = dataValue(dataset, 'title', 'growingTitle', 'growing-title')
  const dynamicValue = detail?.value
  return {
    ...call,
    ignored,
    trackValue,
    sensitive,
    textValue: call.textValue === undefined ? (call.kind === 'change' && trackValue ? dynamicValue : dynamicTitle) : call.textValue,
    index: call.index === undefined ? dataValue(dataset, 'index', 'growingIndex', 'growing-index') : call.index,
    hyperlink: call.hyperlink === undefined ? dataValue(dataset, 'src', 'growingSrc', 'growing-src') : call.hyperlink,
  }
}

function eventKey(call: AutoTrackCall): string {
  return JSON.stringify([call.kind, call.xpath, call.textValue, call.index, call.hyperlink])
}

/**
 * Suppresses only an identical probe on the same native event. The native event remains at this
 * boundary and is never forwarded into the persisted JSON tracking contract.
 */
function acceptNativeEvent(call: AutoTrackCall, nativeEvent: unknown): boolean {
  if (typeof nativeEvent !== 'object' || nativeEvent === null) return true
  const key = eventKey(call)
  const seen = seenNativeEvents.get(nativeEvent)
  if (seen?.has(key)) return false
  if (seen === undefined) seenNativeEvents.set(nativeEvent, new Set([key]))
  else seen.add(key)
  return true
}

/** Installs the one runtime target used by compiled templates; a missing target is always a safe no-op. */
export function installAutoTrackDispatcher(next: AutoTrackTarget): void {
  target = next
}

export function dispatchAutoTrack(call: AutoTrackCall, nativeEvent?: unknown): boolean {
  try {
    if (!acceptNativeEvent(call, nativeEvent)) return false
    return target?.autoTrack(snapshotCall(call, nativeEvent)) ?? false
  } catch {
    return false
  }
}
