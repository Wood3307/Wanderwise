/// <reference types="node" />
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ObservatoryEntry } from '../types';
import {
  consumeJourneyExport, exportJourneyToObservatory, getInitialEntry, listJourneyExports,
  registerObservatoryEntry, returnToObservatory,
} from './integration';
import { JOURNEY_EXPORT_PREFIX, type JourneyExportPacket } from './trip';

class TestCustomEvent<T = unknown> extends Event {
  detail: T;
  constructor(type: string, options: CustomEventInit<T> = {}) {
    super(type, options);
    this.detail = options.detail as T;
  }
}

let previousWindow: PropertyDescriptor | undefined;
let previousCustomEvent: PropertyDescriptor | undefined;
let navigations: string[];
let cleanup: (() => void) | undefined;
let storage: Map<string, string>;

beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  navigations = [];
  storage = new Map();
  const mock = Object.assign(new EventTarget(), {
    location: {
      href: 'https://wanderwise.test/explore', origin: 'https://wanderwise.test', search: '',
      assign: (url: string) => { navigations.push(url); },
    },
    localStorage: {
      get length() { return storage.size; },
      key: (index: number) => [...storage.keys()][index] ?? null,
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: mock });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: TestCustomEvent });
});

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (previousCustomEvent) Object.defineProperty(globalThis, 'CustomEvent', previousCustomEvent);
  else Reflect.deleteProperty(globalThis, 'CustomEvent');
});

function post(origin: string, data: unknown): void {
  const event = new Event('message');
  Object.defineProperties(event, { origin: { value: origin }, data: { value: data } });
  window.dispatchEvent(event);
}

test('initial entry uses q/topic parameters and defaults to discovery', () => {
  assert.deepEqual(getInitialEntry(), { query: '' });
  window.location.search = '?topic=大学生实习&returnUrl=%2Fobservatory%3Froom%3D1';
  assert.deepEqual(getInitialEntry(), { query: '大学生实习', returnUrl: '/observatory?room=1' });
  window.location.search = '?q=如何学习&topic=ignored&return=.%2Fhouse';
  assert.deepEqual(getInitialEntry(), { query: '如何学习', returnUrl: '/house' });
});

test('entry channels validate query values and accept only same-origin messages', () => {
  const entries: ObservatoryEntry[] = [];
  let readyCount = 0;
  window.addEventListener('wanderwise:ready', () => { readyCount++; });
  cleanup = registerObservatoryEntry((entry) => entries.push(entry));
  assert.equal(readyCount, 1);
  post('https://attacker.test', { type: 'wanderwise:enter', payload: { query: 'injected' } });
  post('null', { type: 'wanderwise:enter', payload: { query: 'injected' } });
  post(window.location.origin, { type: 'wanderwise:enter', payload: { query: 42 } });
  post(window.location.origin, { type: 'other', payload: { query: 'ignored' } });
  window.dispatchEvent(new CustomEvent('wanderwise:enter', { detail: null }));
  assert.equal(entries.length, 0);
  post(window.location.origin, { type: 'wanderwise:enter', payload: { query: '  学习\u0000方法  ', returnUrl: '/observatory' } });
  window.dispatchEvent(new CustomEvent('wanderwise:enter', { detail: { query: '职业规划' } }));
  window.Wanderwise?.enter({ query: 'x'.repeat(400) });
  assert.deepEqual(entries.slice(0, 2), [{ query: '学习 方法', returnUrl: '/observatory' }, { query: '职业规划' }]);
  assert.equal(entries[2].query.length, 160);
});

test('return URLs reject absolute, external, executable and normalization-based navigation', () => {
  for (const returnUrl of [
    'https://attacker.test/house', 'https://wanderwise.test/house', '//attacker.test/house',
    'javascript:alert(1)', 'data:text/html,test', '/\\attacker.test', '/.//attacker.test',
    '\n//attacker.test', ' /house', '/house\t',
  ]) {
    window.location.search = `?q=test&returnUrl=${encodeURIComponent(returnUrl)}`;
    assert.deepEqual(getInitialEntry(), { query: 'test' }, returnUrl);
    assert.equal(returnToObservatory({ query: 'test', returnUrl }), false, returnUrl);
  }
  assert.deepEqual(navigations, []);
});

test('return event carries local notes and navigates to a valid same-origin path', () => {
  let detail: unknown;
  window.addEventListener('wanderwise:return', (event) => { detail = (event as CustomEvent).detail; });
  const summary = { collection: [], reflections: [], journey: [] };
  assert.equal(returnToObservatory({ query: '学习', returnUrl: '/observatory?room=1#desk' }, summary), true);
  assert.deepEqual(navigations, ['/observatory?room=1#desk']);
  assert.equal((detail as { query: string }).query, '学习');
  assert.deepEqual((detail as { summary: unknown }).summary, summary);
  assert.ok(Number.isFinite(Date.parse((detail as { returnedAt: string }).returnedAt)));
});

test('host may handle the return event and prevent default navigation', () => {
  window.addEventListener('wanderwise:return', (event) => event.preventDefault());
  assert.equal(returnToObservatory({ query: '学习', returnUrl: '/house' }), true);
  assert.deepEqual(navigations, []);
});

test('cleanup removes both listeners and restores the existing host bridge', () => {
  const originalBridge = { enter: () => {}, hostVersion: 2 };
  window.Wanderwise = originalBridge;
  const entries: ObservatoryEntry[] = [];
  cleanup = registerObservatoryEntry((entry) => entries.push(entry));
  assert.equal(window.Wanderwise.hostVersion, 2);
  assert.equal(typeof window.Wanderwise.listJourneyExports, 'function');
  cleanup();
  cleanup = undefined;
  assert.equal(window.Wanderwise, originalBridge);
  post(window.location.origin, { type: 'wanderwise:enter', payload: { query: 'ignored' } });
  window.dispatchEvent(new CustomEvent('wanderwise:enter', { detail: { query: 'ignored' } }));
  assert.deepEqual(entries, []);
});

const packet: JourneyExportPacket = {
  version: 1, tripId: 'trip-a', startedAt: '2026-09-14T08:00:00.000Z', endedAt: '2026-09-14T09:00:00.000Z',
  query: '宇宙', journey: [{ id: 'visit-1', title: '引力如何影响时空？', questionId: '123', type: 'question',
    query: '宇宙', visitedAt: '2026-09-14T08:30:00.000Z', url: 'https://www.zhihu.com/question/123' }],
};

test('explicit exports queue separately by trip ID, remain until consumed and never mix sessions', () => {
  cleanup = registerObservatoryEntry(() => {});
  const received: JourneyExportPacket[] = [];
  window.addEventListener('wanderwise:journey-export', event => received.push((event as CustomEvent).detail));
  assert.deepEqual(exportJourneyToObservatory(packet), { stored: true, acknowledged: false });
  assert.deepEqual(exportJourneyToObservatory({ ...packet, tripId: 'trip-b', query: '另一趟旅行' }), { stored: true, acknowledged: false });
  assert.equal(received.length, 2);
  assert.equal(storage.size, 2);
  assert.deepEqual(window.Wanderwise?.listJourneyExports?.().map(item => item.tripId), ['trip-a', 'trip-b']);
  assert.deepEqual(window.Wanderwise?.consumeJourneyExport?.('trip-a'), packet);
  assert.equal(consumeJourneyExport('trip-a'), undefined);
  assert.deepEqual(listJourneyExports().map(item => item.tripId), ['trip-b']);
  assert.ok(storage.has(`${JOURNEY_EXPORT_PREFIX}trip-b`));
});

test('acknowledgement requires actual host consumption; event observation alone is not receipt', () => {
  cleanup = registerObservatoryEntry(() => {});
  window.addEventListener('wanderwise:journey-export', event => {
    const sent = (event as CustomEvent<JourneyExportPacket>).detail;
    assert.deepEqual(window.Wanderwise?.consumeJourneyExport?.(sent.tripId), packet);
  });
  assert.deepEqual(exportJourneyToObservatory(packet), { stored: false, acknowledged: true });
  assert.equal(storage.size, 0);
});

test('outbox validation rejects corrupt schemas, oversized entries and key/packet identity mismatch', () => {
  storage.set(`${JOURNEY_EXPORT_PREFIX}bad`, '{bad JSON');
  storage.set(`${JOURNEY_EXPORT_PREFIX}mismatch`, JSON.stringify(packet));
  storage.set(`${JOURNEY_EXPORT_PREFIX}huge`, ' '.repeat(4_000_001));
  storage.set(`${JOURNEY_EXPORT_PREFIX}trip-a`, JSON.stringify(packet));
  storage.set('other-application', 'untouched');
  assert.deepEqual(listJourneyExports(), [packet]);
  assert.deepEqual(exportJourneyToObservatory({ ...packet, tripId: '../bad' }), { stored: false, acknowledged: false });
  assert.equal(consumeJourneyExport('../bad'), undefined);
  assert.deepEqual(consumeJourneyExport('trip-a'), packet);
  assert.equal(storage.get('other-application'), 'untouched');
});

test('an active host can accept a memory-only export when persistence is blocked', () => {
  cleanup = registerObservatoryEntry(() => {});
  window.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.deepEqual(exportJourneyToObservatory(packet), { stored: false, acknowledged: false });
  assert.deepEqual(listJourneyExports(), [], 'failed attempts leave nothing a host can claim after discard');
  window.addEventListener('wanderwise:journey-export-pending', event => {
    const pending = (event as CustomEvent<{ version: 1; tripId: string }>).detail;
    assert.deepEqual(Object.keys(pending).sort(), ['tripId', 'version']);
    assert.equal(consumeJourneyExport(pending.tripId)?.tripId, 'trip-b');
  });
  assert.deepEqual(exportJourneyToObservatory({ ...packet, tripId: 'trip-b' }), { stored: false, acknowledged: true });
  assert.deepEqual(listJourneyExports(), []);
});

test('a failed export does not broadcast content asynchronously or remain available for later consumption', async () => {
  cleanup = registerObservatoryEntry(() => {});
  window.localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  window.addEventListener('wanderwise:journey-export', () => assert.fail('failed export broadcast full contents'));
  Object.defineProperty(window, 'parent', { configurable: true, value: {
    location: { origin: window.location.origin }, postMessage: () => assert.fail('failed export queued a message'),
  } });
  let laterClaim: Promise<JourneyExportPacket | undefined> | undefined;
  window.addEventListener('wanderwise:journey-export-pending', event => {
    const tripId = (event as CustomEvent<{ tripId: string }>).detail.tripId;
    laterClaim = Promise.resolve().then(() => consumeJourneyExport(tripId));
  });
  assert.deepEqual(exportJourneyToObservatory(packet), { stored: false, acknowledged: false });
  assert.equal(await laterClaim, undefined);
  assert.deepEqual(listJourneyExports(), []);
});

test('another tab consuming an export removes it from the cached pending list', () => {
  exportJourneyToObservatory(packet);
  storage.delete(`${JOURNEY_EXPORT_PREFIX}trip-a`);
  assert.deepEqual(listJourneyExports(), []);
});

test('same-origin parent/opener notifications include the packet and never target another origin', () => {
  const messages: unknown[] = [];
  Object.defineProperty(window, 'parent', { configurable: true, value: {
    location: { origin: window.location.origin }, postMessage: (...args: unknown[]) => messages.push(args),
  } });
  Object.defineProperty(window, 'opener', { configurable: true, value: {
    location: { origin: 'https://external.test' }, postMessage: () => assert.fail('external host received a journey'),
  } });
  assert.deepEqual(exportJourneyToObservatory(packet), { stored: true, acknowledged: false });
  assert.deepEqual(messages, [[{ type: 'wanderwise:journey-export', payload: packet }, window.location.origin]]);
});
