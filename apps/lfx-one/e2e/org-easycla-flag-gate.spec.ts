// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Lens EasyCLA dark-launch gate E2E (GH-1982).
 *
 * The guard has unit tests and the component has unit tests, but neither touches `app.routes.ts` —
 * delete the `canMatch` entry and both still pass while `/org/easycla` becomes reachable with the
 * flag off. That is the one failure a dark launch cannot afford, so it is pinned here instead:
 * flag off must redirect away and hide the nav item, flag on must render the page.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 *
 * `org-lens-cla-m3-enabled` needs no LaunchDarkly targeting — both cases pin it through the same
 * `stubFeatureFlags` localStorage override the ROI specs use (GH-1655). Pinning is what makes the
 * flag-off case meaningful: an unpinned flag is already false, so the test would pass against a
 * route that was never guarded.
 */

import { ACCOUNT_COOKIE_KEY } from '@lfx-one/shared/constants/accounts.constants';
import { ORG_LENS_CLA_M3_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { expect, Page, test } from '@playwright/test';

import { stubFeatureFlags } from './helpers/org-roi.helper';

const EASYCLA_URL = '/org/easycla';
const PAGE_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_ACCOUNT_NAME = 'Acme Motors';
const MOCK_ACCOUNT_SLUG = 'acme-motors';

function fulfillJson(page: Page, glob: string, body: unknown): Promise<void> {
  return page.route(glob, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

/**
 * Enough org context for an account to be selected. Without it the lens has no organization, the
 * sidebar never builds its org section, and both cases would assert against a page still waiting.
 */
async function stubAccountContext(page: Page): Promise<void> {
  await fulfillJson(page, '**/api/user/personas*', {
    personas: ['contributor'],
    personaProjects: {},
    projects: [],
    organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, accountSlug: MOCK_ACCOUNT_SLUG, membershipTier: '', uid: MOCK_ACCOUNT_ID }],
    isRootWriter: false,
  });

  await fulfillJson(page, '**/api/analytics/org-lens-account-context*', [
    { accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, accountSlug: MOCK_ACCOUNT_SLUG, membershipTier: 'Gold' },
  ]);

  await fulfillJson(page, '**/api/orgs/me/role-grants', {
    writers: [MOCK_ACCOUNT_ID],
    auditors: [],
    cascadingWriters: [],
    cascadingAuditors: [],
    username: 'e2e-org-easycla',
    loaded_at: new Date().toISOString(),
  });

  await fulfillJson(page, '**/api/nav/org-items*', {
    items: [{ uid: MOCK_ACCOUNT_ID, accountId: MOCK_ACCOUNT_ID, name: MOCK_ACCOUNT_NAME, logoUrl: null, primaryDomain: 'acme-motors.example', isMember: true }],
    next_page_token: null,
    upstream_failed: false,
    total: 1,
  });

  await page.context().addCookies([{ name: ACCOUNT_COOKIE_KEY, value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }), domain: 'localhost', path: '/' }]);
}

/**
 * Deep-link to `/org/easycla` with the flag pinned, and report where the router settled.
 *
 * The visit to `/` first, then a reload, is the sequence the other Org Lens specs use to get an
 * authenticated app running before the guarded URL is requested. The guard redirects
 * asynchronously, so the caller must assert on a settled URL rather than on arrival.
 */
async function deepLinkToEasycla(page: Page, flagEnabled: boolean): Promise<void> {
  await stubFeatureFlags(page, { [ORG_LENS_CLA_M3_ENABLED_FLAG]: flagEnabled });
  await stubAccountContext(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(EASYCLA_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  // A redirect away from the whole lens means `org-lens-enabled` is off for this user, which is a
  // missing prerequisite rather than a failure of the flag under test.
  if (!page.url().includes('/org/')) {
    test.skip(true, 'org-lens-enabled appears off — /org/easycla redirected out of the lens');
  }
}

test.describe('Org Lens EasyCLA dark-launch gate', () => {
  // Pin a desktop viewport so the nav assertions hold across every Playwright project: the shell's
  // left-nav sidebar is `hidden lg:flex`, so under mobile-chrome (Pixel 5, 393px) it is display:none
  // and the flag-on case would fail on a visibility check that has nothing to do with the flag.
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(() => {
    if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  });

  test('sends a deep link to Org Overview and hides the nav item while the flag is off', async ({ page }) => {
    await deepLinkToEasycla(page, false);

    await expect(page).toHaveURL(/\/org\/overview/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-page')).toHaveCount(0);
    await expect(page.getByTestId('sidebar').getByRole('link', { name: 'EasyCLA' })).toHaveCount(0);
  });

  test('renders the page and the nav item once the flag is on', async ({ page }) => {
    await deepLinkToEasycla(page, true);

    await expect(page).toHaveURL(/\/org\/easycla/, { timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-page')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-easycla-title')).toContainText(MOCK_ACCOUNT_NAME);
    await expect(page.getByTestId('org-easycla-empty-state')).toBeVisible();
    await expect(page.getByTestId('sidebar').getByRole('link', { name: 'EasyCLA' })).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
  });
});
