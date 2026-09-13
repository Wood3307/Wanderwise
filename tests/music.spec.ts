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

test("Day One defaults on at 100%, decodes the real recording, loops and remembers being closed", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      document.documentElement.dataset.musicPlayAttempts = String(Number(document.documentElement.dataset.musicPlayAttempts || 0) + 1);
      return play.call(this);
    };
  });
  await page.goto("/");
  const audio = page.locator(".background-music audio");
  await expect(page.getByRole("button", { name: "关闭背景音乐", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.locator("html").getAttribute("data-music-play-attempts")).not.toBeNull();
  expect(await audio.evaluate((node: HTMLAudioElement) => ({ volume: node.volume, muted: node.muted, loop: node.loop })))
    .toEqual({ volume: 1, muted: false, loop: true });
  // A trusted page gesture also exercises browsers which block audible autoplay.
  await page.keyboard.press("Tab");
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
  await page.getByRole("button", { name: "关闭背景音乐", exact: true }).click();
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await page.keyboard.press("Tab");
  await page.reload();
  await expect(page.getByRole("button", { name: "开启背景音乐", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Tab");
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  expect(await page.locator("html").getAttribute("data-music-play-attempts")).toBeNull();
});

test("volume and mute persist without old 28% preferences overriding the new default", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("wanderwise.music.v1", JSON.stringify({ volume: 0.28, muted: false })));
  await page.goto("/");
  await page.getByRole("button", { name: "背景音乐设置", exact: true }).click();
  const volume = page.getByRole("slider", { name: "背景音乐音量" });
  await expect(volume).toHaveValue("100");
  await volume.fill("41");
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.volume)).toBe(0.41);
  await page.getByRole("button", { name: "音乐静音", exact: true }).click();
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.muted)).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "背景音乐设置", exact: true }).click();
  await expect(volume).toHaveValue("41");
  await expect(page.getByRole("button", { name: "取消音乐静音", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "关闭背景音乐", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "取消音乐静音", exact: true }).click();
  await expect.poll(() => page.locator(".background-music audio").evaluate((node: HTMLAudioElement) => node.muted)).toBe(false);
  await volume.press("Escape");
  await expect(page.getByRole("group", { name: "背景音乐控制" })).toHaveCount(0);
});

test("blocked autoplay waits quietly, then starts with the first trusted page interaction", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!navigator.userActivation.isActive) return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
      return play.call(this);
    };
  });
  await page.goto("/");
  const music = page.locator(".background-music");
  const audio = music.locator("audio");
  await expect(music).toHaveAttribute("data-playback", "awaiting-gesture");
  expect(await audio.evaluate((node: HTMLAudioElement) => node.paused)).toBe(true);
  await expect(page.getByRole("group", { name: "背景音乐控制" })).toHaveCount(0);
  await expect(music.locator(".spinning")).toHaveCount(0);
  await page.mouse.click(80, 450);
  await expect(music).toHaveAttribute("data-playback", "playing");
  await expect.poll(() => audio.evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(0.1);
});

test("closing while autoplay is blocked prevents later gestures from restarting music", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      document.documentElement.dataset.musicPlayAttempts = String(Number(document.documentElement.dataset.musicPlayAttempts || 0) + 1);
      return Promise.reject(new DOMException("Gesture required", "NotAllowedError"));
    };
  });
  await page.goto("/");
  await expect(page.locator(".background-music")).toHaveAttribute("data-playback", "awaiting-gesture");
  const attempts = await page.locator("html").getAttribute("data-music-play-attempts");
  await page.getByRole("button", { name: "关闭背景音乐", exact: true }).click();
  await page.mouse.click(80, 450);
  await page.keyboard.press("Tab");
  await expect(page.locator(".background-music")).toHaveAttribute("data-playback", "paused");
  expect(await page.locator("html").getAttribute("data-music-play-attempts")).toBe(attempts);
});

test("late autoplay rejection cannot reopen a closed player and reopening can play normally", async ({ page }) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!navigator.userActivation.isActive) {
        return new Promise((_, reject) => setTimeout(() => reject(new DOMException("Delayed autoplay denial", "NotAllowedError")), 700));
      }
      return play.call(this);
    };
  });
  await page.goto("/");
  const music = page.locator(".background-music");
  await page.getByRole("button", { name: "关闭背景音乐", exact: true }).click();
  await expect(music).toHaveAttribute("data-playback", "paused");
  await page.getByRole("button", { name: "开启背景音乐", exact: true }).click();
  await expect(music).toHaveAttribute("data-playback", "playing");
  await expect.poll(() => music.locator("audio").evaluate((node: HTMLAudioElement) => node.currentTime)).toBeGreaterThan(1);
  await expect(music).toHaveAttribute("data-playback", "playing");
});

test("unavailable audio stops loading without a popup and still lets the user close music", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(new DOMException("No supported source", "NotSupportedError"));
    };
  });
  await page.goto("/");
  const music = page.locator(".background-music");
  await expect(music).toHaveAttribute("data-playback", "error");
  await expect(music.locator(".spinning")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "背景音乐控制" })).toHaveCount(0);
  await page.getByRole("button", { name: "背景音乐设置", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "音乐暂时无法播放" })).toBeVisible();
  await page.getByRole("button", { name: "关闭背景音乐", exact: true }).click();
  await expect(music).toHaveAttribute("data-playback", "paused");
  await expect(page.getByRole("button", { name: "开启背景音乐", exact: true })).toHaveAttribute("aria-pressed", "false");
});
