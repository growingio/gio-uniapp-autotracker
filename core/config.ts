import { normalizeCollectorHost } from './collector-host.js'

export type GioInitOptions = Readonly<{
  accountId: string
  dataSourceId: string
  serverUrl?: string | null
  /** Reserved for Web / mini-program profiles. App drops it at this boundary. */
  appId?: string | null
  appChannel?: string | null
  appVersion?: string | null
  sessionExpires?: number
  dataCollect?: boolean
  idMapping?: boolean
  debug?: boolean
}>

export type SessionPolicy = Readonly<{ timeoutMs: number }>

export type ResolvedGioConfig = Readonly<{
  accountId: string
  dataSourceId: string
  serverUrl: string
  appChannel: string | null
  appVersionFallback: string | null
  sessionPolicy: SessionPolicy
  dataCollect: boolean
  idMapping: boolean
  debug: boolean
}>

export type ConfigErrorCode =
  | 'invalid_options'
  | 'invalid_account_id'
  | 'invalid_data_source_id'
  | 'invalid_server_url'
  | 'invalid_app_channel'
  | 'invalid_app_version'
  | 'invalid_session_expires'
  | 'invalid_data_collect'
  | 'invalid_id_mapping'
  | 'invalid_debug'

export type ConfigResult =
  | Readonly<{ ok: true; config: ResolvedGioConfig }>
  | Readonly<{ ok: false; code: ConfigErrorCode }>

const DEFAULT_SERVER_URL = 'https://napi.growingio.com'
const APP_DEFAULT_SESSION_TIMEOUT_MS = 30_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // A string iterator keeps valid surrogate pairs together. Lone surrogates
  // would throw later in URI/UTF-8 encoding, after initialization has started.
  for (const character of trimmed) {
    const point = character.codePointAt(0)!
    if (point >= 0xD800 && point <= 0xDFFF) return null
  }
  return trimmed === '' ? null : trimmed
}

function optionalTrimmedString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function normalizeServerUrl(value: unknown): string | ConfigErrorCode {
  if (value === undefined || value === null) return DEFAULT_SERVER_URL
  if (typeof value !== 'string' || value.trim() === '') return 'invalid_server_url'

  // App service runtimes do not provide the browser's URL constructor. Parse
  // only collector origins: no credentials, paths, query, fragments or escapes.
  const candidate = value.trim().includes('://') ? value.trim() : `https://${value.trim()}`
  if (typeof globalThis.URL === 'function') {
    try {
      const url = new globalThis.URL(candidate)
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '' || url.pathname !== '/'
        || url.search !== '' || url.hash !== '' || url.username !== '' || url.password !== '') return 'invalid_server_url'
      return url.origin
    } catch { return 'invalid_server_url' }
  }
  const match = /^(https?):\/\/(\[[a-f\d:.]+\]|[^\s/:?#@\[\]\\%]+)(?::(\d+))?\/?$/i.exec(candidate)
  if (match === null) return 'invalid_server_url'
  const protocol = match[1]!.toLowerCase()
  const host = normalizeCollectorHost(match[2]!)
  if (host === null) return 'invalid_server_url'
  const port = match[3] === undefined ? null : Number(match[3])
  if (port !== null && (!Number.isInteger(port) || port > 65535)) return 'invalid_server_url'
  const suffix = port === null || (protocol === 'https' && port === 443) || (protocol === 'http' && port === 80) ? '' : `:${port}`
  return `${protocol}://${host}${suffix}`
}

function normalizeBoolean(value: unknown, fallback: boolean, error: ConfigErrorCode): boolean | ConfigErrorCode {
  if (value === undefined) return fallback
  return typeof value === 'boolean' ? value : error
}

function normalizeSessionPolicy(value: unknown): SessionPolicy | ConfigErrorCode {
  if (value === undefined) return { timeoutMs: APP_DEFAULT_SESSION_TIMEOUT_MS }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'invalid_session_expires'
  const timeoutMs = value * 60_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 'invalid_session_expires'
  return { timeoutMs }
}

/**
 * The only module that reads raw init options. A failed result has no side effects,
 * so callers can safely let an integrator correct options and retry initialization.
 */
export function normalizeInitOptions(input: unknown): ConfigResult {
  if (!isRecord(input)) return { ok: false, code: 'invalid_options' }

  const accountId = nonEmptyString(input.accountId)
  if (accountId === null) return { ok: false, code: 'invalid_account_id' }
  const dataSourceId = nonEmptyString(input.dataSourceId)
  if (dataSourceId === null) return { ok: false, code: 'invalid_data_source_id' }

  const serverUrl = normalizeServerUrl(input.serverUrl)
  if (serverUrl === 'invalid_server_url') return { ok: false, code: serverUrl }

  if (input.appChannel !== undefined && input.appChannel !== null && typeof input.appChannel !== 'string') {
    return { ok: false, code: 'invalid_app_channel' }
  }
  const appChannel = optionalTrimmedString(input.appChannel)
  if (input.appVersion !== undefined && input.appVersion !== null && typeof input.appVersion !== 'string') {
    return { ok: false, code: 'invalid_app_version' }
  }
  const appVersionFallback = optionalTrimmedString(input.appVersion)

  const sessionPolicy = normalizeSessionPolicy(input.sessionExpires)
  if (typeof sessionPolicy === 'string') return { ok: false, code: sessionPolicy }
  const dataCollect = normalizeBoolean(input.dataCollect, true, 'invalid_data_collect')
  if (typeof dataCollect === 'string') return { ok: false, code: dataCollect }
  const idMapping = normalizeBoolean(input.idMapping, false, 'invalid_id_mapping')
  if (typeof idMapping === 'string') return { ok: false, code: idMapping }
  const debug = normalizeBoolean(input.debug, false, 'invalid_debug')
  if (typeof debug === 'string') return { ok: false, code: debug }

  return {
    ok: true,
    config: {
      accountId,
      dataSourceId,
      serverUrl,
      appChannel,
      appVersionFallback,
      sessionPolicy,
      dataCollect,
      idMapping,
      debug,
    },
  }
}
