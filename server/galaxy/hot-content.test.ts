import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContentStore, digest } from '../content/store.js';
import { ContentService } from '../content/service.js';
import { AccessService } from '../content/access.js';
import { SynthesisService } from '../content/synthesis.js';
import { createApp } from './app.js';
import { ApiError, ZhihuService } from './zhihu.js';
import type { PublicSnapshot } from './zhihu.js';

const snapshot: PublicSnapshot = {
  fetchedAt: '2026-09-13T00:00:00.000Z', sourceUrl: '',
  items: [{ work_id: '123', title: '学习与注意力', description: '学习方法。' }],
  details: { '123': { work_id: '123', chapter_name: '学习与注意力', author_name: '真实作者', content: '注意力能够影响学习效率。\n根据反馈调整学习方法。' } },
};
const context = { visitorId: 'hot-visitor' };
const hot = (id = 123) => ({ Title: `如何理解热点问题${id}？`, Url: `https://www.zhihu.com/question/${id}`, Summary: '问题说明，不是作者回答。' });
const hotPayload = (id = 123) => ({ Code: 0, Data: { Items: [hot(id)] } });
const noHttp: typeof fetch = async () => { throw new Error('A host request must never bypass ContentService through direct HTTP.'); };
const code = (expected: string) => (error: unknown) => error instanceof ApiError && error.code === expected;

test('host homepage uses budgeted CLI hot data, preserves raw ranks, and does not synthesize answers', async t => {
  const store = new ContentStore(':memory:'); t.after(() => store.close());
  const calls: string[][] = [];
  const content = new ContentService({ store, runner: async args => {
    calls.push(args);
    return { Code: 0, Data: { Items: [
      hot(), { Title: '热榜文章', Url: 'https://zhuanlan.zhihu.com/p/5' },
      { Title: '无效地址', Url: 'https://evil.test/question/4' }, hot(456), hot(),
    ] } };
  } });
  const galaxy = new ZhihuService({ content, secret: 'must-not-bypass-host', snapshot, fetchImpl: noHttp });
  const [first, duplicate] = await Promise.all([galaxy.explore('', context), galaxy.explore('', { visitorId: 'other-visitor' })]);
  assert.equal(first.source, 'zhihu-hot');
  assert.deepEqual(first, duplicate);
  assert.deepEqual(first.questions.map(question => question.id), ['question-123', 'question-456']);
  assert.deepEqual(first.questions.map(question => question.hotRank), [1, 4]);
  assert.ok(first.questions.every(question => question.answers.length === 0 && !question.answersExpanded));
  assert.deepEqual(calls, [['hot', '--limit', '20']]);
  assert.equal(store.db.prepare('SELECT count FROM budgets WHERE scope=?').get('search:global')?.count, 1);
  assert.equal(store.db.prepare('SELECT count FROM budgets WHERE scope=?').get(`search:${digest(context.visitorId)}`)?.count, 1);
  assert.deepEqual(await galaxy.explore('', context), first);
  assert.equal(calls.length, 1);
});

test('host hot SQLite cache survives restart, then refreshes after five minutes through the same budgeted service', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'galaxy-hot-cache-'));
  let now = Date.parse('2026-09-14T00:00:00Z'), calls = 0;
  let store = new ContentStore(join(dir, 'public.sqlite'), () => now);
  t.after(() => { store.close(); rmSync(dir, { recursive: true }); });
  const runner = async () => { calls++; return hotPayload(123 + calls); };
  let content = new ContentService({ store, runner, now: () => now });
  let galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp, now: () => now });
  const first = await galaxy.explore('', context);
  store.close();
  store = new ContentStore(join(dir, 'public.sqlite'), () => now);
  content = new ContentService({ store, runner, now: () => now });
  galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp, now: () => now });
  assert.equal((await galaxy.explore('', context)).questions[0].id, first.questions[0].id);
  assert.equal(calls, 1);
  now += 5 * 60_000;
  assert.equal((await galaxy.explore('', context)).questions[0].id, 'question-125');
  assert.equal(calls, 2);
  assert.equal(store.db.prepare('SELECT count FROM budgets WHERE scope=?').get('search:global')?.count, 2);
});

test('host lazy expansion uses official question answers, preserves source URLs, and keeps prior hotspots readable', async t => {
  let now = 0, hotCalls = 0, answerCalls = 0;
  const store = new ContentStore(':memory:', () => now); t.after(() => store.close());
  const content = new ContentService({ store, now: () => now, runner: async args => {
    if (args[0] === 'hot') return hotPayload(++hotCalls === 1 ? 123 : 456);
    assert.deepEqual(args, ['question', 'answers', '--question-url', 'https://www.zhihu.com/question/123', '--offset', '0', '--limit', '20']);
    answerCalls++;
    return { Code: 0, Data: { Items: [
      { Url: 'https://www.zhihu.com/question/123/answer/201?ref=source', Summary: '根据具体来源与论据理解问题，不把问题简介作为回答。', AuthorName: '原作者' },
      { Url: 'https://www.zhihu.com/question/999/answer/202', Summary: '其他问题不得移入。' },
      { Url: 'https://www.zhihu.com/question/123', Title: '问题自身也不是回答' },
      { Url: 'https://www.zhihu.com/answer/203', Summary: '官方列表能确认该裸回答链接属于目标问题。' },
    ] } };
  } });
  const galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp, now: () => now });
  await galaxy.explore('', context);
  now += 5 * 60_000;
  await galaxy.explore('', context);
  const expanded = await galaxy.question('question-123', '', context);
  assert.deepEqual(expanded.question.answers.map(answer => answer.id), ['answer-201', 'answer-203']);
  assert.equal(expanded.question.answers[0].url, 'https://www.zhihu.com/question/123/answer/201?ref=source');
  assert.equal(expanded.question.answers[1].url, 'https://www.zhihu.com/answer/203');
  assert.equal((await galaxy.findAnswer('answer-201', 'question-123', '', context)).author, '原作者');
  assert.equal(answerCalls, 1);
  assert.equal(hotCalls, 2);
  now = 2 * 60 * 60_000;
  await assert.rejects(galaxy.question('question-123', '', context), code('QUESTION_NOT_FOUND'));
});

test('host budget rejection cannot fall back to direct HTTP or disable another visitor budget', async t => {
  const store = new ContentStore(':memory:'); t.after(() => store.close());
  let calls = 0;
  const content = new ContentService({ store, globalLimit: 3, visitorLimit: 1, runner: async () => { calls++; return hotPayload(); } });
  store.reserve('search', context.visitorId, 3, 1);
  const galaxy = new ZhihuService({ content, secret: 'direct-secret-is-not-an-escape', snapshot, fetchImpl: noHttp });
  await assert.rejects(galaxy.explore('', context), code('DAILY_BUDGET_EXHAUSTED'));
  assert.equal(calls, 0);
  assert.equal((await galaxy.explore('', { visitorId: 'has-budget' })).source, 'zhihu-hot');
  assert.equal(calls, 1);
});

test('stale host hot snapshots report their real age and cannot masquerade as current content after thirty minutes', async t => {
  let now = 0, fail = false, calls = 0;
  const store = new ContentStore(':memory:', () => now); t.after(() => store.close());
  const content = new ContentService({ store, now: () => now, runner: async () => {
    calls++;
    if (fail) throw new ApiError(502, 'CLI_UNAVAILABLE', '暂时无法读取热榜。');
    return hotPayload();
  } });
  let galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp, now: () => now });
  const first = await galaxy.explore('', context);
  fail = true;
  now = 5 * 60_000;
  // Fresh process can still recover the real persisted timestamp before a failed refresh.
  galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp, now: () => now });
  const stale = await galaxy.explore('', context);
  assert.equal(stale.stale, true);
  assert.equal(stale.fetchedAt, first.fetchedAt);
  assert.equal(stale.source, 'zhihu-hot');
  await galaxy.explore('', context);
  assert.equal(calls, 2);
  now = 30 * 60_000;
  await assert.rejects(galaxy.explore('', context), code('CLI_UNAVAILABLE'));
});

test('unconfigured host ContentService remains authoritative and explicit public content needs no CLI or budget', async t => {
  const store = new ContentStore(':memory:'); t.after(() => store.close());
  const content = new ContentService({ store, configured: false, runner: async () => { throw new Error('must not run'); } });
  const galaxy = new ZhihuService({ content, secret: 'do-not-bypass-cli', snapshot, fetchImpl: noHttp });
  await assert.rejects(galaxy.explore('', context), code('ZHIHU_CLI_UNAVAILABLE'));
  assert.equal((await galaxy.explore('', context, 'public')).questions[0].id, 'topic-learning');
  assert.equal((await galaxy.question('knowledge-123', '', context)).question.id, 'topic-learning');
  assert.equal((await galaxy.findAnswer('knowledge-123', 'topic-learning', '', context)).author, '真实作者');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM budgets').get()?.count, 0);
});

test('HTTP galaxy hot and existing host hot share cache and visitor budget independently of direct AI quota', async t => {
  const store = new ContentStore(':memory:');
  let calls = 0;
  const content = new ContentService({ store, globalLimit: 1, visitorLimit: 1, runner: async () => { calls++; return hotPayload(); } });
  const access = new AccessService({ version: 1, cookieSecret: 'a'.repeat(64) });
  const galaxy = new ZhihuService({ content, snapshot, fetchImpl: noHttp });
  const server = createApp(galaxy, { access, synthesis: new SynthesisService(content, { global: 0, perVisitor: 0 }), refreshPublic: false, distDir: '/tmp/no-galaxy-build' }).listen(0, '127.0.0.1');
  t.after(async () => { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); });
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const home = await fetch(`${url}/api/explore?q=`);
  assert.equal(home.status, 200);
  assert.equal((await home.json()).source, 'zhihu-hot');
  const cookie = home.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const headers = { Cookie: cookie };
  assert.equal((await fetch(`${url}/api/hot`, { headers })).status, 200);
  assert.equal(calls, 1);
  const rejected = await fetch(`${url}/api/hot?refresh=true`, { headers });
  assert.equal(rejected.status, 429);
  assert.equal((await rejected.json()).error, 'DAILY_BUDGET_EXHAUSTED');
  assert.equal(calls, 1);
  assert.equal((await fetch(`${url}/api/explore?mode=public`, { headers })).status, 200);
  assert.equal((await fetch(`${url}/api/explore?mode=invalid`, { headers })).status, 400);
  assert.equal((await (await fetch(`${url}/api/health`, { headers })).json()).synthesis.accessRequired, false);
  const ai = await fetch(`${url}/api/synthesis`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'idea', prompt: 'hello' }) });
  assert.equal(ai.status, 429);
  assert.equal((await ai.json()).error, 'DAILY_BUDGET_EXHAUSTED');
  assert.equal(calls, 1, 'an exhausted optional AI budget neither starts a CLI call nor disturbs the cached hot list');
  assert.equal((await fetch(`${url}/api/hot`, { headers })).status, 200);
});
