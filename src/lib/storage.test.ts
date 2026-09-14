import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import type { JourneyStop, Reflection, SavedItem } from '../types';
import {
  exportNotebook, loadCollection, loadJourney, loadReflections,
  saveCollection, saveJourney, saveReflections,
} from './storage';

const collection: SavedItem = {
  id: 'answer-1', type: 'answer', title: '如何找到实习机会？', excerpt: '从真实的问题开始。\n积累可展示的成果。',
  author: '测试作者', url: 'https://www.zhihu.com/question/123/answer/456', questionId: '123', answerId: '456',
  query: '大学生实习', savedAt: '2026-09-13T08:00:00.000Z',
};
const reflection: Reflection = {
  id: 'reflection-1', targetId: 'answer-1', targetTitle: collection.title,
  quote: '积累可展示的成果。', text: '我想先完成一个实际项目，然后记录遇到的问题。',
  query: collection.query, createdAt: '2026-09-13T08:05:00.000Z',
};
const journey: JourneyStop = {
  id: 'visit-1', title: collection.title, type: 'answer', questionId: '123', answerId: '456',
  query: collection.query, visitedAt: '2026-09-13T07:59:00.000Z',
};

let values: Map<string, string>;
let sessionValues: Map<string, string>;
let originalWindow: PropertyDescriptor | undefined;

beforeEach(() => {
  values = new Map();
  sessionValues = new Map();
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
      },
      sessionStorage: {
        getItem: (key: string) => sessionValues.get(key) ?? null,
        setItem: (key: string, value: string) => { sessionValues.set(key, value); },
      },
    },
  });
});

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

test('collection and reflections persist locally while only the current trip persists in this tab', () => {
  assert.equal(saveCollection([collection]), true);
  assert.equal(saveReflections([reflection]), true);
  assert.equal(saveJourney([journey]), true);
  assert.deepEqual(loadCollection(), [collection]);
  assert.deepEqual(loadReflections(), [reflection]);
  assert.deepEqual(loadJourney(), [journey]);
  assert.equal(values.has('wanderwise.journey.v1'), false);
  assert.equal(sessionValues.has('wanderwise.trip-session.v1'), true);
});

test('corrupt JSON and malformed record schemas cannot break notebook loading', () => {
  for (const raw of ['{bad json', 'null', '{}', '"text"']) {
    values.set('wanderwise.collection.v1', raw);
    assert.deepEqual(loadCollection(), []);
  }
  values.set('wanderwise.collection.v1', JSON.stringify([
    null, [], { ...collection, title: 42 }, { ...collection, savedAt: 'tomorrow' },
    { ...collection, type: 'article' }, { ...collection, author: {} }, collection,
  ]));
  values.set('wanderwise.reflections.v1', JSON.stringify([{ ...reflection, text: [] }, reflection]));
  values.set('wanderwise.journey.v1', JSON.stringify([{ ...journey, visitedAt: 'invalid' }, journey]));
  assert.deepEqual(loadCollection(), [collection]);
  assert.deepEqual(loadReflections(), [reflection]);
  assert.deepEqual(loadJourney(), []);
  assert.ok(values.has('wanderwise.journey.v1'), 'legacy history is ignored, never destroyed');
});

test('unsafe source links are omitted while readable saved content is retained', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:secret@example.com/', '//evil.example/']) {
    values.set('wanderwise.collection.v1', JSON.stringify([{ ...collection, url }]));
    const loaded = loadCollection();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].url, undefined);
    assert.equal(loaded[0].excerpt, collection.excerpt);
  }
});

test('record limits and duplicate IDs constrain local persistence', () => {
  const many = Array.from({ length: 600 }, (_, index) => ({ ...collection, id: `saved-${index}` }));
  assert.equal(saveCollection(many), true);
  assert.equal(loadCollection().length, 500);
  values.set('wanderwise.collection.v1', JSON.stringify([collection, collection]));
  assert.equal(loadCollection().length, 1);
});

test('a public knowledge question and answer with the same ID are separate saved items', () => {
  const question: SavedItem = { ...collection, type: 'question', answerId: undefined };
  assert.equal(saveCollection([question, collection]), true);
  const loaded = loadCollection();
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map(item => item.type), ['question', 'answer']);
});

test('storage unavailability and quota failures return failure without discarding saved data', () => {
  assert.equal(saveCollection([collection]), true);
  const previous = values.get('wanderwise.collection.v1');
  assert.equal(saveCollection([{ ...collection, savedAt: 'invalid' }]), false);
  assert.equal(values.get('wanderwise.collection.v1'), previous);
  window.localStorage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.equal(saveCollection([collection]), false);
  window.localStorage.getItem = () => { throw new Error('SecurityError'); };
  assert.deepEqual(loadCollection(), []);
});

test('notebook export preserves source attribution, quoted passages, personal thoughts and chronological visits', () => {
  saveCollection([collection]);
  saveReflections([reflection]);
  saveJourney([{ ...journey, id: 'visit-2', visitedAt: '2026-09-13T09:00:00.000Z' }, journey]);
  const result = exportNotebook(loadCollection(), loadReflections(), loadJourney());
  assert.ok(result.includes(collection.title));
  assert.ok(result.includes(`[阅读知乎原文](<${collection.url}>)`));
  assert.ok(result.includes('作者：测试作者'));
  assert.ok(result.includes('> 从真实的问题开始。\n> 积累可展示的成果。'));
  assert.ok(result.includes(reflection.text));
  assert.ok(result.includes('触发这段思考的原文摘录：'));
  const trail = result.slice(result.indexOf('## 探索足迹'));
  assert.ok(trail.indexOf('07:59:00') < trail.indexOf('09:00:00'));
  assert.ok(result.endsWith('\n'));
});

test('notebook export escapes raw HTML and Markdown content and excludes dangerous link protocols', () => {
  const result = exportNotebook([{
    ...collection, title: '<script>alert(1)</script>',
    excerpt: '[open](javascript:alert(1))', url: 'javascript:alert(1)',
  }], [], []);
  assert.equal(result.includes('<script>'), false);
  assert.equal(result.includes('[阅读知乎原文]'), false);
  assert.ok(result.includes('&lt;script&gt;'));
  assert.ok(result.includes('\\[open\\]'));
});
