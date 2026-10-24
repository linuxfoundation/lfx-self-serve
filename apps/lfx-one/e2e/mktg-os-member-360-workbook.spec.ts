// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { MEMBER_360_WORKBOOK_CONTENT_TYPE } from '@lfx-one/shared/constants';
import { MEMBER_360_PROJECT } from './fixtures/mock-data/member-360.mock';
import { MEMBER_360_DOCUMENT_ID, openMember360, setupMember360 } from './helpers/member-360.helper';

// setupMember360 calls suppressCookieBanner(page), pins the feature override and stubs every API.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ timeout: 60000 });

test('document header Download fetches its stored workbook and saves the filename', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const header = page.getByTestId('mktg-document-view-header');
  const action = header.getByTestId('member-360-download').getByRole('button');
  await expect(action).toHaveText('Download Member360_sample-foundation_2026-Q3.xlsx');
  await expect(page.getByTestId('member-360-download')).toHaveCount(1);
  const request = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith(`/member-360/documents/${MEMBER_360_DOCUMENT_ID}/workbook`));
  const download = page.waitForEvent('download');
  await action.click();
  const fetched = await request;
  expect(fetched.method()).toBe('GET');
  expect(new URL(fetched.url()).searchParams.get('project')).toBe(MEMBER_360_PROJECT.uid);
  expect((await download).suggestedFilename()).toBe('Member360_sample-foundation_2026-Q3.xlsx');
  await expect(action).toBeEnabled();
  await page.screenshot({ path: info.outputPath('workbook-document-header.png'), fullPage: true });
});

test('slow workbook preparation disables the action until the response arrives', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requests = 0;
  await page.route('**/api/mktg-agents/member-360/documents/*/workbook?*', async (route) => {
    requests++;
    await pending;
    await route.fulfill({ contentType: MEMBER_360_WORKBOOK_CONTENT_TYPE, body: Buffer.from('synthetic workbook') });
  });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const host = page.getByTestId('member-360-download');
  const action = host.getByRole('button');
  await action.click();
  await expect(host).toHaveAttribute('data-loading', 'true');
  await expect(action).toBeDisabled();
  await action.click({ force: true });
  await expect.poll(() => requests).toBe(1);
  await page.screenshot({ path: info.outputPath('workbook-preparing.png'), fullPage: true });
  const download = page.waitForEvent('download');
  release?.();
  await download;
  await expect(action).toBeEnabled();
  await expect(host).toHaveAttribute('data-loading', 'false');
  await page.screenshot({ path: info.outputPath('workbook-prepared.png'), fullPage: true });
});

test('workbook failure shows the existing notice and a successful retry clears it', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  let fail = true;
  await page.route('**/api/mktg-agents/member-360/documents/*/workbook?*', (route) =>
    route.fulfill({
      status: fail ? 503 : 200,
      contentType: MEMBER_360_WORKBOOK_CONTENT_TYPE,
      body: Buffer.from(fail ? 'unavailable' : 'synthetic workbook'),
    })
  );
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const action = page.getByTestId('member-360-download').getByRole('button');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (_text: string) => undefined } }));
  await page.getByRole('button', { name: 'Copy Member Success list' }).click();
  await expect(page.getByTestId('member-360-notice')).toContainText('Member Success list copied.');
  await action.click();
  await expect(page.getByTestId('mktg-document-view-workbook-error')).toContainText('The workbook could not be prepared. Try downloading again.');
  await expect(page.getByTestId('member-360-notice')).toContainText('Member Success list copied.');
  await expect(action).toBeEnabled();
  await page.screenshot({ path: info.outputPath('workbook-failure.png'), fullPage: true });
  fail = false;
  const download = page.waitForEvent('download');
  await action.click();
  await download;
  await expect(page.getByTestId('mktg-document-view-workbook-error')).toHaveCount(0);
  await expect(page.getByTestId('member-360-notice')).toContainText('Member Success list copied.');
  await page.screenshot({ path: info.outputPath('workbook-retry-ready.png'), fullPage: true });
});

test('a missing stored run has an explicit message and no workbook action', async ({ page }, info) => {
  await setupMember360(page, { stored: true });
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'MKTG_DOCUMENT_NOT_FOUND' }),
    })
  );
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('mktg-document-view-error')).toContainText('This document could not be found.');
  await expect(page.getByTestId('member-360-download')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('workbook-missing-run.png'), fullPage: true });
});

test('a non-writer sees the document access message and cannot request a workbook', async ({ page }, info) => {
  await setupMember360(page, { writer: false, stored: true });
  let requests = 0;
  await page.route('**/api/mktg-agents/member-360/documents/*/workbook?*', (route) => {
    requests++;
    return route.fulfill({ status: 403, body: '{}' });
  });
  await page.route(`**/api/mktg-agents/documents/member-360/${MEMBER_360_DOCUMENT_ID}**`, (route) => route.fulfill({ status: 403, body: '{}' }));
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  await expect(page.getByTestId('mktg-document-view-error')).toContainText('You need write access');
  await expect(page.getByTestId('member-360-download')).toHaveCount(0);
  expect(requests).toBe(0);
  await page.screenshot({ path: info.outputPath('workbook-no-access.png'), fullPage: true });
});

test('at 390px the filename-labelled header action wraps without page overflow and stays usable', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await setupMember360(page, { stored: true });
  await openMember360(page, `documents/member-360/${MEMBER_360_DOCUMENT_ID}`);
  const header = page.getByTestId('mktg-document-view-header');
  const action = header.getByTestId('member-360-download').getByRole('button');
  await expect(action).toBeVisible();
  expect(await action.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const title = page.getByTestId('mktg-document-view-title');
  const titleBox = await title.boundingBox();
  const actionBox = await action.boundingBox();
  expect(titleBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  if (titleBox && actionBox) expect(actionBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
  const download = page.waitForEvent('download');
  await action.click();
  await download;
  await expect(action).toBeEnabled();
  await page.screenshot({ path: info.outputPath('workbook-header-mobile.png'), fullPage: true });
});
