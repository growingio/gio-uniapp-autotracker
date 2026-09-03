export const AUTO_TRACK_SCHEMA_VERSION = 1 as const

export type AutoTrackCall = Readonly<{
  schemaVersion: typeof AUTO_TRACK_SCHEMA_VERSION
  kind: 'click' | 'change'
  xpath: unknown
  textValue?: unknown
  index?: unknown
  hyperlink?: unknown
  ignored?: unknown
  trackValue?: unknown
  sensitive?: unknown
}>

export type NormalizedAutoTrackCall = Readonly<{
  kind: 'click' | 'change'
  xpath: string
  textValue: string | null
  index: number | null
  hyperlink: string | null
  ignored: boolean
  trackValue: boolean
  sensitive: boolean
}>

function optionalText(value: unknown): string | null {
  let text: string
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') text = String(value)
  else if (Array.isArray(value) && value.every((item) => typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')) text = value.map(String).join('||')
  else return null
  const normalized = text.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 100)
  return normalized.length > 0 ? normalized : null
}

/** The compiler may only forward this constrained JSON call; component values and host objects are rejected. */
export function normalizeAutoTrackCall(value: AutoTrackCall): NormalizedAutoTrackCall | null {
  if (value.schemaVersion !== AUTO_TRACK_SCHEMA_VERSION || (value.kind !== 'click' && value.kind !== 'change') || typeof value.xpath !== 'string' || value.xpath.length === 0) return null
  const index = typeof value.index === 'number' && Number.isSafeInteger(value.index) && value.index >= 0 ? value.index : null
  return {
    kind: value.kind,
    xpath: value.xpath,
    textValue: optionalText(value.textValue),
    index,
    hyperlink: optionalText(value.hyperlink),
    ignored: value.ignored === true,
    trackValue: value.trackValue === true,
    sensitive: value.sensitive === true,
  }
}
