import { expect, test, type Page, type Route } from '@playwright/test';
import type { Answer, ExploreResponse, Question } from '../src/types';

// Deterministic API fixtures only; no external hot-list or search quota is used.
const hotQuestions: Question[] = Array.from({ length: 12 }, (_, index) => ({
  id: `question-${7001 + index}`,
  title: `如何理解第${index + 1}个当前热点问题？`,
  excerpt: `这是第${index + 1}个热点的问题简介，不是回答正文。`,
  keywords: ['热点'], relevance: 1 - index * 0.045,
  color: ['#89baff', '#b2a2ff', '#6ee4d3', '#ffc28e'][index % 4],
  kind: 'question', answers: [], answersExpanded: false, hotRank: index + 1,
  url: `https://www.zhihu.com/question/${7001 + index}`,
}));
const paragraphs = [
  '理解一个热点问题时，应当首先确认原始资料的出处，并区分已知事实与解释性的观点。',
  '不同回答可以提供相互补充的观察角度，阅读时需要结合来源与具体论据判断适用范围。',
  '对有分歧的论证，可以逐步检查其中的假设与推导过程，再形成自己的判断。',
  '保留原文出处能让后续讨论更容易核实，也便于重新回到当时的具体语境。',
];
const answersFor = (question: Question): Answer[] => [0, 1].map(index => ({
  id: `answer-${question.id.slice(9)}${index + 1}`,
  title: index ? '用具体论据理解不同观察角度' : '先确认原始资料，再形成自己的判断',
  author: `测试作者${index ? '乙' : '甲'}`, excerpt: paragraphs[index], paragraphs,
  url: `${question.url}/answer/${question.id.slice(9)}${index + 1}`,
  relevance: 0.9 - index * 0.2, isExcerpt: true,
  highlights: paragraphs.map((text, paragraphIndex) => ({ id: `hot-${index}-${paragraphIndex}`, text, paragraphIndex })),
  highlightMethod: 'extractive',
}));
const hotResponse = (): ExploreResponse => ({
  query: '', keywords: [], source: 'zhihu-hot', fetchedAt: '2026-09-14T06:00:00.000Z',
  questions: hotQuestions, notice: '来自知乎当前热榜，进入后检索同题回答。',
});
const publicResponse: ExploreResponse = {
  query: '', keywords: [], source: 'zhihu-cache', fetchedAt: '2026-09-13T06:00:00.000Z',
  questions: [{ ...hotQuestions[0], id: 'topic-learning', title: '公开知识主题', kind: 'topic', hotRank: undefined, answers: answersFor(hotQuestions[0]), answersExpanded: true }],
};
const fulfill = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
const active = (page: Page) => page.locator('.galaxy-content-enter');

async function mockBackend(page: Page, state: { hotFails?: boolean } = {}) {
  const requests: URL[] = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    requests.push(url);
    if (url.pathname === '/api/health') return fulfill(route, { ok: true, configured: true, publicCount: 10, model: { configured: false, provider: 'extractive' } });
    if (url.pathname === '/api/explore') {
      if (url.searchParams.get('mode') === 'public') return fulfill(route, publicResponse);
      return state.hotFails
        ? fulfill(route, { error: 'ZHIHU_HOT_FAILED', message: '知乎热榜暂时未能获取，请稍后重试。' }, 502)
        : fulfill(route, hotResponse());
    }
    if (url.pathname.startsWith('/api/questions/')) {
      const id = url.pathname.split('/').at(-1);
      const question = hotQuestions.find(entry => entry.id === id);
      if (question) return fulfill(route, { question: { ...question, answers: answersFor(question), answersExpanded: true } });
    }
    if (/^\/api\/answers\/[^/]+\/highlights$/.test(url.pathname)) {
      const answerId = url.pathname.split('/')[3];
      const answer = hotQuestions.flatMap(answersFor).find(entry => entry.id === answerId);
      if (answer) return fulfill(route, { answerId, highlights: answer.highlights, method: 'extractive' });
    }
    // A missing fixture cannot silently fall through to a live upstream API.
    return fulfill(route, { error: 'UNEXPECTED_TEST_REQUEST', message: '此测试没有配置该请求。' }, 500);
  });
  return requests;
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
});

test('homepage automatically shows current question galaxies without preset themes or morphology captions', async ({ page }) => {
  const requests = await mockBackend(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '0');
  const labels = active(page).locator('.galaxy-label');
  await expect(labels).toHaveCount(12);
  await expect(active(page).getByRole('button', { name: /^进入星系：/ }).first()).toBeVisible();
  const ids = await labels.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.nodeId));
  expect(ids).toEqual(hotQuestions.map(question => question.id));
  expect(ids.every(id => id?.startsWith('question-'))).toBe(true);
  const metadata = await active(page).locator('.galaxy-label-meta').allTextContents();
  expect(metadata.every(text => text.includes('知乎热榜'))).toBe(true);
  expect(metadata.join(' ')).not.toMatch(/0\s*个回答|椭圆星系|螺旋星系|棒旋星系|透镜星系|不规则星系/);
  await expect(active(page)).not.toContainText('职场成长');
  await expect(active(page)).not.toContainText('心理与关系');
  const morphologies = await labels.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.morphology));
  expect(morphologies).toHaveLength(12);
  expect(morphologies.every(kind => typeof kind === 'string' && kind.length > 0)).toBe(true);
  const homepageRequests = requests.filter(url => url.pathname === '/api/explore');
  expect(homepageRequests).toHaveLength(1);
  expect(homepageRequests[0].searchParams.get('q')).toBe('');
  expect(homepageRequests[0].searchParams.has('mode')).toBe(false);
  expect(requests.some(url => url.pathname.startsWith('/api/questions/'))).toBe(false);
});

test('a hot question loads its answers on entry and reaches source-backed passages and the original reader', async ({ page }) => {
  const requests = await mockBackend(page);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const enter = active(page).getByRole('button', { name: /^进入星系：/ }).first();
  await expect(enter).toBeVisible();
  const questionId = await enter.evaluate(element => element.closest<HTMLElement>('[data-node-id]')!.dataset.nodeId!);
  const question = hotQuestions.find(entry => entry.id === questionId)!;
  const answer = answersFor(question)[0];
  await enter.click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect(active(page).locator('.galaxy-hub-title')).toHaveText(question.title);
  await expect(active(page).getByRole('button', { name: /^阅读观点：/ })).toHaveCount(2);
  const expansionRequests = requests.filter(url => url.pathname.startsWith('/api/questions/'));
  expect(expansionRequests).toHaveLength(1);
  expect(expansionRequests[0].pathname).toBe(`/api/questions/${questionId}`);
  expect(expansionRequests[0].searchParams.get('q')).toBe('');
  await active(page).getByRole('button', { name: `阅读观点：${answer.title}`, exact: true }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await expect(active(page).locator('.galaxy-label-paragraph')).toHaveCount(4);
  await page.keyboard.press('f');
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(answer.title);
  await expect(reader.locator('.reader-paragraph').first()).toContainText(paragraphs[0]);
  await expect(reader.getByRole('link', { name: '前往知乎原文' })).toHaveAttribute('href', answer.url);
  await expect(reader).toContainText('搜索摘要');
  expect(requests.filter(url => url.pathname.endsWith('/highlights')).every(url => url.searchParams.get('questionId') === questionId)).toBe(true);
  expect(errors).toEqual([]);
});

test('hot-list failure stays explicit until the user selects public browsing, and can return to current hot questions', async ({ page }) => {
  const state = { hotFails: true };
  const requests = await mockBackend(page, state);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('知乎热榜暂时未能获取，请稍后重试。', { exact: true })).toBeVisible();
  await expect(active(page).locator('.galaxy-label')).toHaveCount(0);
  expect(requests.some(url => url.searchParams.get('mode') === 'public')).toBe(false);
  await page.getByRole('button', { name: '浏览公开知识', exact: true }).click();
  await expect(active(page).getByRole('button', { name: '进入星系：公开知识主题', exact: true })).toBeVisible();
  expect(requests.filter(url => url.pathname === '/api/explore' && url.searchParams.get('mode') === 'public')).toHaveLength(1);
  state.hotFails = false;
  await page.getByRole('button', { name: '返回知乎热榜', exact: true }).click();
  await expect(active(page).locator('.galaxy-label')).toHaveCount(12);
  await expect(active(page)).not.toContainText('公开知识主题');
  const lastExploration = requests.filter(url => url.pathname === '/api/explore').at(-1)!;
  expect(lastExploration.searchParams.get('q')).toBe('');
  expect(lastExploration.searchParams.has('mode')).toBe(false);
});
