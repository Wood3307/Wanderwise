import { expect, test, type Page, type Route } from '@playwright/test';

const entry = process.env.WORMHOLE_ENTRY_PATH || '/';
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const errors: string[] = []; pageErrors.set(page, errors); page.on('pageerror', error => errors.push(error.message)); });
test.afterEach(({ page }) => { expect(pageErrors.get(page)).toEqual([]); });
const seed = '恋爱';
const directions = ['友谊', '亲子关系', '性与亲密关系', '同性恋', 'MBTI', '依恋理论', '孤独感', '情绪价值', '家庭代际关系', '非暴力沟通', '文学', '认知科学'];
const texts = ['理解关系中的需求与边界，可以帮助我们从不同角度重新审视日常的相处方式。', '把一个问题放在更广阔的背景之中，原有的答案也可能引出新的、值得探索的方向。'];
const questionFor = (query: string) => ({ id: 'question-880', title: `${query}中的不同相处方式`, excerpt: texts[0], relevance: 1, color: '#a8d8ee', keywords: [query], kind: 'question', url: 'https://www.zhihu.com/question/880', answersExpanded: true,
  answers: [0, 1].map(index => ({ id: `answer-${881 + index}`, title: ['从理解需要开始', '在不同视角中形成理解'][index], author: '隔离测试作者', excerpt: texts[index], paragraphs: texts, relevance: 0.9 - index * 0.2, url: `https://www.zhihu.com/question/880/answer/${881 + index}`, isExcerpt: true, highlights: texts.map((text, paragraphIndex) => ({ id: `h-${index}-${paragraphIndex}`, text, paragraphIndex })) })) });
const fulfill = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(page: Page) {
  const searches: string[] = [];
  const associations: { query: string; exclude: string[] }[] = [];
  page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss());
  await page.route('**/api/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/health') return fulfill(route, { ok: true, configured: true, publicCount: 10, model: { configured: false } });
    if (url.pathname === '/api/associations') {
      const body = route.request().postDataJSON(); associations.push(body);
      const names = body.query === seed ? directions : directions.map(name => `${name}与${body.query}`).slice(0, 10);
      return fulfill(route, { seed: body.query, method: 'semantic', topics: names.map((keyword, i) => ({ id: `topic-${i}`, keyword, relation: `由${body.query}延伸到另一种关系与经验` })) });
    }
    if (url.pathname === '/api/explore') {
      const query = url.searchParams.get('q') || seed; searches.push(query);
      return fulfill(route, { query, keywords: [query], questions: [questionFor(query)], source: 'zhihu-search', fetchedAt: new Date().toISOString() });
    }
    if (url.pathname.startsWith('/api/questions/')) return fulfill(route, { question: questionFor(seed) });
    if (url.pathname.endsWith('/highlights')) {
      const id = url.pathname.split('/')[3];
      return fulfill(route, { answerId: id, highlights: questionFor(seed).answers.find(answer => answer.id === id)?.highlights, method: 'extractive' });
    }
    return fulfill(route, { message: 'This isolated test never calls external services.' }, 404);
  });
  await page.goto(`${entry}?q=${encodeURIComponent(seed)}`);
  await expect(page.getByRole('button', { name: /进入虫洞/ })).toBeEnabled();
  return { searches, associations, initialSearches: [...searches] };
}
const phase = (page: Page) => page.locator('main.app');
const active = (page: Page) => page.locator('.galaxy-content-enter');
const space = (page: Page) => page.getByTestId('association-space');
const coordinate = (page: Page, key: string) => space(page).getAttribute(`data-camera-${key}`).then(Number);
async function dragSpace(page: Page, dx = 140, dy = 35) {
  const viewport = page.viewportSize()!;
  await page.mouse.move(viewport.width * .5, viewport.height * .13);
  await page.mouse.down();
  await page.mouse.move(viewport.width * .5 + dx, viewport.height * .13 + dy, { steps: 12 });
  await page.mouse.up(); await page.waitForTimeout(500);
}
async function enterSpace(page: Page, wheel = false) {
  const portal = page.getByRole('button', { name: /进入虫洞/ });
  if (wheel) { await portal.hover(); await page.mouse.wheel(0, -550); }
  else await portal.click();
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'space');
  await expect(space(page)).toHaveAttribute('data-ready', 'true');
  await expect(space(page)).toHaveAttribute('aria-label', '平行宇宙');
}
async function findTopic(page: Page, keyword: string, returning = false) {
  const topic = page.getByRole('button', { name: `${returning ? '返回' : '探索'} ${keyword}`, exact: true });
  for (let attempt = 0; attempt < 12 && !await topic.isVisible(); attempt++) await dragSpace(page, 130, attempt % 2 ? -20 : 20);
  await expect(topic).toBeVisible(); return topic;
}
async function chooseTopic(page: Page, keyword: string, returning = false) {
  const topic = await findTopic(page, keyword, returning);
  await topic.focus(); await page.keyboard.press('Enter');
}

test('all depths lead to a varied parallel cosmos with readable Pillars background and no old chrome', async ({ page }, info) => {
  const { searches, associations, initialSearches } = await setup(page);
  expect(await page.locator('.wormhole-portal').innerText()).toBe('');
  for (let depth = 0; depth < 3; depth++) {
    await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', String(depth));
    await enterSpace(page, true);
    expect(associations.at(-1)?.query).toBe(seed);
    const topics = page.locator('.association-topic:not([data-return])');
    await expect(topics).toHaveCount(12);
    const kinds = await topics.evaluateAll(nodes => nodes.map(node => (node as HTMLElement).dataset.portalKind));
    expect(new Set(kinds).size).toBeGreaterThanOrEqual(5);
    expect(await page.locator('.association-topic:visible').count()).toBeGreaterThanOrEqual(5);
    await expect(page.locator('.association-header,.association-flight-info,.association-touch-controls,.association-coordinate-list,.association-map-toggle')).toHaveCount(0);
    const text = await space(page).innerText();
    for (const removed of ['超立方体', '联想之间', '返回星海', '联想坐标', '回到入口', '加速', '刹车']) expect(text).not.toContain(removed);
    if (depth === 0) {
      const image = await page.locator('.association-nebula').evaluate(async node => {
        const src = getComputedStyle(node).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)![1];
        const image = new Image(); image.src = src; await image.decode();
        return { src, width: image.naturalWidth, height: image.naturalHeight };
      });
      expect(image.src).toContain('parallel-pillars.jpg'); expect(image.width).toBe(1920); expect(image.height).toBe(1080);
      await expect(page.locator('.association-image-credit')).toHaveAttribute('href', 'https://esahubble.org/images/heic1501a/');
      await page.screenshot({ path: info.outputPath('parallel-universe-desktop.png') });
    }
    await page.keyboard.press('Escape');
    await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
    await expect(page.locator('.galaxy-scene')).toHaveAttribute('data-depth', String(depth));
    if (depth === 0) await active(page).getByRole('button', { name: `进入星系：${questionFor(seed).title}`, exact: true }).click();
    if (depth === 1) await active(page).getByRole('button', { name: '阅读观点：从理解需要开始', exact: true }).click();
  }
  expect(searches).toEqual(initialSearches);
  await page.keyboard.press('f'); await expect(page.getByRole('dialog')).toBeVisible();
});

test('drag rotates portals and horizontal text together while hover and old flight keys do not move the camera', async ({ page }, info) => {
  await setup(page); await enterSpace(page);
  const beforeYaw = await coordinate(page, 'yaw'), beforeRadius = await coordinate(page, 'radius');
  await page.mouse.move(1400, 200); await page.waitForTimeout(300);
  for (const key of ['w', 'a', 's', 'd', 'Space', 'Shift']) { await page.keyboard.down(key); await page.waitForTimeout(75); await page.keyboard.up(key); }
  expect(await coordinate(page, 'yaw')).toBeCloseTo(beforeYaw, 2); expect(await coordinate(page, 'radius')).toBeCloseTo(beforeRadius, 2);
  const anchors = await page.locator('.association-topic').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-portal-id'), world: [(node as HTMLElement).dataset.worldX, (node as HTMLElement).dataset.worldY, (node as HTMLElement).dataset.worldZ], screen: [(node as HTMLElement).dataset.screenX, (node as HTMLElement).dataset.screenY] })));
  await dragSpace(page);
  expect(Math.abs(await coordinate(page, 'yaw') - beforeYaw)).toBeGreaterThan(.2);
  const after = await page.locator('.association-topic').evaluateAll(nodes => nodes.map(node => ({ id: node.getAttribute('data-portal-id'), world: [(node as HTMLElement).dataset.worldX, (node as HTMLElement).dataset.worldY, (node as HTMLElement).dataset.worldZ], screen: [(node as HTMLElement).dataset.screenX, (node as HTMLElement).dataset.screenY], transform: (node as HTMLElement).style.transform })));
  expect(after.map(item => item.world)).toEqual(anchors.map(item => item.world));
  expect(after.map(item => item.screen)).not.toEqual(anchors.map(item => item.screen));
  expect(after.filter(item => item.transform).every(item => item.transform.startsWith('translate3d('))).toBe(true);
  await page.mouse.move(700, 120); await page.mouse.wheel(0, 450);
  await expect.poll(() => coordinate(page, 'radius')).toBeGreaterThan(beforeRadius + 15);
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'space');
  await page.screenshot({ path: info.outputPath('parallel-universe-dragged.png') });
});

test('wheel entry stays on the chosen keyword, searches once, and can branch again', async ({ page }) => {
  const { searches, associations, initialSearches } = await setup(page);
  await active(page).getByRole('button', { name: `进入星系：${questionFor(seed).title}`, exact: true }).click();
  const tripId = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wanderwise.trip-session.v1')!).id);
  await enterSpace(page);
  const topic = await findTopic(page, '友谊'); await topic.hover();
  for (let step = 0; step < 8; step++) {
    if (await phase(page).getAttribute('data-wormhole') !== 'space') break;
    await page.mouse.wheel(0, -300); await page.waitForTimeout(120);
    const sample = await page.evaluate(() => ({ phase: document.querySelector<HTMLElement>('main.app')?.dataset.wormhole, keyword: document.querySelector<HTMLElement>('.association-space')?.dataset.selectedKeyword }));
    if (sample.phase !== 'space') break;
    expect(sample.keyword).toBe('友谊');
  }
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle', { timeout: 25000 });
  expect(searches).toEqual([...initialSearches, '友谊']);
  await expect(active(page).locator('.galaxy-label-title')).toContainText('友谊中的不同相处方式');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('wanderwise.trip-session.v1')!).id)).toBe(tripId);
  await enterSpace(page); expect(associations.at(-1)?.query).toBe('友谊');
  await chooseTopic(page, '友谊与友谊');
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
  expect(searches).toEqual([...initialSearches, '友谊', '友谊与友谊']);
});

test('the original topic portal returns to its existing sky without a new search', async ({ page }) => {
  const { searches, initialSearches } = await setup(page); await enterSpace(page);
  await chooseTopic(page, seed, true);
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle', { timeout: 25000 });
  expect(searches).toEqual(initialSearches);
  await expect(page).toHaveURL(/q=%E6%81%8B%E7%88%B1/);
});

test('failed destinations recover and cancellation ignores a late result', async ({ page }) => {
  await setup(page); await enterSpace(page);
  await page.route('**/api/explore?q=*', route => fulfill(route, { message: '此方向暂时无法连接' }, 503));
  await chooseTopic(page, '友谊');
  await expect(space(page).getByRole('status')).toContainText('此方向暂时无法连接');
  await page.keyboard.press('Escape'); await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
  await enterSpace(page);
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/explore?q=*', async route => { await delayed; await fulfill(route, { query: '友谊', questions: [questionFor('友谊')] }).catch(() => {}); });
  await chooseTopic(page, '友谊'); await expect(phase(page)).toHaveAttribute('data-wormhole', 'departing');
  await page.keyboard.press('Escape'); release();
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
  await expect(page).toHaveURL(/q=%E6%81%8B%E7%88%B1/);
});

test('both crossings use the same blue-white field and reveal only a ready destination', async ({ page }, info) => {
  test.setTimeout(120000);
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await setup(page);
  let releaseAssociations!: () => void;
  const associations = new Promise<void>(resolve => { releaseAssociations = resolve; });
  await page.route('**/api/associations', async route => { await associations; await fulfill(route, { topics: directions.map((keyword, index) => ({ id: String(index), keyword, relation: '' })) }); });
  await page.evaluate(() => {
    const frames: Record<string, unknown>[] = []; Reflect.set(window, '__parallelFrames', frames);
    const sample = () => {
      const app = document.querySelector<HTMLElement>('main.app'), transit = document.querySelector<HTMLElement>('.wormhole-transit');
      if (app && transit && frames.length < 2000) frames.push({ phase: app.dataset.wormhole, reveal: Number(transit.dataset.reveal || 0), visual: transit.dataset.visual, centerX: transit.dataset.centerX, centerY: transit.dataset.centerY,
        spaceReady: app.dataset.wormholeSpaceReady, galaxyReady: app.dataset.wormholeGalaxyReady, originalVisible: getComputedStyle(document.querySelector('.universe')!).visibility });
      requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  });
  await page.getByRole('button', { name: /进入虫洞/ }).click();
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'entering');
  await page.waitForTimeout(3500);
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-visual', 'blue-white');
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-renderer', 'light-field');
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-ready', 'false');
  expect(await page.locator('.wormhole-transit').evaluate(node => getComputedStyle(node).opacity)).toBe('1');
  const entranceBackground = await page.locator('.wormhole-transit').evaluate(node => getComputedStyle(node).backgroundImage);
  await page.screenshot({ path: info.outputPath('blue-white-entry.png') }); releaseAssociations();
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'space', { timeout: 40000 });
  let releaseDestination!: () => void;
  const destination = new Promise<void>(resolve => { releaseDestination = resolve; });
  await page.route('**/api/explore?q=*', async route => { await destination; await fulfill(route, { query: '友谊', questions: [questionFor('友谊')], source: 'zhihu-search', fetchedAt: new Date().toISOString() }); });
  await chooseTopic(page, '友谊'); await expect(phase(page)).toHaveAttribute('data-wormhole', 'departing');
  await page.waitForTimeout(3300);
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-visual', 'blue-white');
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-renderer', 'light-field');
  await expect(page.locator('.wormhole-transit')).toHaveAttribute('data-ready', 'false');
  expect(await page.locator('.wormhole-transit').evaluate(node => getComputedStyle(node).backgroundImage)).toBe(entranceBackground);
  await page.screenshot({ path: info.outputPath('blue-white-exit.png') }); releaseDestination();
  await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle', { timeout: 40000 });
  const frames = await page.evaluate(() => Reflect.get(window, '__parallelFrames')) as { phase: string; reveal: number; visual: string; centerX: string; centerY: string; spaceReady: string; galaxyReady: string; originalVisible: string }[];
  expect(frames.length).toBeGreaterThan(10);
  for (const frame of frames) {
    expect(frame.visual).toBe('blue-white'); expect(Number(frame.centerX)).toBe(0.5); expect(Number(frame.centerY)).toBe(0.5);
    if (frame.phase === 'entering') { expect(frame.originalVisible).toBe('hidden'); if (frame.reveal > 0) expect(frame.spaceReady).toBe('true'); }
    if (frame.reveal > 0 && frame.phase === 'emerging') expect(frame.galaxyReady).toBe('true');
  }
});

test('mobile supports dragging and two-finger zoom without flight buttons', async ({ browser }, info) => {
  const context = await browser.newContext({ baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:5188', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  try {
    await setup(page); await page.getByRole('button', { name: /进入虫洞/ }).tap();
    await expect(phase(page)).toHaveAttribute('data-wormhole', 'space');
    await expect(page.locator('.association-touch-controls,.association-flight-info')).toHaveCount(0);
    const radius = await coordinate(page, 'radius'), yaw = await coordinate(page, 'yaw');
    const session = await context.newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 140, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 255, y: 155, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => Math.abs(await coordinate(page, 'yaw') - yaw)).toBeGreaterThan(.15);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 155, y: 420, id: 1 }, { x: 235, y: 420, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 120, y: 420, id: 1 }, { x: 270, y: 420, id: 2 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => coordinate(page, 'radius')).toBeLessThan(radius - 20);
    await expect(phase(page)).toHaveAttribute('data-wormhole', 'space');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => visualViewport?.scale ?? 1)).toBeCloseTo(1, 2);
    await page.waitForTimeout(550);
    await page.screenshot({ path: info.outputPath('parallel-universe-mobile.png') });
    const visible = page.locator('.association-topic:not([data-return]):visible').first();
    const keyword = (await visible.textContent())!.trim();
    await visible.tap(); await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
    await expect(active(page).locator('.galaxy-label-title')).toContainText(keyword);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('ending a trip cancels a pending parallel-universe destination request', async ({ page }) => {
  await setup(page);
  await active(page).getByRole('button', { name: `进入星系：${questionFor(seed).title}`, exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('wanderwise.trip-session.v1')!).journey.length)).toBe(1);
  await enterSpace(page);
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/explore?q=*', async route => { await delayed; await fulfill(route, { query: '友谊', questions: [questionFor('友谊')] }).catch(() => {}); });
  await chooseTopic(page, '友谊'); await expect(phase(page)).toHaveAttribute('data-wormhole', 'departing');
  page.removeAllListeners('dialog'); const dialogEvent = page.waitForEvent('dialog');
  const session = await page.context().newCDPSession(page); await session.send('Page.close');
  const native = await dialogEvent; await native.dismiss();
  await page.getByRole('dialog', { name: '是否导出漫游足迹', exact: true }).getByRole('button', { name: '不导出，结束旅行', exact: true }).click();
  release(); await expect(phase(page)).toHaveAttribute('data-wormhole', 'idle');
  await expect(page).toHaveURL(/q=%E6%81%8B%E7%88%B1/);
});
