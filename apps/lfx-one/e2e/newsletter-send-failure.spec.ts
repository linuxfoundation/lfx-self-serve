// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter Send Failure — LFXV2-2389.
 *
 * Covers the error path of the send pipeline that `newsletter-live-send.spec.ts`
 * deliberately doesn't exercise: the upstream `/send` call itself fails. Only
 * that one endpoint is mocked (`page.route()`, per the documented "Error-state
 * coverage via route mocking" pattern) — draft creation, the recipient-count
 * lookup, and the post-failure status refetch all hit the real backend, so
 * this spec also proves `handleSendError()` in
 * `newsletter-manage.component.ts` correctly branches back to "still a draft"
 * against a live re-fetch rather than a second mock.
 *
 * `handleSendError()` refetches the newsletter after a failed send and
 * branches on its real status before deciding whether to show "Send failed" —
 * this exists specifically to avoid the duplicate-send regression from
 * LFXV2-2604. Since only the `/send` call is mocked, that refetch hits the
 * real, unmodified backend and reports the newsletter is still a draft, which
 * is what drives the "Send failed" toast and kept-on-page assertions below.
 *
 * Same environment prerequisites as the live-send specs:
 * TEST_USERNAME, TEST_PASSWORD, TEST_NEWSLETTER_PROJECT_SLUG (and optionally
 * TEST_NEWSLETTER_COMMITTEE_NAME).
 */

import { expect, Page, test } from '@playwright/test';

test.setTimeout(60_000);

const PAGE_LOAD_TIMEOUT = 20_000;
const ELEMENT_TIMEOUT = 10_000;
const TOAST_TIMEOUT = 15_000;

const PROJECT_SLUG = process.env.TEST_NEWSLETTER_PROJECT_SLUG;
const COMMITTEE_NAME = process.env.TEST_NEWSLETTER_COMMITTEE_NAME;

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenPrereqsMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
  if (!PROJECT_SLUG) {
    test.skip(true, 'TEST_NEWSLETTER_PROJECT_SLUG not configured — this spec needs a real, seeded project to create a draft against');
  }
}

const RUN_SUBJECT = `E2E Send Failure ${Date.now()}`;

// Matches POST /api/projects/:projectUid/newsletters/:newsletterUid/send only —
// not the GET on the same newsletter resource (the refetch handleSendError()
// issues), and not the list/create/update endpoints under the same prefix.
const SEND_ENDPOINT_PATTERN = /\/api\/projects\/[^/]+\/newsletters\/[^/]+\/send$/;

async function createDraftThroughSendStep(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(`/${PROJECT_SLUG}/newsletters/create?project=${PROJECT_SLUG}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('newsletter-manage')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  await expect(page.getByTestId('newsletter-audience-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  const committeeSelect = page.getByTestId('newsletter-audience-committees');
  await expect(committeeSelect).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await committeeSelect.click();
  const option = COMMITTEE_NAME ? page.getByRole('option', { name: COMMITTEE_NAME }) : page.getByRole('option').first();
  await expect(option).toBeVisible({ timeout: ELEMENT_TIMEOUT });
  await option.click();
  await expect(page.getByTestId('newsletter-audience-recipient-pill')).toBeVisible({ timeout: ELEMENT_TIMEOUT });

  await page.getByTestId('newsletter-manage-next-btn').click();
  await expect(page.getByTestId('newsletter-content-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  await page.getByTestId('newsletter-content-subject').locator('input').fill(RUN_SUBJECT);
  await page.getByTestId('newsletter-content-body').locator('.ql-editor').fill('This draft is used to exercise the send-failure path.');

  await page.getByTestId('newsletter-manage-next-btn').click();
  await expect(page.getByTestId('newsletter-send-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

  // The draft is created (and its id becomes part of the URL) as a side effect
  // of leaving step 1/2 via autosave/next — wait for that to land so the id
  // segment is present before /send is invoked, matching real usage.
  await expect(page).toHaveURL(/\/newsletters\/[^/]+\/[^/]+(\?|$)/, { timeout: ELEMENT_TIMEOUT });
}

test.describe('Newsletter Send Failure', () => {
  test.beforeEach(async ({ page }) => {
    skipWhenPrereqsMissing();
    await page.route(SEND_ENDPOINT_PATTERN, (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Simulated send failure' }) }));
  });

  test('shows a Send failed toast and leaves the draft unsent when /send fails', async ({ page }) => {
    const draftUrl = await test.step('create a draft through the Send step', async () => {
      await createDraftThroughSendStep(page);
      return page.url();
    });

    const sendNowButton = page.getByTestId('newsletter-send-now-button');
    await expect(sendNowButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    await sendNowButton.click();

    const confirmDialog = page.locator('.p-confirmdialog');
    await expect(confirmDialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await confirmDialog.getByRole('button', { name: /send now/i }).click();

    // handleSendError() refetches the real (unmocked) newsletter, sees it's
    // still a draft, and shows this exact toast. The success-path toast text
    // ("sending newsletter" / "newsletter sent") must NOT appear.
    const toast = page.locator('.p-toast');
    await expect(toast).toContainText('Send failed', { timeout: TOAST_TIMEOUT });
    await expect(toast).not.toContainText(/sending newsletter|newsletter sent/i);

    // Draft stays on the manage/send-step page — no redirect to the Sent tab.
    await expect(page).not.toHaveURL(/\/newsletters\/list\?.*tab=sent/);
    await expect(page).toHaveURL(draftUrl);
    await expect(page.getByTestId('newsletter-send-step')).toBeVisible();

    // Re-affirm the send button is still present and enabled — a real retry
    // is possible, not just a dead-end error state.
    await expect(sendNowButton).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
  });

  test('Save as Draft still succeeds while /send is mocked — proves only /send was intercepted', async ({ page }) => {
    await createDraftThroughSendStep(page);

    await page.getByTestId('newsletter-manage-previous-btn').click();
    await expect(page.getByTestId('newsletter-content-step')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    const updatedSubject = `${RUN_SUBJECT} (edited)`;
    await page.getByTestId('newsletter-content-subject').locator('input').fill(updatedSubject);

    await page.getByTestId('newsletter-manage-draft-btn').click();

    // This PUT goes to the real backend (unmocked) — a successful "Draft
    // saved" toast confirms the /send interception in this spec is scoped to
    // that one endpoint and isn't silently swallowing other newsletter calls.
    await expect(page.locator('.p-toast')).toContainText('Draft saved', { timeout: TOAST_TIMEOUT });
  });
});
