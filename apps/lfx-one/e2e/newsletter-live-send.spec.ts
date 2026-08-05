// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Newsletter live-send pipeline — LFXV2-2389.
 *
 * Every other newsletter spec in this suite stubs the newsletter / committee /
 * project APIs with `page.route()`. This spec is a deliberate, narrowly-scoped
 * exception: it drives the compose → send → analytics flow against the real
 * lfx-v2-newsletter-service / committee-service / project-service stack, so a
 * wiring gap between the frontend contract and the live backend response shape
 * can't hide behind a mock that encodes the same (possibly wrong) assumption.
 *
 * Not covered here: nonzero "opens" in analytics. Email opens are triggered by
 * an external mail client loading a tracking pixel — there is no deterministic
 * way to fire one from a Playwright run. The happy path only asserts that
 * Analytics loads and correlates to the send's `group_id`.
 *
 * Prerequisites:
 *   - Full local platform stack up (see lfx-v2-helm) with lfx-v2-newsletter-service,
 *     lfx-v2-committee-service, and lfx-v2-email-service reachable.
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see
 *     e2e/helpers/auth.helper.ts) AND the four LIVE_* vars documented in
 *     e2e/helpers/live-env.helper.ts, pointing at a seeded project + committee
 *     with at least one member.
 *   - Run in isolation via `yarn e2e:live` — NOT part of the default `yarn e2e`
 *     gate, since CI has no job that stands up the full local stack yet.
 */

import { expect, Page, test } from '@playwright/test';
import { getLiveEnv, skipWhenLiveEnvMissing } from './helpers/live-env.helper';

test.setTimeout(120_000);

const PAGE_LOAD_TIMEOUT = 20_000;
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

async function selectAudienceCommittee(page: Page, committeeName: string): Promise<void> {
  await page.getByTestId('newsletter-audience-committees').click();
  await page.getByRole('option', { name: committeeName, exact: true }).click();
}

async function fillSubject(page: Page, subject: string): Promise<void> {
  await page.getByTestId('newsletter-content-subject').locator('input').fill(subject);
}

async function fillBody(page: Page, body: string): Promise<void> {
  // The tiptap content div shares the `newsletter-content-body` testid with its
  // wrapper (see rich-editor.component.html/.ts), so target it by class instead
  // of getByTestId to avoid a strict-mode multi-match error.
  const editorContent = page.locator('.lfx-rich-editor__content');
  await editorContent.click();
  await page.keyboard.type(body);
}

test.describe('Newsletter live send — happy path', () => {
  test('compose, send to a real committee, and load analytics for the sent newsletter', async ({ page }) => {
    const env = getLiveEnv();
    const subject = `Live E2E Newsletter ${Date.now()}`;

    await gotoAuthed(page, `/foundation/newsletters/create?project=${env.projectSlug}`);
    await expect(page.getByTestId('newsletter-manage-stepper'), 'create should land on the stepper').toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });

    // Step 1 — Audience.
    await expect(page.getByTestId('newsletter-audience-step')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await selectAudienceCommittee(page, env.committeeName);
    await expect(page.getByTestId('newsletter-audience-committees'), 'picker should reflect the selected committee').toContainText(env.committeeName);
    await page.getByTestId('newsletter-manage-next-btn').click();

    // Step 2 — Content. Filling triggers the debounced autosave, which creates
    // the draft (POST .../newsletters) the first time subject+body+audience are
    // all present — capture that response to get the newsletter id / project_uid.
    await expect(page.getByTestId('newsletter-content-step')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/projects\/[^/]+\/newsletters$/.test(new URL(response.url()).pathname),
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await fillSubject(page, subject);
    await fillBody(page, 'Live E2E send body content — verifying the compose-to-analytics pipeline against the real backend.');

    const createResponse = await createResponsePromise;
    expect(createResponse.ok(), 'draft autosave-create should succeed').toBeTruthy();
    const draft = await createResponse.json();
    const newsletterId: string = draft.id;
    const projectUid: string = draft.project_uid;
    expect(newsletterId).toBeTruthy();
    expect(projectUid).toBeTruthy();

    await expect(page.getByTestId('newsletter-content-saved-indicator'), 'saved indicator should confirm the autosave landed').toBeVisible({
      timeout: SEND_SETTLE_TIMEOUT,
    });
    await page.getByTestId('newsletter-manage-next-btn').click();

    // Step 3 — Send.
    await expect(page.getByTestId('newsletter-send-step')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await expect(page.getByTestId('newsletter-send-now-button')).toBeEnabled({ timeout: ELEMENT_TIMEOUT });

    const sendResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(`/newsletters/${newsletterId}/send`),
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await page.getByTestId('newsletter-send-now-button').click();

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog, 'send confirmation dialog should appear').toBeVisible({ timeout: ELEMENT_TIMEOUT });
    await dialog.getByRole('button', { name: /send now/i }).click();

    const sendResponse = await sendResponsePromise;
    expect(sendResponse.ok(), 'send request should be accepted').toBeTruthy();
    const sendResult = await sendResponse.json();
    const groupId: string = sendResult.group_id;
    expect(groupId, 'send result should carry a group_id for analytics correlation').toBeTruthy();
    expect(['sending', 'sent']).toContain(sendResult.newsletter.status);

    // Both the synchronous (`sent`, zero-recipient edge case) and asynchronous
    // (`sending`) accept paths land on the Sent tab.
    await expect(page).toHaveURL(/tab=sent/, { timeout: SEND_SETTLE_TIMEOUT });

    // Navigate directly to Analytics via the captured id/project_uid rather than
    // depending on list-row ordering.
    await page.goto(`/foundation/newsletters/${projectUid}/${newsletterId}/analytics?project=${env.projectSlug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('newsletter-analytics'), 'analytics screen should load for the sent newsletter').toBeVisible({
      timeout: SEND_SETTLE_TIMEOUT,
    });
    await expect(page.getByTestId('newsletter-analytics-subject')).toContainText(subject);
    await expect(page.getByTestId('newsletter-analytics-recipients')).toBeVisible({ timeout: ELEMENT_TIMEOUT });
    // Deliberately not asserting a nonzero open count — see file header.
  });
});

test.describe('Newsletter live send — re-send an already-sent newsletter', () => {
  test('re-sending a sent newsletter is treated as a no-op, not an error', async ({ page }) => {
    const env = getLiveEnv();
    const subject = `Live E2E Resend Guard ${Date.now()}`;

    // Compose + send once (mirrors the happy path) to get a genuinely `sent`
    // newsletter to re-target.
    await gotoAuthed(page, `/foundation/newsletters/create?project=${env.projectSlug}`);
    await selectAudienceCommittee(page, env.committeeName);
    await page.getByTestId('newsletter-manage-next-btn').click();

    const createResponsePromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/api\/projects\/[^/]+\/newsletters$/.test(new URL(response.url()).pathname),
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await fillSubject(page, subject);
    await fillBody(page, 'Body content for the resend-guard regression check.');
    const createResponse = await createResponsePromise;
    const draft = await createResponse.json();
    const newsletterId: string = draft.id;
    const projectUid: string = draft.project_uid;

    await expect(page.getByTestId('newsletter-content-saved-indicator')).toBeVisible({ timeout: SEND_SETTLE_TIMEOUT });
    await page.getByTestId('newsletter-manage-next-btn').click();

    await expect(page.getByTestId('newsletter-send-now-button')).toBeEnabled({ timeout: ELEMENT_TIMEOUT });
    const firstSendPromise = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().includes(`/newsletters/${newsletterId}/send`),
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await page.getByTestId('newsletter-send-now-button').click();
    await page.locator('[role="dialog"]').getByRole('button', { name: /send now/i }).click();
    await firstSendPromise;
    await expect(page).toHaveURL(/tab=sent/, { timeout: SEND_SETTLE_TIMEOUT });

    // Give the async fan-out a moment to settle to `sent` before re-targeting it.
    await expect
      .poll(
        async () => {
          const res = await page.request.get(`/api/projects/${projectUid}/newsletters/${newsletterId}`);
          const body = await res.json();
          return body.status;
        },
        { timeout: SEND_SETTLE_TIMEOUT, intervals: [1_000, 2_000, 3_000] }
      )
      .toBe('sent');

    // Reopen the now-sent newsletter and attempt to send it again. The upstream
    // rejects with 409 already_sent, but the UI's handleSendError() refetches and
    // finds status='sent' — it surfaces an INFO "Newsletter sent" toast and
    // returns to the Sent tab instead of a generic error, guarding against a
    // duplicate-send regression (LFXV2-2604). Assert on that real behavior.
    await page.goto(`/foundation/newsletters/${projectUid}/${newsletterId}/edit?project=${env.projectSlug}`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('newsletter-review'), 'reopening a sent newsletter lands on the review screen').toBeVisible({
      timeout: PAGE_LOAD_TIMEOUT,
    });

    await page.getByTestId('newsletter-review-send-now-btn').click();
    await page.locator('[role="dialog"]').getByRole('button', { name: /send now/i }).click();

    await expect(page.locator('.p-toast'), 'a resend attempt should surface the no-op info toast, not a generic error').toContainText(
      'Newsletter sent',
      { timeout: SEND_SETTLE_TIMEOUT }
    );
    await expect(page).toHaveURL(/tab=sent/, { timeout: SEND_SETTLE_TIMEOUT });
  });
});
