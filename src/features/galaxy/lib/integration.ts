/* eslint-disable no-control-regex -- Explicitly reject control bytes in untrusted entry and return values. */
import type { JourneyStop, ObservatoryEntry, Reflection, SavedItem } from '../types';
import {
  JOURNEY_EXPORT_PREFIX, MAX_TRIP_LENGTH, normalizeJourneyExport, validTripId,
  type JourneyExportPacket,
} from './trip';

export interface ObservatorySummary {
  collection?: SavedItem[];
  reflections?: Reflection[];
  journey?: JourneyStop[];
  trip?: JourneyExportPacket;
}

interface WanderwiseBridge {
  enter: (entry: ObservatoryEntry) => void;
  listJourneyExports?: () => JourneyExportPacket[];
  consumeJourneyExport?: (tripId: string) => JourneyExportPacket | undefined;
  [key: string]: unknown;
}

interface ExportRecord { packet: JourneyExportPacket; persisted: boolean; consumed: boolean }
const pendingExports = new WeakMap<Window, Map<string, ExportRecord>>();
const MAX_LISTED_EXPORTS = 200;

function outbox(): Map<string, ExportRecord> {
  let entries = pendingExports.get(window);
  if (!entries) { entries = new Map(); pendingExports.set(window, entries); }
  return entries;
}

function readExport(tripId: string): ExportRecord | undefined {
  if (!validTripId(tripId)) return undefined;
  try {
    const raw = window.localStorage.getItem(`${JOURNEY_EXPORT_PREFIX}${tripId}`);
    const cached = outbox().get(tripId);
    if (raw === null && cached?.persisted) {
      // Another same-origin tab may already have consumed this packet.
      cached.consumed = true;
      outbox().delete(tripId);
      return undefined;
    }
    if (raw && raw.length <= MAX_TRIP_LENGTH) {
      const packet = normalizeJourneyExport(JSON.parse(raw));
      if (packet && packet.tripId === tripId) {
        // Keep the receipt object so a synchronous host consumption can be acknowledged.
        if (cached) { cached.packet = packet; cached.persisted = true; return cached; }
        const entry = { packet, persisted: true, consumed: false };
        outbox().set(tripId, entry);
        return entry;
      }
    }
  } catch { /* A host in this document can still consume a memory-only export. */ }
  return outbox().get(tripId);
}

/** Pending, explicitly authorized exports; these are not part of the current travel history. */
export function listJourneyExports(): JourneyExportPacket[] {
  const ids = new Set(outbox().keys());
  try {
    // Bound scans even when other same-origin applications have many unrelated records.
    for (let i = 0; i < Math.min(window.localStorage.length, 10_000); i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(JOURNEY_EXPORT_PREFIX)) ids.add(key.slice(JOURNEY_EXPORT_PREFIX.length));
      if (ids.size >= MAX_LISTED_EXPORTS) break;
    }
  } catch { /* Storage may be unavailable; preserve the current document's export. */ }
  return [...ids].slice(0, MAX_LISTED_EXPORTS).flatMap(id => {
    const entry = readExport(id);
    return entry ? [structuredClone(entry.packet)] : [];
  }).sort((a, b) => a.endedAt.localeCompare(b.endedAt));
}

/** Host acknowledgement: removes a single delivered packet, never another tab's trip. */
export function consumeJourneyExport(tripId: string): JourneyExportPacket | undefined {
  const entry = readExport(tripId);
  if (!entry) return undefined;
  if (entry.persisted) {
    try { window.localStorage.removeItem(`${JOURNEY_EXPORT_PREFIX}${tripId}`); }
    catch { return undefined; }
  }
  entry.consumed = true;
  outbox().delete(tripId);
  return structuredClone(entry.packet);
}

export interface JourneyExportResult {
  /** Safely queued for a same-origin observatory, including when it is not currently open. */
  stored: boolean;
  /** A host synchronously consumed this packet. Posting an event alone does not mean delivery. */
  acknowledged: boolean;
}

/** Invoke only after the user explicitly chooses to export. No unload/network side effects. */
export function exportJourneyToObservatory(value: JourneyExportPacket): JourneyExportResult {
  const packet = normalizeJourneyExport(value);
  if (!packet) return { stored: false, acknowledged: false };
  const receipt: ExportRecord = { packet, persisted: false, consumed: false };
  outbox().set(packet.tripId, receipt);
  try {
    window.localStorage.setItem(`${JOURNEY_EXPORT_PREFIX}${packet.tripId}`, JSON.stringify(packet));
    receipt.persisted = true;
  } catch { /* An active host can synchronously accept the memory-only handoff below. */ }
  if (!receipt.persisted) {
    // Do not send the full packet into an asynchronous channel when we cannot retain it.
    // A synchronously running host may claim responsibility through consumeJourneyExport.
    // Otherwise a failed attempt must leave no packet that could be exported after discard.
    window.dispatchEvent(new CustomEvent('wanderwise:journey-export-pending', {
      detail: { version: 1, tripId: packet.tripId },
    }));
    if (!receipt.consumed) outbox().delete(packet.tripId);
    return { stored: false, acknowledged: receipt.consumed };
  }
  window.dispatchEvent(new CustomEvent('wanderwise:journey-export', { detail: structuredClone(packet) }));
  const targets = new Set<Window>();
  if (window.parent && window.parent !== window) targets.add(window.parent);
  if (window.opener && window.opener !== window) targets.add(window.opener);
  for (const target of targets) {
    try {
      if (target.location.origin !== window.location.origin) continue;
      target.postMessage({ type: 'wanderwise:journey-export', payload: structuredClone(packet) }, window.location.origin);
    } catch { /* A cross-origin or closed host must not receive the user's journey. */ }
  }
  return { stored: receipt.persisted && !receipt.consumed, acknowledged: receipt.consumed };
}

declare global {
  interface Window {
    Wanderwise?: WanderwiseBridge;
  }
}

function queryText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 160);
}

/** Only local relative paths are accepted, including after URL normalization. */
function safeReturnUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > 2000
    || value.trim() !== value || /[\\\u0000-\u0020\u007F]/.test(value)
    || value.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(value)) return undefined;
  try {
    const url = new URL(value, window.location.href);
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return undefined;
    // A normalized root path beginning with // would become protocol-relative
    // if used as location.assign's argument, even when the parsed URL was local.
    if (url.pathname.startsWith('//')) return undefined;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return undefined;
  }
}

function entryFrom(value: unknown): ObservatoryEntry | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  if (typeof data.query !== 'string') return undefined;
  const returnUrl = safeReturnUrl(data.returnUrl);
  return { query: queryText(data.query), ...(returnUrl ? { returnUrl } : {}) };
}

export function getInitialEntry(): ObservatoryEntry {
  const params = new URLSearchParams(window.location.search);
  return entryFrom({
    query: params.get('q') ?? params.get('topic') ?? '',
    returnUrl: params.get('returnUrl') ?? params.get('return'),
  })!;
}

/** Register the three supported entry channels and restore the host bridge on cleanup. */
export function registerObservatoryEntry(callback: (entry: ObservatoryEntry) => void): () => void {
  const receive = (value: unknown) => {
    const entry = entryFrom(value);
    if (entry) callback(entry);
  };
  const onEvent = (event: Event) => receive((event as CustomEvent<unknown>).detail);
  const onMessage = (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin || !event.data
      || typeof event.data !== 'object' || Array.isArray(event.data)) return;
    const data = event.data as Record<string, unknown>;
    if (data.type === 'wanderwise:enter') receive(data.payload);
  };
  const previousBridge = window.Wanderwise;
  const bridge: WanderwiseBridge = {
    ...previousBridge, enter: receive, listJourneyExports, consumeJourneyExport,
  };
  window.Wanderwise = bridge;
  window.addEventListener('wanderwise:enter', onEvent);
  window.addEventListener('message', onMessage);
  window.dispatchEvent(new CustomEvent('wanderwise:ready', {
    detail: { version: 1, entry: getInitialEntry(), capabilities: ['journey-export-v1'] },
  }));

  return () => {
    window.removeEventListener('wanderwise:enter', onEvent);
    window.removeEventListener('message', onMessage);
    if (window.Wanderwise === bridge) {
      if (previousBridge) window.Wanderwise = previousBridge;
      else delete window.Wanderwise;
    }
  };
}

/** Hosts may preventDefault() on wanderwise:return to handle the transition themselves. */
export function returnToObservatory(entry: ObservatoryEntry, summary: ObservatorySummary = {}): boolean {
  const normalized = entryFrom(entry);
  if (!normalized) return false;
  const event = new CustomEvent('wanderwise:return', {
    cancelable: true,
    detail: {
      query: normalized.query,
      summary,
      returnedAt: new Date().toISOString(),
    },
  });
  if (!window.dispatchEvent(event)) return true;
  if (!normalized.returnUrl) return false;
  try {
    window.location.assign(normalized.returnUrl);
    return true;
  } catch {
    return false;
  }
}
