import { expect, test, type Page } from '@playwright/test';
import type { Answer, Question } from '../src/types';

// Explicit browser fixtures; no search/model requests leave the browser.
const paragraphs = [
  String.raw`**质量与能量**遵循 $E=mc^2$，*尺度*可用 \(r^2\) 表示。代码 ` + '`$not_math$`' + ' 原样显示。',
  String.raw`## 推导

\[\frac{a}{b}=\sqrt{x}\]

> 保留推导的前提。

1. 确定变量
2. 核对单位

- [安全来源](https://www.zhihu.com/question/50)
- [无效链接](javascript:alert(1))`,
  '报价 $20 和 $30，总计 $50。<img src=x onerror=alert(1)> 保持普通文字。',
  '```js\nconst value = "$x^2$";\n```',
];
const answer: Answer = {
  id: 'answer-rich-8', title: '**读懂** $E=mc^2$', author: '测试作者', excerpt: paragraphs[0], paragraphs,
  url: 'https://www.zhihu.com/question/50/answer/80', relevance: .9, isExcerpt: true,
  highlights: paragraphs.map((text, index) => ({ id: `rich-${index}`, text, paragraphIndex: index })), highlightMethod: 'extractive',
};
const question: Question = {
  id: 'question-rich-8', title: String.raw`**引力**与 $\frac{a}{b}$ 如何联系？`, excerpt: '测试富文本', keywords: ['引力'], relevance: .9,
  color: '#b7ddeb', answers: [answer], kind: 'question', answersExpanded: true,
};
async function prepare(page: Page) {
  await page.route('**/api/explore?**', route => route.fulfill({ json: { query: '', keywords: ['引力'], source: 'zhihu-search', fetchedAt: '2026-09-14T00:00:00Z', questions: [question] } }));
  await page.route('**/api/health', route => route.fulfill({ json: { ok: true, configured: true, publicCount: 10, model: { configured: false } } }));
  await page.route('**/api/questions/**', route => route.fulfill({ json: { question } }));
  await page.route('**/api/answers/*/highlights?**', route => route.fulfill({ json: { answerId: answer.id, highlights: answer.highlights, method: 'extractive' } }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.galaxy-content-enter .galaxy-label-title strong')).toHaveText('引力');
}

test('renders Markdown and four TeX delimiters safely while selecting the untouched source paragraph', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.locator('.galaxy-content-enter').getByRole('button', { name: `进入星系：${question.title}`, exact: true }).click();
  await page.locator('.galaxy-content-enter').getByRole('button', { name: `阅读观点：${answer.title}`, exact: true }).click();
  await expect(page.locator('.galaxy-content-enter .galaxy-label-paragraph .katex').first()).toBeVisible();
  await expect(page.locator('.galaxy-content-enter button a')).toHaveCount(0);
  await page.keyboard.press('f');
  const reader = page.getByRole('dialog', { name: '原文阅览', exact: true });
  await expect(reader).toBeVisible();
  await expect(reader.locator('.reader-paragraph').nth(0).locator('strong')).toHaveText('质量与能量');
  await expect(reader.locator('.reader-paragraph').nth(0).locator('.katex')).toHaveCount(2);
  await expect(reader.locator('.reader-paragraph').nth(0).locator('code')).toHaveText('$not_math$');
  await expect(reader.locator('h2')).toHaveText('推导');
  await expect(reader.locator('.katex-display')).toHaveCount(1);
  await expect(reader.locator('.reader-prose blockquote')).toContainText('保留推导的前提');
  await expect(reader.locator('.reader-prose ol li')).toHaveCount(2);
  await expect(reader.getByRole('link', { name: '安全来源' })).toHaveAttribute('href', 'https://www.zhihu.com/question/50');
  await expect(reader.getByRole('link', { name: '无效链接' })).toHaveCount(0);
  await expect(reader.locator('img, script, button a, button div, button pre')).toHaveCount(0);
  await expect(reader.locator('.reader-paragraph').nth(2)).toContainText(paragraphs[2]);
  await expect(reader.locator('.reader-paragraph').nth(2).locator('.katex')).toHaveCount(0);
  await expect(reader.locator('pre code')).toHaveText('const value = "$x^2$";');
  await reader.getByRole('button', { name: '选中第 2 段', exact: true }).click();
  await expect(reader.getByRole('button', { name: '选中第 2 段', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await reader.getByRole('button', { name: /写下思考/ }).click();
  await expect(page.locator('.reflection-quote')).toContainText('推导');
  expect(errors).toEqual([]);
});

test('self-hosted Fangsong and the rendered formula glyphs participate in both dust phases', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await prepare(page);
  const stellar = page.locator('.galaxy-content-enter .galaxy-label-title .stellar-text');
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => stellar.locator('canvas').getAttribute('data-math-glyph-count')).toMatch(/^[1-9]\d*$/);
  await expect.poll(() => stellar.locator('canvas').getAttribute('data-particle-count')).toMatch(/^[1-9]\d*$/);
  expect(await stellar.evaluate(element => getComputedStyle(element).fontFamily)).toContain('Zhuque Fangsong');
  // FontFaceSet.check also includes the overlapping complete fallback face;
  // explicitly load the test glyphs before checking both local font sources.
  await page.evaluate(() => document.fonts.load('16px "Zhuque Fangsong"', '引力'));
  expect(await page.evaluate(() => document.fonts.check('16px "Zhuque Fangsong"', '引力'))).toBe(true);
  // Focus pauses auto rotation, keeping real projected labels clickable.
  await page.locator('.galaxy-content-enter').getByRole('button', { name: `进入星系：${question.title}`, exact: true }).focus();
  await page.keyboard.press('Enter');
  const departing = page.locator('.galaxy-content-exit .stellar-text-exit canvas').first();
  await expect(departing).toBeAttached();
  await expect(departing).toHaveAttribute('data-math-glyph-count', /^[1-9]\d*$/);
  await expect(page.locator('.galaxy-content-exit')).toHaveCount(0);
  await expect(page.locator('.galaxy-content-enter .galaxy-hub-title .katex')).toBeVisible();
});
