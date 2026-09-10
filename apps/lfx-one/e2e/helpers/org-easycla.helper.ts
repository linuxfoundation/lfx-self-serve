// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Shared setup for the Org Lens EasyCLA specs (GH-1978).
 *
 * The gate spec, the content spec and the structural spec all need the same thing before they can
 * assert anything: an authenticated app with an organization selected and the M3 flag pinned. Only
 * the CLA list response differs between them, so that is the parameter and the rest is fixed here.
 */

import { ACCOUNT_COOKIE_KEY } from '@lfx-one/shared/constants/accounts.constants';
import { ORG_LENS_CLA_M3_ENABLED_FLAG, ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import type { OrgClaGroup, OrgClaGroupList } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, test } from '@playwright/test';

import { stubFeatureFlags } from './org-roi.helper';

export const EASYCLA_URL = '/org/easycla';
export const PAGE_LOAD_TIMEOUT = 30_000;

export const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
export const MOCK_ACCOUNT_NAME = 'Acme Motors';
export const MOCK_ACCOUNT_SLUG = 'acme-motors';

/** The route the page reads its list from — the one thing each spec stubs differently. */
export const CLA_GROUPS_ROUTE = '**/api/orgs/*/lens/cla-groups';

/**
 * The detail page's presigned-URL route.
 *
 * Deliberately narrower than `CLA_GROUPS_ROUTE` with a wildcard suffix: the list route is a strict
 * prefix of this one, so a spec that stubs the list with a trailing `**` would answer the PDF
 * request with a list envelope and the download would fail on a shape mismatch rather than on
 * anything the case was about.
 */
export const PDF_URL_ROUTE = '**/api/orgs/*/lens/cla-groups/*/pdf-url';

export function fulfillJson(page: Page, glob: string, body: unknown): Promise<void> {
  return page.route(glob, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
}

/**
 * A CLA Group row. Cases override only the field they are about, so a case that fails names the
 * field it was testing rather than a fixture detail it never mentioned.
 */
export function claGroup(overrides: Partial<OrgClaGroup> = {}): OrgClaGroup {
  return {
    id: 'signature-uuid-1',
    claGroupId: 'cla-group-uuid-1',
    claGroupName: 'Nimbus Foundation CLA',
    // Present on every fixture row so the signing-entity subline renders: the server sends it only
    // when it differs from the organization's own name, which is what makes the subline meaningful.
    signingEntityName: 'Acme Motors GmbH',
    foundationName: 'Nimbus Foundation',
    projects: [{ projectSfid: 'a09410000182dD3AAI', projectName: 'Cascade' }],
    signed: true,
    status: 'signed',
    signedOn: '2024-03-11T09:20:00Z',
    needsClaManager: false,
    claManagersCount: 2,
    approvalCriteriaCount: 4,
    ...overrides,
  };
}

/** Wraps rows in the list envelope the page's endpoint returns. */
export function claGroupList(claGroups: OrgClaGroup[]): OrgClaGroupList {
  return { orgUid: MOCK_ACCOUNT_ID, claGroups };
}

/**
 * Enough org context for an account to be selected. Without it the lens has no organization, the
 * sidebar never builds its org section, and a spec would assert against a page still waiting.
 */
export async function stubAccountContext(page: Page): Promise<void> {
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
 * Land on `/org/easycla` with the M3 flag on and the CLA list stubbed by the caller.
 *
 * The visit to `/` first, then a reload, is the sequence the other Org Lens specs use to get an
 * authenticated app running before the guarded URL is requested.
 */
export async function gotoEasyclaList(page: Page, stubList: (page: Page) => Promise<void>): Promise<void> {
  // Both flags, not just this feature's. `/org/*` sits behind the parent lens flag as well, so
  // pinning only the child leaves these tests at the mercy of a remote flag: wherever it is off
  // they skip rather than fail, and a suite that skips reports the same green as one that ran.
  await stubFeatureFlags(page, { [ORG_LENS_ENABLED_FLAG]: true, [ORG_LENS_CLA_M3_ENABLED_FLAG]: true });
  await stubAccountContext(page);
  await stubList(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(EASYCLA_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  // A redirect away from the whole lens means `org-lens-enabled` is off for this user, which is a
  // missing prerequisite rather than a failure of anything these specs are about.
  if (!page.url().includes('/org/')) {
    test.skip(true, 'org-lens-enabled appears off — /org/easycla redirected out of the lens');
  }
}

/**
 * Land on `/org/easycla/{signatureId}` with the same context `gotoEasyclaList` establishes.
 *
 * Routed to directly rather than by clicking a card, because most detail cases are about what the
 * page renders for a given row and would otherwise fail on the list. The one case that is about
 * the card click navigates from the list itself.
 */
export async function gotoEasyclaDetail(page: Page, signatureId: string, stubList: (page: Page) => Promise<void>): Promise<void> {
  await stubFeatureFlags(page, { [ORG_LENS_ENABLED_FLAG]: true, [ORG_LENS_CLA_M3_ENABLED_FLAG]: true });
  await stubAccountContext(page);
  await stubList(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(`${EASYCLA_URL}/${signatureId}`, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);

  if (!page.url().includes('/org/')) {
    test.skip(true, 'org-lens-enabled appears off — /org/easycla redirected out of the lens');
  }
}

/**
 * The search box.
 *
 * `lfx-input-text` emits its hook as `data-test`, not the `data-testid` Playwright resolves by
 * default, so this one control is addressed by attribute while everything else on the page uses
 * `getByTestId`.
 */
export function searchInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-search"]');
}

/** Skips when the shared Playwright credentials are absent, as every authenticated spec does. */
export function skipWithoutCredentials(): void {
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}
