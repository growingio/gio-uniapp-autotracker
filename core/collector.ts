import type { TransportRequest, TransportResult } from './ports.js'
import type { ProtocolEvent } from './protocol.js'

export const COLLECT_REQUEST_TIMEOUT_MS = 5_000

export type CollectorRequestResult =
  | Readonly<{ ok: true; request: TransportRequest }>
  | Readonly<{ ok: false; code: 'invalid_send_time' | 'events_not_serializable' }>

/** Creates the only collector request shape permitted to reach a platform transport adapter. */
export function buildCollectorRequest(
  serverUrl: string,
  accountId: string,
  events: readonly ProtocolEvent[],
  sendAt: number,
): CollectorRequestResult {
  if (!Number.isFinite(sendAt) || sendAt < 0) return { ok: false, code: 'invalid_send_time' }
  let body: string
  try {
    body = JSON.stringify(events)
  } catch {
    return { ok: false, code: 'events_not_serializable' }
  }
  return {
    ok: true,
    request: {
      url: `${serverUrl}/v3/projects/${encodeURIComponent(accountId)}/collect?stm=${sendAt}&compress=0`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
      timeoutMs: COLLECT_REQUEST_TIMEOUT_MS,
    },
  }
}

/** Only collector 200 and 204 mean accepted; every other HTTP status is a failure. */
export function normalizeCollectorResult(result: TransportResult): TransportResult {
  if (result.kind === 'success' && result.status !== 200 && result.status !== 204) {
    return { kind: 'http', status: result.status }
  }
  return result
}

export function isRetryableCollectorFailure(result: TransportResult): boolean {
  return result.kind === 'network' || result.kind === 'timeout' || (result.kind === 'http' && result.status >= 500)
}
