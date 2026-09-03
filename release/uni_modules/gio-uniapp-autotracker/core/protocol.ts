export const APP_EVENT_TYPES = [
  'VISIT',
  'PAGE',
  'CUSTOM',
  'LOGIN_USER_ATTRIBUTES',
  'APP_CLOSED',
  'VIEW_CLICK',
  'VIEW_CHANGE',
] as const

export type AppEventType = (typeof APP_EVENT_TYPES)[number]
export type ProtocolEvent = Readonly<Record<string, unknown>> & Readonly<{ eventType: AppEventType }>

const COMMON_FIELDS = [
  'deviceId', 'userId', 'userKey', 'sessionId', 'dataSourceId', 'eventType', 'platform',
  'platformVersion', 'timestamp', 'domain', 'appState', 'appName', 'path', 'query',
  'networkState', 'appChannel', 'screenWidth', 'screenHeight', 'deviceBrand', 'deviceModel',
  'deviceType', 'appVersion', 'language', 'timezoneOffset', 'latitude', 'longitude', 'sdkVersion',
] as const

const EVENT_FIELDS: Readonly<Record<AppEventType, readonly string[]>> = {
  VISIT: ['eventSequenceId'],
  PAGE: ['eventSequenceId', 'orientation', 'protocolType', 'title', 'referralPage'],
  CUSTOM: ['eventSequenceId', 'eventName', 'pageShowTimestamp', 'attributes'],
  LOGIN_USER_ATTRIBUTES: ['attributes'],
  APP_CLOSED: [],
  VIEW_CLICK: ['eventSequenceId', 'pageShowTimestamp', 'textValue', 'xpath', 'index', 'hyperlink'],
  VIEW_CHANGE: ['eventSequenceId', 'pageShowTimestamp', 'textValue', 'xpath'],
}

const REQUIRED_EVENT_FIELDS: Readonly<Record<AppEventType, readonly string[]>> = {
  VISIT: ['eventSequenceId'],
  PAGE: ['eventSequenceId', 'orientation'],
  CUSTOM: ['eventSequenceId', 'eventName'],
  LOGIN_USER_ATTRIBUTES: ['attributes'],
  APP_CLOSED: [],
  VIEW_CLICK: ['eventSequenceId', 'pageShowTimestamp', 'xpath'],
  VIEW_CHANGE: ['eventSequenceId', 'pageShowTimestamp', 'xpath'],
}

const REQUIRED_COMMON_FIELDS = [
  'deviceId', 'sessionId', 'dataSourceId', 'eventType', 'platform', 'platformVersion', 'timestamp',
  'domain', 'appState', 'appName', 'networkState', 'screenWidth', 'screenHeight', 'deviceBrand',
  'deviceModel', 'deviceType', 'appVersion', 'language', 'timezoneOffset', 'sdkVersion',
] as const

const CUSTOM_EVENT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,99}$/

export type AttributeDiagnostic = 'attribute_invalid_value' | 'attribute_key_collision'
export type NormalizedAttributes = Readonly<{ attributes: ReadonlyMap<string, string>; diagnostics: readonly AttributeDiagnostic[] }>
export type BuildEventResult =
  | Readonly<{ ok: true; event: ProtocolEvent }>
  | Readonly<{ ok: false; code: 'invalid_event_type' | 'missing_required_field' | 'invalid_custom_event_name' }>

function isEmptyOutboundValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  return typeof value === 'object' && Object.keys(value).length === 0
}

/** Removes wire-empty values after a caller has built a whitelisted event. */
export function sanitizeOutboundEvent(event: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => !isEmptyOutboundValue(value)))
}

function truncate(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}

function normalizeAttributeScalar(value: unknown): string | null {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  return null
}

export function normalizeAttributes(input: unknown): NormalizedAttributes {
  const attributes = new Map<string, string>()
  const diagnostics: AttributeDiagnostic[] = []
  if (input === null || input === undefined) return { attributes, diagnostics }
  if (typeof input !== 'object' || Array.isArray(input)) return { attributes, diagnostics: ['attribute_invalid_value'] }

  for (const [rawKey, rawValue] of Object.entries(input)) {
    const key = truncate(rawKey, 100)
    let value: string | null
    if (Array.isArray(rawValue)) {
      if (rawValue.length > 100) {
        diagnostics.push('attribute_invalid_value')
        continue
      }
      const parts = rawValue.map(normalizeAttributeScalar)
      value = parts.every((part) => part !== null) ? parts.join('||') : null
    } else {
      value = normalizeAttributeScalar(rawValue)
    }
    if (value === null) {
      diagnostics.push('attribute_invalid_value')
      continue
    }
    if (attributes.has(key)) {
      diagnostics.push('attribute_key_collision')
      continue
    }
    attributes.set(key, truncate(value, 1000))
  }
  return { attributes, diagnostics }
}

export function buildAppEvent(eventType: string, fields: Readonly<Record<string, unknown>>): BuildEventResult {
  if (!APP_EVENT_TYPES.includes(eventType as AppEventType)) return { ok: false, code: 'invalid_event_type' }
  const typedEventType = eventType as AppEventType
  if (typedEventType === 'CUSTOM' && (typeof fields.eventName !== 'string' || !CUSTOM_EVENT_NAME.test(fields.eventName))) {
    return { ok: false, code: 'invalid_custom_event_name' }
  }
  const allowed = new Set([...COMMON_FIELDS, ...EVENT_FIELDS[typedEventType]])
  const candidate = Object.fromEntries(
    Object.entries({ ...fields, eventType: typedEventType }).filter(([key]) => allowed.has(key)),
  )
  // Common fields retain the established contract: present but empty values may be omitted from
  // the wire payload. Event-specific required fields, however, must still exist after cleanup.
  if (REQUIRED_COMMON_FIELDS.some((key) => !(key in candidate))) return { ok: false, code: 'missing_required_field' }
  const event = sanitizeOutboundEvent(candidate)
  if (REQUIRED_EVENT_FIELDS[typedEventType].some((key) => !(key in event))) return { ok: false, code: 'missing_required_field' }
  return { ok: true, event: event as ProtocolEvent }
}
