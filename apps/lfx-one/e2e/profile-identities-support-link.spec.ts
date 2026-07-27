// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile identity dialogs — "contact support" link on already-claimed errors (LFXV2-2858).
 *
 * When adding or verifying an email identity that is already claimed by another LFID
 * account, the add-account and verify-identity dialogs surface a "contact support"
 * action beside the red error. The link is gated on the error *message* (via the shared
 * isIdentityAlreadyLinkedError util, the same marker set the backend uses), NOT on the
 * HTTP status — so these tests drive the send-code error path and vary only the message:
 *   - already-linked message  → support link appears
 *   - any other error message  → support link is absent
 *
 * Both the identity list and the email verification endpoint are mocked, so the spec is
 * self-contained and does not depend on a seeded backend test user (unlike the sibling
 * profile-identities-verify spec, which reads live data).
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, Page, test } from '@playwright/test';

// Mirrors EMAIL_ALREADY_LINKED_MESSAGE in @lfx-one/shared/constants. Inlined rather than
// imported because the shared constants barrel transitively pulls Angular runtime code,
// which the Playwright Node test loader can't compile. The only invariant this spec relies
// on is that the message contains an already-linked marker (matched by isIdentityAlreadyLinkedError).
const EMAIL_ALREADY_LINKED_MESSAGE = 'This email is already linked to another account';

const IDENTITIES_ROUTE = '**/api/profile/identities';
const SEND_CODE_ROUTE = '**/api/profile/identities/email/send-code';
const UNRELATED_ERROR_MESSAGE = 'Invalid or expired verification code. Please try again.';
const SUPPORT_BUTTON = { name: 'contact support' } as const;

// The unverified email identity the mocked list exposes; drives the verify dialog's
// verify-btn-<id> and OTP flow.
const UNVERIFIED_EMAIL_ID = 'idf-email-unverified';

// Deterministic identities payload so the page renders without depending on a seeded
// backend test user (the sibling profile-identities-verify spec relies on live data and
// can't run outside that environment — this spec mocks it to stay self-contained).
async function mockIdentities(page: Page): Promise<void> {
  await page.route(IDENTITIES_ROUTE, (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: UNVERIFIED_EMAIL_ID,
          platform: 'email',
          type: 'email',
          value: 'jdoe@company.org',
          verified: false,
          verifiedBy: null,
          source: 'e2e',
          icon: 'fa-light fa-envelope',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          displayState: 'unverified',
          inAuth0: false,
        },
      ]),
    });
  });
}

// Neutralize the Osano consent overlay, which otherwise intercepts pointer events on the
// dialog's provider buttons. Registered via addInitScript so it applies on every navigation
// before page scripts (mirrors profile-edit-drawer / me-profile-nav specs).
async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = (): void => {
      if (document.getElementById('e2e-hide-osano')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'e2e-hide-osano';
      style.textContent = '.osano-cm-window { display: none !important; pointer-events: none !important; }';
      (document.head ?? document.documentElement).appendChild(style);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide);
    } else {
      hide();
    }
  });
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep the test running; a failure here is useful signal, not noise.
  }
}

// Stub the send-code endpoint with a chosen status + message. Later registrations win,
// so a test can call this to override the beforeEach default.
async function mockSendCode(page: Page, status: number, message: string): Promise<void> {
  await page.route(SEND_CODE_ROUTE, (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ success: false, error: 'send_code_failed', message }),
    });
  });
}

test.describe('Identity dialogs — already-claimed support link', () => {
  test.beforeEach(async ({ page }) => {
    await suppressCookieBanner(page);
    await mockIdentities(page);
    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);
    await expect(page.getByTestId('unverified-identities-section').or(page.getByTestId('verified-identities-section'))).toBeVisible({ timeout: 10000 });
  });

  test.describe('Add-account dialog', () => {
    // Open the add-account dialog and advance to the email "connect" step.
    async function openEmailConnectStep(page: Page): Promise<void> {
      await page.getByTestId('add-identity-btn').locator('button').click();
      await expect(page.getByTestId('add-account-dialog')).toBeVisible({ timeout: 5000 });
      await page.getByTestId('provider-action-email').locator('button').click();
      await page.getByTestId('add-account-email').locator('input').fill('claimed@example.com');
    }

    test('shows the support link when the email is already linked (409)', async ({ page }) => {
      await mockSendCode(page, 409, EMAIL_ALREADY_LINKED_MESSAGE);
      await openEmailConnectStep(page);
      await page.getByTestId('add-account-send-code').locator('button').click();

      const error = page.getByTestId('add-account-send-error');
      await expect(error).toBeVisible({ timeout: 5000 });
      await expect(error).toContainText(EMAIL_ALREADY_LINKED_MESSAGE);
      await expect(error.getByRole('button', SUPPORT_BUTTON)).toBeVisible();
    });

    test('hides the support link for an unrelated error', async ({ page }) => {
      await mockSendCode(page, 400, UNRELATED_ERROR_MESSAGE);
      await openEmailConnectStep(page);
      await page.getByTestId('add-account-send-code').locator('button').click();

      const error = page.getByTestId('add-account-send-error');
      await expect(error).toBeVisible({ timeout: 5000 });
      await expect(error).toContainText(UNRELATED_ERROR_MESSAGE);
      await expect(error.getByRole('button', SUPPORT_BUTTON)).toHaveCount(0);
    });
  });

  test.describe('Verify-identity dialog', () => {
    // The mocked list exposes a single unverified email identity; its verify button id
    // derives from UNVERIFIED_EMAIL_ID.
    async function openVerifyEmailDialog(page: Page): Promise<void> {
      await page.getByTestId(`verify-btn-${UNVERIFIED_EMAIL_ID}`).locator('button').click();
      await expect(page.getByTestId('verify-identity-dialog')).toBeVisible({ timeout: 5000 });
    }

    test('shows the support link when the email is already linked (409)', async ({ page }) => {
      await mockSendCode(page, 409, EMAIL_ALREADY_LINKED_MESSAGE);
      await openVerifyEmailDialog(page);
      await page.getByTestId('verify-send-code').locator('button').click();

      const error = page.getByTestId('verify-email-error');
      await expect(error).toBeVisible({ timeout: 5000 });
      await expect(error).toContainText(EMAIL_ALREADY_LINKED_MESSAGE);
      await expect(error.getByRole('button', SUPPORT_BUTTON)).toBeVisible();
    });

    test('hides the support link for an unrelated error', async ({ page }) => {
      await mockSendCode(page, 400, UNRELATED_ERROR_MESSAGE);
      await openVerifyEmailDialog(page);
      await page.getByTestId('verify-send-code').locator('button').click();

      const error = page.getByTestId('verify-email-error');
      await expect(error).toBeVisible({ timeout: 5000 });
      await expect(error).toContainText(UNRELATED_ERROR_MESSAGE);
      await expect(error.getByRole('button', SUPPORT_BUTTON)).toHaveCount(0);
    });
  });
});
