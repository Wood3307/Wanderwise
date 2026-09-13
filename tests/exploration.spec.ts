import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import type { Answer, ExploreResponse, Question, SavedItem } from '../src/types';

const keys = { collection: 'wanderwise.collection.v1', reflections: 'wanderwise.reflections.v1', journey: 'wanderwise.journey.v1' };
// Explicit test fixtures: these are never shipped as real Zhihu content.
const paragraphs = [
  '学习之前明确具体目标能够减少注意力切换，每次只安排一个能够独立完成的小任务。',
  '间隔复习的关键是逐步延长检索间隔，因为反复主动回想可以帮助知识进入长期记忆。',
  '例如学习数学时，先遮住答案独立解题，再对照推导检查错误，更容易发现理解盲点。',
  '睡眠不足会影响注意力和记忆巩固，因此考试前保持稳定作息往往更加有效。',
  '如果环境中经常出现消息提醒，可以把手机放到另一个房间，固定休息时间再处理消息。',
  '评估掌握程度时，尝试用自己的语言解释概念，无法解释清楚的部分需要重新理解。',
];
const titles = ['把目标拆成可执行的小任务', '在间隔复习中建立长期记忆', '给深度学习留下完整时间'];
const answers: Answer[] = titles.map((title, index) => ({
  id: `answer-${101 + index}`, title, author: `测试作者${'甲乙丙'[index]}`, excerpt: paragraphs[index], paragraphs,
  url: `https://www.zhihu.com/question/50/answer/${101 + index}`, relevance: 0.98 - index * 0.25, votes: 120 - index * 30, isExcerpt: true,
  highlights: paragraphs.map((text, paragraphIndex) => ({ id: `a${index}-p${paragraphIndex}`, text, paragraphIndex })), highlightMethod: 'extractive',
}));
const question: Question = {
  id: 'question-50', title: '怎样让学习真正转化为长期记忆？', excerpt: '从学习目标、练习和记忆理解学习方法。', keywords: ['学习', '记忆'], relevance: 0.98,
  color: '#a8d8ee', answers, kind: 'question', url: 'https://www.zhihu.com/question/50', answersExpanded: true,
};
const otherQuestions: Question[] = [
  { ...question, id: 'question-51', title: '为什么持续专注比延长学习时间更有效？', relevance: 0.64, color: '#c0a8e4', answers: [{ ...answers[1], id: 'answer-201' }] },
  { ...question, id: 'question-52', title: '怎样养成适合自己的阅读习惯？', relevance: 0.25, color: '#76aea8', answers: [{ ...answers[2], id: 'answer-301' }] },
];
const discovery = (query = ''): ExploreResponse => ({ query, keywords: ['学习'], source: 'zhihu-search', fetchedAt: '2026-09-13T00:00:00.000Z', questions: [{ ...question, answers: [answers[0]], answersExpanded: false }, ...otherQuestions] });
const fulfill = (route: Route, value: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('wanderwise.e2e.initialized')) {
      for (const key of ['wanderwise.collection.v1', 'wanderwise.reflections.v1', 'wanderwise.journey.v1']) localStorage.removeItem(key);
      sessionStorage.setItem('wanderwise.e2e.initialized', 'true');
    }
  });
  // Browser tests never consume live search or model quota.
  await page.route('**/api/explore?**', route => fulfill(route, discovery(new URL(route.request().url()).searchParams.get('q') ?? '')));
  await page.route('**/api/questions/**', route => fulfill(route, { question }));
  await page.route('**/api/health', route => fulfill(route, { ok: true, configured: true, publicCount: 10, model: { configured: true, provider: 'zhihu', name: 'zhida-fast-1p5' } }));
  await page.route('**/api/answers/*/highlights?**', route => {
    const answerId = new URL(route.request().url()).pathname.split('/')[3];
    const source = [...answers, ...otherQuestions.flatMap((item) => item.answers)].find((item) => item.id === answerId);
    return fulfill(route, { answerId, highlights: source?.highlights ?? [], method: 'model' });
  });
});

const active = (page: Page) => page.locator('.galaxy-content-enter');
const visiblePageSize = (page: Page) => (page.viewportSize()?.width ?? 1440) < 760 ? 2 : 4;
async function hoverMovingCelestialText(page: Page, button: Locator): Promise<void> {
  if (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
  await expect(button).toBeVisible();
  let previous: { x: number; y: number } | undefined;
  // Wait for the camera flight, but permit the subpixel drift of a slowly
  // rotating star. Move the actual pointer first: locator.hover()/click() wait
  // for exact pixel stability before hovering, so they cannot initiate this
  // deliberate hover-to-pause interaction by themselves.
  await expect.poll(async () => {
    const box = (await button.boundingBox())!;
    const movement = previous ? Math.hypot(box.x - previous.x, box.y - previous.y) : Infinity;
    previous = box;
    return movement;
  }, { intervals: [200, 250] }).toBeLessThan(1);
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-motion-paused', 'true');
}
async function arrive(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '0');
  await expect(active(page).getByRole('button', { name: /^进入星系：/ }).first()).toBeVisible();
}
async function enterQuestion(page: Page): Promise<void> {
  const enter = active(page).getByRole('button', { name: `进入星系：${question.title}`, exact: true });
  await hoverMovingCelestialText(page, enter);
  await enter.click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect(active(page).locator('.galaxy-hub-title')).toHaveText(question.title);
  await expect(active(page).locator('.galaxy-hub')).toHaveAttribute('data-screen-x', /-?\d/);
  await expect(active(page).getByRole('button', { name: /^阅读观点：/ })).toHaveCount(Math.min(answers.length, visiblePageSize(page)));
}
async function enterArticle(page: Page, answer = answers[0]): Promise<void> {
  if (await page.locator('.galaxy-scene').getAttribute('data-depth') === '0') await enterQuestion(page);
  const enter = active(page).getByRole('button', { name: `阅读观点：${answer.title}`, exact: true });
  await hoverMovingCelestialText(page, enter);
  await enter.click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await expect(active(page).getByRole('button', { name: `阅读原文：${answer.title}`, exact: true })).toBeVisible();
  await expect(active(page).locator('.galaxy-hub')).toHaveAttribute('data-screen-x', /-?\d/);
  await expect(active(page).locator('.galaxy-label-paragraph')).toHaveCount(Math.min(answer.highlights?.length ?? answer.paragraphs.length, visiblePageSize(page)));
}
async function openReader(page: Page, answer = answers[0]): Promise<void> {
  const enter = active(page).getByRole('button', { name: `阅读原文：${answer.title}`, exact: true });
  await hoverMovingCelestialText(page, enter);
  await enter.click();
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toBeVisible();
}
async function openBag(page: Page): Promise<void> {
  await page.getByRole('button', { name: '知识行囊', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true })).toBeVisible();
}
async function stored(page: Page, key: string): Promise<unknown[]> {
  return page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '[]'), key);
}

async function projectionSnapshot(label: Locator) {
  return label.evaluate(element => {
    const node = element as HTMLElement;
    const body = node.querySelector<HTMLElement>('.galaxy-label-body')!;
    const title = node.querySelector<HTMLElement>('.galaxy-label-title')!;
    const marker = node.querySelector<HTMLElement>('.galaxy-star-marker')!.getBoundingClientRect();
    const box = body.getBoundingClientRect();
    let horizontal = true;
    for (let current: HTMLElement | null = title; current && !current.classList.contains('galaxy-content-layer'); current = current.parentElement) {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(current).transform);
      if (Math.abs(matrix.b) > 0.0001 || Math.abs(matrix.c) > 0.0001 || Math.abs(matrix.m13) > 0.0001 || Math.abs(matrix.m23) > 0.0001) horizontal = false;
    }
    return {
      world: [Number(node.dataset.worldX), Number(node.dataset.worldY), Number(node.dataset.worldZ)],
      screen: [Number(node.dataset.screenX), Number(node.dataset.screenY)],
      marker: [marker.x + marker.width / 2, marker.y + marker.height / 2],
      text: { x: box.x, y: box.y, width: box.width, height: box.height },
      fontSize: Number.parseFloat(getComputedStyle(title).fontSize), horizontal,
      visible: getComputedStyle(body).visibility !== 'hidden' && Number(getComputedStyle(body).opacity) > 0,
    };
  });
}

async function dragUncoveredCanvas(page: Page, dx = 74, dy = 26) {
  const start = await page.locator('.galaxy-canvas').evaluate((canvas, movement) => {
    const rect = canvas.getBoundingClientRect();
    for (const fy of [0.76, 0.66, 0.56, 0.43, 0.84]) {
      for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
        const x = rect.x + rect.width * fx;
        const y = rect.y + rect.height * fy;
        if (x + movement.dx < rect.left + 12 || x + movement.dx > rect.right - 12 || y + movement.dy < rect.top + 12 || y + movement.dy > rect.bottom - 12) continue;
        if (document.elementFromPoint(x, y) === canvas) return { x, y };
      }
    }
    throw new Error('No uncovered canvas area is available for camera dragging.');
  }, { dx, dy });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 12 });
  await page.mouse.up();
}

async function expectAnchoredDrag(page: Page, label: Locator) {
  await expect(label).toHaveAttribute('data-world-x', /-?\d/);
  await expect(label.locator('.galaxy-label-title')).toBeVisible();
  let lastScreen: number[] | undefined;
  // Wait for the entry flight to settle, so it cannot falsely satisfy the drag
  // assertion. Reduced motion also makes the scene's world anchors stationary.
  await expect.poll(async () => {
    const current = (await projectionSnapshot(label)).screen;
    const delta = lastScreen ? Math.hypot(current[0] - lastScreen[0], current[1] - lastScreen[1]) : Infinity;
    lastScreen = current;
    return delta;
  }, { intervals: [150, 200, 250] }).toBeLessThan(0.25);
  const before = await projectionSnapshot(label);
  await dragUncoveredCanvas(page);
  await expect.poll(async () => {
    const current = await projectionSnapshot(label);
    return Math.hypot(current.screen[0] - before.screen[0], current.screen[1] - before.screen[1]);
  }).toBeGreaterThan(6);
  await expect.poll(async () => {
    const current = await projectionSnapshot(label);
    return Math.hypot(current.text.x - before.text.x, current.text.y - before.text.y);
  }).toBeGreaterThan(6);
  const after = await projectionSnapshot(label);
  expect(after.world).toEqual(before.world);
  expect(after.world.every(Number.isFinite)).toBe(true);
  expect(after.screen.every(Number.isFinite)).toBe(true);
  expect(Math.hypot(after.marker[0] - after.screen[0], after.marker[1] - after.screen[1])).toBeLessThan(2);
  expect(after.visible).toBe(true);
  expect(after.fontSize).toBeGreaterThanOrEqual(13);
  expect(after.horizontal).toBe(true);
  expect(after.text.width).toBeGreaterThanOrEqual(175);
  const viewport = page.viewportSize()!;
  expect(after.text.x).toBeGreaterThanOrEqual(0);
  expect(after.text.y).toBeGreaterThanOrEqual(0);
  expect(after.text.x + after.text.width).toBeLessThanOrEqual(viewport.width);
  expect(after.text.y + after.text.height).toBeLessThanOrEqual(viewport.height);
}

test('real public discovery groups ten traceable works into topics with multiple orbiting articles', async ({ page, request }) => {
  const response = await request.get('/api/explore?q=');
  expect(response.ok()).toBe(true);
  const corpus = await response.json() as ExploreResponse;
  expect(corpus.questions.length).toBe(3);
  expect(corpus.questions.every((entry) => entry.kind === 'topic')).toBe(true);
  expect(corpus.questions.reduce((count, entry) => count + entry.answers.length, 0)).toBe(10);
  expect(corpus.questions.flatMap((entry) => entry.answers).every((answer) => !!answer.workId && !!answer.author && answer.isExcerpt)).toBe(true);
  await page.route('**/api/explore?**', route => fulfill(route, corpus));
  await arrive(page);
  await expect(active(page).locator('.galaxy-label')).toHaveCount(3);
  await expect(active(page).locator('.galaxy-label-eyebrow').first()).toHaveText('THEME');
  await active(page).getByRole('button', { name: /^进入星系：/ }).first().click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect(active(page).locator('.galaxy-hub-meta')).toContainText('主题聚合');
  await expect(active(page).getByRole('button', { name: /^阅读观点：/ })).toHaveCount(corpus.questions[0].answers.length);
});

test('three depths contain distinct content, luminosity contrast, and a central source reader', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await arrive(page);
  await expect(page.getByRole('complementary')).toHaveCount(0);
  for (const text of ['选择一束星光，发现新的方向', '让知识相遇，让思考生长', '本次探索', '初始星光亮度']) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
  await expect(page.locator('.depth-navigation, .bottom-bar, .universe-stats, .journey-location')).toHaveCount(0);
  const powers = await active(page).locator('.galaxy-label').evaluateAll(nodes => nodes.map(node => Number((node as HTMLElement).style.getPropertyValue('--star-power'))));
  expect(Math.max(...powers) / Math.min(...powers)).toBeGreaterThan(8);
  await page.screenshot({ path: testInfo.outputPath('depth-0-question-clusters.png'), animations: 'disabled' });
  await enterQuestion(page);
  await expect(active(page).locator('.galaxy-label-body')).toContainText(['测试作者甲', '测试作者乙', '测试作者丙']);
  await page.screenshot({ path: testInfo.outputPath('depth-1-answers-around-question.png'), animations: 'disabled' });
  await enterArticle(page);
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
  const hub = (await active(page).locator('.galaxy-hub').boundingBox())!;
  expect(Math.abs(hub.x + hub.width / 2 - 720)).toBeLessThan(90);
  const cards = await active(page).locator('.galaxy-label-body').all();
  const bounds = await Promise.all(cards.map(card => card.boundingBox()));
  expect(bounds.some(bound => bound && bound.x + bound.width < hub.x + hub.width / 2)).toBe(true);
  expect(bounds.some(bound => bound && bound.x > hub.x + hub.width / 2)).toBe(true);
  for (const bound of bounds) {
    expect(bound).not.toBeNull();
    expect(bound!.x < hub.x + hub.width && bound!.x + bound!.width > hub.x && bound!.y < hub.y + hub.height && bound!.y + bound!.height > hub.y).toBe(false);
  }
  await page.screenshot({ path: testInfo.outputPath('depth-2-paragraph-constellation.png'), animations: 'disabled' });
  await active(page).getByRole('button', { name: '下一组星光' }).click();
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(4));
  await active(page).getByRole('button', { name: '上一组星光' }).click();
  await openReader(page);
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(answers[0].title);
  await expect(reader.locator('.reader-source-badge')).toContainText('搜索摘要');
  await expect(reader.getByRole('link', { name: '前往知乎原文' })).toHaveAttribute('href', answers[0].url);
  const room = (await reader.boundingBox())!;
  expect(Math.abs(room.x + room.width / 2 - 720)).toBeLessThan(5);
  await page.screenshot({ path: testInfo.outputPath('central-reading-room.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(reader).toBeHidden();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await page.keyboard.press('Escape');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '0');
  expect(errors).toEqual([]);
});

test('E saves question and answer independently; reload and removal keep storage consistent', async ({ page }) => {
  await arrive(page);
  await enterQuestion(page);
  await page.keyboard.press('e');
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await enterArticle(page);
  await page.keyboard.press('e');
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(2);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBag(page);
  const bag = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await expect(bag.getByRole('button', { name: /^收藏 2$/ })).toBeVisible();
  await expect(bag.getByRole('article')).toHaveCount(2);
  await bag.getByRole('button', { name: /^移除收藏：/ }).first().click();
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await bag.getByRole('button', { name: /^移除收藏：/ }).click();
  await expect(bag.getByText('行囊轻轻，旅途才刚开始')).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await stored(page, keys.collection)).toEqual([]);
});

test('R attaches an exact constellation quote, persists, exports and deletes the reflection', async ({ page }) => {
  await arrive(page);
  await enterArticle(page);
  await active(page).locator('.galaxy-label-title').nth(1).click();
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection.locator('blockquote')).toHaveText(paragraphs[1]);
  const thought = '我想把这段观点和自己的经历对照，再做一个小实验。';
  await reflection.getByRole('textbox', { name: '你的思考' }).fill(thought);
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await expect(reflection).toBeHidden();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBag(page);
  const bag = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await bag.getByRole('button', { name: /^我的思考 1$/ }).click();
  await expect(bag.getByText(thought, { exact: true })).toBeVisible();
  await expect(bag.locator('blockquote')).toHaveText(paragraphs[1]);
  const downloadPromise = page.waitForEvent('download');
  await bag.getByRole('button', { name: '导出旅行手记' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Wanderwise-旅行手记-.*\.md$/);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  const notebook = Buffer.concat(chunks).toString('utf8');
  expect(notebook).toContain(thought);
  expect(notebook).toContain(paragraphs[1]);
  expect(notebook).toContain('探索足迹');
  await bag.getByRole('button', { name: '删除这条思考' }).click();
  await expect(bag.getByText('留一点此刻的想法')).toBeVisible();
  expect(await stored(page, keys.reflections)).toEqual([]);
});

test('a paragraph opens its source in the central reader and journey reopens the correct answer', async ({ page }) => {
  await arrive(page);
  await enterArticle(page, answers[1]);
  await active(page).getByRole('button', { name: '在原文中阅读第 4 段', exact: true }).click();
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader.getByRole('button', { name: '选中第 4 段', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '探索足迹', exact: true }).click();
  const journey = page.getByRole('dialog', { name: '探索足迹', exact: true });
  await expect(journey.getByRole('button', { name: /走进问题/ }).first()).toBeVisible();
  await journey.getByRole('button', { name: /停留阅读/ }).first().click();
  await expect(journey).toBeHidden();
  await expect(active(page).getByRole('button', { name: `阅读原文：${answers[1].title}` })).toBeVisible();
  await expect.poll(async () => (await stored(page, keys.journey)).length).toBeGreaterThanOrEqual(2);
});

test('search updates the address, handles no matches, and returns to discovery without quota use', async ({ page }) => {
  await page.route('**/api/explore?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    return fulfill(route, { ...discovery(query), ...(query === '不存在的测试主题' ? { questions: [] } : {}) });
  });
  await arrive(page);
  const search = page.getByRole('textbox', { name: '探索问题或话题' });
  await search.fill('学习');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page).toHaveURL(/q=%E5%AD%A6%E4%B9%A0/);
  await expect(active(page).locator('.galaxy-label')).toHaveCount(3);
  await search.fill('不存在的测试主题');
  await page.getByRole('button', { name: '开始探索' }).click();
  await expect(page.getByRole('heading', { name: '这个问题还没有匹配的星光' })).toBeVisible();
  await page.getByRole('button', { name: '浏览公开知识', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(active(page).locator('.galaxy-label')).toHaveCount(3);
});

test('API failure exposes a useful retry and recovers', async ({ page }) => {
  let fail = true;
  await page.route('**/api/explore?**', route => fail ? fulfill(route, { error: { message: '知识服务暂时离线，请稍后重试。' } }, 503) : fulfill(route, discovery()));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: '暂时无法抵达这片星海' })).toBeVisible();
  await expect(page.getByText('知识服务暂时离线，请稍后重试。', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重新连接' }).click();
  await expect(active(page).locator('.galaxy-label')).toHaveCount(3);
});

test('a question without answers stays in its orbit and supports reflection', async ({ page }) => {
  await page.route('**/api/explore?**', route => fulfill(route, { ...discovery(), questions: [{ ...question, answers: [], answersExpanded: true }] }));
  await arrive(page);
  await active(page).getByRole('button', { name: `进入星系：${question.title}` }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect(active(page).locator('.galaxy-hub-meta')).toHaveText('0 个回答 · 棒旋星系');
  await expect(active(page).getByRole('button', { name: /^阅读观点：/ })).toHaveCount(0);
  await page.locator('.galaxy-canvas').dispatchEvent('wheel', { deltaY: -1600 });
  await page.keyboard.press('Enter');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect(page.getByRole('dialog', { name: '原文阅览' })).toHaveCount(0);
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await reflection.getByRole('textbox', { name: '你的思考' }).fill('先记下我对问题本身的想法。');
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await expect.poll(async () => (await stored(page, keys.reflections)).length).toBe(1);
});

test('a missing saved target stays at overview and preserves its source link', async ({ page }) => {
  await arrive(page);
  const saved: SavedItem = { id: 'unavailable-question', type: 'question', title: '曾经收藏的一个问题', excerpt: '内容后来不在搜索结果中。', query: 'missing-target-query', questionId: 'unavailable-question', url: 'https://www.zhihu.com/question/123', savedAt: new Date().toISOString() };
  await page.evaluate(({ key, item }) => localStorage.setItem(key, JSON.stringify([item])), { key: keys.collection, item: saved });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBag(page);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: saved.title, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: '这条收藏或足迹暂未出现在最新结果中' })).toBeVisible();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '0');
  await openBag(page);
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('link')).toHaveAttribute('href', saved.url!);
});

test('saved navigation across queries synchronizes search and observatory return', async ({ page }) => {
  await arrive(page);
  const saved: SavedItem = { id: question.id, type: 'question', title: question.title, excerpt: question.excerpt, questionId: question.id, query: '学习', url: question.url, savedAt: new Date().toISOString() };
  await page.evaluate(({ key, item }) => localStorage.setItem(key, JSON.stringify([item])), { key: keys.collection, item: saved });
  await page.goto('/?q=%E8%81%8C%E5%9C%BA', { waitUntil: 'domcontentloaded' });
  await openBag(page);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: saved.title, exact: true }).click();
  await expect(active(page).locator('.galaxy-hub-title')).toHaveText(question.title);
  await expect(page).toHaveURL(/q=%E5%AD%A6%E4%B9%A0/);
  await expect(page.getByRole('textbox', { name: '探索问题或话题' })).toHaveValue('学习');
  await page.evaluate(() => window.addEventListener('wanderwise:return', event => {
    event.preventDefault(); Reflect.set(window, '__e2eReturnQuery', (event as CustomEvent<{ query: string }>).detail.query);
  }));
  await page.getByRole('button', { name: '返回占星台', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__e2eReturnQuery'))).toBe('学习');
});

test('shortcuts ignore editors and Escape closes reflection, reader, then depth in order', async ({ page }) => {
  await arrive(page);
  await enterArticle(page);
  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: '探索问题或话题' });
  await expect(search).toBeFocused();
  await search.pressSequentially('erf');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await stored(page, keys.collection)).toEqual([]);
  await openReader(page);
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection).toBeVisible();
  await reflection.getByRole('textbox').pressSequentially('erf');
  expect(await stored(page, keys.collection)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(reflection).toBeHidden();
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await page.keyboard.press('Escape');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
});

test('model status is available on demand and explicit fallback keeps exact quotes usable', async ({ page }) => {
  await page.route('**/api/answers/*/highlights?**', route => fulfill(route, { answerId: answers[0].id, highlights: answers[0].highlights, method: 'extractive', notice: '模型响应超时，已使用原文提取精华。' }));
  await arrive(page);
  await page.getByRole('button', { name: '内容与模型连接', exact: true }).click();
  const connection = page.getByRole('dialog', { name: '内容与模型连接', exact: true });
  await expect(connection.getByText('搜索已配置', { exact: true })).toBeVisible();
  await expect(connection.getByText('zhida-fast-1p5', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await enterArticle(page);
  await expect(page.getByRole('status').filter({ hasText: '模型响应超时，已使用原文提取精华。' })).toBeVisible();
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
  await openReader(page);
  await expect(page.getByRole('dialog', { name: '原文阅览' }).getByRole('button', { name: '选中第 1 段', exact: true })).toBeVisible();
});

test('two excerpts from the same paragraph keep the exact selected quote in reflection', async ({ page }) => {
  const sameParagraph = [
    { id: 'same-paragraph-first', text: paragraphs[0].slice(0, 19), paragraphIndex: 0 },
    { id: 'same-paragraph-second', text: paragraphs[0].slice(19), paragraphIndex: 0 },
  ];
  const answer = { ...answers[0], highlights: sameParagraph };
  await page.route('**/api/questions/**', route => fulfill(route, { question: { ...question, answers: [answer, ...answers.slice(1)] } }));
  await page.route('**/api/answers/*/highlights?**', route => fulfill(route, { answerId: answer.id, highlights: sameParagraph, method: 'model' }));
  await arrive(page);
  await enterQuestion(page);
  await active(page).getByRole('button', { name: `阅读观点：${answer.title}` }).click();
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(sameParagraph.map(item => item.text));
  await active(page).locator('.galaxy-label-title').nth(1).click();
  await expect(active(page).locator('.galaxy-star-marker').nth(0)).toHaveAttribute('aria-pressed', 'false');
  await expect(active(page).locator('.galaxy-star-marker').nth(1)).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection.locator('blockquote')).toHaveText(sameParagraph[1].text);
  await reflection.getByRole('textbox', { name: '你的思考' }).fill('记录同一段落里的第二个片段。');
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]')[0]?.quote, keys.reflections)).toBe(sameParagraph[1].text);
});

test('a delayed model selection shrinking six excerpts to four clamps an open second page', async ({ page }) => {
  let release!: () => void;
  const responseReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/answers/*/highlights?**', async route => {
    await responseReady;
    return fulfill(route, { answerId: answers[0].id, highlights: answers[0].highlights!.slice(0, 4), method: 'model' });
  });
  try {
    await arrive(page);
    await enterArticle(page);
    await active(page).getByRole('button', { name: '下一组星光' }).click();
    await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(4));
    release();
    await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
    await expect(active(page).getByRole('button', { name: '下一组星光' })).toHaveCount(0);
    await openReader(page);
    await expect(page.getByRole('dialog', { name: '原文阅览' }).getByRole('heading', { level: 1 })).toHaveText(answers[0].title);
  } finally { release(); }
});

test('a model quote absent from the current source is rejected before display and reflection', async ({ page }) => {
  const fabricated = '这句话不属于任何当前原文，不应成为引用或个人思考的来源。';
  await page.route('**/api/answers/*/highlights?**', route => fulfill(route, {
    answerId: answers[0].id, method: 'model',
    highlights: [{ id: 'invalid-source-quote', paragraphIndex: 0, text: fabricated }, ...answers[0].highlights!.slice(1, 4)],
  }));
  await arrive(page);
  await enterArticle(page);
  await expect(page.getByRole('status').filter({ hasText: '片段与当前原文不匹配，已保留原文内容。' })).toBeVisible();
  await expect(page.getByText(fabricated, { exact: true })).toHaveCount(0);
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
  await active(page).locator('.galaxy-label-title').first().click();
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection.locator('blockquote')).toHaveText(paragraphs[0]);
  await reflection.getByRole('textbox', { name: '你的思考' }).fill('这条思考只引用真实原文。');
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || '[]')[0]?.quote, keys.reflections)).toBe(paragraphs[0]);
  expect(JSON.stringify(await stored(page, keys.reflections))).not.toContain(fabricated);
});

test('a legacy public work saved as a question restores its exact article inside the current topic', async ({ page }) => {
  const legacyAnswer: Answer = { ...answers[1], id: 'knowledge-777', workId: '777', title: '旧版收藏的确切原文', url: 'https://api.zhihu.com/km-indep-home/hackathon/v2/knowledge/777' };
  const topic: Question = { ...question, id: 'topic-learning', kind: 'topic', title: '学习与成长', answers: [answers[0], legacyAnswer, answers[2]] };
  const legacySaved: SavedItem = {
    id: 'knowledge-777', type: 'question', questionId: 'knowledge-777', title: legacyAnswer.title,
    excerpt: legacyAnswer.excerpt, url: legacyAnswer.url, query: '', savedAt: '2026-09-12T12:00:00.000Z',
  };
  await page.route('**/api/explore?**', route => fulfill(route, { ...discovery(), source: 'zhihu-cache', questions: [topic] }));
  await page.route('**/api/answers/*/highlights?**', route => fulfill(route, { answerId: legacyAnswer.id, highlights: legacyAnswer.highlights, method: 'extractive' }));
  await arrive(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify([value])), { key: keys.collection, value: legacySaved });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBag(page);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: legacySaved.title, exact: true }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await expect(active(page).getByRole('button', { name: `阅读原文：${legacyAnswer.title}`, exact: true })).toBeVisible();
  await openReader(page, legacyAnswer);
  await expect(page.getByRole('dialog', { name: '原文阅览' }).getByRole('link', { name: '查看知乎官方内容来源' })).toHaveAttribute('href', legacyAnswer.url);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(active(page).locator('.galaxy-hub-title')).toHaveText(topic.title);
  await openBag(page);
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('article')).toHaveCount(1);
});

test('a saved answer absent from initial search restores after expanding its known parent question', async ({ page }) => {
  const saved: SavedItem = {
    id: answers[1].id, type: 'answer', questionId: question.id, answerId: answers[1].id,
    title: answers[1].title, excerpt: answers[1].excerpt, author: answers[1].author,
    url: answers[1].url, query: '', savedAt: '2026-09-12T12:00:00.000Z',
  };
  let expansionCalls = 0;
  await page.route('**/api/questions/**', route => {
    expansionCalls++;
    expect(new URL(route.request().url()).pathname).toBe(`/api/questions/${question.id}`);
    return fulfill(route, { question });
  });
  await arrive(page);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify([value])), { key: keys.collection, value: saved });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openBag(page);
  expect(expansionCalls).toBe(0);
  await page.getByRole('dialog', { name: '知识行囊', exact: true }).getByRole('button', { name: saved.title, exact: true }).click();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await expect(active(page).getByRole('button', { name: `阅读原文：${answers[1].title}`, exact: true })).toBeVisible();
  expect(expansionCalls).toBe(1);
  await openReader(page, answers[1]);
  await expect(page.getByRole('dialog', { name: '原文阅览' }).getByRole('link', { name: '前往知乎原文' })).toHaveAttribute('href', answers[1].url);
  await expect(page.getByRole('status').filter({ hasText: '这条收藏或足迹暂未出现在最新结果中' })).toHaveCount(0);
});

test('normal motion retains outgoing glyph dust until disintegration finishes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await arrive(page);
  await expect(active(page).locator('.stellar-text-dust').first()).toBeAttached();
  await expect(page.locator('.galaxy-content-exit')).toHaveCount(0);
  await page.evaluate(() => {
    const state = { dust: false, hidden: false, retainedMs: 0 };
    Reflect.set(window, '__dustExit', state);
    let tracked: Element | null = null;
    let started = 0;
    const observer = new MutationObserver(() => {
      const layer = document.querySelector('.galaxy-content-exit');
      if (!tracked && layer) {
        tracked = layer; started = performance.now();
        state.dust = !!layer.querySelector('.stellar-text-exit .stellar-text-dust');
        state.hidden = layer.getAttribute('aria-hidden') === 'true';
      }
      if (tracked && !tracked.isConnected) { state.retainedMs = performance.now() - started; observer.disconnect(); }
    });
    observer.observe(document.querySelector('.galaxy-scene')!, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
  });
  await active(page).getByRole('button', { name: `进入星系：${question.title}` }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__dustExit').retainedMs)).toBeGreaterThan(650);
  expect(await page.evaluate(() => Reflect.get(window, '__dustExit').dust)).toBe(true);
  expect(await page.evaluate(() => Reflect.get(window, '__dustExit').hidden)).toBe(true);
  await expect(page.locator('.galaxy-content-exit')).toHaveCount(0);
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
});

test('mobile supports three layers, central reading and notes without horizontal overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await arrive(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-question-clusters.png'), animations: 'disabled' });
  await enterArticle(page);
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 2));
  await expect(active(page).locator('.galaxy-orbit-pagination > span')).toHaveText('1—2 / 6');
  const initialPlanets = await active(page).locator('.galaxy-label-paragraph').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-node-id')));
  await page.screenshot({ path: testInfo.outputPath('mobile-paragraph-constellation.png'), animations: 'disabled' });
  await active(page).getByRole('button', { name: '下一组星光' }).click();
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(2, 4));
  await expect(active(page).locator('.galaxy-orbit-pagination > span')).toHaveText('3—4 / 6');
  const nextPlanets = active(page).locator('.galaxy-label-paragraph');
  await expect(nextPlanets).toHaveCount(2);
  for (const label of await nextPlanets.all()) {
    await expect(label.locator('.galaxy-label-title')).toBeVisible();
    await expect(label).toHaveAttribute('data-planet-kind', /.+/);
    await expect(label).toHaveAttribute('data-world-x', /-?\d/);
    expect(initialPlanets).not.toContain(await label.getAttribute('data-node-id'));
  }
  await nextPlanets.first().locator('.galaxy-star-marker').click();
  await expect(nextPlanets.first().locator('.galaxy-star-marker')).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '收藏当前内容', exact: true }).click();
  await expect.poll(async () => (await stored(page, keys.collection)).length).toBe(1);
  await page.keyboard.press('f');
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.getByRole('button', { name: '选中第 3 段', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await reader.getByRole('button', { name: /写下思考/ }).click();
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await expect(reflection.locator('blockquote')).toHaveText(paragraphs[2]);
  await reflection.getByRole('textbox', { name: '你的思考' }).fill('在手机上留下的一点思考。');
  await reflection.getByRole('button', { name: '保存思考' }).click();
  await reader.getByRole('button', { name: '关闭原文阅览', exact: true }).click();
  await openBag(page);
  const bag = page.getByRole('dialog', { name: '知识行囊', exact: true });
  await expect(bag.getByRole('article')).toHaveCount(1);
  await bag.getByRole('button', { name: /^我的思考 1$/ }).click();
  await expect(bag.getByText('在手机上留下的一点思考。')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('mobile-notebook.png'), animations: 'disabled' });
});

test('answer stars and excerpt planets keep readable labels attached to persistent world anchors while dragging', async ({ page }, testInfo) => {
  await arrive(page);
  await enterQuestion(page);
  const answerLabel = active(page).locator('.galaxy-label').filter({ hasText: answers[0].title });
  await expectAnchoredDrag(page, answerLabel);
  await page.screenshot({ path: testInfo.outputPath('answer-star-camera-orbit.png'), animations: 'disabled' });
  await enterArticle(page);
  const paragraphLabel = active(page).locator('.galaxy-label-paragraph').first();
  await expectAnchoredDrag(page, paragraphLabel);
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
  await page.screenshot({ path: testInfo.outputPath('paragraph-planet-camera-orbit.png'), animations: 'disabled' });
});

test('F toggles the source reader, V controls flight, and editor/modifier/repeat events do not trigger reading', async ({ page }) => {
  await arrive(page);
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toHaveCount(0);
  await expect(page.locator('.galaxy-flight-hud')).toHaveCount(0);
  await enterQuestion(page);
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toHaveCount(0);
  await enterArticle(page);
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', repeat: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', metaKey: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', altKey: true, bubbles: true }));
  });
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toHaveCount(0);
  await page.keyboard.press('f');
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.getByRole('heading', { level: 1 })).toHaveText(answers[0].title);
  await page.keyboard.press('f');
  await expect(reader).toBeHidden();
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '2');
  await page.keyboard.press('v');
  await expect(page.locator('.galaxy-flight-hud')).toBeVisible();
  await page.keyboard.press('v');
  await expect(page.locator('.galaxy-flight-hud')).toHaveCount(0);
  await page.keyboard.press('/');
  const search = page.getByRole('textbox', { name: '探索问题或话题' });
  await search.pressSequentially('fv');
  await expect(search).toHaveValue('fv');
  await expect(reader).toBeHidden();
  await expect(page.locator('.galaxy-flight-hud')).toHaveCount(0);
  await openBag(page);
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: '知识行囊', exact: true })).toBeVisible();
  await expect(reader).toBeHidden();
  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  const reflection = page.getByRole('dialog', { name: '让这一刻的思考，留下来' });
  await reflection.getByRole('textbox', { name: '你的思考' }).pressSequentially('fv');
  await expect(reflection).toBeVisible();
  await expect(reader).toBeHidden();
});

test('overview galaxy shapes and the four excerpt planets expose distinct celestial identities', async ({ page }, testInfo) => {
  const questions = Array.from({ length: 5 }, (_, index) => index === 0 ? question : ({
    ...question, id: `morphology-question-${index}`, title: `用第 ${index + 1} 个问题观察星系形态`,
  }));
  await page.route('**/api/explore?**', route => fulfill(route, { ...discovery(), questions }));
  await arrive(page);
  await expect(active(page).locator('.galaxy-label[data-morphology]')).toHaveCount(5);
  const morphologies = await active(page).locator('.galaxy-label').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-morphology')));
  expect(new Set(morphologies).size).toBe(5);
  expect(morphologies.every(Boolean)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('five-galaxy-morphologies.png'), animations: 'disabled' });
  await enterArticle(page);
  await expect(active(page).locator('.galaxy-label[data-planet-kind]')).toHaveCount(4);
  const planets = await active(page).locator('.galaxy-label-paragraph').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-planet-kind')));
  expect(new Set(planets).size).toBe(4);
  expect(planets.every(Boolean)).toBe(true);
  await expect(active(page).locator('.galaxy-label-title')).toHaveText(paragraphs.slice(0, 4));
  await page.screenshot({ path: testInfo.outputPath('four-distinct-excerpt-planets.png'), animations: 'disabled' });
});

test('the macro cluster occupies a real volume and stays readable from the sides and above', async ({ page }, testInfo) => {
  const questions = Array.from({ length: 5 }, (_, index) => index === 0 ? question : ({
    ...question, id: `volume-question-${index}`, title: `从不同方向观察第 ${index + 1} 个知识星系`,
    answers: answers.map(answer => ({ ...answer, id: `${answer.id}-volume-${index}` })),
  }));
  await page.route('**/api/explore?**', route => fulfill(route, { ...discovery(), questions }));
  await arrive(page);
  const labels = active(page).locator('.galaxy-label[data-node-kind="question"]');
  await expect(labels).toHaveCount(5);
  await expect(labels.last()).toHaveAttribute('data-world-z', /-?\d/);
  const readWorld = () => labels.evaluateAll(nodes => nodes.map(node => {
    const element = node as HTMLElement;
    return [Number(element.dataset.worldX), Number(element.dataset.worldY), Number(element.dataset.worldZ)];
  }));
  const world = await readWorld();
  const extents = [0, 1, 2].map(axis => Math.max(...world.map(point => point[axis])) - Math.min(...world.map(point => point[axis])));
  expect(Math.min(...extents) / Math.max(...extents)).toBeGreaterThan(0.7);
  const center = [0, 1, 2].map(axis => world.reduce((sum, point) => sum + point[axis], 0) / world.length);
  const covariance = Array.from({ length: 3 }, (_, row) => Array.from({ length: 3 }, (_, column) => (
    world.reduce((sum, point) => sum + (point[row] - center[row]) * (point[column] - center[column]), 0)
  )));
  const [[xx, xy, xz], [, yy, yz], [, , zz]] = covariance;
  const determinant = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz - yy * xz * xz - zz * xy * xy;
  expect(determinant / (xx * yy * zz)).toBeGreaterThan(0.5);

  const selected = active(page).locator(`.galaxy-label[data-node-id="${question.id}"]`);
  await selected.locator('.galaxy-star-marker').click();
  for (const view of [
    { name: 'left', dx: 294, dy: 0 }, { name: 'right', dx: -588, dy: 0 },
    { name: 'above', dx: 294, dy: 300 }, { name: 'below', dx: 0, dy: -600 },
  ]) {
    const before = await projectionSnapshot(selected);
    await dragUncoveredCanvas(page, view.dx, view.dy);
    await expect.poll(async () => {
      const now = (await projectionSnapshot(selected)).screen;
      return Math.hypot(now[0] - before.screen[0], now[1] - before.screen[1]);
    }).toBeGreaterThan(8);
    await expect(selected.locator('.galaxy-label-title')).toBeVisible();
    const projected = await labels.evaluateAll(nodes => nodes.map(node => {
      const element = node as HTMLElement;
      const body = element.querySelector<HTMLElement>('.galaxy-label-body')!;
      return { x: Number(element.dataset.screenX), y: Number(element.dataset.screenY), visible: getComputedStyle(body).visibility !== 'hidden' };
    }));
    expect(Math.max(...projected.map(point => point.x)) - Math.min(...projected.map(point => point.x))).toBeGreaterThan(150);
    expect(Math.max(...projected.map(point => point.y)) - Math.min(...projected.map(point => point.y))).toBeGreaterThan(150);
    expect(projected.filter(point => point.visible).length).toBeGreaterThanOrEqual(3);
    const readable = await projectionSnapshot(selected);
    expect(readable.horizontal).toBe(true);
    expect(readable.fontSize).toBeGreaterThanOrEqual(13);
    expect(readable.text.width).toBeGreaterThanOrEqual(175);
    expect(readable.text.x).toBeGreaterThanOrEqual(0);
    expect(readable.text.y).toBeGreaterThanOrEqual(0);
    expect(readable.text.x + readable.text.width).toBeLessThanOrEqual(1440);
    expect(readable.text.y + readable.text.height).toBeLessThanOrEqual(960);
    expect(await readWorld()).toEqual(world);
    await page.screenshot({ path: testInfo.outputPath(`volumetric-cluster-${view.name}.png`), animations: 'disabled' });
  }
});

test('answer stars have varied identities that persist when entering their planetary systems', async ({ page }) => {
  await arrive(page);
  await enterQuestion(page);
  const kinds = new Map<string, string>();
  for (const answer of answers) {
    const label = active(page).locator(`.galaxy-label[data-node-id="${answer.id}"]`);
    await expect(label).toHaveAttribute('data-star-kind', /^(azure|violet|ivory|amber)$/);
    kinds.set(answer.id, (await label.getAttribute('data-star-kind'))!);
  }
  expect(new Set(kinds.values()).size).toBeGreaterThanOrEqual(2);
  for (const answer of answers) {
    await enterArticle(page, answer);
    await expect(active(page).locator('.galaxy-hub')).toHaveAttribute('data-star-kind', kinds.get(answer.id)!);
    await expect(active(page).getByRole('button', { name: `阅读原文：${answer.title}`, exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
    await expect(active(page).locator(`.galaxy-label[data-node-id="${answer.id}"]`)).toHaveAttribute('data-star-kind', kinds.get(answer.id)!);
  }
});

// Observe real animation writes, rather than assume a fixed frame rate on the
// software renderer. Each sample is the applied galaxy rotation after 15 frames.
async function sampleGalaxyMotion(page: Page, count = 2): Promise<{ angle: number; time: number }[]> {
  return page.locator('.galaxy-scene').evaluate((scene, needed) => new Promise((resolve, reject) => {
    const samples: { angle: number; time: number }[] = [];
    const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error('The scene stopped producing animation frames.')); }, 15_000);
    const observer = new MutationObserver(() => {
      samples.push({ angle: Number((scene as HTMLElement).dataset.galaxyRotation), time: performance.now() });
      if (samples.length >= needed) { observer.disconnect(); clearTimeout(timer); resolve(samples); }
    });
    observer.observe(scene, { attributes: true, attributeFilter: ['data-galaxy-rotation'] });
  }), count);
}

async function leaveCelestialText(page: Page) {
  await page.mouse.move(10, 300);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
}

test('slow galaxy rotation pauses for hover, keyboard reading and the reader, then resumes without jumping', async ({ page }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await arrive(page);
  await enterQuestion(page);
  await leaveCelestialText(page);
  const scene = page.locator('.galaxy-scene');
  await expect(scene).toHaveAttribute('data-motion-paused', 'false');
  const moving = await sampleGalaxyMotion(page);
  expect(moving[1].angle).toBeGreaterThan(moving[0].angle);
  expect((moving[1].angle - moving[0].angle) / ((moving[1].time - moving[0].time) / 1000)).toBeLessThan(0.004);

  const label = active(page).locator(`.galaxy-label[data-node-id="${answers[0].id}"]`);
  await hoverMovingCelestialText(page, label.locator('.galaxy-label-title'));
  await expect(scene).toHaveAttribute('data-motion-paused', 'true');
  const hovering = await sampleGalaxyMotion(page);
  expect(hovering[1].angle).toBe(hovering[0].angle);
  const hoveredAnchor = (await projectionSnapshot(label)).world;
  await label.locator('.galaxy-label-title').focus();
  await page.mouse.move(10, 300);
  await expect(scene).toHaveAttribute('data-motion-paused', 'true');
  const focused = await sampleGalaxyMotion(page);
  expect(focused[1].angle).toBe(hovering[1].angle);
  expect((await projectionSnapshot(label)).world).toEqual(hoveredAnchor);

  const resumingAt = await page.evaluate(() => performance.now());
  await leaveCelestialText(page);
  await expect(scene).toHaveAttribute('data-motion-paused', 'false');
  const resumed = await sampleGalaxyMotion(page);
  expect(resumed[1].angle).toBeGreaterThan(focused[1].angle);
  expect(resumed[0].angle - focused[1].angle).toBeLessThan((resumed[0].time - resumingAt) / 1000 * 0.004 + 0.0001);

  await enterArticle(page);
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toBeVisible();
  await leaveCelestialText(page);
  await expect(scene).toHaveAttribute('data-motion-paused', 'true');
  const reading = await sampleGalaxyMotion(page);
  expect(reading[1].angle).toBe(reading[0].angle);
  await page.keyboard.press('f');
  await expect(page.getByRole('dialog', { name: '原文阅览', exact: true })).toBeHidden();
  await leaveCelestialText(page);
  await expect(scene).toHaveAttribute('data-motion-paused', 'false');
  const afterReader = await sampleGalaxyMotion(page);
  expect(afterReader[1].angle).toBeGreaterThan(reading[1].angle);
});

test('reduced motion keeps rotating galaxies and their answer anchors still while camera dragging remains available', async ({ page }) => {
  await arrive(page);
  await enterQuestion(page);
  await leaveCelestialText(page);
  const scene = page.locator('.galaxy-scene');
  await expect(scene).toHaveAttribute('data-motion-paused', 'true');
  const label = active(page).locator(`.galaxy-label[data-node-id="${answers[0].id}"]`);
  const before = (await projectionSnapshot(label)).world;
  const still = await sampleGalaxyMotion(page);
  expect(still[1].angle).toBe(still[0].angle);
  expect((await projectionSnapshot(label)).world).toEqual(before);
  await expectAnchoredDrag(page, label);
  await expect(scene).toHaveAttribute('data-motion-paused', 'true');
});
