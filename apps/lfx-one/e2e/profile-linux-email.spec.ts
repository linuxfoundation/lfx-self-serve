// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Linux.com email tab.
 *
 * Covers:
 * - Partial-claim-failure recovery: `add_alias` (auth-service) succeeds but
 *   `set_target` (forwards-service) fails, so the server returns
 *   `502 FORWARD_SET_FAILED`. The alias is immutable once claimed, so the
 *   component must recover into the claimed/edit view instead of leaving the
 *   user stuck on the claim form (where a retry would fail with `already_claimed`).
 * - Forwarding-target visibility across the claimed states.
 * - The whole-tab retry panel when the alias service is unavailable.
 *
 * The tab reads its state from a single `GET /api/profile/linux-email` call —
 * the server resolves `user_emails.read` and returns the primary email inline as
 * `primaryEmail`, so these stubs set it on the alias body rather than mocking a
 * separate `/api/profile/emails` fetch.
 */

import { LINUX_EMAIL_FORWARD_REAUTH_KEY } from '@lfx-one/shared/constants';
import type { LinuxAliasData } from '@lfx-one/shared/interfaces';
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

/**
 * Navigate and wait for the claimed panel to render. Routes/init scripts must be
 * registered before this — Playwright can't retroactively intercept a request or
 * seed sessionStorage for a navigation that already happened.
 */
async function gotoIdentitiesAndExpectClaimedPanel(page: Page): Promise<void> {
  await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('linux-email-claimed-panel')).toBeVisible({ timeout: 10000 });
}

/** Stub the identities fetch the tab needs to render deterministically. */
async function stubIdentities(page: Page): Promise<void> {
  await page.route('**/api/profile/identities', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) });
  });
}

/** Stub the alias GET as purchased-but-unclaimed — the first-time-claim starting state. */
async function stubUnclaimedLinuxEmail(page: Page): Promise<void> {
  await page.route('**/api/profile/linux-email', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const body: LinuxAliasData = { state: 'purchased_unclaimed', domain: DOMAIN, alias: null, email: null, forwardTo: null, primaryEmail: PRIMARY_EMAIL };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
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
      ? { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: `${ALIAS}@${DOMAIN}`, forwardTo: null, primaryEmail: PRIMARY_EMAIL }
      : { state: 'purchased_unclaimed', domain: DOMAIN, alias: null, email: null, forwardTo: null, primaryEmail: PRIMARY_EMAIL };
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
    await stubIdentities(page);
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
    await stubIdentities(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = {
        state: 'claimed',
        domain: DOMAIN,
        alias: ALIAS,
        email: `${ALIAS}@${DOMAIN}`,
        forwardTo: PRIMARY_EMAIL,
        primaryEmail: PRIMARY_EMAIL,
      };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await gotoIdentitiesAndExpectClaimedPanel(page);
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
    await stubIdentities(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: aliasEmail, forwardTo: externalForward, primaryEmail: aliasEmail };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await gotoIdentitiesAndExpectClaimedPanel(page);
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
    await stubIdentities(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'claimed', domain: DOMAIN, alias: ALIAS, email: aliasEmail, forwardTo: null, primaryEmail: aliasEmail };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await gotoIdentitiesAndExpectClaimedPanel(page);
    await expect(page.getByTestId('linux-email-forward-empty')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-select')).not.toBeAttached();
  });

  test('shows the normal hint on a first-time claim with a single verified email', async ({ page }) => {
    await stubIdentities(page);
    await stubUnclaimedLinuxEmail(page);

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-claim-panel')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claim-forward-select')).toBeVisible();
    await expect(page.getByText('Choose one of your verified email addresses.')).toBeVisible();
  });

  test('does not make a second /api/profile/emails fetch on the Linux.com tab', async ({ page }) => {
    // Perf regression guard: the primary email arrives inline, so the tab must not make a second
    // /api/profile/emails round-trip. GET-scoped, fulfilled so a reintroduced fetch fails loudly.
    await stubIdentities(page);

    let emailsFetchCount = 0;
    await page.route('**/api/profile/emails', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      emailsFetchCount++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ primary_email: PRIMARY_EMAIL, alternate_emails: [] }) });
    });
    await stubUnclaimedLinuxEmail(page);

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    // Let the tab finish rendering before asserting no /emails fetch was made.
    await expect(page.getByTestId('linux-email-claim-panel')).toBeVisible({ timeout: 10000 });
    expect(emailsFetchCount).toBe(0);
  });
});

/**
 * Stub the alias GET as claimed with forwardAuthRequired, and pre-latch the one-shot
 * redirect guard so the page renders the recoverable panel instead of bouncing to
 * authorizeUrl. Omit authorizeUrl to exercise the "Flow C unconfigured" dead-end copy.
 */
async function stubClaimedNeedsReauth(page: Page, authorizeUrl?: string): Promise<void> {
  await page.addInitScript((key) => sessionStorage.setItem(key, '1'), LINUX_EMAIL_FORWARD_REAUTH_KEY);
  await stubIdentities(page);
  const aliasEmail = `${ALIAS}@${DOMAIN}`;
  await page.route('**/api/profile/linux-email', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const body: LinuxAliasData = {
      state: 'claimed',
      domain: DOMAIN,
      alias: ALIAS,
      email: aliasEmail,
      forwardTo: null,
      primaryEmail: PRIMARY_EMAIL,
      forwardAuthRequired: true,
      ...(authorizeUrl ? { authorizeUrl } : {}),
    };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.describe('Linux.com email — forward re-auth (#1935)', () => {
  test('shows the re-auth panel instead of the blank select when the forward target could not be read', async ({ page }) => {
    await stubClaimedNeedsReauth(page, 'https://app.dev.lfx.dev/api/profile/auth/start?returnTo=/profile/identities');
    await gotoIdentitiesAndExpectClaimedPanel(page);

    await expect(page.getByTestId('linux-email-forward-reauth')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-reauth-button')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-select')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-forward-empty')).not.toBeAttached();
  });

  test('falls back to unavailable copy with no button when Flow C is unconfigured (no authorizeUrl)', async ({ page }) => {
    await stubClaimedNeedsReauth(page);
    await gotoIdentitiesAndExpectClaimedPanel(page);

    await expect(page.getByTestId('linux-email-forward-reauth')).toBeVisible();
    await expect(page.getByTestId('linux-email-forward-reauth-copy')).toContainText("re-authorization isn't available right now");
    await expect(page.getByTestId('linux-email-forward-reauth-button')).not.toBeAttached();
  });
});

test.describe('Linux.com email — service unavailable', () => {
  test('renders the whole-tab retry panel when the alias service is unavailable', async ({ page }) => {
    // getLinuxAlias reads user_emails.read server-side; when that (or any downstream
    // read) fails, the endpoint returns service_unavailable. The tab must render the
    // whole-tab retry panel rather than any of the claim/claimed forms.
    await stubIdentities(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      const body: LinuxAliasData = { state: 'service_unavailable', domain: DOMAIN, alias: null, email: null, forwardTo: null, primaryEmail: null };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-retry-button')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claim-panel')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-claimed-panel')).not.toBeAttached();
  });

  test('renders the retry panel when the alias request itself fails (client catchError)', async ({ page }) => {
    // Distinct from the 200-body service_unavailable case above: the GET itself returns 502,
    // so the component's own catchError synthesizes the service_unavailable retry state.
    await stubIdentities(page);
    await page.route('**/api/profile/linux-email', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Bad gateway' }) });
    });

    // Capture console.error output so we can assert the catchError logs the failure
    // (component logs 'Failed to load Linux.com alias state:' before falling back).
    // Read the status from the second arg directly rather than string-matching the serialized
    // preview, so the assertion also fails if the error argument is ever dropped (status would
    // be undefined) — not just if the prefix changes. Note: the app's initializeConsoleOverride
    // (main.ts) reshapes HttpErrorResponse args into a plain { status_code, err: { statusCode } }
    // object before logging, so the HTTP status lives on `status_code`, not `.status`.
    const aliasLoadErrors: { text: string; status: number | undefined }[] = [];
    page.on('console', async (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (!text.includes('Failed to load Linux.com alias state')) return;
      const errorArg = msg.args()[1];
      const status = errorArg
        ? await errorArg.evaluate((err) => (err && typeof err === 'object' ? (err as { status_code?: number }).status_code : undefined)).catch(() => undefined)
        : undefined;
      aliasLoadErrors.push({ text, status });
    });

    await page.goto('/profile/identities', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page).not.toHaveURL(/auth0\.com/);

    await expect(page.getByTestId('linux-email-retry-button')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('linux-email-claim-panel')).not.toBeAttached();
    await expect(page.getByTestId('linux-email-claimed-panel')).not.toBeAttached();

    // The catchError path must log the underlying failure (with the 502 detail) so it stays
    // diagnosable in production — assert both the prefix and the error's HTTP status.
    await expect
      .poll(() => aliasLoadErrors)
      .toContainEqual(expect.objectContaining({ text: expect.stringContaining('Failed to load Linux.com alias state'), status: 502 }));
  });
});
