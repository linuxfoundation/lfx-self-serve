// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page } from '@playwright/test';
import { MKTG_POLL_RETRYING_TEXT } from '../../../packages/shared/src/constants/mktg-run.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { kitTest as test, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';
import { DATA_LOAD_TIMEOUT } from './helpers/mktg-os-assets.helper';
import { expectRetryingLine, setupOutage } from './helpers/mktg-os-outage.helper';

/** The structure and the retry policy behind the offline sweep (mktg-os-connection-failures.spec.ts). */
const KIT_FAMILY = '/families/positioning-brand';
/** Long enough for several checks at the healthy 5 s cadence, so "no reads" and "fewer reads" are both measurable. */
const OBSERVE_MS = 22_000;
/** A wake (tab return, focus, reconnect) re-reads at once. */
const WAKE_READ_TIMEOUT = 2_000;

// Playwright has no visibility emulation: the page's own visibilityState is overridden on the document instance and the
// event the shared poller listens to is dispatched (as mktg-os-documents.spec.ts does).
const setVisibility = (page: Page, state: DocumentVisibilityState): Promise<void> =>
  page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

const countListingReads = (page: Page): (() => number) => {
  let reads = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === '/api/mktg-agents/documents') reads++;
  });
  return () => reads;
};

test.describe('Marketing OS connection failures · structure and retry policy', () => {
  test.setTimeout(120_000);
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });

  for (const width of [1440, 1280, 390]) {
    test(`the status line sits above the kit and the family at ${width}px, on one spot each, without overflow`, async ({ page }, info) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      await setupKit(page, { loaded: true });
      const outage = await setupOutage(page);
      await openKit(page);
      await page.setViewportSize({ width, height: 1000 });
      await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4, { timeout: DATA_LOAD_TIMEOUT });
      await outage.down();
      for (const [host, line, content] of [
        ['mktg-kit-page', 'mktg-kit-retrying', 'mktg-kit-families'],
        ['mktg-family-page', 'mktg-family-retrying', 'mktg-family-content-loading'],
      ]) {
        if (host === 'mktg-family-page') {
          await page.evaluate((url) => {
            history.pushState({}, '', url);
            dispatchEvent(new PopStateEvent('popstate'));
          }, `/project/mktg-os-agents${KIT_FAMILY}?project=${KIT_PROJECT.slug}`);
          // Opened during the outage: the line sits above the skeleton instead of the rows.
          await expect(page.getByTestId('mktg-family-content-loading')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
        }
        const status = page.getByTestId(line);
        await expectRetryingLine(page, status);
        // One line for the one read: the text appears once on the page.
        await expect(page.getByTestId(host).getByText(MKTG_POLL_RETRYING_TEXT)).toHaveCount(1);
        const lineBox = await status.boundingBox();
        const below = await page.getByTestId(content).boundingBox();
        const hostBox = await page.getByTestId(host).boundingBox();
        if (!lineBox || !below || !hostBox) throw new Error('Expected the status line, its content and the page host to be on screen');
        expect(lineBox.y + lineBox.height).toBeLessThanOrEqual(below.y);
        expect(lineBox.x).toBeGreaterThanOrEqual(hostBox.x);
        expect(lineBox.x + lineBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width + 1);
        // A status line, never a banner: one or two text lines high at any width.
        expect(lineBox.height).toBeLessThan(48);
        expect(await page.getByTestId(host).evaluate((element) => element.scrollWidth > element.clientWidth + 1)).toBe(false);
        const path = info.outputPath(`${line}-${width}.png`);
        await page.screenshot({ path, fullPage: true });
        await info.attach(`${line} at ${width}px`, { path, contentType: 'image/png' });
      }
    });
  }

  test('a failing read backs off: fewer checks than the healthy cadence, and it never stops', async ({ page }) => {
    await setupKit(page, { loaded: true });
    const outage = await setupOutage(page);
    const reads = countListingReads(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4, { timeout: DATA_LOAD_TIMEOUT });

    const healthyFrom = reads();
    await page.waitForTimeout(OBSERVE_MS);
    const healthy = reads() - healthyFrom;
    // Healthy: one check every 5 s.
    expect(healthy).toBeGreaterThanOrEqual(3);

    await outage.down();
    await expectRetryingLine(page, page.getByTestId('mktg-kit-retrying'));
    const failingFrom = reads();
    await page.waitForTimeout(OBSERVE_MS);
    const failing = reads() - failingFrom;
    // Failing: never faster than the healthy cadence (the jitter's floor), and still checking (it never gives up).
    expect(failing).toBeGreaterThanOrEqual(1);
    expect(failing).toBeLessThanOrEqual(healthy);
    await expect(page.getByTestId('mktg-kit-retrying')).toHaveText(MKTG_POLL_RETRYING_TEXT);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
    test.info().annotations.push({ type: 'reads', description: `healthy ${healthy} in ${OBSERVE_MS} ms, failing ${failing} in ${OBSERVE_MS} ms` });
  });

  test('a hidden tab checks nothing during an outage, and coming back re-reads at once and clears the line', async ({ page }) => {
    await setupKit(page, { loaded: true });
    const outage = await setupOutage(page);
    const reads = countListingReads(page);
    await openKit(page);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4, { timeout: DATA_LOAD_TIMEOUT });
    await outage.down();
    const line = page.getByTestId('mktg-kit-retrying');
    await expectRetryingLine(page, line);

    await setVisibility(page, 'hidden');
    const hiddenAt = reads();
    await page.waitForTimeout(OBSERVE_MS);
    expect(reads()).toBe(hiddenAt);

    // The server is back while the tab is hidden; nothing is read until the tab is shown again.
    outage.upQuietly();
    await page.waitForTimeout(WAKE_READ_TIMEOUT);
    expect(reads()).toBe(hiddenAt);
    await setVisibility(page, 'visible');
    await expect.poll(() => reads(), { timeout: WAKE_READ_TIMEOUT }).toBeGreaterThan(hiddenAt);
    await expect(line).toHaveCount(0);
    await expect(page.getByTestId('mktg-kit-families').locator('article')).toHaveCount(4);
  });

  test('a final refusal is never sent again: no automatic retry and no re-read on reconnect, focus or tab return', async ({ page }) => {
    await setupKit(page, { loaded: true, revisionStatus: 404 });
    let detailReads = 0;
    page.on('request', (request) => {
      if (request.method() === 'GET' && new URL(request.url()).pathname.includes('/revisions/')) detailReads++;
    });
    await openKit(page, KIT_FAMILY);
    await expect(page.getByTestId('mktg-family-sources-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    expect(detailReads).toBe(1);
    for (const wake of ['online', 'focus']) await page.evaluate((event) => window.dispatchEvent(new Event(event)), wake);
    await setVisibility(page, 'hidden');
    await setVisibility(page, 'visible');
    await page.waitForTimeout(OBSERVE_MS);
    expect(detailReads).toBe(1);
    await expect(page.getByTestId('mktg-family-sources-error')).toBeVisible();
    await expect(page.getByTestId('mktg-family-asset-boilerplates')).toContainText('Draft');
  });
});
