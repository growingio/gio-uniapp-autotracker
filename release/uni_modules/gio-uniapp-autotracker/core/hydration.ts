import type { EventSequenceSnapshot } from './event-sequence.js'
import type { IdentityHydration } from './identity-persistence.js'
import type { AppSystemContext } from './ports.js'
import type { QueueHydration } from './queue-persistence.js'
import type { SessionHydration } from './session-persistence.js'

export type HydratedTrackerState = Readonly<{
  identity: IdentityHydration
  session: SessionHydration
  meta: Readonly<{ snapshot: EventSequenceSnapshot; source: string }>
  queue: QueueHydration
  systemContext: AppSystemContext
}>

export type HydrationDependencies = Readonly<{
  hydrateIdentity: () => Promise<IdentityHydration>
  hydrateSession: () => Promise<SessionHydration>
  hydrateMeta: () => Promise<Readonly<{ snapshot: EventSequenceSnapshot; source: string }>>
  hydrateQueue: () => Promise<QueueHydration>
  loadSystemContext: () => Promise<AppSystemContext>
}>

export type HydrationResult =
  | Readonly<{ ok: true; state: HydratedTrackerState }>
  | Readonly<{ ok: false; code: 'system_context_unavailable' }>

/** One readiness gate: buffered events are released only after every state record and context resolve. */
export async function hydrateTrackerState(dependencies: HydrationDependencies): Promise<HydrationResult> {
  try {
    const [identity, session, meta, queue, systemContext] = await Promise.all([
      dependencies.hydrateIdentity(),
      dependencies.hydrateSession(),
      dependencies.hydrateMeta(),
      dependencies.hydrateQueue(),
      dependencies.loadSystemContext(),
    ])
    return { ok: true, state: { identity, session, meta, queue, systemContext } }
  } catch {
    return { ok: false, code: 'system_context_unavailable' }
  }
}
