import { expect, test, type Page } from '@playwright/test';
import type { ExploreResponse, SavedItem } from '../src/types';

const keys = {
  collection: 'wanderwise.collection.v1',
  reflections: 'wanderwise.reflections.v1',
  journey: 'wanderwise.journey.v1',
};

test.beforeEach(async ({ page }) => {
  // Every test gets a fresh context. The marker also preserves data on deliberate reloads.
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('wanderwise.e2e.initialized')) {
      for (const key of ['wanderwise.collection.v1', 'wanderwise.reflections.v1', 'wanderwise.journey.v1']) localStorage.removeItem(key);
      sessionStorage.setItem('wanderwise.e2e.initialized', 'true');
    }
  });
});

async function arrive(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
}

async function enterArticle(page: Page): Promise<void> {
  await page.getByRole('button', { name: '进入这片星系' }).click();
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toBeVisible();
  await page.getByRole('button', { name: '走近这束光 · 阅读' }).click();
  await expect(page.getByRole('complementary', { name: '文章阅读' })).toBeVisible();
  await expect(page.getByRole('button', { name: '选中第 1 段', exact: true })).toBeVisible();
}

async function openBag(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^知识行囊/ }).click();
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true })).toBeVisible();
}

async function stored(page: Page, key: string): Promise<unknown[]> {
  return page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '[]'), key);
}

test('real public discovery opens ten knowledge clusters and all three depths', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await arrive(page);
  await expect(page.locator('.universe-stats')).toContainText('10');
  await page.getByRole('button', { name: '星海图谱' }).click();
  await expect(page.getByText('10 个主题', { exact: true })).toBeVisible();
  await expect(page.locator('.minimap > button')).toHaveCount(10);
  await page.getByRole('button', { name: '星海图谱' }).click();
  await expect(page.locator('.universe canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-starfield.png'), animations: 'disabled' });
  await enterArticle(page);
  await expect(page.getByRole('link', { name: /阅读知乎原文|查看知乎官方内容来源/ })).toHaveAttribute('href', /^https:\/\//);
  await expect.poll(async () => (await stored(page, keys.journey)).length).toBeGreaterThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test('E saves a question and its article independently, reload persists, and bag removal updates storage', async ({ page }) => {
  await arrive(page);
  await page.getByRole('button', { name: '进入这片星系' }).click();
  await page.keyboard.press('e');
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await page.getByRole('button', { name: '走近这束光 · 阅读' }).click();
  await page.keyboard.press('e');
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await openBag(page);
  const dialog = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await expect(dialog.getByRole('button', { name: /^收藏 2$/ })).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await dialog.getByRole('button', { name: /^移除收藏：/ }).first().click();
  await expect(dialog.getByRole('article')).toHaveCount(1);
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await dialog.getByRole('button', { name: /^移除收藏：/ }).click();
  await expect(dialog.getByText('行囊轻轻，旅途才刚开始')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await stored(page, keys.collection)).toEqual([]);
});

test('R attaches a personal thought to a selected paragraph, survives reload, exports and deletes', async ({ page }) => {
  await arrive(page);
  await enterArticle(page);
  const paragraph = page.getByRole('button', { name: '选中第 1 段', exact: true });
  const quotedText = (await paragraph.textContent())!.replace(/^\d{2}/, '').trim();
  await paragraph.click();
  await expect(paragraph).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(dialog.locator('blockquote')).toHaveText(quotedText);
  const thought = '我想把这段观点和自己的经历对照，再做一个小实验。';
  await dialog.getByRole('textbox', { name: '你的思考' }).fill(thought);
  await dialog.getByRole('button', { name: '保存思考' }).click();
  await expect(dialog).toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await openBag(page);
  const bag = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await bag.getByRole('button', { name: /^我的思考 1$/ }).click();
  await expect(bag.getByText(thought, { exact: true })).toBeVisible();
  await expect(bag.locator('blockquote')).toHaveText(quotedText);
  const downloadPromise = page.waitForEvent('download');
  await bag.getByRole('button', { name: '导出旅行手记' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Wanderwise-旅行手记-.*\.md$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const notebook = Buffer.concat(chunks).toString('utf8');
  expect(notebook).toContain(thought);
  expect(notebook).toContain('触发这段思考的原文摘录');
  expect(notebook).toContain('探索足迹');
  await bag.getByRole('button', { name: '删除这条思考' }).click();
  await expect(bag.getByText('留一点此刻的想法')).toBeVisible();
  expect(await stored(page, keys.reflections)).toEqual([]);
});

test('journey records reading and reopens the visited content', async ({ page }) => {
  await arrive(page);
  await enterArticle(page);
  const articleTitle = await page.getByRole('complementary', { name: '文章阅读' }).getByRole('heading', { level: 2 }).textContent();
  await page.getByRole('button', { name: '探索足迹', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '探索足迹', exact: true });
  await expect(dialog.getByRole('button', { name: /停留阅读/ }).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /走进问题/ }).first()).toBeVisible();
  await dialog.getByRole('button', { name: /停留阅读/ }).first().click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('complementary', { name: '文章阅读' }).getByRole('heading', { level: 2 })).toHaveText(articleTitle!);
});

test('search uses the real API, handles an empty result, and resets to discovery', async ({ page }) => {
  await arrive(page);
  const search = page.getByRole('textbox', { name: '探索问题或话题' });
  await search.fill('学习');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page).toHaveURL(/q=%E5%AD%A6%E4%B9%A0/);
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await expect(page.locator('.journey-location')).toContainText('学习');
  await search.fill('zzqwanderwisenomatch748392016');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByRole('heading', { name: '这个方向，还没有发现星光' })).toBeVisible();
  await page.getByRole('button', { name: '自由漫游', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
});

test('API failure shows a useful retry and recovers from the real endpoint', async ({ page }) => {
  await page.route('**/api/explore?**', route => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: '知识服务暂时离线，请稍后重试。' } }),
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '暂时没能抵达这片星海' })).toBeVisible();
  await expect(page.getByText('知识服务暂时离线，请稍后重试。', { exact: true })).toBeVisible();
  await page.unroute('**/api/explore?**');
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
});

test('a question without available answers still supports question reflections and disables article entry', async ({ page }) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await page.route('**/api/explore?**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: '', keywords: ['学习'], source: 'zhihu-search', fetchedAt: new Date().toISOString(),
      questions: [{
        id: 'empty-question', title: '暂时没有可用回答的问题', excerpt: '等待更多内容。',
        keywords: ['学习'], relevance: 0.9, color: '#89baff', answers: [],
        url: 'https://www.zhihu.com/question/123',
      }],
    }),
  }));
  await arrive(page);
  await page.getByRole('button', { name: '进入这片星系' }).click();
  await expect(page.getByRole('button', { name: '走近这束光 · 阅读' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /文章恒星/ })).toBeDisabled();
  const depth = page.getByRole('slider', { name: '探索深度' });
  await expect(depth).toHaveAttribute('max', '1');
  await depth.focus();
  await page.keyboard.press('End');
  await expect(depth).toHaveValue('1');
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '文章阅读' })).toHaveCount(0);
  await page.getByRole('complementary', { name: '当前问题的观点' }).getByRole('heading').click();
  await page.keyboard.press('r');
  const dialog = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: '你的思考' }).fill('先记下我对问题本身的想法。');
  await dialog.getByRole('button', { name: '保存思考' }).click();
  await expect.poll(async () => (await stored(page, keys.reflections)).length).toBe(1);
  expect(runtimeErrors).toEqual([]);
});

test('a saved target missing from refreshed results reports the missing content and remains at the overview', async ({ page }) => {
  await arrive(page);
  const saved: SavedItem = {
    id: 'unavailable-question', type: 'question', title: '曾经收藏的一个问题',
    excerpt: '这条内容后来不在当前搜索结果中。', query: 'missing-target-query',
    questionId: 'unavailable-question', url: 'https://www.zhihu.com/question/123',
    savedAt: new Date().toISOString(),
  };
  await page.evaluate(({ key, item }) => localStorage.setItem(key, JSON.stringify([item])), { key: keys.collection, item: saved });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await page.route('**/api/explore?q=missing-target-query', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      query: 'missing-target-query', keywords: [], source: 'zhihu-search', fetchedAt: new Date().toISOString(),
      questions: [{
        id: 'different-question', title: '最新结果中的另一个问题', excerpt: '这并不是原来的收藏。',
        keywords: [], relevance: 0.8, color: '#89baff', answers: [],
      }],
    }),
  }));
  await openBag(page);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: saved.title, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '这条收藏或足迹暂未出现在最新结果中，可从行囊中的来源链接继续阅读。' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '文章阅读' })).toHaveCount(0);
  await openBag(page);
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('link')).toHaveAttribute('href', saved.url!);
});

test('a visit across queries synchronizes the address and the observatory return query', async ({ page, request }) => {
  const response = await request.get('/api/explore?q=%E5%AD%A6%E4%B9%A0');
  expect(response.ok()).toBe(true);
  const data = await response.json() as ExploreResponse;
  expect(data.questions.length).toBeGreaterThan(0);
  const question = data.questions[0];
  const saved: SavedItem = {
    id: question.id, type: 'question', title: question.title, excerpt: question.excerpt,
    questionId: question.id, query: '学习', url: question.url, savedAt: new Date().toISOString(),
  };
  await arrive(page);
  await page.evaluate(({ key, item }) => localStorage.setItem(key, JSON.stringify([item])), { key: keys.collection, item: saved });
  await page.goto('/?q=%E8%81%8C%E5%9C%BA', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('complementary', { name: '当前知识主题' })).toBeVisible();
  await openBag(page);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: saved.title, exact: true }).click();
  await expect(page.getByRole('complementary', { name: '当前问题的观点' }).getByRole('heading')).toHaveText(question.title);
  await expect(page).toHaveURL(/q=%E5%AD%A6%E4%B9%A0/);
  await expect(page.getByRole('textbox', { name: '探索问题或话题' })).toHaveValue('学习');
  await page.evaluate(() => {
    window.addEventListener('wanderwise:return', event => {
      event.preventDefault();
      Reflect.set(window, '__e2eReturnQuery', (event as CustomEvent<{ query: string }>).detail.query);
    });
  });
  await page.getByRole('button', { name: '返回占星台', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__e2eReturnQuery'))).toBe('学习');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('expanded reading provides more space and Escape collapses it before leaving the article', async ({ page }) => {
  await arrive(page);
  await enterArticle(page);
  const article = page.getByRole('complementary', { name: '文章阅读' });
  const originalWidth = (await article.boundingBox())!.width;
  await page.getByRole('button', { name: '展开阅读区域', exact: true }).click();
  await expect.poll(async () => (await article.boundingBox())!.width).toBeGreaterThan(originalWidth * 1.2);
  await expect(page.getByRole('button', { name: '收起阅读区域', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(article).toBeVisible();
  await expect(page.getByRole('button', { name: '展开阅读区域', exact: true })).toBeVisible();
  await expect.poll(async () => (await article.boundingBox())!.width).toBe(originalWidth);
});

test('keyboard shortcuts ignore editing, and Escape closes dialogs before changing depth', async ({ page }) => {
  await arrive(page);
  await page.getByRole('button', { name: '进入这片星系' }).click();
  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: '探索问题或话题' });
  await expect(search).toBeFocused();
  await search.pressSequentially('erf');
  await expect(search).toHaveValue('erf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page, keys.collection)).toEqual([]);
  await page.getByRole('complementary', { name: '当前问题的观点' }).getByRole('heading').click();
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection).toBeVisible();
  await reflection.getByRole('textbox').pressSequentially('erf');
  expect(await stored(page, keys.collection)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(reflection).toBeHidden();
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toBeVisible();
  await page.getByRole('button', { name: '探索指南', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '你的星际旅行指南' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('complementary', { name: '当前问题的观点' })).toBeVisible();
});

test('mobile 390 × 844 supports reading, collecting and reflection without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await arrive(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-starfield.png'), animations: 'disabled' });
  await enterArticle(page);
  await page.getByRole('button', { name: /收藏这束光/ }).click();
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await page.getByRole('button', { name: /^思考/ }).click();
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await reflection.getByRole('textbox', { name: '你的思考' }).fill('在手机上留下的一点思考。');
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await openBag(page);
  const bag = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await expect(bag.getByRole('article')).toHaveCount(1);
  await bag.getByRole('button', { name: /^我的思考 1$/ }).click();
  await expect(bag.getByText('在手机上留下的一点思考。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-notebook.png'), animations: 'disabled' });
});
