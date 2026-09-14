import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Uses a new browser context and mocked APIs. It never reads a user's profile or server credentials.
// Example: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs BASE_URL=http://127.0.0.1:4187 node scripts/test-galaxy-handoff-browser.mjs
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const origin = process.env.BASE_URL || 'http://127.0.0.1:4187'
const output = resolve('artifacts/galaxy-handoff')
await mkdir(output, { recursive: true })
const paragraphs = ['测试来源中的第一段，只有被实际访问的问题与文章才应出现在这次旅行中。', '第二段保留真实文章的阅读路径，导出的旅行不会改变已有收藏与独立手记。']
const answer = { id: 'answer-701', title: '接收测试文章', author: '隔离测试作者', excerpt: paragraphs[0], paragraphs, isExcerpt: true, relevance: 0.8, url: 'https://www.zhihu.com/question/700/answer/701', highlightMethod: 'extractive', highlights: paragraphs.map((text, paragraphIndex) => ({ id: `p-${paragraphIndex}`, text, paragraphIndex })) }
const question = { id: 'question-700', title: '隔离测试中的真实访问路径', excerpt: '此固定数据仅用于自动验收。', keywords: ['测试'], relevance: 0.95, color: '#a8d8ee', kind: 'question', hotRank: 1, url: 'https://www.zhihu.com/question/700', answers: [answer], answersExpanded: true }
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}), args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const viewport = { width: Number(process.env.VIEWPORT_WIDTH || 1440), height: Number(process.env.VIEWPORT_HEIGHT || 1000) }
const context = await browser.newContext({ viewport, reducedMotion: 'reduce', ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) })
const errors = [], checks = []
const check = message => { checks.push(message); console.log('PASS', message) }
context.on('page', page => { page.on('pageerror', error => errors.push(error.message)); page.on('dialog', dialog => dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()) })
await context.route('**/api/**', route => {
  const url = new URL(route.request().url())
  const body = url.pathname === '/api/health' ? { ok: true, configured: true, publicCount: 10, model: { configured: false, provider: 'extractive' } }
    : url.pathname === '/api/explore' ? { query: url.searchParams.get('q') || '', source: 'zhihu-hot', keywords: [], fetchedAt: new Date().toISOString(), questions: [question] }
      : url.pathname.startsWith('/api/questions/') ? { question, source: 'zhihu-hot' }
        : url.pathname.endsWith('/highlights') ? { answerId: answer.id, highlights: answer.highlights, method: 'extractive' }
          : { message: 'No external APIs are permitted in this isolated test' }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})
const profile = page => page.evaluate(() => new Promise((resolve, reject) => {
  const open = indexedDB.open('wanderwise-personal', 1)
  open.onsuccess = () => { const db = open.result; const read = db.transaction('vault').objectStore('vault').get('profile'); read.onsuccess = () => { resolve(read.result); db.close() }; read.onerror = () => { reject(read.error); db.close() } }
  open.onerror = () => reject(open.error)
}))
async function waitForTrips(page, count) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await profile(page)
    if (current?.galaxyVoyages?.length === count) return current
    await page.waitForTimeout(100)
  }
  assert.fail(`expected ${count} persisted galaxy trips`)
}
const active = page => page.locator('.galaxy-content-enter')
async function enterQuestion(page) {
  const button = active(page).getByRole('button', { name: `进入星系：${question.title}`, exact: true })
  await button.waitFor({ state: 'visible', timeout: 45000 })
  await button.click()
  await page.locator('.galaxy-scene[data-depth="1"]').waitFor()
}
try {
  let page = await context.newPage()
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/home')
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 })
  await page.screenshot({ path: resolve(output, `merged-home-${viewport.width}.png`) })
  await page.goto(`${origin}/world`, { waitUntil: 'domcontentloaded' })
  await page.waitForURL('**/land')
  await page.locator('canvas').first().waitFor({ state: 'visible', timeout: 60000 })
  check('Latest land direct-entry routes still open the home and redirect the legacy world URL to the islands')
  await page.goto(`${origin}/galaxy`, { waitUntil: 'domcontentloaded' })
  await enterQuestion(page)
  const before = await profile(page)
  await active(page).getByRole('button', { name: `阅读观点：${answer.title}`, exact: true }).click()
  await page.locator('.galaxy-scene[data-depth="2"]').waitFor()
  await page.getByRole('button', { name: '返回观星台', exact: true }).click()
  await page.getByRole('dialog', { name: '是否导出漫游足迹' }).getByRole('button', { name: '导出并返回观星台', exact: true }).click()
  await page.waitForURL('**/observatory')
  const received = await waitForTrips(page, 1)
  const first = received.galaxyVoyages[0]
  assert.equal(first.journey.length, 2)
  assert.deepEqual(new Set(first.journey.map(stop => stop.title)), new Set([question.title, answer.title]))
  for (const key of ['sources', 'collections', 'notes', 'works', 'journeys', 'recipes', 'legacy', 'reading']) assert.deepEqual(received[key], before[key], `${key} must survive the handoff`)
  assert.equal(await page.evaluate(id => localStorage.getItem(`wanderwise.journey-export.v1.${id}`), first.tripId), null)
  check('Explicit export returns to observatory, persists two source-backed stops and acknowledges only the delivered packet')
  await page.locator('.observatory-loading').waitFor({ state: 'hidden', timeout: 60000 })
  const logButtonBox = await page.getByRole('button', { name: '查看本次足迹', exact: true }).boundingBox()
  assert.ok(logButtonBox && logButtonBox.x >= 0 && logButtonBox.x + logButtonBox.width <= viewport.width, 'the returned log entry must remain inside the viewport')
  await page.screenshot({ path: resolve(output, `observatory-return-${viewport.width}.png`) })
  await page.getByRole('button', { name: '查看本次足迹', exact: true }).click()
  const log = page.locator(`.ms-galaxy-voyage[data-trip-id="${first.tripId}"]`)
  await log.waitFor({ state: 'visible' })
  assert.equal(await log.locator('.ms-galaxy-voyage-stops > li').count(), 2)
  assert.deepEqual(new Set(await log.getByRole('link', { name: '查看原文' }).evaluateAll(links => links.map(link => link.href))), new Set([question.url, answer.url]))
  await page.screenshot({ path: resolve(output, `received-log-${viewport.width}.png`) })
  await page.getByRole('button', { name: '灯下续读', exact: true }).click()
  await page.getByRole('heading', { name: '灯下续读', exact: true }).waitFor({ state: 'visible' })
  await page.locator('.ms-panel-main .ms-empty').waitFor({ state: 'visible' })
  check('The merged personal panel retains the land reading workspace alongside the galaxy travel log')
  await page.getByRole('button', { name: '关闭个人空间', exact: true }).click()
  check('Returned observatory opens the actual personal log, showing the visited titles and exact original links')
  // Exercise a client-side route entry rather than resetting the document/session through goto.
  await page.evaluate(() => { history.pushState({ key: 'handoff-browser-next-entry', idx: 2, usr: { wanderwiseEntry: true } }, '', '/galaxy'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })) })
  await page.locator('.galaxy-scene[data-depth="0"]').waitFor()
  const emptyTrip = await page.evaluate(() => JSON.parse(sessionStorage.getItem('wanderwise.trip-session.v1')))
  assert.notEqual(emptyTrip.id, first.tripId)
  assert.deepEqual(emptyTrip.journey, [])
  await enterQuestion(page)
  await page.getByRole('button', { name: '返回观星台', exact: true }).click()
  await page.getByRole('dialog', { name: '是否导出漫游足迹' }).getByRole('button', { name: '不导出，返回观星台', exact: true }).click()
  await page.waitForURL('**/observatory')
  assert.equal((await profile(page)).galaxyVoyages.length, 1)
  check('New SPA entry begins with empty travel history, and discard returns without creating an exported log')
  const later = { ...first, tripId: 'waiting-for-next-host', query: '重新打开宿主领取', startedAt: '2026-09-14T02:00:00.000Z', endedAt: '2026-09-14T02:20:00.000Z' }
  await page.evaluate(packet => localStorage.setItem(`wanderwise.journey-export.v1.${packet.tripId}`, JSON.stringify(packet)), later)
  await page.close()
  page = await context.newPage()
  await page.goto(`${origin}/observatory`, { waitUntil: 'domcontentloaded' })
  await waitForTrips(page, 2)
  assert.equal(await page.evaluate(id => localStorage.getItem(`wanderwise.journey-export.v1.${id}`), later.tripId), null)
  await page.evaluate(packet => { localStorage.setItem(`wanderwise.journey-export.v1.${packet.tripId}`, JSON.stringify({ ...packet, query: 'conflicting retry' })); dispatchEvent(new Event('wanderwise:journey-retry')) }, later)
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await page.evaluate(id => localStorage.getItem(`wanderwise.journey-export.v1.${id}`), later.tripId) === null) break
    await page.waitForTimeout(100)
  }
  const restored = await profile(page)
  assert.equal(restored.galaxyVoyages.length, 2)
  assert.equal(restored.galaxyVoyages.find(trip => trip.tripId === later.tripId).query, later.query)
  check('Opening only the host drains a pending authorized export; duplicate delivery keeps the first receipt')
  assert.deepEqual(errors, [])
  await writeFile(resolve(output, `report-${viewport.width}.json`), JSON.stringify({ checks, errors, viewport, isolatedStorage: true, realApiCalls: 0 }, null, 2))
} finally { await context.close(); await browser.close() }
