import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Music tests use the actual local recording, never live content credentials.
  await page.route("**/api/explore?**", (route) => route.fulfill({
    json: { query: "", keywords: [], source: "zhihu-public", fetchedAt: new Date().toISOString(), questions: [] },
  }));
  await page.route("**/api/health", (route) => route.fulfill({
    json: { ok: true, configured: false, publicCount: 0, model: { configured: false, provider: "extractive" } },
  }));
});

test("Day One starts on click, decodes the real recording, loops and pauses", async ({ page }) => {
  await page.goto("/");
  const audio = page.locator(".background-music audio");
  await expect(page.getByRole("button", { name: "播放背景音乐", exact: true })).toBeVisible();
  expect(await audio.evaluate((node: HTMLAudioElement) => ({ paused: node.paused, time: node.currentTime, loop: node.loop })))
    .toEqual({ paused: true, time: 0, loop: true });

  await page.getByRole("button", { name: "播放背景音乐", exact: true }).click();
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.readyState)).toBeGreaterThanOrEqual(2);
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.1);
  const loaded = await audio.evaluate((node: HTMLAudioElement) => ({ duration: node.duration, source: node.currentSrc, error: node.error?.code ?? null }));
  expect(loaded.duration).toBeGreaterThan(199);
  expect(loaded.duration).toBeLessThan(201);
  expect(loaded.source).toContain("/audio/day-one.mp3");
  expect(loaded.error).toBeNull();

  await audio.evaluate((node: HTMLAudioElement) => { node.currentTime = node.duration - 0.3; });
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeLessThan(2);
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(false);

  await page.getByRole("button", { name: "暂停背景音乐", exact: true }).click();
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await expect(page.getByRole("button", { name: "播放背景音乐", exact: true })).toBeVisible();
});

test("volume and mute persist while refreshing does not autoplay", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "背景音乐设置", exact: true }).click();
  const volume = page.getByRole("slider", { name: "背景音乐音量" });
  await volume.fill("41");
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.volume)).toBe(0.41);
  await page.getByRole("button", { name: "音乐静音", exact: true }).click();
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.muted)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "背景音乐设置", exact: true }).click();
  await expect(volume).toHaveValue("41");
  await expect(page.getByRole("button", { name: "取消音乐静音", exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await page.getByRole("button", { name: "取消音乐静音", exact: true }).click();
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.muted)).toBe(false);
  await volume.press("Escape");
  await expect(page.getByRole("group", { name: "背景音乐控制" })).toHaveCount(0);
});
