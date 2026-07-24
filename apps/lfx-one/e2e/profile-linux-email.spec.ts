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
    // The toast assertion runs first — PrimeNG toasts have a short default lifetime, so
    // checking it after the other awaits below risks it disappearing before we see it.
    await expect(page.getByText(/set your forwarding address below/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claimed-address')).toContainText(`${ALIAS}@${DOMAIN}`);
    await expect(page.getByTestId('linux-email-forward-form')).toBeVisible();

    // The claim form is gone — retrying the old form is no longer possible (and would
    // have failed with already_claimed since the alias is immutable upstream).
    await expect(page.getByTestId('linux-email-claim-panel')).not.toBeAttached();
  });
});

test.describe('Linux.com email — forwarding target visibility', () => {
  test('keeps the forward dropdown visible with a hint when the saved target is the only verified option', async ({ page }) => {
    await stubProfileContext(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: `${ALIAS}@${DOMAIN}`, forwardTo: PRIMARY_EMAIL };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-forward-select')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-empty')).not.toBeAttached();
    await expect(page.getByText('Add another verified email to change this.')).toBeVisible();
  });

  test('keeps the forward dropdown visible with a hint when a preserved external target is the only option', async ({ page }) => {
    // Alias-as-primary + no verified alternates would normally yield zero forward options,
    // but a pre-existing *external* forwardTo (one not among the user's verified emails) is
    // deliberately preserved so the user still sees and can keep their current target. The
    // select must stay visible with the "add another" hint — not collapse to the empty state.
    // Distinct from the primary-as-only-option case above: here the sole option comes from the
    // forwardTo-preservation branch, with the primary excluded because it equals the alias.
    const aliasEmail = `${ALIAS}@${DOMAIN}`;
    const externalForward = 'someone@external.com';
    await page.route('**/api/profile/emails', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: EmailManagementData = { primary_email: aliasEmail, alternate_emails: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/profile/identities', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: aliasEmail, forwardTo: externalForward };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-forward-select')).toBeVisible();
    // The preserved external target is the selected option — proves the preservation branch fired.
    await expect(page.getByTestId('linux-email-forward-select')).toContainText(externalForward);
    await expect(page.getByTestId('linux-email-forward-empty')).not.toBeAttached();
    await expect(page.getByText('Add another verified email to change this.')).toBeVisible();
  });

  test('shows the empty-state message and hides the select when no verified email can be forwarded to', async ({ page }) => {
    // Genuine-empty case: the only verified email is the claimed alias itself (so it's
    // excluded from forwardOptions) and no external forwardTo is saved — zero options.
    const aliasEmail = `${ALIAS}@${DOMAIN}`;
    await page.route('**/api/profile/emails', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: EmailManagementData = { primary_email: aliasEmail, alternate_emails: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/api/profile/identities', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: aliasEmail, forwardTo: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-forward-empty')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-select')).not.toBeAttached();
  });

  test('shows the normal hint on a first-time claim with a single verified email', async ({ page }) => {
    await stubProfileContext(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'purchased_unclaimed', domain: DOMAIN, alias: null, email: null, forwardTo: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claim-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claim-forward-select')).toBeVisible();
    await expect(page.getByText('Choose one of your verified email addresses.')).toBeVisible();
  });
});

test.describe('Linux.com email — verified emails fetch failure', () => {
  test('shows a retry panel instead of the empty-state message on the claim form', async ({ page }) => {
    await page.route('**/api/profile/emails', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream unavailable' }) });
    });
    await page.route('**/api/profile/identities', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'purchased_unclaimed', domain: DOMAIN, alias: null, email: null, forwardTo: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claim-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claim-forward-load-error')).toBeVisible();
    await expect(page.getByTestId('linux-email-claim-forward-empty')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-claim-forward-retry-button')).toBeVisible();
  });

  test('shows a retry panel instead of the empty-state message on the edit form', async ({ page }) => {
    await page.route('**/api/profile/emails', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'upstream unavailable' }) });
    });
    await page.route('**/api/profile/identities', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
    });
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // A preserved forwardTo (from before the emails fetch started failing) would make
      // forwardOptions() non-empty even though emails failed — the retry panel must still
      // win over the select in that case.
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: `${ALIAS}@${DOMAIN}`, forwardTo: PRIMARY_EMAIL };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-forward-load-error')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-empty')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-forward-select')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-forward-retry-button')).toBeVisible();
  });
});
