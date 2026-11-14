import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

const CASE_SLUGS = [
  'aquiplan',
  'ace-benihbunbun',
  'hexagon-paragon',
  'little-visionaries',
  'c2m-crystalin',
  'smart-queue-kopi-kenangan',
  'sahabatbulu',
  'fellowship-community',
  'business-club',
  'arupadatu-website',
];

test.describe('Jocelyn Lau Portfolio Smoke & Review Suite', () => {
  test('home renders hero, masthead, and 10 work rows without console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    const res = await page.goto('/');
    expect(res?.status()).toBe(200);

    await expect(page.locator('h1')).toContainText('Jocelyn Lau');
    await expect(page.locator('.hero__hook')).toContainText('Building growth strategies');
    await expect(page.locator('[data-jkt-clock]')).toHaveText(/^JKT \d{2}:\d{2}$/);
    await expect(page.locator('[data-scrub-chars]')).toContainText('Strategy should do more');
    await expect(page.locator('.roll-link .roll-text[data-text]').first()).toBeVisible();
    await expect(page.locator('.site-marquee')).toBeVisible();

    const rows = page.locator('[data-work-row]');
    await expect(rows).toHaveCount(10);
    await expect(page.locator('[data-work-counter]')).toHaveText('01/10');

    // Filter tabs work and update 01/XX index counter
    await page.locator('[data-filter="Leadership & Community"]').click();
    await expect(page.locator('[data-work-row]:not([hidden])')).toHaveCount(3);
    await expect(page.locator('[data-work-counter]')).toHaveText('01/03');

    await page.locator('[data-filter="Strategy & Consulting"]').click();
    await expect(page.locator('[data-work-row]:not([hidden])')).toHaveCount(7);
    await expect(page.locator('[data-work-counter]')).toHaveText('01/07');

    await page.locator('[data-filter="all"]').click();
    await expect(page.locator('[data-work-row]:not([hidden])')).toHaveCount(10);
    await expect(page.locator('[data-work-counter]')).toHaveText('01/10');

    // Hero 3D lanyard canvas mounts with non-zero dimensions and credentials portrait loads eagerly
    const lanyardCanvas = page.locator('[data-lanyard] .lanyard-canvas');
    await expect(lanyardCanvas).toBeVisible();
    const lanyardBox = await lanyardCanvas.boundingBox();
    expect(lanyardBox).not.toBeNull();
    expect(lanyardBox!.width).toBeGreaterThan(100);
    expect(lanyardBox!.height).toBeGreaterThan(100);

    const portraitLoaded = await page.locator('.about-profile__portrait').evaluate(
      (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
    );
    expect(portraitLoaded).toBe(true);

    // Highlight card metrics all stay on a single line at 1440px
    await page.setViewportSize({ width: 1440, height: 900 });
    const metricHeights = await page.locator('.highlight-card__metric').evaluateAll((els) =>
      els.map((el) => el.getBoundingClientRect().height),
    );
    expect(new Set(metricHeights.map((h) => Math.round(h))).size).toBe(1);

    expect(errors).toEqual([]);
  });

  test('every case study page returns 200, renders h1, and has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    for (const slug of CASE_SLUGS) {
      const res = await page.goto(`/work/${slug}`);
      expect(res?.status(), `Status for /work/${slug}`).toBe(200);
      await expect(page.locator('h1')).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test('no horizontal overflow at 375, 768, 1024, and 1440px and mobile thumbnails/menu work', async ({ page }) => {
    for (const width of [375, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      const homeOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      });
      expect(homeOverflow, `Home overflow at ${width}px`).toBe(true);

      await page.goto('/work/little-visionaries');
      const caseOverflow = await page.evaluate(() => {
        return document.documentElement.scrollWidth <= window.innerWidth;
      });
      expect(caseOverflow, `Case study overflow at ${width}px`).toBe(true);
    }

    // Check mobile view specifically
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const firstThumb = page.locator('.work-row__thumb').first();
    await expect(firstThumb).toBeVisible();

    // Mobile menu opens, traps Tab focus inside header/dialog, and closes with Escape
    const toggle = page.locator('[data-menu-toggle]');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Tab through all 6 links inside mobile-menu; next Tab should wrap back inside header/menu
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
    }
    const activeInHeader = await page.evaluate(() => {
      const active = document.activeElement;
      return Boolean(active && active.closest('.site-header'));
    });
    expect(activeInHeader, 'Tab focus should remain trapped inside mobile header/menu').toBe(true);

    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // Skip to content link becomes visible on focus
    const skipLink = page.locator('a.sr-only[href="#main-content"]');
    await skipLink.focus();
    const skipBox = await skipLink.boundingBox();
    expect(skipBox?.width ?? 0).toBeGreaterThan(20);
    expect(skipBox?.height ?? 0).toBeGreaterThan(15);
  });

  test('reduced motion: all [data-reveal] elements have computed opacity 1 immediately', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();

    await page.goto('/');
    const opacities = await page.locator('[data-reveal], [data-scrub-chars]').evaluateAll((els) =>
      els.map((el) => window.getComputedStyle(el).opacity),
    );
    for (const op of opacities) {
      expect(op).toBe('1');
    }

    await context.close();
  });

  test('JavaScript disabled: content remains fully visible and readable', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();

    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('.lanyard-fallback')).toBeVisible();
    const opacities = await page.locator('[data-reveal], [data-scrub-chars]').evaluateAll((els) =>
      els.map((el) => window.getComputedStyle(el).opacity),
    );
    for (const op of opacities) {
      expect(op).toBe('1');
    }

    await context.close();
  });

  test('navigation back/forward with View Transitions works cleanly', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await page.locator('[data-work-row]').first().click();
    await expect(page).toHaveURL(/\/work\/aquiplan/);
    await expect(page.locator('h1')).toContainText('AquiPlan');

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('[data-work-row]')).toHaveCount(10);

    expect(errors).toEqual([]);
  });

  test('built assets apply the black-and-red ColorHunt palette and leak no personal phone/student IDs', async () => {
    const distDir = path.resolve('dist');
    const htmlFiles: string[] = [];
    const cssFiles: string[] = [];

    async function walk(dir: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (entry.name.endsWith('.html')) htmlFiles.push(full);
        else if (entry.name.endsWith('.css')) cssFiles.push(full);
      }
    }

    await walk(distDir);
    expect(htmlFiles.length).toBeGreaterThanOrEqual(11);

    for (const file of htmlFiles) {
      const content = await fs.readFile(file, 'utf8');
      expect(content).not.toContain('81239913768');
      expect(content).not.toContain('2902654751');
      expect(content).not.toContain('2902669072');
      expect(content.toLowerCase()).not.toContain('fcfbf4');
      expect(content.toLowerCase()).not.toContain('f5efc6');
    }

    const joinedCss = (await Promise.all(cssFiles.map((f) => fs.readFile(f, 'utf8')))).join('\n').toLowerCase();
    expect(joinedCss).not.toContain('fcfbf4');
    expect(joinedCss).not.toContain('f5efc6');
    expect(joinedCss).toContain('#830000');
    expect(joinedCss).toContain('#bc0202');
    expect(joinedCss).toMatch(/#ff0000|#f00/);
  });
});
