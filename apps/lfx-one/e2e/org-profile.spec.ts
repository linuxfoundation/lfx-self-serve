// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Profile E2E — Spec 021-org-profile-edit smoke set.
 *
 * Coverage map:
 * - S1: authenticated load — stubbed canonical + addresses; page reports data-state="loaded"
 * - S2: writer gate — stubbed role-grants show/hide the edit button
 * - S3: edit + save — stubbed PUT returns updated record; page returns to data-mode="view"
 * - S4: load error + retry — first canonical GET fails; retry re-fetches and loads
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 */

import type { CascadingRoleGrant } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

const PROFILE_URL = '/org/profile';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_UID = '4c46585f-878c-8285-b2e9-2dbfc38ddd9b';
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

const MOCK_CANONICAL = {
  uid: MOCK_UID,
  accountId: MOCK_ACCOUNT_ID,
  name: 'Red Hat LLC',
  description: 'Open source software company providing enterprise solutions.',
  website: 'redhat.com',
  primaryDomain: 'redhat.com',
  logoUrl: null,
  industry: 'Open Source Software',
  sector: 'Information Technology',
  numberOfEmployees: 19000,
  crunchBaseUrl: 'https://crunchbase.com/organization/red-hat',
  updatedAt: '2026-05-20T12:34:56Z',
  parentUid: null,
  isMember: true,
};

const MOCK_ADDRESSES = {
  primaryAddress: {
    line1: '100 East Davie Street',
    city: 'Raleigh',
    stateProvince: 'NC',
    postalCode: '27601',
    country: 'United States',
  },
  billingAddress: {
    line1: '100 East Davie Street',
    city: 'Raleigh',
    stateProvince: 'NC',
    postalCode: '27601',
    country: 'United States',
  },
};

test.setTimeout(120_000);

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

interface StubGrantsOptions {
  writers: string[];
  auditors?: string[];
  cascadingWriters?: CascadingRoleGrant[];
  cascadingAuditors?: CascadingRoleGrant[];
}

async function stubOrgProfileContext(page: Page, options: StubGrantsOptions): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: MOCK_CANONICAL.name,
            accountSlug: 'red-hat-llc',
            membershipTier: '',
            uid: MOCK_UID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: options.writers,
        auditors: options.auditors ?? [],
        cascadingWriters: options.cascadingWriters ?? [],
        cascadingAuditors: options.cascadingAuditors ?? [],
        username: 'e2e-org-profile',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubCanonicalAndAddresses(page: Page, canonicalStatus: number = 200, canonicalBody: unknown = MOCK_CANONICAL): Promise<void> {
  await page.route(`**/api/orgs/uid/${MOCK_UID}`, (route) => {
    if (route.request().method() !== 'GET') {
      return route.fallback();
    }
    return route.fulfill({
      status: canonicalStatus,
      contentType: 'application/json',
      body: canonicalStatus === 200 ? JSON.stringify(canonicalBody) : JSON.stringify({ error: 'Upstream failure' }),
    });
  });

  await page.route(`**/api/orgs/uid/${MOCK_UID}/addresses`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(MOCK_ADDRESSES),
    })
  );
}

async function gotoProfileWithStubs(page: Page, writers: string[]): Promise<void> {
  await stubOrgProfileContext(page, { writers });
  await stubCanonicalAndAddresses(page);

  // Install stubs before reload so client-side persona + role-grant fetches are intercepted (mirrors org-selector S9).
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/profile')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/profile redirected away');
  }
}

test.describe('Org Profile — authenticated smoke set (S1/S2/S3/S4)', () => {
  test('S1: stubbed canonical + addresses load the summary card with data-state="loaded"', async ({ page }) => {
    await gotoProfileWithStubs(page, [MOCK_UID]);

    const root = page.getByTestId('org-profile-page');
    await expect(root).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(root).toHaveAttribute('data-state', 'loaded');
    await expect(root).toHaveAttribute('data-mode', 'view');
    await expect(page.getByTestId('org-profile-summary-card')).toBeVisible();
    await expect(page.getByTestId('org-profile-name')).toHaveText(MOCK_CANONICAL.name);
    await expect(page.getByTestId('org-profile-primary-address-card')).toBeVisible();
  });

  test('S2: writer gate hides the edit button when role-grants omit the selected uid', async ({ page }) => {
    await gotoProfileWithStubs(page, []);

    const root = page.getByTestId('org-profile-page');
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-profile-edit-button')).not.toBeVisible();
  });

  test('S2b: writer gate shows the edit button when role-grants include the selected uid', async ({ page }) => {
    await gotoProfileWithStubs(page, [MOCK_UID]);

    const root = page.getByTestId('org-profile-page');
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-profile-edit-button')).toBeVisible();
  });

  test('S3: edit + save returns to view mode after a stubbed PUT', async ({ page }) => {
    await gotoProfileWithStubs(page, [MOCK_UID]);

    const root = page.getByTestId('org-profile-page');
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });

    const updatedDescription = 'Updated by e2e save flow.';
    await page.route(`**/api/orgs/uid/${MOCK_UID}`, (route) => {
      if (route.request().method() === 'PUT') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_CANONICAL, description: updatedDescription }),
        });
      }
      return route.fallback();
    });

    await page.getByTestId('org-profile-edit-button').click();
    await expect(root).toHaveAttribute('data-mode', 'edit');

    const editPage = page.getByTestId('org-profile-edit-page');
    await expect(editPage).toBeVisible();
    await expect(editPage).toHaveAttribute('data-dirty', 'false');
    await expect(editPage).toHaveAttribute('data-can-save', 'false');

    await page.getByTestId('org-profile-edit-description-textarea').fill(updatedDescription);
    await expect(editPage).toHaveAttribute('data-dirty', 'true');
    await expect(editPage).toHaveAttribute('data-can-save', 'true');

    await page.getByTestId('org-profile-edit-save-button').click();
    await expect(root).toHaveAttribute('data-mode', 'view');
    await expect(editPage).toBeHidden();
    await expect(page.getByTestId('org-profile-description')).toContainText(updatedDescription);
  });

  test('S4: load error surfaces data-state="error" and retry re-fetches successfully', async ({ page }) => {
    await stubOrgProfileContext(page, { writers: [MOCK_UID] });

    let canonicalAttempts = 0;
    await page.route(`**/api/orgs/uid/${MOCK_UID}`, (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      canonicalAttempts += 1;
      if (canonicalAttempts === 1) {
        return route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'Upstream failure' }) });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CANONICAL),
      });
    });

    await page.route(`**/api/orgs/uid/${MOCK_UID}/addresses`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_ADDRESSES),
      })
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    if (!page.url().includes('/org/profile')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/profile redirected away');
    }

    const root = page.getByTestId('org-profile-page');
    await expect(root).toHaveAttribute('data-state', 'error', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-profile-load-error')).toBeVisible();

    await page.getByTestId('org-profile-retry-button').click();
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-profile-summary-card')).toBeVisible();
    expect(canonicalAttempts).toBeGreaterThanOrEqual(2);
  });
});

// Spec 022 US4 — inherited-auditor Profile Page must hide Edit (FR-011a + Clarifications Q3 + Q4).
// `writerSet` stays DIRECT-only by design; cascading-auditor uids land in `inheritedAuditorSet`
// (additive surface for the dropdown badge only). Selecting a cascading-auditor org therefore
// renders the read-only view with NO Edit button, NO in-page banner, NO replacement CTA.
test.describe('Org Profile — spec 022 inherited-auditor (US4)', () => {
  test('S5: inherited-auditor org renders read-only with no Edit button and no in-page disclosure', async ({ page }) => {
    // The selected org inherits auditor from a direct-granted parent (FGA: writer does NOT cascade).
    await stubOrgProfileContext(page, {
      writers: [], // direct-writer set is empty for the *selected* uid
      cascadingAuditors: [{ uid: MOCK_UID, parentUid: '4c46585f-878c-8285-b2e9-2dbfc38dc8a7', parentName: 'IBM Corporation' }],
    });
    await stubCanonicalAndAddresses(page);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/profile')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/profile redirected away');
    }

    const root = page.getByTestId('org-profile-page');
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });
    await expect(root).toHaveAttribute('data-mode', 'view');
    // Real values render from the (stubbed) canonical fetch.
    await expect(page.getByTestId('org-profile-name')).toHaveText(MOCK_CANONICAL.name);

    // FR-011a — Edit button is absent for inherited-auditor rows.
    await expect(page.getByTestId('org-profile-edit-button')).toHaveCount(0);
    // Clarifications Q4 — no in-page banner / replacement CTA / parent-link surfaces here.
    // The disclosure lives entirely in the dropdown tooltip (covered by org-selector S10).
    await expect(page.locator('[data-testid="org-profile-inherited-banner"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="org-profile-inherited-cta"]')).toHaveCount(0);
  });
});

// Spec 023 — fail-soft addresses: GET /addresses always responds 200 with null
// primary/billing when no SFID resolves, no Snowflake row matches, or the lookup fails.
// The Profile Page must collapse the address cards gracefully — no toast, no broken page,
// the rest of the page renders.
test.describe('Org Profile — spec 023 empty addresses graceful degradation', () => {
  test('S6: 200-with-nulls from GET /addresses leaves the rest of the page intact with no error toast', async ({ page }) => {
    await stubOrgProfileContext(page, { writers: [MOCK_UID] });

    await page.route(`**/api/orgs/uid/${MOCK_UID}`, (route) => {
      if (route.request().method() !== 'GET') {
        return route.fallback();
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_CANONICAL),
      });
    });

    // Simulate the fail-soft path: the BFF always returns 200 with null addresses when
    // the Snowflake lookup yields nothing (or fails). No fixture data is served anywhere.
    await page.route(`**/api/orgs/uid/${MOCK_UID}/addresses`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ primaryAddress: null, billingAddress: null }),
      })
    );

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });

    await page.goto(PROFILE_URL, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    if (!page.url().includes('/org/profile')) {
      test.skip(true, 'org-lens-enabled flag appears off — /org/profile redirected away');
    }

    const root = page.getByTestId('org-profile-page');
    // Page loads cleanly — no exception thrown by the address-cards null path.
    await expect(root).toHaveAttribute('data-state', 'loaded', { timeout: DATA_LOAD_TIMEOUT });

    // Summary card renders normally.
    await expect(page.getByTestId('org-profile-summary-card')).toBeVisible();
    await expect(page.getByTestId('org-profile-name')).toHaveText(MOCK_CANONICAL.name);

    // No PrimeNG error toast (the component must not surface a toast for missing-addresses).
    await expect(page.locator('p-toast .p-toast-message-error')).toHaveCount(0);

    // The address card scaffold stays mounted (a section heading + empty/fallback content), but
    // the actual fixture address line MUST NOT render — proves the null body short-circuited the data path.
    const primaryCard = page.getByTestId('org-profile-primary-address-card');
    await expect(primaryCard).toBeVisible();
    await expect(primaryCard).not.toContainText(MOCK_ADDRESSES.primaryAddress.line1);
  });
});
