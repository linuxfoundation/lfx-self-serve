// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Live Send → Analytics — LFXV2-2389.
 *
 * End-to-end coverage of the real send-to-committee-to-analytics pipeline, with
 * NO `page.route()` mocking. Every request in this spec hits the real newsletter
 * BFF proxy, the real newsletter-service, and (once a send is accepted) the real
 * email provider fan-out. This is deliberately different from the rest of the
 * `e2e/` tree, which stubs the backend for determinism — this spec exists
 * specifically to prove the send → deliver → analytics contract holds against
 * live services, matching the newsletter-service, committee-service, and
 * email-service contracts documented in their respective repos.
 *
 * Environment prerequisites (this spec skips itself, loudly, when unmet):
 *   - TEST_USERNAME / TEST_PASSWORD — real Auth0 credentials (see global-setup.ts).
 *   - TEST_NEWSLETTER_PROJECT_SLUG — slug of a real, seeded project/foundation
 *     with a writer-accessible "Newsletter" category committee that has at
 *     least one member with a deliverable mailbox (e.g. Mailpit locally, or a
 *     real inbox in a shared environment).
 *   - TEST_NEWSLETTER_COMMITTEE_NAME (optional) — exact committee name to pick
 *     from the audience group selector. Falls back to the first available
 *     "Newsletter" category committee for the project when unset.
 *
 * Scope note: this spec asserts on DELIVERED counts only (`delivered`,
 * `total_recipients`), not on open-tracking counts (`unique_opens`,
 * `total_opens`). Open tracking depends on a recipient's mail client actually
 * fetching the tracking pixel, which no automated flow can trigger
 * deterministically. See the spec's "Environment prerequisite" note.
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(120_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;
const SEND_ACK_TIMEOUT = 20_000;
const ANALYTICS_POLL_TIMEOUT = 60_000;
const ANALYTICS_POLL_INTERVAL = 3_000;

const PROJECT_SLUG = process.env.TEST_NEWSLETTER_PROJECT_SLUG;
const COMMITTEE_NAME = process.env.TEST_NEWSLETTER_COMMITTEE_NAME;

// Gated on env vars, not on URL sniffing, so a genuine auth-flow regression
// (expired storageState, broken Auth0 login helper) still fails loudly when
// creds ARE configured. See newsletter-reopen-review.spec.ts for the same pattern.
const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenPrereqsMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
  if (!PROJECT_SLUG) {
    test.skip(true, 'TEST_NEWSLETTER_PROJECT_SLUG not configured — this spec needs a real, seeded project to send against');
  }
}

// Unique per run so the sent-list lookup can't match a newsletter left over
// from a previous (possibly failed) run of this same spec.
const RUN_SUBJECT = `E2E Live Send ${Date.now()}`;

async function gotoCreate(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/${PROJECT_SLUG}/newsletters/create?project=${PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('newsletter-manage')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function selectAudienceCommittee(page: Page): Promise<void> {
  await expect(page.getByTestId('newsletter-manage-step-1')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('newsletter-audience-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  const committeeSelect = page.getByTestId('newsletter-audience-committees');
  await expect(committeeSelect).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await committeeSelect.click();

  const option = COMMITTEE_NAME ? page.getByRole('option', { name: COMMITTEE_NAME }) : page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await option.click();

  // Recipient count resolves async (real backend call to committee-service via
  // the newsletter BFF) — wait for it to settle before moving on so "Next" is enabled.
  await expect(page.getByTestId('newsletter-audience-recipient-pill')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
}

async function fillContent(page: Page): Promise<void> {
  await page.getByTestId('newsletter-manage-next-btn').click();
  await expect(page.getByTestId('newsletter-manage-step-2')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await expect(page.getByTestId('newsletter-content-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await page.getByTestId('newsletter-content-subject').locator('input').fill(RUN_SUBJECT);
  await page.getByTestId('newsletter-content-body').locator('.ql-editor').fill('This newsletter was sent by an automated end-to-end test against live services.');
}

async function goToSendStepAndSend(page: Page): Promise<void> {
  await page.getByTestId('newsletter-manage-next-btn').click();
  await expect(page.getByTestId('newsletter-manage-step-3')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await expect(page.getByTestId('newsletter-send-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  const sendNowButton = page.getByTestId('newsletter-send-now-button');
  await expect(sendNowButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
  await sendNowButton.click();

  const confirmDialog = page.locator('.p-confirmdialog');
  await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await confirmDialog.getByRole('button', { name: /send now/i }).click();

  // The component deliberately has no in-app "sending" progress indicator — an
  // accepted send (202 sending, or a fast-settled sent) always redirects to the
  // Sent tab of the list. That redirect, plus the acknowledgement toast, IS the
  // send-accepted signal this spec asserts on.
  await expect(page.locator('.p-toast')).toContainText(/sending newsletter|newsletter sent/i, { timeout: SEND_ACK_TIMEOUT });
  await expect(page).toHaveURL(/\/newsletters\/list\?.*tab=sent/, { timeout: SEND_ACK_TIMEOUT });
}

async function openSentAnalytics(page: Page): Promise<void> {
  await expect(page.getByTestId('newsletter-list-table')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  const row = page.locator('[data-testid^="newsletter-row-"]').filter({ hasText: RUN_SUBJECT });
  await expect(row).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await row.click();

  await expect(page).toHaveURL(/\/newsletters\/[^/]+\/[^/]+\/analytics/, { timeout: PAGE_LOAD_TIMEOUT });
  await expect(page.getByTestId('newsletter-analytics')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

async function waitForDeliveryConfirmedAnalytics(page: Page): Promise<{ totalRecipients: number; delivered: number }> {
  const deadline = Date.now() + ANALYTICS_POLL_TIMEOUT;
  let totalRecipients = 0;
  let delivered = 0;

  while (Date.now() < deadline) {
    const recipientsText = await page.getByTestId('newsletter-analytics-recipients').innerText();
    totalRecipients = Number(recipientsText.trim());

    if (totalRecipients > 0) {
      const summaryText = await page.getByTestId('newsletter-analytics-recipients').locator('..').innerText();
      const deliveredMatch = summaryText.match(/(\d+)\s+delivered/i);
      delivered = deliveredMatch ? Number(deliveredMatch[1]) : 0;
      if (delivered > 0) {
        return { totalRecipients, delivered };
      }
    }

    await page.waitForTimeout(ANALYTICS_POLL_INTERVAL);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('newsletter-analytics')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  }

  return { totalRecipients, delivered };
}

test.describe.serial('Newsletter live send → analytics (live services)', () => {
  test.beforeEach(() => {
    skipWhenPrereqsMissing();
  });

  test('creates a draft, sends it to a real committee, and lands on the Sent list', async ({ page }) => {
    await gotoCreate(page);
    await selectAudienceCommittee(page);
    await fillContent(page);
    await goToSendStepAndSend(page);
  });

  test('analytics reflects delivery-confirmed recipients once the send settles', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);
    await page.goto(`/${PROJECT_SLUG}/newsletters/list?project=${PROJECT_SLUG}&tab=sent`, { waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(/auth0\.com/);

    await openSentAnalytics(page);

    const { totalRecipients, delivered } = await waitForDeliveryConfirmedAnalytics(page);

    expect(totalRecipients, 'the sent newsletter should have at least one resolved recipient').toBeGreaterThan(0);
    expect(delivered, 'at least one recipient should show as delivered once the async send settles').toBeGreaterThan(0);
    expect(delivered).toBeLessThanOrEqual(totalRecipients);
  });
});
