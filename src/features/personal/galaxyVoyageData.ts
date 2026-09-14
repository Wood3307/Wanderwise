import { normalizeJourneyExport } from '../galaxy/lib/trip'
import type { GalaxyVoyage } from './types'

export const MAX_GALAXY_VOYAGES = 1000

/** First receipt wins: retrying the same exported trip must not replace its history. */
export function mergeGalaxyVoyages(current: GalaxyVoyage[], incoming: GalaxyVoyage[]): GalaxyVoyage[] {
  const trips = new Map<string, GalaxyVoyage>()
  for (const value of [...current, ...incoming]) {
    const trip = normalizeJourneyExport(value)
    if (!trip) throw new Error('漫游足迹格式无效')
    if (!trips.has(trip.tripId)) trips.set(trip.tripId, trip)
  }
  if (trips.size > MAX_GALAXY_VOYAGES) throw new Error('漫游日志已达到容量，请先导出个人空间备份。')
  return [...trips.values()].sort((a, b) => b.endedAt.localeCompare(a.endedAt))
}
