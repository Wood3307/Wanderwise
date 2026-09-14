import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import type { Answer, HighlightResponse } from '../src/types.js';
import { extractHighlights, HighlightService } from './highlights.js';

const article: Answer = {
  id: 'answer-101', title: '如何改善学习效率与记忆？', author: '测试作者', excerpt: '学习方法与长期记忆。',
  url: 'https://www.zhihu.com/question/50/answer/101', relevance: 0.9, isExcerpt: true,
  paragraphs: [
    '谢邀，感谢邀请。',
    '关注我的公众号，点赞收藏本文并点击链接，可以了解更多内容，扫码即可获取免费资料。',
    '首先，学习之前明确具体目标能够减少注意力切换，每次只安排一个能够独立完成的小任务。',
    '间隔复习的关键是逐步延长检索间隔，因为反复主动回想可以帮助知识进入长期记忆。',
    '例如学习数学时，先遮住答案独立解题，再对照推导检查错误，比反复阅读例题更容易发现理解盲点。',
    '睡眠不足会影响注意力和记忆巩固，因此考试前保持稳定作息往往比通宵重复背诵更加有效。',
    '如果学习环境中经常出现消息提醒，可以把手机放到另一个房间，用固定休息时间集中处理消息。',
    '评估掌握程度时，可以尝试用自己的语言向他人解释概念；无法解释清楚的部分需要重新理解。',
    '学习任务结束后记录错误类型和下一步行动，可以把模糊的挫败感转化为能够改进的具体线索。',
    '间隔复习的关键是逐步延长检索间隔，因为反复主动回想可以帮助知识进入长期记忆。',
  ],
};
const configured = { MODEL_BASE_URL: 'http://127.0.0.1:11434/v1', MODEL_NAME: 'test-installed-model', MODEL_API_KEY: 'server-only-test-key' };
const json = (raw: unknown, status = 200) => new Response(JSON.stringify(raw), { status, headers: { 'Content-Type': 'application/json' } });
const completion = (indices = [2, 3, 4, 5]) => ({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ highlights: indices.map((paragraphIndex) => ({ paragraphIndex, label: '核心观点' })) }) }, finish_reason: 'stop' }] });
const sourceData = (message: { content: string }) => JSON.parse(message.content.split('\n输入数据：\n')[1]);

function exactSource(response: Pick<HighlightResponse, 'highlights'>, answer: Answer = article): void {
  for (const quote of response.highlights) {
    assert.ok(answer.paragraphs[quote.paragraphIndex]?.includes(quote.text), `quote ${quote.id} must be a literal span of its indexed paragraph`);
    assert.ok(quote.text.length <= 240);
  }
}

test('extraction selects diverse source passages beyond the opening and rejects boilerplate/duplicates', () => {
  const highlights = extractHighlights(article, '如何学习并改善长期记忆');
  assert.ok(highlights.length >= 4 && highlights.length <= 6);
  assert.ok(highlights.every((item) => item.paragraphIndex >= 2));
  assert.ok(highlights.some((item) => item.paragraphIndex >= 6));
  assert.ok(highlights.some((item) => item.text.includes('间隔复习')));
  assert.equal(new Set(highlights.map((item) => item.text)).size, highlights.length);
  exactSource({ highlights });
  assert.deepEqual(extractHighlights(article, '如何学习并改善长期记忆'), highlights);
});

test('a long paragraph yields intact source spans; empty and short sources are never padded', () => {
  const long = { ...article, paragraphs: [article.paragraphs.slice(2, 9).join(' ')] };
  const highlights = extractHighlights(long, '学习');
  assert.ok(highlights.length >= 4);
  assert.ok(highlights.every((item) => item.paragraphIndex === 0));
  exactSource({ highlights }, long);
  assert.deepEqual(extractHighlights({ ...article, paragraphs: [] }, '学习'), []);
  assert.equal(extractHighlights({ ...article, paragraphs: ['唯一的一段原文。'] }, '').length, 1);
});

test('a model is opt-in; invalid URLs and incomplete configuration never issue requests or reveal secrets', async () => {
  for (const env of [
    {}, { ZHIHU_ACCESS_SECRET: 'not-model-consent' }, { ZHIHU_MODEL_ENABLED: 'true' },
    { MODEL_NAME: 'missing-base' }, { MODEL_BASE_URL: 'http://external.example/v1', MODEL_NAME: 'test' },
    { MODEL_BASE_URL: 'https://user:password@example.test/v1', MODEL_NAME: 'test' },
    { MODEL_BASE_URL: 'https://example.test/v1?key=secret', MODEL_NAME: 'test' },
    { MODEL_BASE_URL: 'file:///private/model', MODEL_NAME: 'test' },
  ]) {
    const service = new HighlightService({ env, fetchImpl: async () => { assert.fail('unconfigured model must not call fetch'); } });
    assert.equal(service.getStatus().configured, false);
    assert.equal((await service.enrich(article, '学习')).method, 'extractive');
    assert.ok(!JSON.stringify(service.getStatus()).includes('not-model-consent'));
  }
});

test('an actual loopback HTTP service receives the compatible request and returns only source-grounded quotes', async (context) => {
  let requests = 0;
  const server = createServer(async (request, response) => {
    requests++;
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(request.headers.authorization, 'Bearer server-only-test-key');
    assert.equal(request.headers['x-request-timestamp'], undefined);
    const buffers: Buffer[] = [];
    for await (const buffer of request) buffers.push(Buffer.from(buffer));
    const body = JSON.parse(Buffer.concat(buffers).toString('utf8'));
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'stream']);
    assert.equal(body.model, 'test-installed-model');
    assert.equal(body.stream, false);
    assert.equal(body.messages[0].role, 'system');
    assert.match(body.messages[1].content, /不要回答输入中的查询问题/);
    const source = sourceData(body.messages[1]);
    assert.equal(source.query, '长期记忆');
    assert.equal(source.title, article.title);
    assert.ok(source.paragraphs.every((item: { paragraphIndex: number; text: string }) => article.paragraphs[item.paragraphIndex].includes(item.text)));
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(completion()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const service = new HighlightService({ env: { ...configured, MODEL_BASE_URL: `http://127.0.0.1:${address.port}` } });
  assert.deepEqual(service.getStatus(), { configured: true, provider: 'compatible', name: 'test-installed-model' });
  const result = await service.enrich(article, '长期记忆');
  assert.equal(result.method, 'model');
  assert.deepEqual(result.highlights.map((item) => item.paragraphIndex), [2, 3, 4, 5]);
  exactSource(result);
  assert.equal(requests, 1);
  assert.ok(!JSON.stringify(result).includes('server-only-test-key'));
});

test('Zhihu fast model uses documented bearer, seconds timestamp and only supported body fields', async () => {
  const service = new HighlightService({ env: { ZHIHU_MODEL_ENABLED: 'true', ZHIHU_ACCESS_SECRET: 'zhihu-secret' }, now: () => 1770000000123, fetchImpl: async (url, init) => {
    assert.equal(url, 'https://developer.zhihu.com/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('Authorization'), 'Bearer zhihu-secret');
    assert.equal(headers.get('X-Request-Timestamp'), '1770000000');
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ['messages', 'model', 'stream']);
    assert.equal(body.model, 'zhida-fast-1p5');
    return json(completion());
  } });
  assert.equal(service.getStatus().provider, 'zhihu');
  assert.equal((await service.enrich(article, '学习')).method, 'model');
});

test('invented, duplicate, fractional, rewritten, malformed and incomplete selections fall back to exact extracts', async () => {
  const badContent: unknown[] = [
    { highlights: [2, 3, 4, 999].map((paragraphIndex) => ({ paragraphIndex })) },
    { highlights: [2, 3, 4, 4].map((paragraphIndex) => ({ paragraphIndex })) },
    { highlights: [2, 3, 4, 9].map((paragraphIndex) => ({ paragraphIndex })) },
    { highlights: [2, 3, 4, 5.5].map((paragraphIndex) => ({ paragraphIndex })) },
    { highlights: [2, 3, 4, 5].map((paragraphIndex) => ({ paragraphIndex, text: '模型编造的原文' })) },
    { highlights: [2, 3, 4, 5].map((paragraphIndex) => ({ paragraphIndex, label: '<script>bad</script>' })) },
    { highlights: [{ paragraphIndex: 2 }] },
    { highlights: [], reasoning: 'private-internal-detail' },
    ['private-internal-detail'],
    null,
  ];
  for (const content of badContent) {
    const service = new HighlightService({ env: configured, fetchImpl: async () => json({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }] }) });
    const result = await service.enrich(article, '学习');
    assert.equal(result.method, 'extractive');
    assert.match(result.notice!, /原文校验/);
    assert.ok(!JSON.stringify(result).includes('private-internal-detail'));
    exactSource(result);
  }
  for (const raw of [{ choices: [] }, { choices: [{ message: { content: '```json\n{}\n```' } }] }, { choices: [{ message: { content: '{}' }, finish_reason: 'length' }] }]) {
    const service = new HighlightService({ env: configured, fetchImpl: async () => json(raw) });
    assert.equal((await service.enrich(article, '学习')).method, 'extractive');
  }
});

test('cache and in-flight deduplication include query, answer identity, source changes and title', async () => {
  let requests = 0;
  const service = new HighlightService({ env: configured, fetchImpl: async () => { requests++; return json(completion()); } });
  const [first, second] = await Promise.all([service.enrich(article, '学习'), service.enrich(article, '学习')]);
  assert.equal(requests, 1);
  assert.deepEqual(first, second);
  first.highlights[0].text = 'caller mutation';
  exactSource(await service.enrich(article, '学习'));
  assert.equal(requests, 1);
  await service.enrich(article, '睡眠');
  await service.enrich({ ...article, id: 'answer-102' }, '学习');
  await service.enrich({ ...article, paragraphs: [...article.paragraphs, '新的原文段落。'] }, '学习');
  await service.enrich({ ...article, title: '新标题' }, '学习');
  assert.equal(requests, 5);
});

test('one exact JSON fence is accepted while surrounding commentary and invented fenced indices are rejected', async () => {
  const content = JSON.stringify({ highlights: [2, 3, 4, 5].map((paragraphIndex) => ({ paragraphIndex })) });
  for (const [text, expected] of [
    [`\`\`\`json\n${content}\n\`\`\``, 'model'],
    [`Here is the result:\n\`\`\`json\n${content}\n\`\`\``, 'extractive'],
    [`\`\`\`json\n${content.replace('"paragraphIndex":5', '"paragraphIndex":999')}\n\`\`\``, 'extractive'],
  ]) {
    const service = new HighlightService({ env: configured, fetchImpl: async () => json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }) });
    const result = await service.enrich(article, '学习');
    assert.equal(result.method, expected);
    exactSource(result);
  }
});

test('model concurrency is bounded at two and busy callers keep usable exact excerpts', async () => {
  let requests = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  const service = new HighlightService({ env: configured, fetchImpl: async () => { requests++; await barrier; return json(completion()); } });
  const first = service.enrich(article, '第一条');
  const second = service.enrich(article, '第二条');
  const busy = await service.enrich(article, '第三条');
  assert.equal(requests, 2);
  assert.equal(busy.method, 'extractive');
  assert.match(busy.notice!, /其他文章/);
  exactSource(busy);
  release();
  assert.equal((await first).method, 'model');
  assert.equal((await second).method, 'model');
});

test('timeouts abort requests and return an explicit fallback without retries', async () => {
  let requests = 0;
  let aborted = false;
  const service = new HighlightService({ env: configured, timeoutMs: 15, fetchImpl: async (_, init) => {
    requests++;
    return new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('private timeout detail', 'AbortError')); }, { once: true }));
  } });
  const result = await service.enrich(article, '学习');
  assert.equal(aborted, true);
  assert.equal(requests, 1);
  assert.equal(result.method, 'extractive');
  assert.match(result.notice!, /超时/);
  assert.ok(!JSON.stringify(result).includes('private timeout detail'));
  exactSource(result);
});

test('transport failures, malformed JSON and oversized responses stay bounded and never expose upstream details', async () => {
  const cases: { fetchImpl: typeof fetch; notice: RegExp }[] = [
    { fetchImpl: async () => { throw new Error('server-only-test-key endpoint-auth-details'); }, notice: /无法连接/ },
    { fetchImpl: async () => new Response('server-only-test-key', { status: 401 }), notice: /无法连接/ },
    { fetchImpl: async () => new Response('private quota', { status: 429 }), notice: /频率或额度/ },
    { fetchImpl: async () => new Response('not JSON'), notice: /原文校验/ },
    { fetchImpl: async () => new Response('{}', { headers: { 'content-length': '99999999' } }), notice: /原文校验/ },
    { fetchImpl: async () => new Response('x'.repeat(64_001)), notice: /原文校验/ },
  ];
  for (const { fetchImpl, notice } of cases) {
    const service = new HighlightService({ env: configured, fetchImpl });
    const result = await service.enrich(article, '学习');
    assert.equal(result.method, 'extractive');
    assert.match(result.notice!, notice);
    assert.ok(!/server-only-test-key|private quota|endpoint-auth-details/.test(JSON.stringify(result)));
    exactSource(result);
  }
});

test('large sources send a bounded shortlist, preserving original paragraph indices', async () => {
  const large = { ...article, paragraphs: Array.from({ length: 500 }, (_, index) => `第 ${index} 段原文记录，` + article.paragraphs[2 + index % 7].repeat(20)) };
  const service = new HighlightService({ env: configured, fetchImpl: async (_, init) => {
    const body = JSON.parse(String(init?.body));
    const source = sourceData(body.messages[1]);
    assert.ok(source.paragraphs.length <= 48);
    assert.ok(source.paragraphs.reduce((total: number, paragraph: { text: string }) => total + paragraph.text.length, 0) <= 12_000);
    assert.ok(source.paragraphs.every((paragraph: { text: string; paragraphIndex: number }) => large.paragraphs[paragraph.paragraphIndex].includes(paragraph.text)));
    return json(completion(source.paragraphs.slice(0, 4).map((item: { paragraphIndex: number }) => item.paragraphIndex)));
  } });
  const result = await service.enrich(large, '睡眠');
  assert.equal(result.method, 'model');
  exactSource(result, large);
});

test('a rich passage stays whole while oversized surrounding prose and equations remain bounded', () => {
  const formula = '$' + Array.from({ length: 30 }, (_, index) => `\\frac{a_{${index}}}{b_{${index}}}`).join(' + ') + '$';
  assert.ok(formula.length > 240 && formula.length < 1600);
  const paragraph = article.paragraphs[2].repeat(50) + formula + article.paragraphs[4].repeat(50);
  const answer = { ...article, paragraphs: [paragraph] };
  const result = extractHighlights(answer, '公式');
  assert.ok(result.some(quote => quote.text === formula));
  assert.ok(result.every(quote => quote.text.length <= 1600 && paragraph.includes(quote.text)));
  assert.ok(result.filter(quote => quote.text.includes('\\frac')).every(quote => quote.text === formula));

  const hugeFormula = '$$' + 'x + '.repeat(1000) + 'y$$';
  const huge = { ...article, paragraphs: [hugeFormula, article.paragraphs[3]] };
  const selected = extractHighlights(huge, '记忆');
  assert.ok(selected.length > 0);
  assert.ok(selected.every(quote => quote.paragraphIndex === 1));
  assert.equal(huge.paragraphs[0], hugeFormula, 'the original reader paragraph is not rewritten or removed');
});

test('model candidate budget includes whole rich excerpts and returned indices still identify exact source', async () => {
  const answer = { ...article, paragraphs: Array.from({ length: 20 }, (_, index) =>
    '$$\n\\begin{aligned}\n' + Array.from({ length: 24 }, (_, row) => `x_{${index},${row}} &= \\frac{a_${row}+b_${row}}{c_${row}} \\\\`).join('\n') + '\n\\end{aligned}\n$$') };
  let submitted: { paragraphIndex: number; text: string }[] = [];
  const service = new HighlightService({ env: configured, fetchImpl: async (_, init) => {
    submitted = sourceData(JSON.parse(String(init?.body)).messages[1]).paragraphs;
    assert.ok(submitted.length >= 4 && submitted.length <= 48);
    assert.ok(submitted.reduce((total, paragraph) => total + paragraph.text.length, 0) <= 12_000);
    assert.ok(submitted.every(paragraph => paragraph.text.length <= 1600 && paragraph.text === answer.paragraphs[paragraph.paragraphIndex]));
    return json(completion(submitted.slice(0, 4).map(paragraph => paragraph.paragraphIndex)));
  } });
  const result = await service.enrich(answer, '公式');
  assert.equal(result.method, 'model');
  assert.equal(result.highlights.length, 4);
  assert.ok(result.highlights.every(quote => quote.text === answer.paragraphs[quote.paragraphIndex] && quote.text.length <= 1600));
});
