import type { JourneyStop } from '../types';

export const TRIP_SESSION_KEY = 'wanderwise.trip-session.v1';
export const JOURNEY_EXPORT_PREFIX = 'wanderwise.journey-export.v1.';
export const MAX_TRIP_LENGTH = 4_000_000;
const MAX_STOPS = 1000;

export interface TripSession {
  id: string;
  startedAt: string;
  journey: JourneyStop[];
}

export interface JourneyExportStop extends JourneyStop { url?: string }

export interface JourneyExportPacket {
  version: 1;
  tripId: string;
  startedAt: string;
  endedAt: string;
  query: string;
  journey: JourneyExportStop[];
}

const sessions = new WeakMap<Window, TripSession>();
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0);
const timestamp = (value: unknown): value is string =>
  text(value, 64) && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
export const validTripId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);

function safeSourceUrl(value: unknown): string | undefined {
  if (!text(value, 4000)) return undefined;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href : undefined;
  } catch { return undefined; }
}

/** Normalize only bounded, source-backed visit records; discard unknown properties. */
function normalizeJourney(value: unknown): JourneyExportStop[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_STOPS) return undefined;
  const seen = new Set<string>();
  const result: JourneyExportStop[] = [];
  for (const raw of value) {
    const stop = object(raw);
    if (!stop || !text(stop.id, 512) || !text(stop.title, 2000)
      || (stop.type !== 'question' && stop.type !== 'answer') || !text(stop.questionId, 512)
      || (stop.answerId !== undefined && !text(stop.answerId, 512, true))
      || !text(stop.query, 300, true) || !timestamp(stop.visitedAt)) return undefined;
    if (seen.has(stop.id)) continue;
    seen.add(stop.id);
    const url = safeSourceUrl(stop.url);
    result.push({
      id: stop.id, title: stop.title, type: stop.type as JourneyStop['type'],
      questionId: stop.questionId, query: stop.query, visitedAt: stop.visitedAt,
      ...(stop.answerId !== undefined ? { answerId: stop.answerId as string } : {}),
      ...(url ? { url } : {}),
    });
  }
  return result;
}

function normalizeSession(value: unknown): TripSession | undefined {
  const session = object(value);
  if (!session || !validTripId(session.id) || !timestamp(session.startedAt)) return undefined;
  const journey = normalizeJourney(session.journey);
  return journey ? { id: session.id, startedAt: session.startedAt, journey } : undefined;
}

function snapshot(session: TripSession): TripSession {
  return { ...session, journey: session.journey.map(stop => ({ ...stop })) };
}

function persist(session: TripSession): boolean {
  // Keep a usable current trip even if private browsing or quota prevents persistence.
  sessions.set(window, session);
  try {
    const serialized = JSON.stringify(session);
    if (serialized.length > MAX_TRIP_LENGTH) return false;
    window.sessionStorage.setItem(TRIP_SESSION_KEY, serialized);
    return true;
  } catch { return false; }
}

/** An explicit observatory entry or an ended trip always begins a fresh record. */
export function startNewTrip(): TripSession {
  const session: TripSession = {
    id: globalThis.crypto?.randomUUID?.() ?? `trip-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    startedAt: new Date().toISOString(), journey: [],
  };
  if (!persist(session)) {
    // Replacing an ended trip must not leave its old recoverable record behind.
    // Removal can still work when writing is blocked (for example, a quota failure).
    try { window.sessionStorage.removeItem(TRIP_SESSION_KEY); }
    catch { /* Fully blocked storage still leaves the fresh session usable in memory. */ }
  }
  return snapshot(session);
}

/** Idempotent in one document (including React StrictMode). Never reads legacy local history. */
export function initializeTripSession(): TripSession {
  const active = sessions.get(window);
  if (active) return snapshot(active);
  try {
    const navigation = window.performance?.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    // A new document/navigation also resets copied sessionStorage in duplicated/opened tabs.
    // Reload and back/forward restore only this tab's still-current trip.
    if (navigation?.type === 'reload' || navigation?.type === 'back_forward') {
      const raw = window.sessionStorage.getItem(TRIP_SESSION_KEY);
      if (raw && raw.length <= MAX_TRIP_LENGTH) {
        const session = normalizeSession(JSON.parse(raw));
        if (session) { sessions.set(window, session); return snapshot(session); }
      }
    }
  } catch { /* Corrupt/blocked storage starts a new, usable trip. */ }
  return startNewTrip();
}

export const getTripSession = initializeTripSession;
export const loadCurrentJourney = (): JourneyStop[] => getTripSession().journey;

export function saveCurrentJourney(items: JourneyStop[]): boolean {
  if (!Array.isArray(items)) return false;
  const journey = normalizeJourney(items.slice(0, MAX_STOPS));
  if (!journey) return false;
  const session = { ...getTripSession(), journey };
  if (JSON.stringify(session).length > MAX_TRIP_LENGTH) return false;
  return persist(session);
}

export function normalizeJourneyExport(value: unknown): JourneyExportPacket | undefined {
  const packet = object(value);
  if (!packet || packet.version !== 1 || !validTripId(packet.tripId)
    || !timestamp(packet.startedAt) || !timestamp(packet.endedAt)
    || Date.parse(packet.endedAt) < Date.parse(packet.startedAt)
    || !text(packet.query, 300, true)) return undefined;
  const journey = normalizeJourney(packet.journey);
  if (!journey) return undefined;
  const result: JourneyExportPacket = {
    version: 1, tripId: packet.tripId, startedAt: packet.startedAt,
    endedAt: packet.endedAt, query: packet.query, journey,
  };
  return JSON.stringify(result).length <= MAX_TRIP_LENGTH ? result : undefined;
}

/** Called only after the user chooses to export; source URLs are supplied from actual content. */
export function createJourneyExport(options: {
  query: string;
  journey?: JourneyStop[];
  sourceUrls?: Record<string, string>;
}): JourneyExportPacket {
  const session = getTripSession();
  const journey = (options.journey ?? session.journey).map(stop => {
    const url = safeSourceUrl(options.sourceUrls?.[stop.id]
      ?? options.sourceUrls?.[`${stop.type}:${stop.answerId ?? stop.questionId}`]);
    return { ...stop, ...(url ? { url } : {}) };
  });
  const packet = normalizeJourneyExport({
    version: 1, tripId: session.id, startedAt: session.startedAt,
    endedAt: new Date(Math.max(Date.now(), Date.parse(session.startedAt))).toISOString(),
    query: options.query, journey,
  });
  if (!packet) throw new Error('无法导出无效或过大的旅行足迹');
  return packet;
}
