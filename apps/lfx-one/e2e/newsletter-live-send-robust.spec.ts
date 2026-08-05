// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Structural companion to `newsletter-live-send.spec.ts` — see that file's
 * header for the rationale behind the live-service exception to this suite's
 * `page.route()`-mocked convention.
 *
 * This spec asserts the `data-testid` contract holds up through a real
 * compose → send → analytics run: presence, nesting, and stable identifiers
 * across the step transitions — not copy or business-rule outcomes (that's
 * the content-based spec's job).
 */

import { expect, Page, test } from '@playwright/test';
import { getLiveEnv, skipWhenLiveEnvMissing } from './helpers/live-env.helper';

test.setTimeout(120_000);

const ELEMENT_TIMEOUT = 10_000;
const SEND_SETTLE_TIMEOUT = 30_000;

const AUTH_CREDS_PRESENT = !!process.env.TEST_USERNAME && !!process.env.TEST_PASSWORD;

function skipWhenAuthMissing(): void {
  if (!AUTH_CREDS_PRESENT) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}

async function gotoAuthed(page: Page, path: string): Promise<void> {
  skipWhenAuthMissing();
  skipWhenLiveEnvMissing();
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Newsletter live send — structural contract', () => {
  test('stepper, step panels, and send controls keep their testid contract through a live run', async ({ page }) => {
    const env = getLiveEnv();
    const subject = `Live E2E Structural ${Date.now()}`;

    await gotoAuthed(page, `/foundation/newsletters/create?project=${env.projectSlug}`);

    const stepper = page.getByTestId('newsletter-manage-stepper');
    await expect(stepper).toBeAttached({ timeout: ELEMENT_TIMEOUT });

    // Audience step.
    const audienceStep = page.getByTestId('newsletter-audience-step');
    await expect(audienceStep).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    const committeePicker = page.getByTestId('newsletter-audience-committees');
    await expect(committeePicker).toBeAttached();

    await committeePicker.click();
    await page.getByRole('option', { name: env.committeeName, exact: true }).click();
    await page.getByTestId('newsletter-manage-next-btn').click();

    // Content step — the rich editor's wrapper and its nested tiptap content
    // node both carry the same testid by design (see rich-editor.component.ts);
    // assert both halves of that contract explicitly so a future refactor that
    // accidentally de-dupes it is caught either way.
    const contentStep = page.getByTestId('newsletter-content-step');
    await expect(contentStep).toBeAttached({ timeout: ELEMENT_TIMEOUT });

    const subjectField = page.getByTestId('newsletter-content-subject');
    await expect(subjectField).toBeAttached();
    await expect(subjectField.locator('input')).toBeAttached();

    const bodyField = page.getByTestId('newsletter-content-body');
    await expect(bodyField.first()).toBeAttached();
    const editorContent = page.locator('.lfx-rich-editor__content');
    await expect(editorContent).toBeAttached();

    await subjectField.locator('input').fill(subject);
    await editorContent.click();
    await page.keyboard.type('Structural spec body content.');

    await expect(page.getByTestId('newsletter-content-saved-indicator')).toBeVisible({ timeout: SEND_SETTLE_TIMEOUT });
    await page.getByTestId('newsletter-manage-next-btn').click();

    // Send step.
    const sendStep = page.getByTestId('newsletter-send-step');
    await expect(sendStep).toBeAttached({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-send-test-button')).toBeAttached();
    const sendNowButton = page.getByTestId('newsletter-send-now-button');
    await expect(sendNowButton).toBeAttached();
    await expect(sendNowButton).toBeEnabled();

    const sendResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/newsletters\/[^/]+\/send$/.test(new URL(response.url()).pathname),
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await sendNowButton.click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await dialog.getByRole('button', { name: /send now/i }).click();

    const sendResponse = await sendResponsePromise;
    const sendResult = await sendResponse.json();
    const projectUid: string = sendResult.newsletter.project_uid;
    const newsletterId: string = sendResult.newsletter.id;

    await expect(page).toHaveURL(/tab=sent/, { timeout: SEND_SETTLE_TIMEOUT });

    // Analytics screen — nested testid structure.
    await page.goto(`/foundation/newsletters/${projectUid}/${newsletterId}/analytics?project=${env.projectSlug}`, { waitUntil: 'domcontentloaded' });
    const analyticsRoot = page.getByTestId('newsletter-analytics');
    await expect(analyticsRoot).toBeAttached({ timeout: SEND_SETTLE_TIMEOUT });
    await expect(analyticsRoot.getByTestId('newsletter-analytics-subject')).toBeAttached();
    await expect(analyticsRoot.getByTestId('newsletter-analytics-recipients')).toBeAttached();
  });
});
