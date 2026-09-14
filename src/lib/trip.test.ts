import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { JourneyStop } from '../types';
import {
  TRIP_SESSION_KEY, createJourneyExport, getTripSession, initializeTripSession,
  loadCurrentJourney, normalizeJourneyExport, saveCurrentJourney, startNewTrip,
} from './trip';

const visit: JourneyStop = {
  id: 'visit-1', title: '如何理解引力？', type: 'answer', questionId: '123', answerId: '456',
  query: '物理', visitedAt: '2026-09-14T08:00:00.000Z',
};
let previousWindow: PropertyDescriptor | undefined;
let sessionValues: Map<string, string>;
let localValues: Map<string, string>;

function documentWindow(type: 'navigate' | 'reload' | 'back_forward' = 'navigate') {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      performance: { getEntriesByType: () => [{ type }] },
      sessionStorage: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => { sessionValues.set(key, value); },
        removeItem: (key: string) => { sessionValues.delete(key); },
      },
      localStorage: {
        getItem: (key: string) => localValues.get(key) ?? null,
        setItem: (key: string, value: string) => { localValues.set(key, value); },
      },
    },
  });
}

beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  sessionValues = new Map(); localValues = new Map(); documentWindow();
});
afterEach(() => {
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('initialization is idempotent per document, ignores legacy history and keeps only this trip', () => {
  localValues.set('wanderwise.journey.v1', JSON.stringify([visit]));
  const first = initializeTripSession();
  assert.deepEqual(first.journey, []);
  assert.equal(saveCurrentJourney([visit]), true);
  const again = initializeTripSession();
  assert.equal(again.id, first.id);
  assert.deepEqual(again.journey, [visit]);
  again.journey.length = 0;
  assert.equal(getTripSession().journey.length, 1, 'snapshots cannot mutate stored trips');
  assert.equal(JSON.parse(localValues.get('wanderwise.journey.v1')!).length, 1);
});

test('reload/back-forward restores one trip but a new navigation or copied tab starts a fresh trip', () => {
  const first = initializeTripSession();
  saveCurrentJourney([visit]);
  documentWindow('reload');
  assert.equal(getTripSession().id, first.id);
  assert.deepEqual(loadCurrentJourney(), [visit]);
  documentWindow('back_forward');
  assert.equal(getTripSession().id, first.id);
  documentWindow('navigate');
  assert.notEqual(getTripSession().id, first.id);
  assert.deepEqual(loadCurrentJourney(), []);
});

test('explicit new entry/end clears only this trip while preserving collections and legacy data', () => {
  localValues.set('wanderwise.collection.v1', '["kept"]');
  const before = getTripSession();
  saveCurrentJourney([visit]);
  const after = startNewTrip();
  assert.notEqual(after.id, before.id);
  assert.deepEqual(loadCurrentJourney(), []);
  assert.equal(localValues.get('wanderwise.collection.v1'), '["kept"]');
  assert.equal(JSON.parse(sessionValues.get(TRIP_SESSION_KEY)!).id, after.id);
});

test('corrupt, oversized or invalid session data cannot resurrect malformed history', () => {
  for (const raw of ['{invalid', '{}', JSON.stringify({ id: '../bad', startedAt: visit.visitedAt, journey: [visit] }), ' '.repeat(4_000_001)]) {
    sessionValues.set(TRIP_SESSION_KEY, raw);
    documentWindow('reload');
    assert.deepEqual(loadCurrentJourney(), []);
  }
});

test('failed persistence preserves the current in-memory trip and rejects invalid visits', () => {
  const first = getTripSession();
  window.sessionStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.equal(saveCurrentJourney([visit]), false);
  assert.equal(getTripSession().id, first.id);
  assert.deepEqual(loadCurrentJourney(), [visit]);
  assert.equal(saveCurrentJourney([{ ...visit, visitedAt: 'invalid' }]), false);
  assert.deepEqual(loadCurrentJourney(), [visit]);
});

test('ending or replacing a trip removes the old recoverable session when the new write fails', () => {
  const previous = getTripSession();
  saveCurrentJourney([visit]);
  assert.equal(JSON.parse(sessionValues.get(TRIP_SESSION_KEY)!).journey.length, 1);
  window.sessionStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  const fresh = startNewTrip();
  assert.notEqual(fresh.id, previous.id);
  assert.deepEqual(loadCurrentJourney(), []);
  assert.equal(sessionValues.has(TRIP_SESSION_KEY), false);
  documentWindow('reload');
  assert.notEqual(getTripSession().id, previous.id);
  assert.deepEqual(loadCurrentJourney(), [], 'refresh must not resurrect the explicitly ended trip');
});

test('export carries exactly one trip, source attribution and bounded validated schema', () => {
  saveCurrentJourney([visit]);
  const packet = createJourneyExport({ query: '物理', sourceUrls: { 'answer:456': 'https://www.zhihu.com/question/123/answer/456' } });
  assert.equal(packet.version, 1);
  assert.equal(packet.tripId, getTripSession().id);
  assert.equal(packet.journey[0].url, 'https://www.zhihu.com/question/123/answer/456');
  assert.deepEqual(normalizeJourneyExport({ ...packet, irrelevant: 'removed' }), packet);
  assert.equal(normalizeJourneyExport({ ...packet, tripId: '../escape' }), undefined);
  assert.equal(normalizeJourneyExport({ ...packet, query: 'x'.repeat(301) }), undefined);
  assert.equal(normalizeJourneyExport({ ...packet, journey: Array(1001).fill(visit) }), undefined);
  assert.equal(normalizeJourneyExport({ ...packet, endedAt: '2020-01-01T00:00:00.000Z' }), undefined);
  const unsafe = createJourneyExport({ query: '物理', sourceUrls: { 'visit-1': 'javascript:alert(1)' } });
  assert.equal(unsafe.journey[0].url, undefined);
  assert.deepEqual(loadCurrentJourney(), [visit], 'creating an export neither ends nor sends a trip');
});
