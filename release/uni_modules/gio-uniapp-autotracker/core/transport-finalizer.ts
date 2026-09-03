import type { TransportHandle, TransportPort, TransportRequest, TransportResult } from './ports.js'

export interface TimerPort {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export type FinalizedTransport = Readonly<{ cancel: () => void }>

/**
 * Gives each dispatch one completion path. A host callback arriving after timeout, cancellation,
 * or a synchronous dispatch exception cannot mutate the queue a second time.
 */
export function dispatchWithFinalizer(
  transport: TransportPort,
  timer: TimerPort,
  request: TransportRequest,
  done: (result: TransportResult) => void,
): FinalizedTransport {
  let settled = false
  let handle: TransportHandle | void
  let timeoutHandle: unknown

  const settle = (result: TransportResult): void => {
    if (settled) return
    settled = true
    timer.clearTimeout(timeoutHandle)
    done(result)
  }

  timeoutHandle = timer.setTimeout(() => {
    try {
      handle?.abort?.()
    } catch {
      // The timeout result is still authoritative when a host abort throws.
    }
    settle({ kind: 'timeout' })
  }, request.timeoutMs)

  try {
    handle = transport.dispatch(request, settle)
  } catch (error) {
    settle({ kind: 'network', message: error instanceof Error ? error.message : undefined })
  }

  return {
    cancel: () => {
      try {
        handle?.abort?.()
      } catch {
        // Cancellation is best effort; it still completes once as aborted.
      }
      settle({ kind: 'aborted' })
    },
  }
}
