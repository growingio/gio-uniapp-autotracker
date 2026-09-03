export type Location = Readonly<{ latitude: number; longitude: number }>

/** Memory-only explicit business location; it never requests a permission or touches storage. */
export class LocationState {
  private location: Location | null = null

  public set(latitude: unknown, longitude: unknown): boolean {
    if (typeof latitude !== 'number' || typeof longitude !== 'number'
      || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false
    this.location = { latitude, longitude }
    return true
  }

  public clear(): void {
    this.location = null
  }

  public current(): Location | null {
    return this.location === null ? null : { ...this.location }
  }
}
