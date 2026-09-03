/**
 * 传统 uni-app App 1.0 的可执行字段契约。
 *
 * 此文件是 Protocol 的测试输入，不是 event builder；阶段 1 不得在此处
 * 增加运行时代码或绕过本文件自行定义字段。
 */
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
export type AppEventFixture = Readonly<Record<string, unknown>> & Readonly<{ eventType: AppEventType }>

export const APP_COMMON_REQUIRED_FIELDS = [
  'deviceId',
  'sessionId',
  'dataSourceId',
  'eventType',
  'platform',
  'platformVersion',
  'timestamp',
  'domain',
  'appState',
  'appName',
  'networkState',
  'screenWidth',
  'screenHeight',
  'deviceBrand',
  'deviceModel',
  'deviceType',
  'appVersion',
  'language',
  'timezoneOffset',
  'sdkVersion',
] as const

export const APP_COMMON_OPTIONAL_FIELDS = [
  'userId',
  'userKey',
  'path',
  'query',
  'appChannel',
  'latitude',
  'longitude',
] as const

const COMMON_ALLOWED_FIELDS = [
  ...APP_COMMON_REQUIRED_FIELDS,
  ...APP_COMMON_OPTIONAL_FIELDS,
] as const

const EVENT_FIELDS = {
  VISIT: ['eventSequenceId'],
  PAGE: ['eventSequenceId', 'orientation', 'protocolType', 'title', 'referralPage'],
  CUSTOM: ['eventSequenceId', 'eventName', 'pageShowTimestamp', 'attributes'],
  LOGIN_USER_ATTRIBUTES: ['attributes'],
  APP_CLOSED: [],
  VIEW_CLICK: ['eventSequenceId', 'pageShowTimestamp', 'textValue', 'xpath', 'index', 'hyperlink'],
  VIEW_CHANGE: ['eventSequenceId', 'pageShowTimestamp', 'textValue', 'xpath'],
} as const satisfies Record<AppEventType, readonly string[]>

export const APP_ALLOWED_FIELDS: Readonly<Record<AppEventType, readonly string[]>> = APP_EVENT_TYPES.reduce(
  (rules, eventType) => {
    rules[eventType] = [...COMMON_ALLOWED_FIELDS, ...EVENT_FIELDS[eventType]]
    return rules
  },
  {} as Record<AppEventType, readonly string[]>,
)

export const APP_EVENT_REQUIRED_FIELDS: Readonly<Record<AppEventType, readonly string[]>> = {
  VISIT: ['eventSequenceId'],
  PAGE: ['eventSequenceId', 'orientation'],
  CUSTOM: ['eventSequenceId', 'eventName'],
  LOGIN_USER_ATTRIBUTES: ['attributes'],
  APP_CLOSED: [],
  VIEW_CLICK: ['eventSequenceId', 'pageShowTimestamp', 'xpath'],
  VIEW_CHANGE: ['eventSequenceId', 'pageShowTimestamp', 'xpath'],
}

export const EVENT_SEQUENCE_EVENT_TYPES = [
  'VISIT',
  'PAGE',
  'CUSTOM',
  'VIEW_CLICK',
  'VIEW_CHANGE',
] as const satisfies readonly AppEventType[]

/** These protocol fields are App-capable, but explicitly excluded from the 1.0 base SDK. */
export const APP_V1_EXCLUDED_FIELDS = [
  'urlScheme',
  'idfa',
  'idfv',
  'oaid',
  'googleAdvertisingId',
  'androidId',
  'imei',
] as const

const context = {
  deviceId: 'device-1',
  sessionId: 'session-1',
  dataSourceId: 'data-source-1',
  platform: 'Android',
  platformVersion: '14',
  timestamp: 1_700_000_000_000,
  domain: 'com.example.app',
  appState: 'FOREGROUND',
  appName: 'Fixture App',
  networkState: 'WIFI',
  screenWidth: 1080,
  screenHeight: 1920,
  deviceBrand: 'Fixture',
  deviceModel: 'Fixture Phone',
  deviceType: 'PHONE',
  appVersion: '1.0.0',
  language: 'zh-CN',
  timezoneOffset: '-480',
  sdkVersion: '0.1.0',
} as const

export const APP_EVENT_FIXTURES: Readonly<Record<AppEventType, AppEventFixture>> = {
  VISIT: { ...context, eventType: 'VISIT', eventSequenceId: 1 },
  PAGE: {
    ...context,
    eventType: 'PAGE',
    eventSequenceId: 2,
    path: 'pages/index/index',
    query: 'from=fixture',
    title: '首页',
    referralPage: 'pages/landing/index',
    orientation: 'PORTRAIT',
  },
  CUSTOM: {
    ...context,
    eventType: 'CUSTOM',
    eventSequenceId: 3,
    eventName: 'fixture_event',
    pageShowTimestamp: 1_700_000_000_000,
    attributes: { enabled: 'false' },
  },
  LOGIN_USER_ATTRIBUTES: {
    ...context,
    eventType: 'LOGIN_USER_ATTRIBUTES',
    attributes: { plan: 'free' },
  },
  APP_CLOSED: { ...context, eventType: 'APP_CLOSED', appState: 'BACKGROUND' },
  VIEW_CLICK: {
    ...context,
    eventType: 'VIEW_CLICK',
    eventSequenceId: 4,
    pageShowTimestamp: 1_700_000_000_000,
    xpath: 'pages/index/index#tap#fixture-button',
    index: 0,
  },
  VIEW_CHANGE: {
    ...context,
    eventType: 'VIEW_CHANGE',
    eventSequenceId: 5,
    pageShowTimestamp: 1_700_000_000_000,
    xpath: 'pages/index/index#change#fixture-switch',
    textValue: 'false',
  },
}

export const OUTBOUND_SANITIZATION_VECTORS = [
  { input: { domain: '', screenWidth: 0 }, expectedKeys: ['screenWidth'] },
  { input: { appName: null, attributes: {}, timezoneOffset: '0' }, expectedKeys: ['timezoneOffset'] },
  { input: { tags: [], enabled: 'false', latitude: 0, longitude: 0 }, expectedKeys: ['enabled', 'latitude', 'longitude'] },
] as const
