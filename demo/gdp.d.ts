import type { gdp as gdpCommand } from '@/uni_modules/gio-uniapp-autotracker/index.js'

declare global {
  /** SDK-owned global command entry. Pages must not import or retain the internal runtime. */
  const gdp: typeof gdpCommand
}

export {}
