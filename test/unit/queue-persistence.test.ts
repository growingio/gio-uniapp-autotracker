import { describe, expect, it } from 'vitest'

import { QueuePersistence } from '../../core/queue-persistence.js'
import { buildAppEvent } from '../../core/protocol.js'
import { EventQueue } from '../../core/queue.js'
import type { StoragePort } from '../../core/ports.js'
import type { ProtocolEvent } from '../../core/protocol.js'

function event(sequence: number): ProtocolEvent {
  const built = buildAppEvent('CUSTOM', {
    deviceId: 'device', sessionId: 'session', dataSourceId: 'source', platform: 'Android', platformVersion: '14', timestamp: sequence,
    domain: 'com.example', appState: 'FOREGROUND', appName: 'Example', networkState: 'WIFI', screenWidth: 0, screenHeight: 0,
    deviceBrand: 'UNKNOWN', deviceModel: 'UNKNOWN', deviceType: 'UNKNOWN', appVersion: '1.0.0', language: 'en-US', timezoneOffset: '0',
    sdkVersion: '0.1.0', eventSequenceId: sequence, eventName: `event_${sequence}`,
  })
  if (!built.ok) throw new Error('fixture_event_invalid')
  return built.event
}

function storage(initial: string | null = null): { port: StoragePort; values: () => string[] } {
  let value = initial
  const values: string[] = []
  return {
    port: {
      persistentQueue: true,
      read: async () => value === null ? { kind: 'missing' } : { kind: 'value', value },
      write: async (_area, _key, next) => { values.push(next); value = next; return { kind: 'ok' } },
      remove: async () => { value = null; return { kind: 'ok' } },
    },
    values: () => values,
  }
}

describe('QueuePersistence', () => {
  it('serializes writes by revision and restores a cold-start queue', async () => {
    const backend = storage()
    const queue = new EventQueue()
    const persistence = new QueuePersistence(backend.port, 'gio:v1:source:queue:v1')
    queue.enqueue(event(1))
    const first = persistence.persist(queue)
    queue.enqueue(event(2))
    const second = persistence.persist(queue)
    await expect(first).resolves.toStrictEqual({ kind: 'ok' })
    await expect(second).resolves.toStrictEqual({ kind: 'ok' })
    expect(persistence.currentRevision()).toBe(2)
    expect(JSON.parse(backend.values()[1]!).revision).toBe(2)

    const restored = new EventQueue()
    const nextPersistence = new QueuePersistence(backend.port, 'gio:v1:source:queue:v1')
    await expect(nextPersistence.hydrate(restored)).resolves.toBe('restored')
    expect(restored.snapshot().map((entry) => entry.event.eventSequenceId)).toStrictEqual([1, 2])
  })

  it('removes only its queue key when a record is malformed', async () => {
    let removed = 0
    const port: StoragePort = {
      persistentQueue: true,
      read: async () => ({ kind: 'value', value: '{not-json' }),
      write: async () => ({ kind: 'ok' }),
      remove: async () => { removed += 1; return { kind: 'ok' } },
    }
    await expect(new QueuePersistence(port, 'gio:v1:source:queue:v1').hydrate(new EventQueue())).resolves.toBe('corrupt')
    expect(removed).toBe(1)
  })

  it('rejects a syntactically valid snapshot whose event bypasses the protocol contract', async () => {
    let removed = 0
    const port: StoragePort = {
      persistentQueue: true,
      read: async () => ({ kind: 'value', value: JSON.stringify({
        version: 1, revision: 1, entries: [{ requestId: 'q1', retryCount: 0, event: { eventType: 'CUSTOM', eventName: 'forged' } }],
      }) }),
      write: async () => ({ kind: 'ok' }),
      remove: async () => { removed += 1; return { kind: 'ok' } },
    }
    const queue = new EventQueue()
    await expect(new QueuePersistence(port, 'gio:v1:source:queue:v1').hydrate(queue)).resolves.toBe('corrupt')
    expect(queue.snapshot()).toStrictEqual([])
    expect(removed).toBe(1)
  })

  it('rejects a persisted request identifier that cannot produce a safe next queue id', async () => {
    const persisted = JSON.stringify({ version: 1, revision: 1, entries: [{ requestId: 'q9007199254740992', retryCount: 0, event: event(1) }] })
    let removed = 0
    const port: StoragePort = {
      persistentQueue: true,
      read: async () => ({ kind: 'value', value: persisted }),
      write: async () => ({ kind: 'ok' }),
      remove: async () => { removed += 1; return { kind: 'ok' } },
    }
    await expect(new QueuePersistence(port, 'gio:v1:source:queue:v1').hydrate(new EventQueue())).resolves.toBe('corrupt')
    expect(removed).toBe(1)
  })

  it('does not advance revision when storage rejects a write', async () => {
    const port: StoragePort = {
      persistentQueue: true,
      read: async () => ({ kind: 'missing' }),
      write: async () => ({ kind: 'quota' }),
      remove: async () => ({ kind: 'ok' }),
    }
    const queue = new EventQueue()
    queue.enqueue(event(1))
    const persistence = new QueuePersistence(port, 'gio:v1:source:queue:v1')
    await expect(persistence.persist(queue)).resolves.toStrictEqual({ kind: 'quota' })
    expect(persistence.currentRevision()).toBe(0)
  })
})
