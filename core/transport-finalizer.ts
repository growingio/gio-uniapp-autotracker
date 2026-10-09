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

  const settle = (result: TransportResult, abort = false): void => {
    if (settled) return
    settled = true
    timer.clearTimeout(timeoutHandle)
    if (abort) {
      try {
        handle?.abort?.()
      } catch {
        // The authoritative result was locked before invoking host code.
      }
    }
    done(result)
  }

  timeoutHandle = timer.setTimeout(() => {
    settle({ kind: 'timeout' }, true)
  }, request.timeoutMs)

  try {
    handle = transport.dispatch(request, settle)
  } catch (error) {
    settle({ kind: 'network', message: error instanceof Error ? error.message : undefined })
  }

  return {
    cancel: () => { settle({ kind: 'aborted' }, true) },
  }
}
