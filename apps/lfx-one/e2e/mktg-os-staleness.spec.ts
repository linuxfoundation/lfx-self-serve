// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, test } from '@playwright/test';
import { suppressCookieBanner } from './helpers/account-settings-email.helper';
import { openStaleness, setupStaleness, STALENESS_ASSET_URL, STALENESS_FAMILY_URL, STALENESS_KIT_URL, upstreamRef } from './helpers/mktg-os-staleness.helper';

test.describe('Marketing OS current-revision staleness and rebuild', () => {
  test.use({ viewport: { width: 1440, height: 1000 } });
  test.setTimeout(60_000);
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
  });
  test.afterEach(async ({ page }, info) => {
    await page.screenshot({ path: info.outputPath('final-state.png'), fullPage: true });
  });

  test('shows matching Family and Kit states, without marking missing assets or one-off runs', async ({ page }) => {
    await setupStaleness(page);
    await openStaleness(page);
    await expect(page.getByTestId('mktg-family-state-boilerplates')).toContainText('Needs rebuild');
    await expect(page.getByTestId('mktg-family-state-faq')).toContainText('Needs rebuild');
    await expect(page.getByTestId('mktg-family-state-brand-kit')).toContainText('Not run yet');
    await expect(page.getByTestId('mktg-family-rebuild').getByRole('button')).toBeEnabled();
    await openStaleness(page, STALENESS_KIT_URL);
    await expect(page.getByTestId('mktg-kit-asset-boilerplates')).toContainText('Needs rebuild');
    await expect(page.getByTestId('mktg-kit-family-availability-positioning-brand')).toContainText('Core');
    await expect(page.getByTestId('mktg-kit-family-needs-rebuild-positioning-brand')).toContainText('Needs rebuild');
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).not.toContainText('Needs rebuild');
    await expect(page.getByTestId('mktg-kit-asset-linkedin-post')).toContainText('this month');
  });

  test('one Downstream action runs in order, asks in place, then opens the exact new Draft', async ({ page }) => {
    const calls = await setupStaleness(page, { questions: true });
    await openStaleness(page, STALENESS_ASSET_URL);
    await expect(page.getByTestId('mktg-downstream-copy')).toHaveText('Boilerplates and FAQ were built from v1. Rebuild them from v3?');
    await page.getByTestId('mktg-downstream-rebuild').getByRole('button').click();
    await expect(page.getByTestId('mktg-rebuild-progress')).toBeVisible();
    await expect(page.getByTestId('mktg-run-questions-send')).toBeVisible({ timeout: 15_000 });
    expect(calls.starts).toEqual(['boilerplates']);
    await expect(page).toHaveURL(/\/families\/positioning-brand/);
    await expect(page).not.toHaveURL(/[?&]rebuild=/);
    await page.getByTestId('mktg-run-questions-send').getByRole('button').click();
    await expect(page.getByTestId('mktg-rebuild-status')).toContainText('ready for review', { timeout: 25_000 });
    expect(calls.starts).toEqual(['boilerplates', 'faq']);
    expect(calls.answers).toHaveLength(1);
    expect(calls.answers[0]).toMatchObject({ chainId: '12345678-1234-4123-8123-123456789abc', questionsId: 'synthetic-q1', stepIndex: 0 });
    // PC4: new Drafts do not silently clear the current approved asset's stale state.
    await expect(page.getByTestId('mktg-family-state-boilerplates')).toContainText('Needs rebuild');
    await page.getByTestId('mktg-rebuild-open-boilerplates').getByRole('button').click();
    await expect(page).toHaveURL(new RegExp(`revision=${upstreamRef(2).revisionId}`));
    await expect(page.getByTestId('mktg-document-view-document')).toContainText('Synthetic rebuilt draft');
  });

  test('a pasted URL never starts a rebuild write', async ({ page }) => {
    const calls = await setupStaleness(page);
    await openStaleness(page, STALENESS_FAMILY_URL + '&rebuild=' + upstreamRef(3).revisionId);
    await expect(page.getByTestId('mktg-family-rebuild').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mktg-rebuild-progress')).toHaveCount(0);
    expect(calls.starts).toEqual([]);
  });

  test('stops a failed step while leaving earlier Drafts available for review', async ({ page }) => {
    const calls = await setupStaleness(page, { failSecond: true });
    await openStaleness(page);
    await page.getByTestId('mktg-family-rebuild').getByRole('button').click();
    await expect(page.getByTestId('mktg-rebuild-status')).toContainText('Rebuild stopped', { timeout: 20_000 });
    await expect(page.getByTestId('mktg-rebuild-open-boilerplates')).toBeVisible();
    await expect(page.getByTestId('mktg-rebuild-step-faq')).toContainText('Synthetic source unavailable');
    expect(calls.starts).toEqual(['boilerplates', 'faq']);
  });

  test('empty and unknown historical provenance never offer a false rebuild', async ({ page }) => {
    await setupStaleness(page, { empty: true });
    await openStaleness(page);
    await expect(page.getByTestId('mktg-family-state-messaging-framework')).toContainText('Not run yet');
    // Rebuild is offered only when something is stale.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
  });
  test('unknown provenance has no Downstream warning', async ({ page }) => {
    await setupStaleness(page, { unknown: true });
    await openStaleness(page, STALENESS_ASSET_URL);
    await expect(page.getByTestId('mktg-document-view-revisions')).toBeVisible();
    await expect(page.getByTestId('mktg-downstream-card')).toHaveCount(0);
  });
  test('matching input identity keeps approved assets out of the stale set', async ({ page }) => {
    await setupStaleness(page, { stale: false });
    await openStaleness(page);
    await expect(page.getByTestId('mktg-family-state-boilerplates')).toContainText('Approved');
    // Rebuild is offered only when something is stale.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
  });
  test('shows listing errors separately from Missing and offers retry', async ({ page }) => {
    await setupStaleness(page, { listError: true });
    await openStaleness(page);
    await expect(page.getByTestId('mktg-family-error')).toContainText('could not be loaded');
    await expect(page.getByTestId('mktg-family-error-retry')).toBeVisible();
    await expect(page.getByTestId('mktg-family-assets')).toHaveCount(0);
    // Rebuild is offered only when something is stale.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
  });
  test('requires write access without calling any rebuild endpoint', async ({ page }) => {
    const calls = await setupStaleness(page, { writer: false });
    await openStaleness(page);
    await expect(page.getByTestId('mktg-family-error')).toContainText('write access');
    // Rebuild is offered only when something is stale.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    expect(calls.starts).toEqual([]);
  });
  test('has a real loading state before the listing arrives', async ({ page }) => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await setupStaleness(page, { holdListing: held });
    await openStaleness(page, STALENESS_FAMILY_URL);
    await expect(page.getByTestId('mktg-family-loading')).toBeVisible();
    // Rebuild is offered only when something is stale.
    await expect(page.getByTestId('mktg-family-rebuild')).toHaveCount(0);
    release();
    await expect(page.getByTestId('mktg-family-state-faq')).toContainText('Needs rebuild');
  });
});
