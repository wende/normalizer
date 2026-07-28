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
    await expect(page.locator("#sampleButton")).toBeVisible();
  });

  test("preview tab bar switches modes", async ({ page }) => {
    const tabs = page.locator(".preview-tab");
    await expect(tabs).toHaveCount(5);

    for (const mode of ["split", "lit", "normal", "base", "specular"]) {
      await page.locator(`.preview-tab[data-mode="${mode}"]`).click();
      await expect(page.locator(`.preview-tab[data-mode="${mode}"]`)).toHaveClass(/active/);
    }
  });

  test("pipeline and control tabs switch panels", async ({ page }) => {
    await expect(page.locator("#lightPanel")).toBeVisible();
    await expect(page.locator("#normalPanel")).toHaveCount(0);

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
    await expect(lightCards).toHaveCount(6);
    await expect(page.locator(".control-card__title").filter({ hasText: "Diffuse" })).toBeVisible();
    await expect(page.locator(".control-card__title").filter({ hasText: "Specular" })).toBeVisible();
    await expect(page.locator(".control-card__title").filter({ hasText: "Ambient" })).toBeVisible();
    await expect(page.locator(".control-card__title").filter({ hasText: "Shadow" })).toBeVisible();
  });

  test("lit preview casts an alpha shadow and exposes a draggable contact", async ({ page }) => {
    await page.locator('.preview-tab[data-mode="lit"]').click();
    await expect(page.locator("#shadowEnabled")).toBeChecked();
    await page.waitForFunction(() => {
      const stage = document.querySelector(".preview-stage");
      return stage?.dataset.imageWidth && stage?.dataset.shadowContactY;
    });

    const before = await page.locator(".preview-stage").getAttribute("data-shadow-contact-y");
    const coords = await page.evaluate(() => {
      const canvas = document.querySelector("#previewCanvas");
      const stage = document.querySelector(".preview-stage");
      const bounds = canvas.getBoundingClientRect();
      const left = Number(stage.dataset.imageLeft);
      const top = Number(stage.dataset.imageTop);
      const width = Number(stage.dataset.imageWidth);
      const height = Number(stage.dataset.imageHeight);
      return {
        x: bounds.left + bounds.width * (left + width * 0.5),
        y: bounds.top + bounds.height * (top + height),
        targetY: bounds.top + bounds.height * (top + height * 0.82),
      };
    });

    await page.mouse.move(coords.x, coords.y);
    await page.mouse.down();
    await page.mouse.move(coords.x, coords.targetY, { steps: 8 });
    await page.mouse.up();

    await expect.poll(() => page.locator(".preview-stage").getAttribute("data-shadow-contact-y")).not.toBe(before);
    const after = Number(await page.locator(".preview-stage").getAttribute("data-shadow-contact-y"));
    expect(after).toBeLessThan(0.9);

    // A viewer-facing light projects into the upper-left, receding background
    // rather than the foreground below the tree.
    const shadowPixels = await page.evaluate(() => {
      const canvas = document.querySelector("#previewGL");
      const stage = document.querySelector(".preview-stage");
      const gl = canvas.getContext("webgl2");
      const data = new Uint8Array(canvas.width * canvas.height * 4);
      gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      const left = Number(stage.dataset.imageLeft) * canvas.width;
      const width = Number(stage.dataset.imageWidth) * canvas.width;
      const top = Number(stage.dataset.imageTop) * canvas.height;
      const height = Number(stage.dataset.imageHeight) * canvas.height;
      let count = 0;
      for (let y = Math.floor(top + height * 0.08); y < Math.floor(top + height * 0.45); y += 1) {
        for (let x = Math.floor(left + width * 0.04); x < Math.floor(left + width * 0.23); x += 1) {
          const offset = ((canvas.height - 1 - y) * canvas.width + x) * 4;
          if (data[offset] < 40 && data[offset + 1] < 45 && data[offset + 2] < 42) count += 1;
        }
      }
      return count;
    });
    expect(shadowPixels).toBeGreaterThan(0);
  });

  test("Canvas2D fallback renders the Lit shadow", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      const getContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function patchedGetContext(type, ...args) {
        return type === "webgl2" ? null : getContext.call(this, type, ...args);
      };
    });
    try {
      await page.goto(BASE);
      await page.waitForSelector("#previewCanvas", { timeout: 15000 });
      await page.waitForFunction(() => /\d+x\d+/.test(document.querySelector("#status")?.textContent || ""));
      await page.locator('.preview-tab[data-mode="lit"]').click();
      const shadowPixels = await page.evaluate(() => {
        const canvas = document.querySelector("#previewCanvas");
        const stage = document.querySelector(".preview-stage");
        const ctx = canvas.getContext("2d");
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const left = Number(stage.dataset.imageLeft) * canvas.width;
        const width = Number(stage.dataset.imageWidth) * canvas.width;
        const top = Number(stage.dataset.imageTop) * canvas.height;
        const height = Number(stage.dataset.imageHeight) * canvas.height;
        let count = 0;
        for (let y = Math.floor(top + height * 0.08); y < Math.floor(top + height * 0.45); y += 1) {
          for (let x = Math.floor(left + width * 0.04); x < Math.floor(left + width * 0.23); x += 1) {
            const offset = (y * canvas.width + x) * 4;
            if (data[offset] < 40 && data[offset + 1] < 45 && data[offset + 2] < 42) count += 1;
          }
        }
        return count;
      });
      expect(shadowPixels).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
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
});
