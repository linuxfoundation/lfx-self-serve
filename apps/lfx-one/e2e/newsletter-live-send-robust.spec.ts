// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Live Send → Analytics — Structural Tests — LFXV2-2389.
 *
 * Companion to `newsletter-live-send.spec.ts`. Asserts the `data-testid`
 * contract the send-and-analytics flow depends on, isolated from copy /
 * wording changes that the content spec exercises. Per
 * `docs/architecture/testing/e2e-testing.md`, every feature with E2E coverage
 * gets a content spec AND a structural (`-robust`) spec.
 *
 * This spec also runs against live services (no `page.route()` mocking) —
 * the send pipeline can't be meaningfully stubbed without re-implementing the
 * newsletter-service/committee-service/email-service contracts, so the
 * structural assertions below run inline in the same live flow rather than
 * against a fixture-seeded page load like the rest of the `-robust` specs in
 * this tree.
 *
 * Same environment prerequisites as `newsletter-live-send.spec.ts`:
 * TEST_USERNAME, TEST_PASSWORD, TEST_NEWSLETTER_PROJECT_SLUG (and optionally
 * TEST_NEWSLETTER_COMMITTEE_NAME).
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(120_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;
const SEND_ACK_TIMEOUT = 20_000;

const PROJECT_SLUG = process.env.TEST_NEWSLETTER_PROJECT_SLUG;
const COMMITTEE_NAME = process.env.TEST_NEWSLETTER_COMMITTEE_NAME;

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenPrereqsMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
  if (!PROJECT_SLUG) {
    test.skip(true, 'TEST_NEWSLETTER_PROJECT_SLUG not configured — this spec needs a real, seeded project to send against');
  }
}

const RUN_SUBJECT = `E2E Live Send Structural ${Date.now()}`;

async function gotoCreate(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/${PROJECT_SLUG}/newsletters/create?project=${PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('newsletter-manage')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

test.describe('Newsletter Live Send — Structural Tests', () => {
  test.beforeEach(() => {
    skipWhenPrereqsMissing();
  });

  test.describe('Create wizard — stepper testid contract', () => {
    test('audience, content, and send steps expose their root testids in order', async ({ page }) => {
      await gotoCreate(page);

      await expect(page.getByTestId('newsletter-manage-stepper')).toBeAttached();
      await expect(page.getByTestId('newsletter-manage-step-1')).toBeAttached();
      await expect(page.getByTestId('newsletter-manage-step-2')).toBeAttached();
      await expect(page.getByTestId('newsletter-manage-step-3')).toBeAttached();
      await expect(page.getByTestId('newsletter-audience-step')).toBeAttached();
      await expect(page.getByTestId('newsletter-audience-committees')).toBeAttached();
    });

    test('the audience step gates Next until a committee is selected', async ({ page }) => {
      await gotoCreate(page);

      const nextButton = page.getByTestId('newsletter-manage-next-btn');
      await expect(nextButton).toBeAttached();
      await expect(nextButton).toBeDisabled();

      const committeeSelect = page.getByTestId('newsletter-audience-committees');
      await committeeSelect.click();
      const option = COMMITTEE_NAME ? page.getByRole('option', { name: COMMITTEE_NAME }) : page.getByRole('option').first();
      await option.click();

      await expect(page.getByTestId('newsletter-audience-recipient-pill')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
      await expect(nextButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    });
  });

  test.describe('Send step — action testid contract', () => {
    test('send step exposes send-test and send-now actions and a confirm dialog mount point', async ({ page }) => {
      await gotoCreate(page);

      const committeeSelect = page.getByTestId('newsletter-audience-committees');
      await committeeSelect.click();
      const option = COMMITTEE_NAME ? page.getByRole('option', { name: COMMITTEE_NAME }) : page.getByRole('option').first();
      await option.click();
      await expect(page.getByTestId('newsletter-audience-recipient-pill')).toBeAttached({ timeout: ELEMENT_TIMEOUT });

      await page.getByTestId('newsletter-manage-next-btn').click();
      await expect(page.getByTestId('newsletter-content-step')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await page.getByTestId('newsletter-content-subject').locator('input').fill(RUN_SUBJECT);
      await page.getByTestId('newsletter-content-body').locator('.ql-editor').fill('Structural spec body content.');

      await page.getByTestId('newsletter-manage-next-btn').click();
      await expect(page.getByTestId('newsletter-send-step')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });

      await expect(page.getByTestId('newsletter-send-step-summary')).toBeAttached();
      await expect(page.getByTestId('newsletter-send-test-button')).toBeAttached();
      await expect(page.getByTestId('newsletter-send-now-button')).toBeAttached();

      // p-confirmDialog mount point lives on the parent manage component, keyed
      // 'newsletter-manage' — attached regardless of which step is showing.
      await expect(page.locator('p-confirmdialog')).toBeAttached();
    });
  });

  test.describe('Sent list + analytics — testid contract', () => {
    test('a sent newsletter row links into an analytics page exposing the recipients/opens testid contract', async ({ page }) => {
      await gotoCreate(page);

      const committeeSelect = page.getByTestId('newsletter-audience-committees');
      await committeeSelect.click();
      const option = COMMITTEE_NAME ? page.getByRole('option', { name: COMMITTEE_NAME }) : page.getByRole('option').first();
      await option.click();
      await expect(page.getByTestId('newsletter-audience-recipient-pill')).toBeAttached({ timeout: ELEMENT_TIMEOUT });

      await page.getByTestId('newsletter-manage-next-btn').click();
      await page.getByTestId('newsletter-content-subject').locator('input').fill(RUN_SUBJECT);
      await page.getByTestId('newsletter-content-body').locator('.ql-editor').fill('Structural spec body content.');

      await page.getByTestId('newsletter-manage-next-btn').click();
      await expect(page.getByTestId('newsletter-send-step')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });

      const sendNowButton = page.getByTestId('newsletter-send-now-button');
      await expect(sendNowButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
      await sendNowButton.click();

      const confirmDialog = page.locator('.p-confirmdialog');
      await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await confirmDialog.getByRole('button', { name: /send now/i }).click();

      await expect(page).toHaveURL(/\/newsletters\/list\?.*tab=sent/, { timeout: SEND_ACK_TIMEOUT });
      await expect(page.getByTestId('newsletter-list-table')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });

      const row = page.locator('[data-testid^="newsletter-row-"]').filter({ hasText: RUN_SUBJECT });
      await expect(row).toBeAttached({ timeout: ELEMENT_TIMEOUT });
      await row.click();

      await expect(page.getByTestId('newsletter-analytics')).toBeAttached({ timeout: PAGE_LOAD_TIMEOUT });
      await expect(page.getByTestId('newsletter-analytics-subject')).toBeAttached();
      await expect(page.getByTestId('newsletter-analytics-recipients')).toBeAttached();
      await expect(page.getByTestId('newsletter-analytics-unique-opens')).toBeAttached();
      await expect(page.getByTestId('newsletter-analytics-total-opens')).toBeAttached();
      await expect(page.getByTestId('newsletter-analytics-open-rate')).toBeAttached();
    });
  });
});
