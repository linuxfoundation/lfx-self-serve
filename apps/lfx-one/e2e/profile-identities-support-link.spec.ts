// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Profile identity dialogs — support remains reachable after enumeration-safe sends (#443, #4695).
 * A generic send-code 200 advances both dialogs to the OTP step with a visible, neutral support
 * hint, regardless of whether a code was actually delivered. After the resend threshold, Resend
 * is replaced by a Contact support action. An unrelated 400 stays on the send step with a plain
 * inline error and no support button.
 * Identity reads and send-code writes are mocked; no real email is sent.
 * Requires the dev server and the existing Playwright authentication setup.
 */

import { expect, Page, test } from '@playwright/test';

// Mirrors EMAIL_VERIFICATION_SENT_MESSAGE; the shared constants barrel reaches Angular code
// that Playwright's plain Node loader cannot compile.
const EMAIL_VERIFICATION_SENT_MESSAGE = 'If this address can be added to your account, a verification code has been sent.';

const IDENTITIES_ROUTE = '**/api/profile/identities';
const SEND_CODE_ROUTE = '**/api/profile/identities/email/send-code';
const UNRELATED_ERROR_MESSAGE = 'Invalid or expired verification code. Please try again.';
const SUPPORT_BUTTON = { name: 'contact support' } as const;
// Mirrors EMAIL_RESEND_SUPPORT_THRESHOLD and the 60s resend cooldown (same Node-loader constraint as above).
const RESEND_SUPPORT_THRESHOLD = 1;
const RESEND_COOLDOWN_MS = 60_000;

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
          value: 'unverified@example.test',
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

// Neutralize the Transcend consent overlay, which otherwise intercepts pointer events on the
// dialog's provider buttons. Registered via addInitScript so it applies on every navigation
// before page scripts (mirrors profile-edit-drawer / me-profile-nav specs).
async function suppressCookieBanner(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const hide = (): void => {
      if (document.getElementById('e2e-hide-transcend')) {
        return;
      }
      const style = document.createElement('style');
      style.id = 'e2e-hide-transcend';
      style.textContent = '#transcend-consent-manager { display: none !important; pointer-events: none !important; }';
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

// Stub the send-code endpoint with the chosen success or failure envelope.
async function mockSendCode(page: Page, status: number, message: string): Promise<void> {
  await page.route(SEND_CODE_ROUTE, (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(status === 200 ? { success: true, message } : { success: false, error: 'send_code_failed', message }),
    });
  });
}

test.describe('Identity dialogs — enumeration-safe OTP support', () => {
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

    test('shows the OTP support hint after a generic successful send', async ({ page }) => {
      await mockSendCode(page, 200, EMAIL_VERIFICATION_SENT_MESSAGE);
      await openEmailConnectStep(page);
      await page.getByTestId('add-account-send-code').locator('button').click();

      await expect(page.getByTestId('add-account-otp')).toBeVisible();
      const hint = page.getByTestId('add-account-otp-hint');
      await expect(hint).toBeVisible();
      await expect(hint).not.toContainText('already linked');
      await expect(hint.getByRole('button', SUPPORT_BUTTON)).toBeVisible();
      await expect(page.getByTestId('add-account-send-error')).toHaveCount(0);
    });

    test('replaces Resend with Contact support after the resend threshold', async ({ page }) => {
      await page.clock.install();
      await mockSendCode(page, 200, EMAIL_VERIFICATION_SENT_MESSAGE);
      await openEmailConnectStep(page);
      await page.getByTestId('add-account-send-code').locator('button').click();
      await expect(page.getByTestId('add-account-otp')).toBeVisible();
      await expect(page.getByTestId('add-account-resend-support')).toHaveCount(0);

      for (let resend = 0; resend < RESEND_SUPPORT_THRESHOLD; resend++) {
        await page.clock.runFor(RESEND_COOLDOWN_MS);
        await page.getByTestId('add-account-resend').click();
      }

      await expect(page.getByTestId('add-account-resend')).toHaveCount(0);
      await expect(page.getByTestId('add-account-resend-support')).toBeVisible();
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

    test('shows the OTP support hint after a generic successful send', async ({ page }) => {
      await mockSendCode(page, 200, EMAIL_VERIFICATION_SENT_MESSAGE);
      await openVerifyEmailDialog(page);
      await page.getByTestId('verify-send-code').locator('button').click();

      await expect(page.getByTestId('verify-otp')).toBeVisible();
      const hint = page.getByTestId('verify-otp-hint');
      await expect(hint).toBeVisible();
      await expect(hint).not.toContainText('already linked');
      await expect(hint.getByRole('button', SUPPORT_BUTTON)).toBeVisible();
      await expect(page.getByTestId('verify-email-error')).toHaveCount(0);
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
