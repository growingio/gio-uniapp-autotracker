export type AppPlatform = 'Android' | 'iOS' | 'HarmonyOS'
export type NetworkState = '2G' | '3G' | '4G' | '5G' | 'WIFI' | 'UNKNOWN'

export type AppSystemContext = Readonly<{
  platform: AppPlatform
  platformVersion: string
  domain: string
  appState: 'FOREGROUND' | 'BACKGROUND'
  appName: string
  networkState: NetworkState
  screenWidth: number
  screenHeight: number
  deviceBrand: string
  deviceModel: string
  deviceType: 'PHONE' | 'PAD' | 'FOLD' | 'UNKNOWN'
  appVersion: string
  language: string
  sdkVersion: string
}>

export interface SystemContextPort {
  load(): Promise<AppSystemContext>
}

export interface ClockPort {
  now(): number
}

export interface TimezonePort {
  getOffsetMinutes(): number
}

/** Core reports fixed diagnostics and dispatched event JSON through this port. */
export interface LoggerPort {
  info(message: string): void
  success(message: string): void
  warn(message: string): void
  error(message: string): void
  debug(message: string, data?: unknown): void
}

/** Network state is best effort. UNKNOWN includes offline and must never block queueing. */
export interface NetworkPort {
  current(): Promise<NetworkState>
  subscribe(listener: (state: NetworkState) => void): () => void
}

export type StorageArea = 'state' | 'queue'
export type StorageRead =
  | Readonly<{ kind: 'value'; value: string }>
  | Readonly<{ kind: 'missing' | 'unavailable' | 'corrupt'; message?: string }>
export type StorageWrite =
  | Readonly<{ kind: 'ok' }>
  | Readonly<{ kind: 'unavailable' | 'quota' | 'failed'; message?: string }>

/** The platform adapter owns its host storage API; core owns record encoding and validation. */
export interface StoragePort {
  readonly persistentQueue: boolean
  read(area: StorageArea, key: string): Promise<StorageRead>
  write(area: StorageArea, key: string, value: string): Promise<StorageWrite>
  remove(area: StorageArea, key: string): Promise<StorageWrite>
}

export type TransportRequest = Readonly<{
  url: string
  method: 'POST'
  headers: Readonly<Record<string, string>>
  body: string
  timeoutMs: number
}>

export type TransportResult =
  | Readonly<{ kind: 'success'; status: number }>
  | Readonly<{ kind: 'http'; status: number; responseText?: string }>
  | Readonly<{ kind: 'network' | 'timeout' | 'aborted' | 'unsupported'; message?: string }>

export type TransportHandle = Readonly<{ abort?: () => void }>

export interface TransportPort {
  dispatch(request: TransportRequest, done: (result: TransportResult) => void): TransportHandle | void
}
