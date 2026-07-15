// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Linux.com email tab — partial-claim-failure recovery.
 *
 * Covers the fix for the non-atomic claim flow: `add_alias` (auth-service) succeeds
 * but `set_target` (forwards-service) fails, so the server returns
 * `502 FORWARD_SET_FAILED`. The alias is immutable once claimed, so the component
 * must recover into the claimed/edit view (where the user can set forwarding)
 * instead of leaving them stuck on the claim form, where a retry would fail with
 * `already_claimed`.
 */

import type { EmailManagementData, LinuxAliasData } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

const DOMAIN = 'example.org';
const ALIAS = 'jane-doe';
const PRIMARY_EMAIL = 'jane.doe@example.com';

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

/** Stub the sibling fetches the tab needs to render deterministically. */
async function stubProfileContext(page: Page): Promise<void> {
  await page.route('**/api/profile/emails', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const body: EmailManagementData = { primary_email: PRIMARY_EMAIL, alternate_emails: [] };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/api/profile/identities', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

/**
 * Stub the alias GET/POST pair so the claim endpoint fails on the forward step
 * while the alias itself is left claimed upstream (mirrors the real add_alias-then-
 * set_target semantics: the first call succeeds and is immutable, the second fails).
 */
async function stubPartialClaimFailure(page: Page): Promise<void> {
  let claimed = false;

  await page.route('**/api/profile/linux-email', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const body: LinuxAliasData = claimed
      ? { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: `${ALIAS}@${DOMAIN}`, forwardTo: null }
      : { state: 'purchased_unclaimed', domain: DOMAIN, alias: null, email: null, forwardTo: null };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/api/profile/linux-email/claim', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    // The alias claim (add_alias) succeeded and is immutable — only the forward
    // (set_target) step failed. The next GET must reflect the claimed state.
    claimed = true;
    return route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({
        error: 'Alias claimed, but forwarding could not be set. Please set your forwarding address again.',
        code: 'FORWARD_SET_FAILED',
        service: 'profile_controller',
        path: '/api/profile/linux-email/claim',
      }),
    });
  });
}

test.describe('Linux.com email — partial claim failure recovery', () => {
  test('recovers into the claimed/edit view after a FORWARD_SET_FAILED response', async ({ page }) => {
    await stubProfileContext(page);
    await stubPartialClaimFailure(page);

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Starting state: purchased but unclaimed — the claim form is shown.
    await expect(page.getByTestId('linux-email-claim-panel')).toBeVisible({ timeout: 10000 });

    await page.getByTestId('linux-email-alias-input').locator('input').fill(ALIAS);
    await page.getByTestId('linux-email-claim-forward-select').click();
    await page.getByRole('option', { name: `${PRIMARY_EMAIL} (Primary)`, exact: true }).click();
    await page.getByTestId('linux-email-claim-button').locator('button').click();

    // Recovery: even though the claim request failed, the tab transitions to the
    // claimed/edit view (not left stuck on the claim form) and surfaces a guiding toast.
    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claimed-address')).toContainText(`${ALIAS}@${DOMAIN}`);
    await expect(page.getByTestId('linux-email-forward-form')).toBeVisible();
    await expect(page.getByText(/set your forwarding address below/i)).toBeVisible();

    // The claim form is gone — retrying the old form is no longer possible (and would
    // have failed with already_claimed since the alias is immutable upstream).
    await expect(page.getByTestId('linux-email-claim-panel')).not.toBeAttached();
  });
});
