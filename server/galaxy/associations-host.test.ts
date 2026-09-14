import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from './app.js';
import { ZhihuService } from './zhihu.js';
import { ContentStore, digest } from '../content/store.js';
import { ContentService } from '../content/service.js';
import { AccessService } from '../content/access.js';
import { SynthesisService } from '../content/synthesis.js';

const snapshot = { fetchedAt: '2026-09-14T00:00:00Z', sourceUrl: '', items: [], details: {} };
const config = { version: 1 as const, cookieSecret: 'cookie-secret-for-test-only-long-enough' };
const noHttp = async () => { assert.fail('host must never bypass ContentService'); };
const associationsResult = () => ({ Data: { choices: [{ message: { content: JSON.stringify({ topics: ['友谊', 'MBTI', '依恋理论', '同性恋', '如何与小孩相处', '情绪调节', '沟通'].map(keyword => ({ keyword, relation: '从亲密关系出发的延伸' })) }) }, finish_reason: 'stop' }] } });

test('direct visitor associations deduplicate one CLI call and share the exact synthesis visitor/global quota', async context => {
  const store = new ContentStore(':memory:');
  const calls: { args: string[]; timeout: number }[] = [];
  const content = new ContentService({ store, configured: true, runner: async (args, timeout) => {
    assert.equal(typeof timeout, 'number');
    if (timeout === undefined) throw new Error('Host AI calls must specify their timeout');
    calls.push({ args, timeout });
    assert.equal(args[0], 'answer', 'associations never fan out into destination searches');
    assert.ok(args[1].startsWith('--query='));
    assert.deepEqual(args.slice(2), ['--model', 'zhida-fast-1p5', '--output', 'json']);
    if (timeout === 10_000) { await delay(15); return associationsResult(); }
    assert.equal(timeout, 60_000);
    return { choices: [{ message: { content: JSON.stringify({ text: '连接两种想法的草稿。', sourceIds: [] }) } }] };
  } });
  const access = new AccessService(config);
  const service = new ZhihuService({ content, snapshot, fetchImpl: noHttp });
  const server = createApp(service, { access, synthesis: new SynthesisService(content, { global: 4, perVisitor: 3 }) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (query: string, cookie?: string) => fetch(`${url}/api/associations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ query }) });
  const count = () => store.db.prepare("SELECT count FROM budgets WHERE scope='ai:global'").get()?.count;
  const first = await post('恋爱');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).method, 'model', 'a new visitor needs no invitation code');
  const rawCookie = first.headers.get('set-cookie') ?? '';
  assert.match(rawCookie, /mirror_visitor=/); assert.match(rawCookie, /HttpOnly/);
  assert.ok(!rawCookie.includes('mirror_access'));
  const cookie = rawCookie.split(';')[0];
  const visitor = access.visitor(cookie.slice('mirror_visitor='.length)).id;
  assert.equal(calls.length, 1); assert.equal(count(), 1);

  // Identical concurrent requests and subsequent reopenings reuse one result.
  const concurrent = await Promise.all([post('亲密关系', cookie), post('亲密关系', cookie)]);
  for (const response of concurrent) assert.equal((await response.json()).method, 'model');
  assert.equal(calls.length, 2); assert.equal(count(), 2);
  assert.equal((await (await post('亲密关系', cookie)).json()).method, 'model');
  assert.equal(calls.length, 2);
  const synthesize = () => fetch(`${url}/api/synthesis`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ mode: 'idea', prompt: '把这些联系写成一份草稿' }) });
  assert.equal((await synthesize()).status, 200);
  assert.equal(calls.length, 3); assert.equal(count(), 3);
  assert.equal(store.db.prepare('SELECT count FROM budgets WHERE scope=?').get(`ai:${digest(visitor)}`)?.count, 3);

  // Both endpoints obey the configured limit, not independent hardcoded limits.
  const exhausted = await post('宇宙', cookie);
  assert.equal(exhausted.status, 200); assert.equal((await exhausted.json()).method, 'semantic');
  assert.equal((await synthesize()).status, 429);
  assert.equal(calls.length, 3); assert.equal(count(), 3);
  assert.equal((await (await post('恋爱', cookie)).json()).method, 'model', 'previously generated ideas remain usable without another debit');
  assert.equal((await (await post('数学')).json()).method, 'model', 'a different visitor may use the remaining global quota');
  assert.equal(calls.length, 4); assert.equal(count(), 4);
  assert.equal((await (await post('城市')).json()).method, 'semantic', 'the application-wide cap also preserves semantic exploration');
  assert.equal(calls.length, 4); assert.equal(count(), 4);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM budgets WHERE scope LIKE 'search:%'").get()?.count, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM public_cache').get()?.count, 0, 'AI suggestions are not persisted as verified public content');
});

test('invalid and cross-origin association requests cannot spend visitor AI quota', async context => {
  const store = new ContentStore(':memory:'); let calls = 0;
  const content = new ContentService({ store, configured: true, runner: async () => { calls++; return associationsResult(); } });
  const service = new ZhihuService({ content, snapshot, fetchImpl: noHttp });
  const server = createApp(service, { access: new AccessService(config), synthesis: new SynthesisService(content) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const post = (body: string, extra: Record<string, string> = {}) => fetch(`${url}/api/associations`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body });
  assert.equal((await post('{')).status, 400);
  assert.equal((await post(JSON.stringify({ query: ['恋爱', '宇宙'] }))).status, 400);
  assert.equal((await post(JSON.stringify({ query: '恋爱' }), { Origin: 'https://other-site.invalid' })).status, 403);
  assert.equal((await post(JSON.stringify({ query: '恋爱' }), { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  assert.equal(calls, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM budgets').get()?.count, 0);
});

test('an unconfigured host provides semantic associations without CLI calls or AI quota', async context => {
  const store = new ContentStore(':memory:');
  const content = new ContentService({ store, configured: false, runner: async () => { assert.fail('unconfigured CLI must not be called'); } });
  const service = new ZhihuService({ content, snapshot, fetchImpl: noHttp });
  const server = createApp(service, { access: new AccessService(config), synthesis: new SynthesisService(content) }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => { server.closeAllConnections(); server.close(); store.close(); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/api/associations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: '恋爱' }) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.method, 'semantic'); assert.ok(result.topics.length >= 5);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM budgets').get()?.count, 0);
});
