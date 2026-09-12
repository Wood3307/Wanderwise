import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { adaptPublic, adaptSearch, ApiError, extractKeywords, loadSnapshot, plainText, safeZhihuUrl, validWorkId, ZhihuService } from './zhihu.js';
import type { PublicSnapshot, SearchItem } from './zhihu.js';

const snapshot: PublicSnapshot = {
  fetchedAt: '2026-09-13T00:00:00.000Z',
  sourceUrl: 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list',
  items: [{ work_id: '123', title: '如何提高学习效率？', description: '学习与注意力。' }],
  details: { '123': { work_id: '123', chapter_name: '如何提高学习效率？', author_name: '测试作者', content: '注意力能够影响学习效率。\n这是独立的第二段。' } },
};
const answerItem: SearchItem = { Title: '如何学习？', ContentType: 'Answer', ContentID: '101', ContentText: '<p>第一种观点。</p><p>更详细的论述。</p>', Url: 'https://www.zhihu.com/question/50/answer/101?utm_source=test', AuthorName: '甲', VoteUpCount: 4 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('search groups real question IDs and preserves distinct authors, articles, and excerpts', () => {
  const results = adaptSearch([
    answerItem,
    { ...answerItem, ContentID: '102', AuthorName: '乙', Url: 'https://www.zhihu.com/question/50/answer/102' },
    { ...answerItem, ContentID: '102', AuthorName: '乙', Url: 'https://www.zhihu.com/question/50/answer/102' },
    { ...answerItem, ContentType: 'Article', ContentID: '200', Url: 'https://zhuanlan.zhihu.com/p/200', AuthorName: '' },
  ], '学习');
  assert.equal(results.length, 2);
  const question = results.find((entry) => entry.id === 'question-50')!;
  assert.deepEqual(question.answers.map((answer) => answer.author), ['甲', '乙']);
  assert.deepEqual(question.answers[0].paragraphs, ['第一种观点。', '更详细的论述。']);
  assert.equal(question.answers[0].isExcerpt, true);
  assert.equal(question.answers[0].votes, 4);
  assert.equal(results.find((entry) => entry.id === 'article-200')?.answers[0].author, '作者未提供');
});

test('answer-only URLs join matching real titles; conflicting question IDs stay separate', () => {
  const results = adaptSearch([
    answerItem,
    { ...answerItem, ContentID: '102', Url: 'https://www.zhihu.com/answer/102' },
    { ...answerItem, Title: '如何实践？', ContentID: '103', Url: 'https://www.zhihu.com/answer/103' },
  ], '学习');
  assert.equal(results.length, 2);
  assert.equal(results[0].answers.length, 2);
  const conflicts = adaptSearch([answerItem, { ...answerItem, Url: 'https://www.zhihu.com/question/51/answer/102', ContentID: '102' }], '学习');
  assert.equal(conflicts.length, 2);
});

test('source URLs, identifiers and markup do not create executable or arbitrary remote links', () => {
  for (const input of ['javascript:alert(1)', 'https://www.zhihu.com.evil.test/answer/123', 'https://user:pass@www.zhihu.com/answer/123', 'https://www.zhihu.com:8888/answer/123', 'http://www.zhihu.com/answer/123', 'https://www.zhihu.com/redirect?to=evil']) {
    assert.equal(safeZhihuUrl(input), undefined);
    assert.equal(adaptSearch([{ ...answerItem, Url: input }], '').length, 0);
  }
  for (const input of ['../123', '123?secret', '123\n', '123/456', '123#x', '', 123]) assert.equal(validWorkId(input), false);
  assert.equal(validWorkId('1747681485547843585'), true);
  assert.equal(plainText('<script>evil()</script><p>正文 &amp; <em>关键词</em></p><style>hidden</style>'), '正文 & 关键词');
});

test('public mode searches the real corpus and leaves unrelated searches empty', () => {
  assert.equal(adaptPublic(snapshot, '量子纠缠').length, 0);
  const result = adaptPublic(snapshot, '如何提高学习效率？');
  assert.equal(result.length, 1);
  assert.equal(result[0].answers.length, 1);
  assert.equal(result[0].answers[0].author, '测试作者');
  assert.equal(result[0].answers[0].isExcerpt, true);
  assert.match(result[0].answers[0].url, /^https:\/\/api\.zhihu\.com\//);
  assert.ok(extractKeywords('大学生实习应该如何获取资源？').includes('实习'));
  assert.ok(!extractKeywords('大学生实习应该如何获取资源？').includes('如何'));
});

test('authenticated search sends documented server headers and caches repeated queries', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'test-only-secret', now: () => 1770000000123, fetchImpl: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://developer.zhihu.com');
    assert.equal(url.searchParams.get('Query'), '学习 & 工作');
    assert.equal(url.searchParams.get('Count'), '10');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-only-secret');
    assert.equal(headers.get('X-Request-Timestamp'), '1770000000');
    assert.equal(init?.redirect, 'error');
    return json({ Code: 0, Data: { Items: [answerItem] } });
  } });
  const first = await service.explore('学习 & 工作');
  assert.equal(first.source, 'zhihu-search');
  assert.deepEqual(await service.explore('学习 & 工作'), first);
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(first).includes('test-only-secret'));
});

test('upstream authentication messages and transport failures never expose secrets', async () => {
  const service = new ZhihuService({ snapshot, secret: 'test-only-secret', fetchImpl: async () => json({ Code: 20001, Message: 'test-only-secret internal auth details' }) });
  await assert.rejects(service.explore('学习'), (error: unknown) => error instanceof ApiError && error.code === 'ZHIHU_AUTH_FAILED' && !error.message.includes('test-only-secret'));
  const broken = new ZhihuService({ snapshot, secret: 'test-only-secret', fetchImpl: async () => { throw new Error('test-only-secret'); } });
  await assert.rejects(broken.explore('学习'), (error: unknown) => error instanceof ApiError && error.status === 502 && !error.message.includes('test-only-secret'));
  const timedOut = new ZhihuService({ snapshot, secret: 'test-only-secret', fetchImpl: async () => { throw new DOMException('timeout detail', 'TimeoutError'); } });
  await assert.rejects(timedOut.explore('学习'), (error: unknown) => error instanceof ApiError && error.status === 504);
});

test('HTTP rate limiting is preserved without exposing upstream response bodies', async () => {
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => new Response('private body', { status: 429 }) });
  await assert.rejects(service.explore('学习'), (error: unknown) => error instanceof ApiError && error.status === 429 && error.upstreamStatus === 429 && !error.message.includes('private body'));
});

test('knowledge reads require an ID from the official list before making requests', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, fetchImpl: async () => { calls++; throw new Error('must not fetch'); } });
  await assert.rejects(service.knowledge('../etc'), (error: unknown) => error instanceof ApiError && error.status === 400);
  await assert.rejects(service.knowledge('456'), (error: unknown) => error instanceof ApiError && error.status === 404);
  assert.equal((await service.knowledge('123')).author, '测试作者');
  assert.equal(calls, 0);
});

test('public refresh sends no secret and commits only complete valid data', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'never-send-to-public', fetchImpl: async (input, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).get('Authorization'), null);
    assert.equal(new Headers(init?.headers).get('X-Request-Timestamp'), null);
    return String(input).endsWith('/list') ? json(snapshot.items) : json(snapshot.details['123']);
  } });
  await Promise.all([service.refreshPublic(), service.refreshPublic()]);
  assert.equal(calls, 2);
  assert.equal((await service.explore('')).source, 'zhihu-public');
  await service.refreshPublic();
  assert.equal(calls, 2);
  const broken = new ZhihuService({ snapshot, fetchImpl: async () => json({}, 503) });
  await broken.refreshPublic();
  const cached = await broken.explore('');
  assert.equal(cached.source, 'zhihu-cache');
  assert.equal(cached.questions.length, 1);
  assert.equal(broken.publicError?.upstreamStatus, 503);
});

test('simultaneous identical search requests share a bounded upstream request', async () => {
  let calls = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => {
    calls++;
    await barrier;
    return json({ Code: 0, Data: { Items: [answerItem] } });
  } });
  const first = service.explore('学习');
  const second = service.explore('学习');
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
});

test('oversized upstream payload is rejected before parsing or display', async () => {
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => new Response('{}', { headers: { 'content-length': '2000000' } }) });
  await assert.rejects(service.explore('学习'), (error: unknown) => error instanceof ApiError && error.code === 'UPSTREAM_TOO_LARGE');
});

test('bundled snapshot has traceable real authors and excerpts for offline startup', async () => {
  const bundled = await loadSnapshot();
  assert.equal(bundled.items.length, 10);
  assert.equal(Object.keys(bundled.details).length, 10);
  assert.equal(bundled.details['1307332455322529792'].author_name, '潘幸知');
  assert.equal(bundled.details['1307332455322529792'].content?.length, 3000);
  const service = new ZhihuService({ snapshot: bundled, fetchImpl: async () => { throw new Error('offline'); } });
  const response = await service.explore('');
  assert.equal(response.source, 'zhihu-cache');
  assert.equal(response.questions.length, 10);
  assert.ok(response.questions.every((question) => question.answers[0].paragraphs.length > 1 && question.answers[0].isExcerpt));
});

test('HTTP API validates queries, reports configuration safely, and returns JSON errors', async (context) => {
  const service = new ZhihuService({ snapshot, secret: 'never-expose-this', fetchImpl: async () => { throw new Error('should not fetch'); } });
  const server: Server = createApp(service, { refreshPublic: false, distDir: '/tmp/wanderwise-no-dist' }).listen(0, '127.0.0.1');
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const health = await (await fetch(`${origin}/api/health`)).json();
  assert.deepEqual(health, { ok: true, configured: true, publicCount: 1 });
  assert.equal((await fetch(`${origin}/api/explore?q=a&q=b`)).status, 400);
  assert.equal((await fetch(`${origin}/api/explore?q=${'a'.repeat(161)}`)).status, 400);
  assert.equal((await fetch(`${origin}/api/knowledge/999`)).status, 404);
  const missing = await fetch(`${origin}/api/missing`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') || '', /application\/json/);
  const error = await fetch(`${origin}/api/explore?q=test`);
  assert.equal(error.status, 502);
  assert.ok(!(await error.text()).includes('never-expose-this'));
});
