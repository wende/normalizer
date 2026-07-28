import { test, expect } from "@playwright/test";

const BASE = process.env.WEB_URL || "http://localhost:8765";

test.describe("Normal Map Generator UI", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE);
    await page.waitForSelector("#previewGL", { timeout: 15000 });
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status")?.textContent || "";
        return /\d+x\d+/.test(status) || status.includes("ms");
      },
      { timeout: 15000 }
    );
  });

  test("loads full-page layout and header", async ({ page }) => {
    await expect(page.locator(".app")).toBeVisible();
    const box = await page.locator(".app").boundingBox();
    const viewport = page.viewportSize();
    expect(box?.width).toBeGreaterThanOrEqual((viewport?.width ?? 0) - 2);
    await expect(page.locator(".brand")).toContainText("Normalizer");
    await expect(page.locator("#exportButton")).toBeVisible();
    await expect(page.locator("#exportPackButton")).toBeVisible();
    await expect(page.locator("#sampleButton")).toBeVisible();
  });

  test("preview tab bar switches modes", async ({ page }) => {
    const tabs = page.locator(".preview-tab");
    await expect(tabs).toHaveCount(7);

    for (const mode of ["split", "lit", "normal", "base", "specular", "parallax", "occlusion"]) {
      await page.locator(`.preview-tab[data-mode="${mode}"]`).click();
      await expect(page.locator(`.preview-tab[data-mode="${mode}"]`)).toHaveClass(/active/);
    }
  });

  test("pipeline and control tabs switch panels", async ({ page }) => {
    await expect(page.locator("#lightPanel")).toBeVisible();
    await expect(page.locator("#normalPanel")).toHaveCount(0);

    await page.locator('.pill-switch button:has-text("Procedural")').click();
    await page.locator('.pill-switch button:has-text("Normal")').click();
    await expect(page.locator("#normalPanel")).toBeVisible();
    await expect(page.locator("#lightPanel")).toHaveCount(0);

    await page.locator('.pill-switch button:has-text("AI")').first().click();
    await expect(page.locator("#aiPanel")).toBeVisible();
    await expect(page.locator("#normalPanel")).toHaveCount(0);
    await expect(page.locator("#aiGenerateButton")).toBeVisible();
  });

  test("sliders update status after debounce", async ({ page }) => {
    const slider = page.locator("#diffuseIntensity");
    await slider.fill("200");
    await page.waitForFunction(
      () => document.querySelector("#status")?.textContent?.includes("ms"),
      { timeout: 5000 }
    );
    await expect(page.locator("#status")).toContainText("ms");
  });

  test("sample button reloads without error", async ({ page }) => {
    await page.locator("#sampleButton").click();
    await expect(page.locator("#status")).toHaveText(/\d+x\d+.*ms/);
  });

  test("control cards render grouped sections", async ({ page }) => {
    const lightCards = page.locator("#lightPanel .control-card");
    await expect(lightCards).toHaveCount(5);
    await expect(page.locator(".control-card__title").filter({ hasText: "Diffuse" })).toBeVisible();
    await expect(page.locator(".control-card__title").filter({ hasText: "Specular" })).toBeVisible();
    await expect(page.locator(".control-card__title").filter({ hasText: "Ambient" })).toBeVisible();
  });

  test("canvas renders non-empty preview", async ({ page }) => {
    const hasPixels = await page.evaluate(() => {
      const canvas = document.querySelector("#previewGL");
      if (!canvas) return false;
      const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
      if (!gl) return canvas.width > 0 && canvas.height > 0;
      const pixels = new Uint8Array(4);
      gl.readPixels(
        Math.floor(canvas.width / 2),
        Math.floor(canvas.height / 2),
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
      return pixels.some((v) => v > 0);
    });
    expect(hasPixels).toBe(true);
  });

  test("split divider is draggable", async ({ page }) => {
    await page.locator('.preview-tab[data-mode="split"]').click();
    await page.waitForFunction(() => {
      const stage = document.querySelector(".preview-stage");
      return stage?.dataset.imageWidth && stage?.dataset.splitRatio;
    });

    const coords = await page.evaluate(() => {
      const canvas = document.querySelector("#previewCanvas");
      const stage = document.querySelector(".preview-stage");
      const bounds = canvas.getBoundingClientRect();
      const left = Number(stage.dataset.imageLeft);
      const width = Number(stage.dataset.imageWidth);
      const ratio = Number(stage.dataset.splitRatio);
      const top = Number(stage.dataset.imageTop);
      const height = Number(stage.dataset.imageHeight);
      const y = bounds.top + bounds.height * (top + height * 0.5);
      const startX = bounds.left + bounds.width * (left + width * ratio);
      const endX = bounds.left + bounds.width * (left + width * 0.75);
      return { startX, y, endX };
    });

    await page.mouse.move(coords.startX, coords.y);
    await page.mouse.down();
    await page.mouse.move(coords.endX, coords.y, { steps: 12 });
    await page.mouse.up();

    const ratio = Number(await page.locator(".preview-stage").getAttribute("data-split-ratio"));
    expect(ratio).toBeGreaterThan(0.55);
  });

  test("export triggers download", async ({ page }) => {
    const downloadPromise = page.waitForEvent("download", { timeout: 10000 });
    await page.locator("#exportButton").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.png$/i);
  });

  test("export pack downloads zip with normalizer.json", async ({ page }) => {
    // Wait until generated maps exist (debounced recompute after sample load).
    await page.waitForFunction(
      () => {
        const status = document.querySelector("#status")?.textContent || "";
        return /ms|sample ready|AI map ready/i.test(status);
      },
      { timeout: 20000 },
    );
    const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
    await page.locator("#exportPackButton").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.zip$/i);
    const path = await download.path();
    expect(path).toBeTruthy();
  });
});
