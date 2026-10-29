// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_DOCUMENTS_API_PATH } from '../../../packages/shared/src/constants/mktg-document-store.constants';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { expect } from '@playwright/test';
import { kitTest as test, kitDocuments, KIT_PROJECT, openKit, setupKit } from './helpers/mktg-kit.helper';

for (const entry of [
  { name: 'Kit', suffix: '', row: 'mktg-kit-asset-messaging-framework' },
  { name: 'Family', suffix: '/families/positioning-brand', row: 'mktg-family-asset-messaging-framework' },
]) {
  test(`${entry.name} re-reads on return, bounds timer reads and keeps partial progress in the same row`, async ({ page }, info) => {
    await suppressCookieBanner(page);
    const listing = kitDocuments(false);
    let reads = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === MKTG_DOCUMENTS_API_PATH) reads++;
    });
    await setupKit(page, { listing });
    await openKit(page, entry.suffix);
    const row = page.getByTestId(entry.row);
    await expect(row).toContainText('Not run yet');
    const mounted = await row.elementHandle();
    const before = reads;
    listing.runs = [
      {
        project: KIT_PROJECT.uid,
        agentKey: 'foundation-message',
        documentId: 'living',
        runId: 'b'.repeat(64),
        state: 'writing',
        startedAt: new Date().toISOString(),
      },
    ];
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(row).toContainText('Writing');
    expect(reads).toBeGreaterThan(before);
    listing.progressUnavailable = true;
    listing.runs = [];
    const timed = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === MKTG_DOCUMENTS_API_PATH && url.searchParams.get('poll') === '1';
    });
    await timed;
    await expect(row).toContainText('Writing');
    const returned = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === MKTG_DOCUMENTS_API_PATH && !url.searchParams.has('poll');
    });
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await returned;
    await expect(row).toContainText('Writing');
    listing.progressUnavailable = false;
    const complete = page.waitForResponse((response) => new URL(response.url()).pathname === MKTG_DOCUMENTS_API_PATH);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await complete;
    await expect(row).toContainText('Not run yet');
    expect(await mounted?.evaluate((node) => node.isConnected)).toBe(true);
    await expect(row).toBeVisible();
    await page.screenshot({ path: info.outputPath('confirmed-row.png'), fullPage: true });
  });
}
