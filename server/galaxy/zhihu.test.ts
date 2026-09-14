import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { createApp } from './app.js';
import { adaptPublic, adaptSearch, ApiError, extractKeywords, loadSnapshot, plainText, safeZhihuUrl, validWorkId, ZhihuService } from './zhihu.js';
import type { PublicSnapshot, SearchItem } from './zhihu.js';
import { parseRichText } from '../../src/features/galaxy/lib/rich-text.js';
import katex from 'katex';
import { ContentService, normalizeItems } from '../content/service.js';
import { ContentStore } from '../content/store.js';

const snapshot: PublicSnapshot = {
  fetchedAt: '2026-09-13T00:00:00.000Z',
  sourceUrl: 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/list',
  items: [{ work_id: '123', title: '如何提高学习效率？', description: '学习与注意力。' }],
  details: { '123': { work_id: '123', chapter_name: '如何提高学习效率？', author_name: '测试作者', content: '注意力能够影响学习效率。\n这是独立的第二段。' } },
};
const answerItem: SearchItem = { Title: '如何学习？', ContentType: 'Answer', ContentID: '101', ContentText: '<p>第一种观点。</p><p>更详细的论述。</p>', Url: 'https://www.zhihu.com/question/50/answer/101?utm_source=test', AuthorName: '甲', VoteUpCount: 4 };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

test('CLI content summaries retain rich source through SQLite restart, expansion and existing budgets', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'galaxy-rich-content-'));
  const path = join(directory, 'content.sqlite3');
  const now = () => Date.parse('2026-09-14T06:00:00Z');
  let store = new ContentStore(path, now);
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const blocks = [
    '学习应保留来源的条件、证据和边界，不能把检索摘要冒充完整正文。',
    '$$\n\\begin{aligned}\n  a &< b \\\\\n  c &> d\n\\end{aligned}\n$$',
    '```python\nif a < b:\n    print("literal <span> and  two spaces")\n\n    print(a)\n```',
    '- 检查实际问题与适用条件。\n  - 保留来源中的缩进。\n- 根据证据重新比较观点。',
    '| 方法 | 边界 |\n| --- | --- |\n| 实践 | 需要观察实际反馈 |',
  ];
  const body = blocks.join('\n\n');
  const expandedBlocks = [...blocks, '\\[\\sum_{n=1}^{N} n = \\frac{N(N+1)}{2}\\]'];
  const calls: string[][] = [];
  const runner = async (args: string[]) => {
    calls.push([...args]);
    const expanded = args[0] === 'question';
    assert.deepEqual(args.slice(0, 2), expanded ? ['question', 'answers'] : ['search', 'zhihu']);
    return { Data: { Items: [{ ...answerItem, ContentText: expanded ? expandedBlocks.join('\n\n') : body }] } };
  };
  const context = { visitorId: 'format-test-visitor' };
  const makeServices = () => {
    const content = new ContentService({ store, runner, now, globalLimit: 2, visitorLimit: 2 });
    const galaxy = new ZhihuService({ content, snapshot, now, fetchImpl: async () => { throw new Error('Legacy direct fetch must not run'); } });
    return { content, galaxy };
  };
  let { content, galaxy } = makeServices();
  const [first, concurrent] = await Promise.all([galaxy.explore('学习', context), galaxy.explore('学习', context)]);
  assert.deepEqual(first, concurrent);
  assert.equal(calls.length, 1);
  const firstAnswer = first.questions[0].answers[0];
  assert.deepEqual(firstAnswer.paragraphs, blocks);
  assert.equal(firstAnswer.isExcerpt, true);
  assert.equal(store.source('answer-101')?.summary, body);
  assert.equal(store.source('answer-101')?.kind, 'search_summary');
  assert.equal((await content.search('学习', 'zhihu', context)).cached, true);
  const expanded = await galaxy.question('question-50', '学习', context);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['question', 'answers', '--question-url', 'https://www.zhihu.com/question/50', '--offset', '0', '--limit', '20']);
  assert.deepEqual(expanded.question.answers[0].paragraphs, expandedBlocks);
  assert.equal(expanded.question.answers[0].isExcerpt, true);
  assert.equal(store.source('answer-101')?.kind, 'answer_summary');
  assert.equal(store.source('answer-101')?.summary, expandedBlocks.join('\n\n'));
  for (const answer of [firstAnswer, expanded.question.answers[0]]) {
    assert.ok(answer.highlights!.length > 0);
    for (const highlight of answer.highlights!) assert.ok(answer.paragraphs[highlight.paragraphIndex].includes(highlight.text));
  }
  const budgets = () => store.db.prepare('SELECT day, scope, count FROM budgets ORDER BY scope').all();
  const reserved = budgets();
  assert.equal(reserved.length, 2);
  assert.ok(reserved.every(row => row.count === 2));
  store.close();
  store = new ContentStore(path, now);
  ({ content, galaxy } = makeServices());
  assert.deepEqual(budgets(), reserved);
  assert.equal((await content.search('学习', 'zhihu', context)).cached, true);
  const restored = await galaxy.question('question-50', '学习', context);
  assert.deepEqual(restored.question, expanded.question);
  assert.match(restored.notice!, /本地缓存/);
  assert.equal(calls.length, 2);
  assert.deepEqual(budgets(), reserved);
  await assert.rejects(galaxy.explore('另一个问题', context), (error: unknown) => error instanceof ApiError && error.code === 'DAILY_BUDGET_EXHAUSTED');
  assert.equal(calls.length, 2);
  assert.deepEqual(budgets(), reserved);
});

test('unified content source bounds do not split math, code or surrogate pairs before caching', () => {
  const prefix = '来源'.repeat(5999);
  const formula = '$$\\frac{' + 'x+'.repeat(100) + '1}{2}$$';
  const titlePrefix = '题'.repeat(399);
  const result = normalizeItems({ Data: { Items: [
    { ...answerItem, Title: titlePrefix + formula, ContentText: prefix + formula },
    { ...answerItem, Url: 'https://www.zhihu.com/question/50/answer/102', Title: titlePrefix + '🌠后文', ContentText: prefix + '`literal <b> code`' },
  ] } }, 'zhihu', 'search_summary', '2026-09-14T06:00:00Z');
  assert.equal(result.items.length, 2);
  for (const item of result.items) {
    assert.equal(item.title, titlePrefix);
    assert.equal(item.summary, prefix);
    assert.equal(item.kind, 'search_summary');
    assert.ok(item.title.length <= 400 && item.summary.length <= 12_000);
  }
  assert.ok(typeof result.notice === 'string');
  assert.match(result.notice, /并非全文/);
});

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

test('adapter-to-highlight math survives multi-line environments, blank lines and explicit LaTeX fences', () => {
  const aligned = '\\begin{aligned}\n'
    + Array.from({ length: 12 }, (_, index) => `x_{${index}} &= \\frac{a_{${index}} + b_{${index}}}{c_{${index}}} \\\\`).join('\n\n')
    + '\n\\end{aligned}';
  for (const formula of [`$$\n${aligned}\n$$`, `\\[\n${aligned}\n\\]`, aligned, `\`\`\`latex\n${aligned}\n\`\`\``]) {
    assert.ok(formula.length > 240);
    const answers = [
      adaptSearch([{ ...answerItem, ContentText: formula }], '')[0].answers[0],
      adaptPublic({ ...snapshot, details: { '123': { ...snapshot.details['123'], content: formula } } }, '')[0].answers[0],
    ];
    for (const answer of answers) {
      assert.deepEqual(answer.paragraphs, [formula]);
      assert.deepEqual(answer.highlights!.map(quote => quote.text), [formula]);
      assert.equal(answer.highlights![0].paragraphIndex, 0);
      const parsed = parseRichText(answer.highlights![0].text);
      const math = parsed.tokens.flatMap(token => token.children ?? [token]).filter(token => token.type === 'math_display');
      assert.equal(math.length, 1);
      assert.match(katex.renderToString(math[0].content, { displayMode: true, throwOnError: true, trust: false }), /class="katex/);
    }
  }
  const inline = '计算得到 \\(\n\\frac{a}{b}\n\\) 并解释每一个变量的含义。';
  const answer = adaptSearch([{ ...answerItem, ContentText: inline }], '')[0].answers[0];
  assert.deepEqual(answer.paragraphs, [inline]);
  assert.equal(answer.highlights![0].text, inline);
  assert.ok(parseRichText(answer.highlights![0].text).tokens.some(token => token.children?.some(child => child.type === 'math_inline')));
});

test('equation source attributes and approved Zhihu equation URLs are restored without fetching images', () => {
  const content = '<p>比较：$a &lt; b$；代码：`$a &lt; b$`。</p>'
    + '<p>网址公式：<img src="https://www.zhihu.com/equation?tex=%5Cfrac%7Ba%2Bb%7D%7Bc%7D&amp;preview=true">。</p>'
    + '<p>延迟图片：<img data-src="/equation?tex=E%3Dmc%5E2">。</p>'
    + '<p>属性公式：<span data-tex="x &lt; y"><span>rendered fallback</span></span>。</p>'
    + '<p>公式图片：<img data-latex="\\sqrt{x}">。</p>';
  const answer = adaptSearch([{ ...answerItem, ContentText: content }], '')[0].answers[0];
  assert.deepEqual(answer.paragraphs, [
    '比较：$a < b$；代码：`$a &lt; b$`。',
    '网址公式：$\\frac{a+b}{c}$。',
    '延迟图片：$E=mc^2$。',
    '属性公式：$x < y$。',
    '公式图片：$\\sqrt{x}$。',
  ]);
  assert.ok(!JSON.stringify(answer).includes('rendered fallback'));
  const math = parseRichText(answer.paragraphs[0]).tokens.flatMap(token => token.children ?? []).find(token => token.type === 'math_inline');
  assert.ok(math);
  assert.doesNotThrow(() => katex.renderToString(math.content, { throwOnError: true, trust: false }));
  for (const url of ['https://evil.test/equation?tex=E', 'https://www.zhihu.com.evil.test/equation?tex=E', 'https://user:pass@www.zhihu.com/equation?tex=E', 'https://www.zhihu.com:8443/equation?tex=E', 'javascript:alert(1)', 'https://www.zhihu.com/redirect?tex=E']) {
    assert.equal(plainText(`<p>原文<img src="${url}">保持。</p>`), '原文保持。');
  }
  assert.equal(plainText('<p>原文<img alt="not source TeX" src="https://example.test/image.png">保持。</p>'), '原文保持。');
});

test('answer labels and summaries finish source formulas instead of cutting TeX commands', () => {
  const formula = '$\\int_{-\\infty}^{+\\infty} e^{-x^2} \\, dx = \\sqrt{\\pi}$';
  const content = `需要先明确核心的计算公式：${formula}。结论用于解释高斯积分的计算方法。`;
  const answer = adaptSearch([{ ...answerItem, ContentText: content }], '')[0].answers[0];
  assert.ok(answer.title.includes(formula));
  assert.ok(answer.title.length <= 400);
  assert.ok(answer.highlights!.every(quote => answer.paragraphs[quote.paragraphIndex].includes(quote.text)));
  const long = '说明'.repeat(85) + formula + '。之后的分析同样来自原文。';
  const question = adaptSearch([{ ...answerItem, ContentText: long }], '')[0];
  assert.ok(question.excerpt.includes(formula));
  assert.ok(question.answers[0].excerpt.includes(formula));
  assert.ok(long.startsWith(question.excerpt));
  assert.ok(long.startsWith(question.answers[0].excerpt));
  const publicAnswer = adaptPublic({ ...snapshot, details: { '123': { ...snapshot.details['123'], content: long, introduction: long } } }, '')[0].answers[0];
  assert.ok(publicAnswer.excerpt.includes(formula));
  assert.ok(long.startsWith(publicAnswer.excerpt));
  const huge = '$$' + 'x + '.repeat(400) + 'y$$';
  const hugeAnswer = adaptSearch([{ ...answerItem, ContentText: huge }], '')[0].answers[0];
  assert.deepEqual(hugeAnswer.paragraphs, [huge]);
  assert.equal(hugeAnswer.title, answerItem.Title);
  assert.equal(hugeAnswer.excerpt, '');
  assert.deepEqual(hugeAnswer.highlights, []);

  for (const [limit, fromPublic] of [[12000, false], [20000, true]] as const) {
    const prefix = '文'.repeat(limit - 10);
    const boundary = prefix + formula;
    const limited = fromPublic
      ? adaptPublic({ ...snapshot, details: { '123': { ...snapshot.details['123'], content: boundary } } }, '')[0].answers[0]
      : adaptSearch([{ ...answerItem, ContentText: boundary }], '')[0].answers[0];
    assert.deepEqual(limited.paragraphs, [prefix]);
    assert.ok(limited.highlights!.every(quote => boundary.includes(quote.text)));
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
  assert.equal((await service.explore('', undefined, 'public')).source, 'zhihu-public');
  await service.refreshPublic();
  assert.equal(calls, 2);
  const broken = new ZhihuService({ snapshot, fetchImpl: async () => json({}, 503) });
  await broken.refreshPublic();
  const cached = await broken.explore('', undefined, 'public');
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
  const response = await service.explore('', undefined, 'public');
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
