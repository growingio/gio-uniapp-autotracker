export const MAX_BOOTSTRAP_BUFFER_ITEMS = 50
export const MAX_BOOTSTRAP_BUFFER_BYTES = 256 * 1024

export type BootstrapBufferLimits = Readonly<{ maxItems: number; maxBytes: number }>

const DEFAULT_LIMITS: BootstrapBufferLimits = {
  maxItems: MAX_BOOTSTRAP_BUFFER_ITEMS,
  maxBytes: MAX_BOOTSTRAP_BUFFER_BYTES,
}

function utf8ByteLength(value: string): number {
  let size = 0
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit <= 0x7f) size += 1
    else if (unit <= 0x7ff) size += 2
    else if (unit >= 0xd800 && unit <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      size += 4
      index += 1
    } else size += 3
  }
  return size
}

/** Captures JSON snapshots while state/system hydration is incomplete; never evicts old intents. */
export class BootstrapBuffer {
  private readonly serialized: string[] = []

  public constructor(private readonly limits: BootstrapBufferLimits = DEFAULT_LIMITS) {}

  public push(intent: unknown): boolean {
    let value: string | undefined
    try {
      value = JSON.stringify(intent)
    } catch {
      return false
    }
    if (value === undefined || this.serialized.length >= this.limits.maxItems) return false
    const candidate = `[${this.serialized.concat(value).join(',')}]`
    if (utf8ByteLength(candidate) > this.limits.maxBytes) return false
    this.serialized.push(value)
    return true
  }

  public drain(): readonly unknown[] {
    const values = JSON.parse(`[${this.serialized.join(',')}]`) as unknown[]
    this.serialized.splice(0, this.serialized.length)
    return values
  }

  public size(): number {
    return this.serialized.length
  }
}
