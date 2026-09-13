import { expect, test, type Page, type Route } from '@playwright/test';
import type { ExploreResponse, Question } from '../src/types';

// These named fixtures and paused routes are local to the browser test. They
// never use the application's live Zhihu credentials or consume search quota.
function discovery(query: string, empty = false): ExploreResponse {
  const questions: Question[] = empty ? [] : Array.from({ length: 3 }, (_, index) => ({
    id: `question-${query || 'initial'}-${index}`,
    title: `${query || '原星海'} · 问题${index + 1}`,
    excerpt: '浏览器测试的独立问题。', keywords: [query || '星海'],
    relevance: .95 - index * .25, color: ['#b8dbe9', '#baa6dd', '#91bbb5'][index],
    kind: 'question', answersExpanded: true,
    answers: [{ id: `answer-${query || 'initial'}-${index}`, title: '测试回答', author: '测试作者',
      excerpt: '这是一段用于测试界面交互的回答。', paragraphs: ['这是一段用于测试界面交互的回答。'],
      url: `https://www.zhihu.com/question/50/answer/${80 + index}`, relevance: .9, isExcerpt: true }],
  }));
  return { query, questions, keywords: [query || '星海'], source: 'zhihu-search', fetchedAt: '2026-09-14T00:00:00Z' };
}

type VoyageAudit = { phases: { phase: string; at: number }[]; ids: string[] };

async function harness(page: Page, motion = 'no-preference' as 'no-preference' | 'reduce') {
  const pending = new Map<string, Route[]>();
  await page.emulateMedia({ reducedMotion: motion });
  await page.addInitScript(() => {
    localStorage.setItem('wanderwise.music.v2', JSON.stringify({ enabled: false, volume: 1, muted: false }));
  });
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, configured: true, publicCount: 10, model: { configured: false } } }));
  await page.route('**/api/explore?**', route => {
    const query = new URL(route.request().url()).searchParams.get('q') ?? '';
    if (!query) return route.fulfill({ json: discovery('') });
    pending.set(query, [...(pending.get(query) ?? []), route]);
  });
  await page.route('**/api/answers/*/highlights?**', route => route.fulfill({ json: { highlights: [], method: 'extractive' } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-voyage', 'idle');
  await expect(page.locator('.galaxy-content-enter [data-node-id="question-initial-0"] .galaxy-label-title')).toBeVisible();
  await page.evaluate(() => {
    const scene = document.querySelector<HTMLElement>('.galaxy-scene')!;
    const audit: VoyageAudit = { phases: [], ids: [] };
    const record = () => {
      const phase = scene.dataset.voyage ?? 'idle';
      if (audit.phases.at(-1)?.phase !== phase) audit.phases.push({ phase, at: performance.now() });
      for (const node of scene.querySelectorAll<HTMLElement>('[data-node-kind="question"]')) {
        if (node.dataset.nodeId && !audit.ids.includes(node.dataset.nodeId)) audit.ids.push(node.dataset.nodeId);
      }
    };
    record();
    new MutationObserver(record).observe(scene, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-voyage'] });
    (window as typeof window & { voyageAudit: VoyageAudit }).voyageAudit = audit;
  });
  return {
    async requested(query: string) {
      await expect.poll(() => pending.get(query)?.length ?? 0).toBeGreaterThan(0);
    },
    async respond(query: string, options: { empty?: boolean; failure?: boolean } = {}) {
      await expect.poll(() => pending.get(query)?.length ?? 0).toBeGreaterThan(0);
      const routes = pending.get(query)!;
      pending.delete(query);
      for (const route of routes) await route.fulfill({
        status: options.failure ? 503 : 200,
        json: options.failure ? { message: '测试连接暂时中断，请重试。' } : discovery(query, options.empty),
      });
    },
  };
}

const scene = (page: Page) => page.locator('.galaxy-scene');
const title = (page: Page, query: string) => page.locator(`.galaxy-content-enter [data-node-id="question-${query}-0"] .galaxy-label-title`);
const audit = (page: Page) => page.evaluate(() => (window as typeof window & { voyageAudit: VoyageAudit }).voyageAudit);
async function search(page: Page, query: string) {
  const input = page.getByRole('textbox', { name: '探索问题或话题', exact: true });
  await input.fill(query);
  await input.press('Enter');
}

test('initial discovery is immediate; another search carries old galaxies through collapse, wait and a new birth', async ({ page }) => {
  const network = await harness(page);
  await expect(page.locator('.search-voyage-status')).toHaveCount(0);
  expect((await audit(page)).phases.map(item => item.phase)).toEqual(['idle']);

  await search(page, '新星海');
  await network.requested('新星海');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'collapse');
  await expect(page.locator('[data-node-id="question-initial-0"]')).toBeAttached();
  await expect(page.locator('[data-node-id="question-新星海-0"]')).toHaveCount(0);
  await expect(page.locator('.loading-message')).toHaveCount(0);
  expect(await page.locator('.galaxy-content-layer').evaluateAll(elements => elements.every(element => (element as HTMLElement).inert))).toBe(true);
  expect(await page.locator('[data-node-id="question-initial-0"] .galaxy-label-title').evaluate(element => getComputedStyle(element).pointerEvents)).toBe('none');
  await page.mouse.move(720, 730);
  await page.mouse.wheel(0, -600);
  await expect(scene(page)).toHaveAttribute('data-depth', '0');
  await expect.poll(async () => Number(await scene(page).getAttribute('data-voyage-progress'))).toBeGreaterThan(.02);
  await expect(scene(page)).toHaveAttribute('data-voyage', 'wait');
  await expect(scene(page)).toHaveAttribute('data-voyage-progress', '1.000');
  await expect(page.locator('[data-node-id="question-initial-0"]')).toBeAttached();
  await network.respond('新星海');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'birth');
  await expect(page.locator('[data-node-id="question-新星海-0"]')).toBeAttached();
  expect(await page.locator('.galaxy-content-layer').evaluateAll(elements => elements.every(element => (element as HTMLElement).inert))).toBe(true);
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(title(page, '新星海')).toBeVisible();
  expect(await title(page, '新星海').evaluate(element => element.closest<HTMLElement>('.galaxy-content-layer')!.inert)).toBe(false);

  const history = (await audit(page)).phases;
  expect(history.map(item => item.phase)).toEqual(['idle', 'collapse', 'wait', 'birth', 'idle']);
  expect(history[2].at - history[1].at).toBeGreaterThan(1900);
  expect(history[4].at - history[3].at).toBeGreaterThan(1550);
});

test('rapid searches keep the same departing scene and only the latest response can create galaxies', async ({ page }) => {
  const network = await harness(page);
  await search(page, '过期A');
  await network.requested('过期A');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'collapse');
  await search(page, '有效B');
  await network.requested('有效B');
  await expect(page.locator('[data-node-id="question-initial-0"]')).toBeAttached();
  // B returns first. Its result still waits for the physical collapse, while
  // the already aborted A route is fulfilled later to exercise stale results.
  await network.respond('有效B');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'birth');
  await network.respond('过期A');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(title(page, '有效B')).toBeVisible();
  await expect(page.locator('[data-node-id^="question-过期A-"]')).toHaveCount(0);
  const history = await audit(page);
  expect(history.phases.filter(item => item.phase === 'birth')).toHaveLength(1);
  expect(history.ids.some(id => id.startsWith('question-过期A-'))).toBe(false);
  await expect(page.getByRole('textbox', { name: '探索问题或话题', exact: true })).toHaveValue('有效B');
});

test('a search submitted during a new birth collapses that incoming scene and leaves only the newest result', async ({ page }) => {
  const network = await harness(page);
  await search(page, '诞生A');
  await network.respond('诞生A');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'birth');
  await expect(page.locator('[data-node-id="question-诞生A-0"]')).toBeAttached();

  // Submit while A is still emerging, before its text becomes interactive.
  // B must collapse the current A geometry, not restore the original universe
  // or let A's obsolete completion timer end B's transition.
  await search(page, '接续B');
  await network.requested('接续B');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'collapse');
  await expect(page.locator('[data-node-id="question-诞生A-0"]')).toBeAttached();
  await expect(page.locator('[data-node-id="question-接续B-0"]')).toHaveCount(0);
  expect(await page.locator('[data-node-id="question-诞生A-0"]').evaluate(element => element.closest<HTMLElement>('.galaxy-content-layer')!.inert)).toBe(true);
  await expect(scene(page)).toHaveAttribute('data-voyage', 'wait');
  await expect(page.locator('[data-node-id="question-诞生A-0"]')).toBeAttached();
  await network.respond('接续B');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'birth');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(title(page, '接续B')).toBeVisible();
  await expect(page.locator('.galaxy-content-enter [data-node-kind="question"]')).toHaveCount(3);
  await expect(page.locator('.galaxy-content-enter [data-node-id^="question-诞生A-"]')).toHaveCount(0);
  await expect(page.locator('.galaxy-content-enter [data-node-id^="question-initial-"]')).toHaveCount(0);

  const phases = (await audit(page)).phases.map(item => item.phase);
  const firstBirth = phases.indexOf('birth');
  expect(phases.slice(firstBirth)).toEqual(['birth', 'collapse', 'wait', 'birth', 'idle']);
});

test('failed and empty searches leave the transition and allow reconnecting or searching again', async ({ page }) => {
  const network = await harness(page);
  await search(page, '断线');
  await network.respond('断线', { failure: true });
  await expect(page.getByText('暂时无法抵达这片星海', { exact: true })).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(page.locator('.search-voyage-status')).toHaveCount(0);
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await network.respond('断线');
  await expect(title(page, '断线')).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');

  await search(page, '空结果');
  await network.respond('空结果', { empty: true });
  await expect(page.getByText('这个问题还没有匹配的星光', { exact: true })).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(page.locator('.search-voyage-status')).toHaveCount(0);
  await search(page, '恢复');
  await network.respond('恢复');
  await expect(title(page, '恢复')).toBeVisible();
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await expect(page.locator('.empty-universe')).toHaveCount(0);
});

test('mobile infall targets the photographed hole after cover cropping; reduced motion removes the cinematic delay', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const network = await harness(page);
  await search(page, '移动星海');
  await network.requested('移动星海');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'collapse');
  await expect(scene(page)).toHaveAttribute('data-hole-x', /^\d/);
  const target = await scene(page).evaluate(element => {
    const root = element as HTMLElement, picture = root.querySelector<HTMLElement>('.cosmic-picture')!;
    const bounds = root.getBoundingClientRect(), image = picture.getBoundingClientRect();
    const [xPosition, yPosition] = getComputedStyle(picture).backgroundPosition.split(' ').map(part => parseFloat(part) / 100);
    const scale = Math.max(image.width / 1672, image.height / 941);
    return {
      actualX: Number(root.dataset.holeX), actualY: Number(root.dataset.holeY), width: bounds.width, height: bounds.height,
      expectedX: image.left - bounds.left + (image.width - 1672 * scale) * xPosition + 1483 * scale,
      expectedY: image.top - bounds.top + (image.height - 941 * scale) * yPosition + 153 * scale,
    };
  });
  expect(Math.abs(target.actualX - target.expectedX)).toBeLessThan(2);
  expect(Math.abs(target.actualY - target.expectedY)).toBeLessThan(2);
  expect(target.actualX / target.width).toBeGreaterThan(.65);
  expect(target.actualX / target.width).toBeLessThan(1);
  expect(target.actualY / target.height).toBeLessThan(.3);
  // A system preference change during infall must release the animation gate,
  // keep the pending request valid, and avoid starting a subsequent birth.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(scene(page)).toHaveClass(/galaxy-reduced-motion/);
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  await network.respond('移动星海');
  await expect(title(page, '移动星海')).toBeVisible();
  expect((await audit(page)).phases.some(item => item.phase === 'birth')).toBe(false);
  const before = (await audit(page)).phases.length;
  await search(page, '静态星海');
  await network.requested('静态星海');
  await expect(scene(page)).toHaveAttribute('data-voyage', 'idle');
  const responseTime = await page.evaluate(() => performance.now());
  await network.respond('静态星海');
  await expect(title(page, '静态星海')).toBeVisible();
  const shownAt = await page.evaluate(() => performance.now());
  expect(shownAt - responseTime).toBeLessThan(1500);
  expect((await audit(page)).phases.slice(before)).toEqual([]);
  await expect(page.locator('.search-voyage-status')).toHaveCount(0);
});
