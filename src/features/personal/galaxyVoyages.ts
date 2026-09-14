import { consumeJourneyExport, listJourneyExports } from '../galaxy/lib/integration'
import { JOURNEY_EXPORT_PREFIX, normalizeJourneyExport } from '../galaxy/lib/trip'
import type { GalaxyVoyage } from './types'
import { receiveGalaxyVoyage, usePersonalStore } from './store'

interface InboxOptions {
  target?: Window
  list?: () => GalaxyVoyage[]
  consume?: (tripId: string) => GalaxyVoyage | undefined
  receive?: (value: GalaxyVoyage) => Promise<GalaxyVoyage>
  ready?: () => boolean
}

/** Mounted once by the host, including on routes where the galaxy bundle is not mounted. */
export function connectGalaxyVoyageInbox(options: InboxOptions = {}): () => void {
  const target = options.target ?? window
  const list = options.list ?? listJourneyExports
  const consume = options.consume ?? consumeJourneyExport
  const receive = options.receive ?? receiveGalaxyVoyage
  const ready = options.ready ?? (() => usePersonalStore.getState().ready)
  const pending = new Set<string>()
  let active = true
  const scan = () => {
    if (!active || !ready()) return
    for (const value of list()) {
      const packet = normalizeJourneyExport(value)
      if (!packet || pending.has(packet.tripId)) continue
      pending.add(packet.tripId)
      void receive(packet).then(() => {
        // Persist first. A failed transaction must leave the authorized export in its outbox.
        consume(packet.tripId)
      }).catch(() => {
        // The personal store shows the storage error. Reopen/focus or explicit retry can recover.
      }).finally(() => pending.delete(packet.tripId))
    }
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(JOURNEY_EXPORT_PREFIX) && event.newValue !== null) scan()
  }
  // Signals never become records themselves: only packets in the explicitly authorized outbox qualify.
  target.addEventListener('wanderwise:journey-export', scan)
  target.addEventListener('wanderwise:journey-retry', scan)
  target.addEventListener('storage', onStorage)
  target.addEventListener('focus', scan)
  scan()
  return () => {
    active = false
    target.removeEventListener('wanderwise:journey-export', scan)
    target.removeEventListener('wanderwise:journey-retry', scan)
    target.removeEventListener('storage', onStorage)
    target.removeEventListener('focus', scan)
  }
}
