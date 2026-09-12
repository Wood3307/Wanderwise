import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { ObservatoryEntry } from '../types';
import { getInitialEntry, registerObservatoryEntry, returnToObservatory } from './integration';

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

beforeEach(() => {
  previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  previousCustomEvent = Object.getOwnPropertyDescriptor(globalThis, 'CustomEvent');
  navigations = [];
  const mock = Object.assign(new EventTarget(), {
    location: {
      href: 'https://wanderwise.test/explore', origin: 'https://wanderwise.test', search: '',
      assign: (url: string) => { navigations.push(url); },
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
  cleanup();
  cleanup = undefined;
  assert.equal(window.Wanderwise, originalBridge);
  post(window.location.origin, { type: 'wanderwise:enter', payload: { query: 'ignored' } });
  window.dispatchEvent(new CustomEvent('wanderwise:enter', { detail: { query: 'ignored' } }));
  assert.deepEqual(entries, []);
});
