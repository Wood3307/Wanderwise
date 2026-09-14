import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from './app.js';
import { adaptHot, ApiError, ZhihuService } from './zhihu.js';
import type { HotItem, PublicSnapshot, SearchItem } from './zhihu.js';

const snapshot: PublicSnapshot = {
  fetchedAt: '2026-09-13T00:00:00.000Z', sourceUrl: '',
  items: [{ work_id: '123', title: '学习与注意力', description: '学习方法。' }],
  details: { '123': { work_id: '123', chapter_name: '学习与注意力', author_name: '真实作者', content: '注意力能够影响学习效率。\n根据反馈调整学习方法。' } },
};
const hot = (id = 50, title = '如何学习？'): HotItem => ({ Title: title, Url: `https://www.zhihu.com/question/${id}`, Summary: '这是问题摘要，不是任何人的回答。', ThumbnailUrl: '' });
const answer: SearchItem = { Title: '如何学习？', ContentType: 'Answer', ContentID: '101', ContentText: '从明确的学习目标出发，再根据练习反馈调整方法。', Url: 'https://www.zhihu.com/question/50/answer/101', AuthorName: '真实作者' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const hotResponse = (items: HotItem[] = [hot()]) => json({ Code: 0, Data: { Total: items.length, Items: items } });
const errorCode = (code: string) => (error: unknown) => error instanceof ApiError && error.code === code;

test('hot adapter preserves actual question identities and ranks without inventing answers', () => {
  const questions = adaptHot([
    { ...hot(50), Title: '<b>如何学习？</b> - 知乎' },
    { ...hot(), Url: 'https://zhuanlan.zhihu.com/p/500' },
    { ...hot(70), Url: 'https://www.zhihu.com/question/70?utm_source=hot' },
    hot(50),
    ...['https://www.zhihu.com/question/80/answer/801', 'https://zhuanlan.zhihu.com/question/90', 'https://evil.test/question/90', 'javascript:alert(1)', 'http://www.zhihu.com/question/90'].map(Url => ({ ...hot(), Url })),
    { ...hot(99), Title: '' },
  ]);
  assert.deepEqual(questions.map(question => question.id), ['question-50', 'question-70']);
  assert.deepEqual(questions.map(question => question.hotRank), [1, 3]);
  assert.equal(questions[0].title, '如何学习？');
  assert.equal(questions[1].url, 'https://www.zhihu.com/question/70');
  assert.ok(questions.every(question => question.answers.length === 0 && question.answersExpanded === false && question.kind === 'question'));
  assert.ok(questions.every(question => question.excerpt === hot().Summary));
  assert.equal(adaptHot(Array.from({ length: 30 }, (_, index) => hot(index + 1))).length, 12);
});

test('homepage cold start uses official hot endpoint and merges concurrent reads with a five-minute cache', async () => {
  let now = 1_800_000_000_000;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const service = new ZhihuService({ snapshot, secret: 'test-secret', now: () => now, fetchImpl: async (input, init) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://developer.zhihu.com');
    assert.equal(url.pathname, '/api/v1/content/hot_list');
    assert.equal(url.searchParams.get('Limit'), '20');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-secret');
    assert.equal(headers.get('X-Request-Timestamp'), String(Math.floor(now / 1000)));
    assert.equal(init?.redirect, 'error');
    await gate;
    return hotResponse([hot(10), hot(20), hot(30)]);
  } });
  const pending = [service.explore(''), service.explore(''), service.explore('')];
  assert.equal(calls, 1);
  release();
  const responses = await Promise.all(pending);
  assert.equal(responses[0].source, 'zhihu-hot');
  assert.deepEqual(responses[0].questions.map(question => question.id), ['question-10', 'question-20', 'question-30']);
  assert.deepEqual(responses[0], responses[1]);
  assert.deepEqual(await service.explore(''), responses[0]);
  assert.ok(!JSON.stringify(responses).includes('test-secret'));
  now += 5 * 60_000;
  await service.explore('');
  assert.equal(calls, 2);
});

test('missing hot credentials reports configuration failure and public content needs an explicit mode', async () => {
  const service = new ZhihuService({ snapshot, fetchImpl: async () => { throw new Error('must not fetch'); } });
  await assert.rejects(service.explore(''), errorCode('ZHIHU_NOT_CONFIGURED'));
  const publicResult = await service.explore('', undefined, 'public');
  assert.equal(publicResult.source, 'zhihu-cache');
  assert.equal(publicResult.questions[0].id, 'topic-learning');
  assert.equal((await service.question('topic-learning', '')).question.answers[0].id, 'knowledge-123');
  assert.equal((await service.findAnswer('knowledge-123', 'topic-learning', '')).author, '真实作者');
  assert.equal((await service.question('knowledge-123', '')).question.id, 'topic-learning');
});

test('hot questions lazily search the original title and do not turn summaries into answers', async () => {
  const paths: string[] = [];
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async input => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    if (url.pathname.endsWith('hot_list')) return hotResponse();
    assert.equal(url.searchParams.get('Query'), '如何学习？');
    return json({ Code: 0, Data: { Items: [
      answer,
      { ...answer, ContentID: '102', Url: 'https://www.zhihu.com/question/99/answer/102' },
      { ...answer, ContentID: '103', Url: 'https://www.zhihu.com/answer/103' },
    ] } });
  } });
  assert.equal((await service.explore('')).questions[0].answers.length, 0);
  const [first, duplicate] = await Promise.all([service.question('question-50', ''), service.question('question-50', '')]);
  assert.deepEqual(first, duplicate);
  assert.deepEqual(first.question.answers.map(entry => entry.id), ['answer-101']);
  assert.equal(first.question.hotRank, 1);
  assert.equal(first.question.answersExpanded, true);
  assert.equal((await service.findAnswer('answer-101', 'question-50', '')).title, answer.ContentText);
  await assert.rejects(service.findAnswer('answer-102', 'question-50', ''), errorCode('ANSWER_NOT_FOUND'));
  await assert.rejects(service.findAnswer('answer-103', 'question-50', ''), errorCode('ANSWER_NOT_FOUND'));
  assert.deepEqual(paths, ['/api/v1/content/hot_list', '/api/v1/content/zhihu_search']);
});

test('exact-title fallback joins a bare answer URL only when no known question IDs conflict', async () => {
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async input => String(input).includes('hot_list')
    ? hotResponse()
    : json({ Code: 0, Data: { Items: [answer, { ...answer, ContentID: '103', Url: 'https://www.zhihu.com/answer/103' }] } }) });
  await service.explore('');
  assert.deepEqual((await service.question('question-50', '')).question.answers.map(entry => entry.id), ['answer-101', 'answer-103']);
});

test('a previously displayed question stays navigable across hot-list rotation, but expires after two hours', async () => {
  let now = 0, hotCalls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, fetchImpl: async input => {
    if (String(input).includes('hot_list')) return hotResponse([hot(++hotCalls === 1 ? 50 : 60)]);
    return json({ Code: 0, Data: { Items: [answer] } });
  } });
  await service.explore('');
  now = 5 * 60_000;
  assert.equal((await service.explore('')).questions[0].id, 'question-60');
  assert.equal((await service.question('question-50', '')).question.answers[0].id, 'answer-101');
  assert.equal((await service.findAnswer('answer-101', 'question-50', '')).author, '真实作者');
  assert.equal(hotCalls, 2);
  now = 2 * 60 * 60_000;
  await assert.rejects(service.question('question-50', ''), errorCode('QUESTION_NOT_FOUND'));
  await assert.rejects(service.findAnswer('answer-101', 'question-50', ''), errorCode('ANSWER_NOT_FOUND'));
  assert.equal(hotCalls, 3);
});

test('hot cache fallback reports its actual timestamp, backs off failure, and never survives thirty minutes', async () => {
  let now = 0, calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, fetchImpl: async () => ++calls === 1 ? hotResponse() : json({}, 503) });
  const fresh = await service.explore('');
  now = 5 * 60_000;
  const stale = await service.explore('');
  assert.equal(stale.stale, true);
  assert.equal(stale.source, 'zhihu-hot');
  assert.equal(stale.fetchedAt, fresh.fetchedAt);
  assert.match(stale.notice ?? '', /上次成功获取/);
  await service.explore('');
  assert.equal(calls, 2);
  now = 30 * 60_000;
  await assert.rejects(service.explore(''), errorCode('UPSTREAM_HTTP_ERROR'));
  assert.equal(calls, 3);
});

test('hot API error codes and malformed payloads stay explicit and never substitute public topics', async () => {
  for (const [raw, code] of [
    [{ Code: 20001, Message: 'test-secret' }, 'ZHIHU_AUTH_FAILED'],
    [{ Code: 30001, Message: 'test-secret' }, 'ZHIHU_RATE_LIMITED'],
    [{ Code: 90001, Message: 'test-secret' }, 'ZHIHU_HOT_FAILED'],
    [{ Code: 0, Data: {} }, 'UPSTREAM_INVALID_RESPONSE'],
    [null, 'UPSTREAM_INVALID_RESPONSE'],
  ] as const) {
    const service = new ZhihuService({ snapshot, secret: 'test-secret', fetchImpl: async () => json(raw) });
    await assert.rejects(service.explore(''), (error: unknown) => error instanceof ApiError && error.code === code && !error.message.includes('test-secret'));
  }
  const empty = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => hotResponse([]) });
  assert.deepEqual((await empty.explore('')).questions, []);
  const timeout = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => { throw new DOMException('private info', 'TimeoutError'); } });
  await assert.rejects(timeout.explore(''), errorCode('UPSTREAM_TIMEOUT'));
});

test('hot-list throttling is separate from answer search pacing and has no automatic retries', async () => {
  let now = 1000, hotCalls = 0, searchCalls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, fetchImpl: async input => {
    if (String(input).includes('hot_list')) { hotCalls++; return hotCalls === 1 ? json({ Code: 30001 }) : hotResponse(); }
    searchCalls++;
    return json({ Code: 0, Data: { Items: [answer] } });
  } });
  await assert.rejects(service.explore(''), errorCode('ZHIHU_RATE_LIMITED'));
  await assert.rejects(service.explore(''), errorCode('ZHIHU_RATE_LIMITED'));
  assert.equal(hotCalls, 1);
  assert.equal((await service.explore('学习')).source, 'zhihu-search');
  assert.equal(searchCalls, 1);
  now += 60_000;
  assert.equal(hotCalls, 1);
  assert.equal((await service.explore('')).source, 'zhihu-hot');
  assert.equal(hotCalls, 2);
});

test('answer search throttling does not prevent the homepage from fetching hot questions', async () => {
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async input => String(input).includes('hot_list') ? hotResponse() : json({ Code: 30001 }) });
  await assert.rejects(service.explore('学习'), errorCode('ZHIHU_RATE_LIMITED'));
  assert.equal((await service.explore('')).source, 'zhihu-hot');
});

test('remembered hot questions are bounded even when many distinct rankings arrive within their TTL', async () => {
  let now = 0, batch = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, fetchImpl: async input => {
    assert.ok(String(input).includes('hot_list'));
    return hotResponse(Array.from({ length: 12 }, (_, index) => hot(batch * 12 + index + 1)));
  } });
  for (; batch < 17; batch++) { await service.explore(''); now += 5 * 60_000; }
  now -= 5 * 60_000;
  await assert.rejects(service.question('question-1', ''), errorCode('QUESTION_NOT_FOUND'));
});

test('HTTP homepage defaults to current hot questions; public corpus is an explicit validated choice', async context => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => { calls++; return hotResponse(); } });
  const server = createApp(service, { refreshPublic: false, distDir: '/tmp/no-wanderwise-dist' }).listen(0, '127.0.0.1');
  context.after(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  assert.equal((await (await fetch(`${origin}/api/explore`)).json()).source, 'zhihu-hot');
  assert.equal((await (await fetch(`${origin}/api/explore?mode=public`)).json()).source, 'zhihu-cache');
  assert.equal((await fetch(`${origin}/api/explore?mode=invalid`)).status, 400);
  assert.equal((await fetch(`${origin}/api/explore?mode=public&mode=public`)).status, 400);
  assert.equal(calls, 1);
});
