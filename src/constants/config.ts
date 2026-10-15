import { normalizeCollectorHost } from '../utils/tools.js'
import metadata from '../../package.json' with { type: 'json' }

export type GioInitOptions = Readonly<{
  accountId: string
  dataSourceId: string
  serverUrl?: string | null
  /** 为 Web 和小程序配置预留，当前 App 在此边界剥离该字段。 */
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

/** 确认初始化参数是普通对象形态，拒绝数组与空值。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 归一化必填标识并拒绝未配对代理项，避免后续 URI 或 UTF-8 编码失败。 */
function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  // 字符串迭代可保留合法代理对，未配对代理项必须提前拒绝。
  // 否则初始化开始后可能在 URI 或 UTF-8 编码阶段抛错。
  for (const character of trimmed) {
    const point = character.codePointAt(0)!
    if (point >= 0xD800 && point <= 0xDFFF) return null
  }
  return trimmed === '' ? null : trimmed
}

/** 清理可选字符串的首尾空白，将未提供或空白值统一为 null。 */
function optionalTrimmedString(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** 规范采集服务基础地址，拒绝凭据、接口路径、查询参数和片段；兼容缺少 URL 的 App 运行时。 */
function normalizeServerUrl(value: unknown): string | ConfigErrorCode {
  if (value === undefined || value === null) return DEFAULT_SERVER_URL
  if (typeof value !== 'string' || value.trim() === '') return 'invalid_server_url'

  // 部分 App 运行时没有浏览器的 URL 构造器，因此仅解析采集服务基础地址。
  // 不接受凭据、接口路径、查询参数、片段或转义主机。
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

/** 仅对未提供的布尔配置补默认值，显式非法值返回对应错误。 */
function normalizeBoolean(value: unknown, fallback: boolean, error: ConfigErrorCode): boolean | ConfigErrorCode {
  if (value === undefined) return fallback
  return typeof value === 'boolean' ? value : error
}

/** 将分钟单位的会话配置换算为毫秒，拒绝非正数及换算溢出。 */
function normalizeSessionPolicy(value: unknown): SessionPolicy | ConfigErrorCode {
  if (value === undefined) return { timeoutMs: APP_DEFAULT_SESSION_TIMEOUT_MS }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'invalid_session_expires'
  const timeoutMs = value * 60_000
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return 'invalid_session_expires'
  return { timeoutMs }
}

/** 统一读取和校验原始初始化配置；失败不产生副作用，修正参数后可再次尝试初始化。 */
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

export const SDK_VERSION: string = metadata.version
