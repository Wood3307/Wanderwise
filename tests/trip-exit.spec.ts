import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import type { JourneyExportPacket, TripSession } from '../src/lib/trip';
import type { Question } from '../src/types';

const tripKey = 'wanderwise.trip-session.v1';
const exportPrefix = 'wanderwise.journey-export.v1.';
const question: Question = {
  id: 'question-trip-11', title: '如何记录一次独立的知识漫游？', excerpt: '当前旅行的记录。',
  keywords: ['漫游'], relevance: .9, color: '#acd9eb', kind: 'question', answersExpanded: true,
  url: 'https://www.zhihu.com/question/110',
  answers: [{
    id: 'answer-trip-11', title: '让每段旅程有开始和结束', author: '测试作者',
    excerpt: '一次旅程保留本次经历，结束后再开始新的记录。',
    paragraphs: ['一次旅程保留本次经历，结束后再开始新的记录。'],
    highlights: [{ id: 'trip-highlight', paragraphIndex: 0, text: '一次旅程保留本次经历，结束后再开始新的记录。' }],
    highlightMethod: 'extractive', relevance: .9, isExcerpt: true,
    url: 'https://www.zhihu.com/question/110/answer/111',
  }],
};

async function mockContent(context: BrowserContext) {
  // Exit tests never consume live Zhihu credentials or depend on changing topics.
  await context.route('**/api/explore?**', route => route.fulfill({ json: {
    query: '', keywords: ['漫游'], questions: [question], source: 'zhihu-search', fetchedAt: '2026-09-14T00:00:00Z',
  } }));
  await context.route('**/api/health', route => route.fulfill({ json: {
    ok: true, configured: true, publicCount: 10, model: { configured: false, provider: 'extractive' },
  } }));
  await context.route('**/api/questions/**', route => route.fulfill({ json: { question } }));
  await context.route('**/api/answers/*/highlights?**', route => route.fulfill({ json: {
    answerId: question.answers[0].id, highlights: question.answers[0].highlights, method: 'extractive',
  } }));
}

async function arrive(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.galaxy-content-enter').getByRole('button', {
    name: `进入星系：${question.title}`, exact: true,
  })).toBeVisible();
}

async function visitQuestion(page: Page) {
  const enter = page.locator('.galaxy-content-enter').getByRole('button', {
    name: `进入星系：${question.title}`, exact: true,
  });
  await enter.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', '1');
  await expect.poll(async () => (await currentTrip(page)).journey.length).toBe(1);
}

async function currentTrip(page: Page): Promise<TripSession> {
  return page.evaluate(key => JSON.parse(sessionStorage.getItem(key) || 'null'), tripKey);
}

async function exportsIn(page: Page): Promise<JourneyExportPacket[]> {
  return page.evaluate(prefix => Object.keys(localStorage)
    .filter(key => key.startsWith(prefix))
    .map(key => JSON.parse(localStorage.getItem(key)!)), exportPrefix);
}

async function requestNativeClose(page: Page) {
  // Playwright 1.51 keeps its own page in "closing" after a cancelled close and
  // silently ignores a second page.close(). CDP calls the real browser each time.
  // Page.close still runs native beforeunload; Target.closeTarget would bypass it.
  const session = await page.context().newCDPSession(page);
  await session.send('Page.close');
}

async function cancelNativeClose(page: Page) {
  const nextDialog = page.waitForEvent('dialog');
  await requestNativeClose(page);
  const native = await nextDialog;
  expect(native.type()).toBe('beforeunload');
  await native.dismiss();
  expect(page.isClosed()).toBe(false);
  const choice = page.getByRole('dialog', { name: '是否导出漫游足迹', exact: true });
  await expect(choice).toBeVisible();
  return choice;
}

async function closeWithoutWarning(page: Page) {
  let warnings = 0;
  page.on('dialog', async dialog => { warnings++; await dialog.accept(); });
  const closed = page.waitForEvent('close');
  await requestNativeClose(page);
  await closed;
  expect(warnings).toBe(0);
}

test.beforeEach(async ({ context }) => { await mockContent(context); });

test('each new visit starts its own trip; refresh preserves this tab without importing legacy or copied history', async ({ page, context }) => {
  await page.addInitScript(() => localStorage.setItem('wanderwise.journey.v1', JSON.stringify([{
    id: 'historic-answer', title: '不属于本次旅行的旧足迹', type: 'answer',
    questionId: 'old-question', answerId: 'old-answer', query: '旧内容', visitedAt: '2025-01-01T00:00:00Z',
  }])));
  await arrive(page);
  expect((await currentTrip(page)).journey).toEqual([]);
  await visitQuestion(page);
  const original = await currentTrip(page);

  page.once('dialog', async dialog => {
    expect(dialog.type()).toBe('beforeunload');
    await dialog.accept();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect.poll(async () => (await currentTrip(page))?.id).toBe(original.id);
  expect((await currentTrip(page)).journey).toEqual(original.journey);
  await page.getByRole('button', { name: '探索足迹', exact: true }).click();
  await expect(page.locator('.journey-stop')).toHaveCount(1);
  await expect(page.getByText('不属于本次旅行的旧足迹', { exact: true })).toHaveCount(0);

  const copiedTab = await context.newPage();
  await copiedTab.addInitScript(({ key, value }) => sessionStorage.setItem(key, value), {
    key: tripKey, value: JSON.stringify(original),
  });
  await arrive(copiedTab);
  const fresh = await currentTrip(copiedTab);
  expect(fresh.id).not.toBe(original.id);
  expect(fresh.journey).toEqual([]);
  expect((await currentTrip(page)).journey).toEqual(original.journey);
  await closeWithoutWarning(copiedTab);
});

test('manual return exports this trip to the observatory outbox, then continuing starts an empty journey', async ({ page }) => {
  await arrive(page);
  await visitQuestion(page);
  const original = await currentTrip(page);
  await page.getByRole('button', { name: '返回占星台', exact: true }).click();
  const choice = page.getByRole('dialog', { name: '是否导出漫游足迹', exact: true });
  await expect(choice).toBeVisible();
  await choice.getByRole('button', { name: '导出并返回占星台', exact: true }).click();
  await expect.poll(async () => (await exportsIn(page)).length).toBe(1);
  const exported = (await exportsIn(page))[0];
  expect(exported.tripId).toBe(original.id);
  expect(exported.journey).toHaveLength(1);
  expect(exported.journey[0].title).toBe(question.title);
  expect(exported.journey[0].url).toBe(question.url);
  expect((await currentTrip(page)).journey).toEqual([]);
  await page.getByRole('dialog').getByRole('button', { name: '继续漫游', exact: true }).click();
  expect((await currentTrip(page)).id).not.toBe(original.id);
  expect((await currentTrip(page)).journey).toEqual([]);
  await page.getByRole('button', { name: '探索足迹', exact: true }).click();
  await expect(page.locator('.journey-stop')).toHaveCount(0);
  expect(await page.evaluate(() => window.Wanderwise?.listJourneyExports?.())).toEqual([exported]);
});

test('cancelling browser close offers export, then finishing permits close and the observatory can claim exactly once', async ({ page, context }) => {
  await arrive(page);
  await visitQuestion(page);
  const original = await currentTrip(page);
  let choice = await cancelNativeClose(page);
  expect(await exportsIn(page)).toEqual([]);
  await choice.getByRole('button', { name: '继续漫游', exact: true }).click();
  expect((await currentTrip(page)).journey).toHaveLength(1);

  choice = await cancelNativeClose(page);
  await choice.getByRole('button', { name: '导出并结束旅行', exact: true }).click();
  await expect.poll(async () => (await exportsIn(page)).length).toBe(1);
  expect((await currentTrip(page)).journey).toEqual([]);
  await closeWithoutWarning(page);

  const observatory = await context.newPage();
  await arrive(observatory);
  const queued = await observatory.evaluate(() => window.Wanderwise?.listJourneyExports?.());
  expect(queued).toHaveLength(1);
  expect(queued![0].tripId).toBe(original.id);
  const receipt = await observatory.evaluate(id => window.Wanderwise?.consumeJourneyExport?.(id), original.id);
  expect(receipt?.journey[0].title).toBe(question.title);
  expect(await exportsIn(observatory)).toEqual([]);
  expect(await observatory.evaluate(id => window.Wanderwise?.consumeJourneyExport?.(id), original.id)).toBeUndefined();
  expect((await currentTrip(observatory)).journey).toEqual([]);
});

test('native Leave is never treated as consent to export', async ({ page, context }) => {
  await arrive(page);
  await visitQuestion(page);
  const nativeDialog = page.waitForEvent('dialog');
  await requestNativeClose(page);
  const dialog = await nativeDialog;
  expect(dialog.type()).toBe('beforeunload');
  const closed = page.waitForEvent('close');
  await dialog.accept();
  await closed;
  const next = await context.newPage();
  await arrive(next);
  expect(await exportsIn(next)).toEqual([]);
  expect((await currentTrip(next)).journey).toEqual([]);
});

test('explicit discard clears only the current trip and disables the native exit warning', async ({ page }) => {
  await arrive(page);
  await visitQuestion(page);
  const choice = await cancelNativeClose(page);
  await choice.getByRole('button', { name: '不导出，结束旅行', exact: true }).click();
  expect((await currentTrip(page)).journey).toEqual([]);
  expect(await exportsIn(page)).toEqual([]);
  await closeWithoutWarning(page);
});
