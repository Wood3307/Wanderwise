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
  assert.equal(results.find((entry) => entry.id === 'article-200')?.kind, 'article');
  assert.equal(question.kind, 'question');
  assert.equal(question.answersExpanded, false);
  assert.ok(question.answers.every((answer) => answer.highlights?.every((highlight) => answer.paragraphs[highlight.paragraphIndex].includes(highlight.text))));
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

test('search and public adapters preserve complete source math, Markdown blocks and quote locations', () => {
  const blocks = [
    '普通第一段依然独立，包含学习方法和注意力之间的具体关系。',
    '普通第二段依然独立，建议根据实际反馈调整学习目标。',
    '比较符必须保持原样：$a < b < c > d$，以及 `$x<b<c>d$`。',
    '$$\n\\begin{aligned}\n  a &< b \\\\\n  c &> d\n\\end{aligned}\n$$',
    '\\[\n  \\sum_{n=1}^{N} n = \\frac{N(N+1)}{2}\n\\]',
    '```python\nif a < b:\n    print("<span>literal code</span>")\n\n    print("keep  two spaces")\n```',
    '- **制定目标**：先确定需要解决的具体问题。\n  - 检查条件与假设。\n- **实践反馈**：根据实践结果修正判断。',
    '| 方法 | 适用情况 |\n| --- | --- |\n| 实践 | 验证具体的学习目标 |',
    '结尾保持可定位的原文段落，公式与代码都不是新增或改写的内容。',
  ];
  const content = blocks.slice(0, 2).join('\n') + '\n\n' + blocks.slice(2).join('\n\n');
  const fromSearch = adaptSearch([{ ...answerItem, ContentText: content }], '学习')[0].answers[0];
  const fromPublic = adaptPublic({ ...snapshot, details: { '123': { ...snapshot.details['123'], content } } }, '')[0].answers[0];
  for (const answer of [fromSearch, fromPublic]) {
    assert.deepEqual(answer.paragraphs, blocks);
    assert.ok(answer.highlights!.length > 0);
    for (const highlight of answer.highlights!) {
      assert.ok(answer.paragraphs[highlight.paragraphIndex].includes(highlight.text));
      assert.ok(content.includes(highlight.text));
    }
  }
  assert.equal(plainText('$a < b < c > d$'), '$a < b < c > d$');
  assert.equal(plainText('a < b < c > d'), 'a < b < c > d');
});

test('HTML extraction keeps established paragraph boundaries and preserves explicit equation alt text', () => {
  const content = '<script>privateBadCode()</script><style>hidden-css</style><!-- hidden comment -->'
    + '<p>原有 HTML 段落 &amp; <strong>强调</strong>。</p>'
    + '<p>公式：<img class="ztext-math" alt="a &lt; b &lt; c &gt; d" src="https://example.test/equation" />。</p>'
    + '<div>另一段。<br>换行仍然独立。</div>';
  const answer = adaptSearch([{ ...answerItem, ContentText: content }], '')[0].answers[0];
  assert.deepEqual(answer.paragraphs, ['原有 HTML 段落 & 强调。', '公式：$a < b < c > d$。', '另一段。', '换行仍然独立。']);
  assert.ok(!JSON.stringify(answer).includes('privateBadCode'));
  assert.ok(!JSON.stringify(answer).includes('hidden-css'));
  assert.ok(!JSON.stringify(answer).includes('hidden comment'));
  const indented = adaptSearch([{ ...answerItem, ContentText: '    if a < b:\n        print(a)\n\n下一段。' }], '')[0].answers[0];
  assert.deepEqual(indented.paragraphs, ['    if a < b:\n        print(a)', '下一段。']);
  const delimitedAlt = adaptSearch([{ ...answerItem, ContentText: '<p><img eeimg="1" alt="$a<b<c>d$"></p>' }], '')[0].answers[0];
  assert.deepEqual(delimitedAlt.paragraphs, ['$a<b<c>d$']);
  const windowsCode = adaptSearch([{ ...answerItem, ContentText: '```python\r\nif a < b:\r\n    print(a)\r\n```\r\n\r\n下一段。' }], '')[0].answers[0];
  assert.deepEqual(windowsCode.paragraphs, ['```python\nif a < b:\n    print(a)\n```', '下一段。']);
});

test('HTTP search delivers intact rich source blocks to the reader and highlight endpoint', async (context) => {
  const formula = '$$\n  E = mc^2\n$$';
  const code = '~~~python\nif a < b:\n    print("preserve  indentation")\n~~~';
  const list = '1. 明确学习目标，选择需要验证的关键问题。\n2. 根据实际反馈调整方法，并检查每一个前提。';
  const content = ['建议以具体的学习目标组织知识，下面的公式、代码和步骤均保留原文。', formula, code, list].join('\n\n');
  const service = new ZhihuService({ snapshot, secret: 'test-only-secret', fetchImpl: async () => json({ Code: 0, Data: { Items: [{ ...answerItem, ContentText: content }] } }) });
  const server: Server = createApp(service, { refreshPublic: false, distDir: '/tmp/wanderwise-no-dist' }).listen(0, '127.0.0.1');
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const response = await (await fetch(`${origin}/api/explore?q=${encodeURIComponent('学习')}`)).json();
  const answer = response.questions[0].answers[0];
  assert.deepEqual(answer.paragraphs.slice(1), [formula, code, list]);
  const selected = await (await fetch(`${origin}/api/answers/answer-101/highlights?questionId=question-50&q=${encodeURIComponent('学习')}`)).json();
  assert.ok(selected.highlights.length > 0);
  for (const quote of selected.highlights) {
    assert.ok(answer.paragraphs[quote.paragraphIndex].includes(quote.text));
    assert.ok(content.includes(quote.text));
  }
});

test('public mode searches the real corpus and leaves unrelated searches empty', () => {
  assert.equal(adaptPublic(snapshot, '量子纠缠').length, 0);
  const result = adaptPublic(snapshot, '如何提高学习效率？');
  assert.equal(result.length, 1);
  assert.equal(result[0].answers.length, 1);
  assert.equal(result[0].answers[0].author, '测试作者');
  assert.equal(result[0].answers[0].isExcerpt, true);
  assert.equal(result[0].kind, 'topic');
  assert.equal(result[0].answersExpanded, true);
  assert.ok(result[0].keywords.includes('主题聚合'));
  assert.match(result[0].answers[0].url, /^https:\/\/api\.zhihu\.com\//);
  assert.ok(extractKeywords('大学生实习应该如何获取资源？').includes('实习'));
  assert.ok(!extractKeywords('大学生实习应该如何获取资源？').includes('如何'));
});

test('public topic filtering excludes unmatched works even when their topic matches', () => {
  const corpus: PublicSnapshot = {
    ...snapshot,
    items: [...snapshot.items, { work_id: '124', title: '学习中的实践方法', description: '实践方法来自实际行动。' }],
    details: { ...snapshot.details, '124': { work_id: '124', chapter_name: '学习中的实践方法', author_name: '另一作者', content: '实践方法来自实际行动。\n安排有价值的任务，再检查实践结果。' } },
  };
  const all = adaptPublic(corpus, '');
  assert.equal(all.length, 1);
  assert.equal(all[0].answers.length, 2);
  const filtered = adaptPublic(corpus, '注意力');
  assert.deepEqual(filtered.flatMap((question) => question.answers.map((answer) => answer.id)), ['knowledge-123']);
  assert.equal(adaptPublic(corpus, '量子纠缠').length, 0);
});

test('answer labels use exact source quotes and keep standalone article titles', () => {
  const content = '大家好，我是这篇回答的作者。\n建议学习时先制定具体目标，再安排实践与反馈，以便判断学习方法是否有效。';
  const result = adaptSearch([
    { ...answerItem, Title: '如何学习？ - 知乎', ContentText: content },
    { ...answerItem, ContentType: 'Article', ContentID: '200', Url: 'https://zhuanlan.zhihu.com/p/200', Title: '实践的方法 - 知乎', ContentText: content },
  ], '学习');
  const question = result.find((entry) => entry.kind === 'question')!;
  assert.equal(question.title, '如何学习？');
  assert.match(question.answers[0].title, /^建议学习/);
  assert.ok(content.includes(question.answers[0].title.replace(/…$/, '')));
  assert.equal(result.find((entry) => entry.kind === 'article')?.answers[0].title, '实践的方法');
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

test('entering a question expands same-question answers once, preserves authors and rejects other questions', async () => {
  const requests: string[] = [];
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async (input) => {
    const query = new URL(String(input)).searchParams.get('Query')!;
    requests.push(query);
    if (query === '学习') return json({ Code: 0, Data: { Items: [{ ...answerItem, Title: '如何学习？ - 知乎' }] } });
    assert.equal(query, '如何学习？');
    return json({ Code: 0, Data: { Items: [
      answerItem,
      { ...answerItem, Title: '来源中同一问题的另一种显示标题', ContentID: '102', AuthorName: '乙', Url: 'https://www.zhihu.com/question/50/answer/102' },
      { ...answerItem, Title: '如何学习? - 知乎', ContentID: '103', AuthorName: '丙', Url: 'https://www.zhihu.com/answer/103' },
      { ...answerItem, ContentID: '104', AuthorName: '其他问题作者', Url: 'https://www.zhihu.com/question/51/answer/104' },
      { ...answerItem, ContentType: 'Article', ContentID: '105', Url: 'https://zhuanlan.zhihu.com/p/105' },
      { ...answerItem, Title: '学习有什么价值？', ContentID: '106', Url: 'https://www.zhihu.com/answer/106' },
      { ...answerItem, ContentID: '999', AuthorName: '乙', Url: 'https://www.zhihu.com/question/50/answer/102' },
    ] } });
  } });
  assert.equal((await service.explore('学习')).questions[0].answers.length, 1);
  const [first, concurrent] = await Promise.all([service.question('question-50', '学习'), service.question('question-50', '学习')]);
  assert.deepEqual(concurrent, first);
  assert.deepEqual(requests, ['学习', '如何学习？']);
  assert.equal(first.question.answersExpanded, true);
  assert.deepEqual(first.question.answers.map((answer) => answer.id).sort(), ['answer-101', 'answer-102', 'answer-103']);
  assert.deepEqual(first.question.answers.map((answer) => answer.author).sort(), ['丙', '乙', '甲'].sort());
  assert.match(first.notice ?? '', /补充 2 篇同题回答/);
  assert.deepEqual(await service.question('question-50', '学习'), first);
  assert.equal((await service.explore('学习')).questions[0].answers.length, 3);
  assert.equal((await service.findAnswer('answer-103', 'question-50', '学习')).author, '丙');
  await assert.rejects(service.findAnswer('answer-104', 'question-50', '学习'), (error: unknown) => error instanceof ApiError && error.status === 404);
  await assert.rejects(service.question('question-51', '学习'), (error: unknown) => error instanceof ApiError && error.status === 404);
  assert.equal(requests.length, 2);
});

test('empty same-question expansion remains empty and is cached without adding unrelated content', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => {
    calls++;
    return json({ Code: 0, Data: { Items: calls === 1
      ? [{ ...answerItem, ContentType: 'Question', ContentText: '', ContentID: '50', Url: 'https://www.zhihu.com/question/50' }]
      : [{ ...answerItem, Url: 'https://www.zhihu.com/question/51/answer/101' }] } });
  } });
  const first = await service.question('question-50', '学习');
  assert.equal(first.question.answers.length, 0);
  assert.equal(first.question.answersExpanded, true);
  assert.match(first.notice ?? '', /未返回可确认属于该问题/);
  assert.deepEqual(await service.question('question-50', '学习'), first);
  assert.equal(calls, 2);
});

test('title-only expansion does not merge conflicting known question IDs', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => {
    calls++;
    return json({ Code: 0, Data: { Items: calls === 1
      ? [{ ...answerItem, Url: 'https://www.zhihu.com/answer/101' }]
      : [answerItem, { ...answerItem, ContentID: '102', Url: 'https://www.zhihu.com/question/51/answer/102' }, { ...answerItem, ContentID: '103', Url: 'https://www.zhihu.com/answer/103' }] } });
  } });
  const question = (await service.explore('学习')).questions[0];
  assert.match(question.id, /^title-/);
  const expanded = await service.question(question.id, '学习');
  assert.deepEqual(expanded.question.answers.map((answer) => answer.id).sort(), ['answer-101', 'answer-103']);
});

test('failed expansion preserves initial answers and returns the actual upstream limit condition', async () => {
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', fetchImpl: async () => {
    calls++;
    return calls === 1 ? json({ Code: 0, Data: { Items: [answerItem] } }) : json({ Code: 30001, Message: 'private detail' });
  } });
  await service.explore('学习');
  await assert.rejects(service.question('question-50', '学习'), (error: unknown) => error instanceof ApiError && error.status === 429 && error.code === 'ZHIHU_RATE_LIMITED');
  const retained = await service.explore('学习');
  assert.equal(retained.questions[0].answers.length, 1);
  assert.equal(retained.questions[0].answersExpanded, false);
  assert.equal(calls, 2);
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
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
});

test('new authenticated searches are serialized and conservatively spaced while cache hits remain immediate', async () => {
  let now = 1000;
  let active = 0;
  let maxActive = 0;
  const starts: number[] = [];
  const waits: number[] = [];
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; }, fetchImpl: async () => {
    starts.push(now);
    active++;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active--;
    return json({ Code: 0, Data: { Items: [answerItem] } });
  } });
  await Promise.all([service.explore('学习甲'), service.explore('学习乙'), service.explore('学习丙')]);
  assert.equal(maxActive, 1);
  assert.deepEqual(starts, [1000, 2100, 3200]);
  assert.deepEqual(waits, [1100, 1100]);
  await service.explore('学习甲');
  assert.equal(starts.length, 3);
});

test('upstream rate limiting cancels queued calls and blocks new calls for a local cooldown without retrying', async () => {
  let now = 1000;
  let calls = 0;
  const service = new ZhihuService({ snapshot, secret: 'secret', now: () => now, wait: async (milliseconds) => { now += milliseconds; }, fetchImpl: async () => {
    calls++;
    return calls === 1 ? json({ Code: 30001, Message: 'private quota detail' }) : json({ Code: 0, Data: { Items: [answerItem] } });
  } });
  const queued = await Promise.allSettled([service.explore('学习甲'), service.explore('学习乙'), service.explore('学习丙')]);
  assert.ok(queued.every((result) => result.status === 'rejected' && result.reason instanceof ApiError && result.reason.code === 'ZHIHU_RATE_LIMITED'));
  assert.equal(calls, 1);
  await assert.rejects(service.explore('学习丁'), (error: unknown) => error instanceof ApiError && error.status === 429);
  assert.equal(calls, 1);
  now += 60_000;
  assert.equal(calls, 1);
  assert.equal((await service.explore('学习甲')).source, 'zhihu-search');
  assert.equal(calls, 2);
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
  assert.equal(response.questions.length, 3);
  const answers = response.questions.flatMap((question) => question.answers);
  assert.equal(answers.length, 10);
  assert.equal(new Set(answers.map((answer) => answer.id)).size, 10);
  assert.ok(response.questions.every((question) => question.kind === 'topic' && question.answersExpanded && question.answers.length >= 2));
  for (const answer of answers) {
    assert.equal(answer.author, bundled.details[answer.workId!].author_name);
    assert.equal(answer.title, bundled.details[answer.workId!].chapter_name);
    assert.ok(answer.paragraphs.length > 1 && answer.isExcerpt);
    assert.ok(answer.highlights!.length > 1);
    assert.ok(answer.highlights!.every((highlight) => answer.paragraphs[highlight.paragraphIndex].includes(highlight.text)));
  }
  assert.match(response.notice ?? '', /并非同一知乎问题/);
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
  assert.equal(health.ok, true);
  assert.equal(health.configured, true);
  assert.equal(health.publicCount, 1);
  assert.equal(typeof health.model.configured, 'boolean');
  assert.equal((await fetch(`${origin}/api/explore?q=a&q=b`)).status, 400);
  assert.equal((await fetch(`${origin}/api/explore?q=${'a'.repeat(161)}`)).status, 400);
  assert.equal((await fetch(`${origin}/api/knowledge/999`)).status, 404);
  assert.equal((await fetch(`${origin}/api/questions/question-50?q=a&q=b`)).status, 400);
  assert.equal((await fetch(`${origin}/api/questions/invalid_id`)).status, 400);
  assert.equal((await fetch(`${origin}/api/answers/knowledge-123/highlights`)).status, 400);
  assert.equal((await fetch(`${origin}/api/answers/knowledge-123/highlights?questionId=topic-learning&questionId=topic-career`)).status, 400);
  assert.equal((await fetch(`${origin}/api/answers/knowledge-123/highlights?questionId=topic-career`)).status, 404);
  assert.equal((await fetch(`${origin}/api/answers/knowledge-124/highlights?questionId=topic-learning`)).status, 404);
  const topic = await (await fetch(`${origin}/api/questions/topic-learning`)).json();
  assert.equal(topic.question.answers[0].id, 'knowledge-123');
  const highlights = await (await fetch(`${origin}/api/answers/knowledge-123/highlights?questionId=topic-learning`)).json();
  assert.equal(highlights.answerId, 'knowledge-123');
  assert.ok(highlights.highlights.every((highlight: { text: string }) => snapshot.details['123'].content!.includes(highlight.text)));
  assert.equal((await fetch(`${origin}/api/answers/knowledge-123/highlights`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: 'untrusted arbitrary content', questionId: 'topic-learning' }) })).status, 404);
  const missing = await fetch(`${origin}/api/missing`);
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type') || '', /application\/json/);
  const error = await fetch(`${origin}/api/explore?q=test`);
  assert.equal(error.status, 502);
  assert.ok(!(await error.text()).includes('never-expose-this'));
});
