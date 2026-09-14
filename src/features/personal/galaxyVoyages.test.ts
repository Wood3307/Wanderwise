import test from 'node:test'
import assert from 'node:assert/strict'
import { connectGalaxyVoyageInbox } from './galaxyVoyages'
import { JOURNEY_EXPORT_PREFIX } from '../galaxy/lib/trip'
import type { GalaxyVoyage } from './types'

const trip: GalaxyVoyage = { version: 1, tripId: 'export-one', query: '星空', startedAt: '2026-09-14T00:00:00.000Z', endedAt: '2026-09-14T00:12:00.000Z', journey: [{ id: 'question:question-12', type: 'question', questionId: 'question-12', title: '真实问题', query: '星空', visitedAt: '2026-09-14T00:01:00.000Z', url: 'https://www.zhihu.com/question/12' }] }
const settled = () => new Promise(resolve => setTimeout(resolve, 0))

test('an authorized queued export is acknowledged only after durable receipt resolves, including initial host-only entry', async () => {
  const target = new EventTarget() as Window
  let complete!: (value: GalaxyVoyage) => void
  const committed = new Promise<GalaxyVoyage>(resolve => { complete = resolve })
  const queued = [trip]
  const receives: string[] = [], acknowledgements: string[] = []
  const disconnect = connectGalaxyVoyageInbox({ target, ready: () => true, list: () => queued,
    receive: packet => { receives.push(packet.tripId); return committed },
    consume: id => { acknowledgements.push(id); return queued.pop() },
  })
  assert.deepEqual(receives, [trip.tripId])
  assert.deepEqual(acknowledgements, [])
  target.dispatchEvent(new Event('wanderwise:journey-export'))
  target.dispatchEvent(new Event('focus'))
  assert.deepEqual(receives, [trip.tripId], 'in-flight scans must not submit the same export twice')
  complete(trip)
  await settled()
  assert.deepEqual(acknowledgements, [trip.tripId])
  assert.deepEqual(queued, [])
  disconnect()
})

test('failed persistence keeps the outbox intact and a later user retry commits once', async () => {
  const target = new EventTarget() as Window
  let attempts = 0
  const queued = [trip]
  const disconnect = connectGalaxyVoyageInbox({ target, ready: () => true, list: () => queued,
    receive: async packet => { attempts++; if (attempts === 1) throw new Error('quota'); return packet },
    consume: () => queued.pop(),
  })
  await settled()
  assert.deepEqual(queued, [trip])
  target.dispatchEvent(new Event('wanderwise:journey-retry'))
  await settled()
  assert.equal(attempts, 2)
  assert.deepEqual(queued, [])
  disconnect()
})

test('return, discard, forged payload and memory-only synchronous failure never become imported history', async () => {
  const target = new EventTarget() as Window
  let received = 0
  const disconnect = connectGalaxyVoyageInbox({ target, ready: () => true, list: () => [], receive: async packet => { received++; return packet }, consume: () => undefined })
  for (const name of ['wanderwise:return', 'wanderwise:journey-export', 'wanderwise:journey-export-pending']) {
    const event = new Event(name)
    Object.defineProperty(event, 'detail', { value: trip })
    target.dispatchEvent(event)
  }
  await settled()
  assert.equal(received, 0)
  disconnect()
})

test('only queued valid packets and relevant storage signals are received, and cleanup removes listeners', async () => {
  const target = new EventTarget() as Window
  let scans = 0
  let available = false
  const received: string[] = []
  const disconnect = connectGalaxyVoyageInbox({ target, ready: () => true, list: () => { scans++; return available ? [trip, { ...trip, tripId: '../invalid' }] : [] }, receive: async packet => { received.push(packet.tripId); return packet }, consume: () => { available = false; return trip } })
  available = true
  const storage = (key: string, newValue: string | null) => { const event = new Event('storage'); Object.defineProperties(event, { key: { value: key }, newValue: { value: newValue } }); target.dispatchEvent(event) }
  storage('unrelated-key', 'changed')
  storage(`${JOURNEY_EXPORT_PREFIX}${trip.tripId}`, null)
  assert.equal(scans, 1)
  storage(`${JOURNEY_EXPORT_PREFIX}${trip.tripId}`, '{}')
  await settled()
  assert.deepEqual(received, [trip.tripId])
  disconnect()
  const scansBefore = scans
  target.dispatchEvent(new Event('focus'))
  target.dispatchEvent(new Event('wanderwise:journey-export'))
  storage(`${JOURNEY_EXPORT_PREFIX}${trip.tripId}`, '{}')
  assert.equal(scans, scansBefore)
})
