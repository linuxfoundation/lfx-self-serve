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

// ---------------------------------------------------------------------------
// The self-sign hand-off (GH-1983)
// ---------------------------------------------------------------------------

/** The CLA Group search behind the picker. */
export const SIGN_OPTIONS_ROUTE = '**/api/orgs/*/lens/cla-groups/sign-options*';

/** The write. Every spec below stubs it; none may ever let it reach a real CLA service. */
export const SIGN_ROUTE = '**/api/orgs/*/lens/cla-groups/sign';

/**
 * Where the hand-off is told to send the signer.
 *
 * A synthetic address on a reserved domain, routed and fulfilled locally by `stubHandoff` so the
 * browser never leaves the app under test. A real signing address here would create a real
 * envelope against a real agreement on every run.
 */
export const STUB_SIGN_URL = 'https://signing.example.org/session/e2e-stub';

/**
 * The signature the stubbed hand-off says it opened.
 *
 * Deliberately the `id` of the default `claGroup()` row, because that is what makes the return
 * landing observable: the page only navigates to an agreement it can see in the organization's own
 * list, so a stub signature absent from the stubbed list would leave the signatory on it.
 */
export const STUB_SIGNATURE_ID = 'signature-uuid-1';

/** A searchable CLA Group, corporate-signable unless a case says otherwise. */
export function signOption(overrides: Record<string, unknown> = {}) {
  return {
    claGroupId: 'aaaaaaaa-1111-4111-8111-111111111111',
    claGroupName: 'Cascade CLA',
    projectName: 'Cascade',
    projectSfid: 'a09410000182dD2AAI',
    cclaEnabled: true,
    iclaEnabled: true,
    matchTypes: ['project'],
    organizations: [],
    ...overrides,
  };
}

export function signOptionsResponse(results: ReturnType<typeof signOption>[], truncated = false) {
  return { searchTerm: 'cascade', resultCount: results.length, truncated, results };
}

/**
 * Stubs the whole hand-off chain: the picker's search, the signature request, and the signing
 * address the request answers with.
 *
 * The last one is the important one and is not optional. The component assigns the returned
 * address to `location.href`, so without a route intercepting it the browser navigates away to
 * whatever the fixture said — and a fixture that ever named a real signing host would drive a
 * real DocuSign session from CI. Fulfilling it locally keeps the assertion (did we navigate to
 * exactly the address the server returned?) while the navigation lands on a blank local page.
 */
export async function stubHandoff(page: Page, options: { search?: unknown; sign?: { status: number; body: unknown }; signUrl?: string } = {}): Promise<void> {
  const signUrl = options.signUrl ?? STUB_SIGN_URL;

  await fulfillJson(page, SIGN_OPTIONS_ROUTE, options.search ?? signOptionsResponse([signOption()]));

  const sign = options.sign ?? { status: 200, body: { signUrl, signatureId: STUB_SIGNATURE_ID } };
  await page.route(SIGN_ROUTE, (route) => route.fulfill({ status: sign.status, contentType: 'application/json', body: JSON.stringify(sign.body) }));

  await page.route(`${signUrl}**`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<html><body data-testid="stub-signing-service">stub signing service</body></html>' })
  );
}

/** The picker's search box. Same `data-test` quirk as the list's, for the same reason. */
export function groupSearchInput(page: Page): Locator {
  return page.locator('[data-test="org-easycla-group-select-search"]');
}

/** Skips when the shared Playwright credentials are absent, as every authenticated spec does. */
export function skipWithoutCredentials(): void {
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
  }
}
