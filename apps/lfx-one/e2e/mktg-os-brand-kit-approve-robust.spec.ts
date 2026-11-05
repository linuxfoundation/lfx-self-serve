// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Structural contract of the Brand Kit approve dialog's findings groups, conflict and rule sections and of the overview's basis pills: the
// test ids, the dialog fitting the viewport without sideways scroll at laptop, tablet and phone widths, and a v1 report
// showing none of it. Every read and write is stubbed with synthetic data.

import { expect, test } from '@playwright/test';
import { brandKitReportV2RulesFixture } from '@lfx-one/shared/utils/__fixtures__/brand-kit-report-v2-rules.fixture';
import { brandKitTestRevision } from '@lfx-one/shared/utils/__fixtures__/brand-kit-revision.fixture';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { brandKitDraftRevisionResponse, openAssetDocument } from './helpers/mktg-os-asset-views.helper';

const CHAPTERS = ['logo', 'color', 'type', 'visual', 'usage', 'voice'] as const;

test.beforeEach(async ({ page }) => suppressCookieBanner(page));

for (const width of [1440, 1024, 390]) {
  test(`the approve dialog carries its conflict and rule test ids and fits the viewport without sideways scroll (${width}px)`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    // Found by its test id, not its header: the words are the content spec's.
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('mktg-document-view-approve-confirm') });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-failed')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-failed-item')).toHaveCount(2);
    await expect(dialog.getByTestId('mktg-document-view-approve-missing')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-missing-item')).toHaveCount(4);
    await expect(dialog.getByTestId('mktg-document-view-approve-conflicts')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-conflict')).toHaveCount(1);
    await expect(dialog.getByTestId('mktg-document-view-approve-rules')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-rule')).toHaveCount(6);
    await expect(dialog.getByTestId('mktg-document-view-approve-cancel')).toBeVisible();
    await expect(dialog.getByTestId('mktg-document-view-approve-anyway')).toBeVisible();
    // The dialog, and everything in it, stays inside the viewport: no sideways scroll of the page or of the dialog.
    const box = await dialog.boundingBox();
    if (!box) throw new Error('The approve dialog must be rendered');
    const diagnostic = `viewport ${width}px, dialog ${JSON.stringify(box)}`;
    expect(box.x, diagnostic).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, diagnostic).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)), diagnostic).toBeLessThanOrEqual(width);
    const overflow = await dialog.getByTestId('mktg-document-view-approve-confirm').evaluate((element) => {
      const right = element.getBoundingClientRect().right;
      return Array.from(element.querySelectorAll<HTMLElement>('*'))
        .filter((child) => child.getBoundingClientRect().right > right + 1)
        .map((child) => `${child.tagName.toLowerCase()}[${child.getAttribute('data-testid') ?? ''}]`);
    });
    expect(overflow, diagnostic).toEqual([]);
    await page.screenshot({ path: info.outputPath(`approve-dialog-${width}.png`), fullPage: true });
    await dialog.getByTestId('mktg-document-view-approve-cancel').getByRole('button').click();
    await expect(dialog).toBeHidden();
  });
}

test.describe('at a laptop width', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test('every chapter card of the overview carries its basis pill test id when the report has rules', async ({ page }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const chapters = page.getByTestId('brand-kit-web-view-chapters');
    for (const id of CHAPTERS) {
      const card = chapters.getByTestId(`brand-kit-web-view-chapter-${id}`);
      await expect(card).toBeVisible();
      await expect(card.getByTestId(`brand-kit-web-view-chapter-basis-${id}`)).toBeVisible();
      await expect(card.getByTestId(`brand-kit-web-view-chapter-basis-${id}`)).not.toHaveText('');
    }
    await page.screenshot({ path: info.outputPath('overview-basis-pills.png'), fullPage: true });
  });

  test('a v1 report shows no basis pill and an approve dialog with only today’s list', async ({ page }, info) => {
    const report = { ...brandKitTestRevision().report, sources_failed: [{ name: 'https://synthetic-foundation.example/brand', reason: 'HTTP 404' }] };
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(report));
    await expect(page.getByTestId('brand-kit-web-view-chapters')).toBeVisible();
    await expect(page.locator('[data-testid^="brand-kit-web-view-chapter-basis-"]')).toHaveCount(0);
    await page.getByTestId('mktg-document-view-approve').getByRole('button').click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByTestId('mktg-document-view-approve-confirm') });
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm')).toBeVisible();
    // Today's list is there (one failed source); none of the v2 sections are.
    await expect(dialog.getByTestId('mktg-document-view-approve-confirm').locator(':scope > ul > li')).toHaveCount(1);
    await expect(dialog.getByTestId('mktg-document-view-approve-failed')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-missing')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-conflicts')).toHaveCount(0);
    await expect(dialog.getByTestId('mktg-document-view-approve-rules')).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('approve-dialog-v1.png'), fullPage: true });
  });
});

test.describe('at a phone width', () => {
  test.use({ viewport: { width: 390, height: 1000 } });

  test('each chapter card keeps its title and number on one line, the basis pill under them, and nothing scrolls sideways', async ({ page }, info) => {
    await openAssetDocument(page, 'brand-kit', 200, true, false, brandKitDraftRevisionResponse(brandKitReportV2RulesFixture()));
    const chapters = page.getByTestId('brand-kit-web-view-chapters');
    for (const id of CHAPTERS) {
      const card = chapters.getByTestId(`brand-kit-web-view-chapter-${id}`);
      const pill = card.getByTestId(`brand-kit-web-view-chapter-basis-${id}`);
      await expect(pill).toBeVisible();
      const [title, number, badge] = await Promise.all([card.locator('h4').boundingBox(), card.locator('h4 + span').boundingBox(), pill.boundingBox()]);
      if (!title || !number || !badge) throw new Error(`The ${id} card must render its title, number and pill`);
      const diagnostic = `${id}: title ${JSON.stringify(title)}, number ${JSON.stringify(number)}, pill ${JSON.stringify(badge)}`;
      // One header line: the title is a single line of text-base and the (smaller, baseline-aligned) number sits inside its line box.
      expect(title.height, diagnostic).toBeLessThanOrEqual(30);
      expect(number.y, diagnostic).toBeGreaterThanOrEqual(title.y - 1);
      expect(number.y + number.height, diagnostic).toBeLessThanOrEqual(title.y + title.height + 1);
      // The pill is on its own row under the header.
      expect(badge.y, diagnostic).toBeGreaterThanOrEqual(title.y + title.height - 1);
      const widths = await card.evaluate((element) => [element.scrollWidth, element.clientWidth]);
      expect(widths[0], `${id}: scrollWidth ${widths[0]} vs clientWidth ${widths[1]}`).toBe(widths[1]);
    }
    await page.screenshot({ path: info.outputPath('overview-chapters-390.png'), fullPage: true });
  });
});
