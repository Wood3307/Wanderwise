import type { JourneyStop, ObservatoryEntry, Reflection, SavedItem } from '../types';

export interface ObservatorySummary {
  collection?: SavedItem[];
  reflections?: Reflection[];
  journey?: JourneyStop[];
}

interface WanderwiseBridge {
  enter: (entry: ObservatoryEntry) => void;
  [key: string]: unknown;
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
  const bridge: WanderwiseBridge = { ...previousBridge, enter: receive };
  window.Wanderwise = bridge;
  window.addEventListener('wanderwise:enter', onEvent);
  window.addEventListener('message', onMessage);
  window.dispatchEvent(new CustomEvent('wanderwise:ready', {
    detail: { version: 1, entry: getInitialEntry() },
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
