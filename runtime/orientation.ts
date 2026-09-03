export type PageOrientation = 'PORTRAIT' | 'LANDSCAPE'

export type OrientationInput = Readonly<{
  deviceOrientation?: unknown
  windowWidth?: unknown
  windowHeight?: unknown
}>

function normalizedOrientation(value: unknown): PageOrientation | null {
  if (typeof value !== 'string') return null
  const source = value.trim().toLowerCase()
  if (source === 'portrait') return 'PORTRAIT'
  if (source === 'landscape') return 'LANDSCAPE'
  return null
}

function inferredOrientation(width: unknown, height: unknown): PageOrientation | null {
  if (typeof width !== 'number' || typeof height !== 'number'
    || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width === height) return null
  return width > height ? 'LANDSCAPE' : 'PORTRAIT'
}

/** Resolves one PAGE orientation from host snapshots without keeping a host object in runtime state. */
export class OrientationResolver {
  private lastObserved: PageOrientation | null = null

  public resolve(input: OrientationInput): PageOrientation {
    const observed = normalizedOrientation(input.deviceOrientation) ?? inferredOrientation(input.windowWidth, input.windowHeight)
    if (observed !== null) {
      this.lastObserved = observed
      return observed
    }
    return this.lastObserved ?? 'PORTRAIT'
  }
}
