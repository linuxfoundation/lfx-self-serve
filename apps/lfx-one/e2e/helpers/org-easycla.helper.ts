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
import { ORG_EASYCLA_PATH, ORG_EASYCLA_SIGNATURE_PARAM } from '@lfx-one/shared/constants/cla.constants';
import { ORG_LENS_CLA_M3_ENABLED_FLAG, ORG_LENS_ENABLED_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import type {
  OrgClaApprovalList,
  OrgClaContributorAcknowledgment,
  OrgClaContributorAcknowledgmentList,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaManager,
  OrgClaManagerList,
} from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, test } from '@playwright/test';

import { stubFeatureFlags } from './org-roi.helper';

/** The leftover address the e2e enters through (every release routes it); the org-addressed form is asserted on the way out. */
export const EASYCLA_URL = ORG_EASYCLA_PATH;
export const PAGE_LOAD_TIMEOUT = 30_000;

export const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
export const MOCK_ACCOUNT_NAME = 'Acme Motors';

/** The route the page reads its list from — the one thing each spec stubs differently. */
export const CLA_GROUPS_ROUTE = '**/api/orgs/*/lens/cla-groups';

/** Pair-check hop for attestation Continue and approval-list mutations (#1980). Stub allowed or attestation / mutations fail closed. */
export const PERMISSIONS_CHECKS_ROUTE = '**/api/orgs/*/lens/cla-groups/permissions/checks';

export const APPROVAL_LIST_ROUTE = '**/api/orgs/*/lens/cla-groups/*/approval-list';

export const MANAGERS_ROUTE = '**/api/orgs/*/lens/cla-groups/*/managers';
export const MANAGER_DELETE_ROUTE = '**/api/orgs/*/lens/cla-groups/*/managers/*';

/** Contributor acknowledgments for one agreement. Query string carries search and nextKey. */
export const ACKNOWLEDGMENTS_ROUTE = '**/api/orgs/*/lens/cla-groups/*/acknowledgments**';

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
    claGroupId: STUB_CLA_GROUP_ID,
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
    organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, membershipTier: '', uid: MOCK_ACCOUNT_ID }],
    isRootWriter: false,
  });

  await fulfillJson(page, '**/api/analytics/org-lens-account-context*', [
    { accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, membershipTier: 'Gold' },
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

  // Spec 050: an org-addressed EasyCLA address (`/org/{segment}/easycla/…`) goes through the
  // resolver on arrival. The mock organization publishes no slug, so its canonical address is the
  // SFID form — which is also what the BFF mints for a signing return.
  await page.route('**/api/orgs/resolve/*', (route) => {
    const segment = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    if (segment !== MOCK_ACCOUNT_ID) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uid: MOCK_ACCOUNT_ID, slug: null, name: MOCK_ACCOUNT_NAME }) });
  });
  await page.route('**/api/orgs/uid/*', (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        uid: MOCK_ACCOUNT_ID,
        accountId: MOCK_ACCOUNT_ID,
        name: MOCK_ACCOUNT_NAME,
        slug: null,
        parentUid: null,
        isMember: true,
        logoUrl: null,
      }),
    });
  });

  await page.context().addCookies([{ name: ACCOUNT_COOKIE_KEY, value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }), domain: 'localhost', path: '/' }]);
}

/**
 * ACS pair-check hop for attestation Continue and approval-list mutations. Existing org-easycla e2e
 * stubs this allowed; a denied stub refuses Review and Sign and hides Add/Edit/Remove. Sign CLA
 * itself stays offered. Picker Continue and Start do not POST this hop.
 */
export async function stubPermissionChecks(page: Page, allowed = true): Promise<void> {
  await page.route(PERMISSIONS_CHECKS_ROUTE, (route) => {
    if (route.request().method() !== 'POST') {
      return route.fallback();
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed }) });
  });
}

/**
 * Land on `/org/easycla` with the M3 flag on and the CLA list stubbed by the caller.
 *
 * The visit to `/` first, then a reload, is the sequence the other Org Lens specs use to get an
 * authenticated app running before the guarded URL is requested.
 */
export async function gotoEasyclaList(page: Page, stubList: (page: Page) => Promise<void>, permissionAllowed = true): Promise<void> {
  // Both flags, not just this feature's. `/org/*` sits behind the parent lens flag as well, so
  // pinning only the child leaves these tests at the mercy of a remote flag: wherever it is off
  // they skip rather than fail, and a suite that skips reports the same green as one that ran.
  await stubFeatureFlags(page, { [ORG_LENS_ENABLED_FLAG]: true, [ORG_LENS_CLA_M3_ENABLED_FLAG]: true });
  await stubAccountContext(page);
  await stubPermissionChecks(page, permissionAllowed);
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
 * Land on `/org/easycla/{claGroupId}` with the same context `gotoEasyclaList` establishes.
 *
 * Addressed by CLA Group since #2364, with `signatureId` optional: pass it only where the case is
 * about naming one of several agreements in one group, so every other case exercises the bare
 * group address a share or a post-signing return would use.
 *
 * Routed to directly rather than by clicking a card, because most detail cases are about what the
 * page renders for a given row and would otherwise fail on the list. The one case that is about
 * the card click navigates from the list itself.
 *
 * @param page - Playwright page to drive.
 * @param claGroupId - CLA Group the address is about — the authoritative half.
 * @param stubList - Installs the CLA Group list response this case needs.
 * @param signatureId - Narrows the group to one agreement; omit unless the case is about that choice.
 * @param permissionAllowed - ACS pair-check stub. Defaults true so mutation cases stay writable unless the case is about a deny.
 */
export async function gotoEasyclaDetail(
  page: Page,
  claGroupId: string,
  stubList: (page: Page) => Promise<void>,
  signatureId?: string,
  permissionAllowed = true
): Promise<void> {
  await stubFeatureFlags(page, { [ORG_LENS_ENABLED_FLAG]: true, [ORG_LENS_CLA_M3_ENABLED_FLAG]: true });
  await stubAccountContext(page);
  await stubPermissionChecks(page, permissionAllowed);
  await stubList(page);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await page.reload({ waitUntil: 'domcontentloaded' });

  const query = signatureId ? `?${ORG_EASYCLA_SIGNATURE_PARAM}=${encodeURIComponent(signatureId)}` : '';
  await page.goto(`${EASYCLA_URL}/${claGroupId}${query}`, { waitUntil: 'domcontentloaded' });
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

/**
 * The CLA Group of that same default row, which is the path half of the address the return landing
 * now produces (#2364). Kept beside the signature id for the same reason: the landing is built from
 * the row the page finds, so both halves have to come from that row's fixture.
 *
 * CLA-Group-shaped rather than readable, because the address is matched canonically — the producer
 * emits one group hyphenated or compact, in either case, and a value that is not group-shaped
 * canonicalises to nothing and so matches no row at all.
 */
export const STUB_CLA_GROUP_ID = 'c1a90000-0000-4000-8000-000000000001';

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

// ---------------------------------------------------------------------------
// The Approval List tab (GH-2410)
// ---------------------------------------------------------------------------

/** An editable list. Cases override the entries they are about. */
export function approvalList(overrides: Partial<OrgClaApprovalList> = {}): OrgClaApprovalList {
  return {
    signatureId: STUB_SIGNATURE_ID,
    entries: [],
    canEdit: true,
    ...overrides,
  };
}

/**
 * Stubs both verbs on the approval-list path. PUT is never optional: aborting anything that is
 * not GET or PUT is how a missed intercept stays a failed test rather than a write against a
 * real agreement.
 */
export async function stubApprovalList(page: Page, options: { get?: OrgClaApprovalList; put?: OrgClaApprovalList } = {}): Promise<void> {
  const getBody = options.get ?? approvalList();
  const putBody = options.put ?? getBody;

  await page.route(APPROVAL_LIST_ROUTE, (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getBody) });
    }
    if (method === 'PUT') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(putBody) });
    }
    return route.abort();
  });
}

export function isApprovalListPut(request: { url(): string; method(): string }): boolean {
  return request.url().includes('/approval-list') && request.method() === 'PUT';
}

export function countPutRequests(page: Page): { readonly count: number } {
  let putCount = 0;
  page.on('request', (request) => {
    if (isApprovalListPut(request)) {
      putCount += 1;
    }
  });
  return {
    get count() {
      return putCount;
    },
  };
}

export async function gotoApproval(page: Page, options: { get?: OrgClaApprovalList; put?: OrgClaApprovalList } = {}): Promise<void> {
  await gotoEasyclaDetail(page, STUB_CLA_GROUP_ID, async (p) => {
    await fulfillJson(p, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
    await stubApprovalList(p, options);
  });
  await openApprovalTab(page);
}

/** Opens the Approval List tab. The panel mounts only after this click, and only when signed. */
export async function openApprovalTab(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-detail-tab-approval').click();
  await expect(page.getByTestId('org-easycla-approval-list')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

/** The dialog's value field. Same `data-test` quirk as the list search box. */
export function approvalDialogValue(page: Page, index = 0): Locator {
  return page.locator(`[data-test="org-easycla-approval-dialog-value-${index}"]`);
}

// ---------------------------------------------------------------------------
// The CLA Managers tab (#1984)
// ---------------------------------------------------------------------------

export function manager(overrides: Partial<OrgClaManager> = {}): OrgClaManager {
  return {
    lfUsername: 'kwame.mensah',
    name: 'Kwame Mensah',
    email: 'contributor@example.org',
    addedOn: '2024-05-02T11:00:00Z',
    ...overrides,
  };
}

export function managerList(overrides: Partial<OrgClaManagerList> = {}): OrgClaManagerList {
  return {
    signatureId: STUB_SIGNATURE_ID,
    managers: [manager(), manager({ lfUsername: 'ada.porter', name: 'Ada Porter', email: 'ada.porter@example.org' })],
    ...overrides,
  };
}

/**
 * Stubs GET/POST/DELETE on the managers path. Mutations never reach a real CLA service.
 */
export async function stubManagers(
  page: Page,
  options: { initial?: OrgClaManagerList; afterPost?: OrgClaManagerList; afterDelete?: OrgClaManagerList; postBody?: OrgClaManager } = {}
): Promise<void> {
  let current = options.initial ?? managerList();
  const postResponse = options.postBody ?? manager({ lfUsername: 'new.manager', name: 'New Manager', email: 'new.manager@example.org' });

  await page.route(MANAGERS_ROUTE, (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(current) });
    }
    if (method === 'POST') {
      current = options.afterPost ?? managerList({ managers: [...current.managers, postResponse] });
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(postResponse) });
    }
    return route.abort();
  });

  await page.route(MANAGER_DELETE_ROUTE, (route) => {
    if (route.request().method() !== 'DELETE') {
      return route.fallback();
    }
    current = options.afterDelete ?? managerList({ managers: current.managers.slice(1) });
    return route.fulfill({ status: 204 });
  });
}

export function isManagersPost(request: { url(): string; method(): string }): boolean {
  return request.url().includes('/managers') && request.method() === 'POST' && !request.url().match(/\/managers\/[^/?]+$/);
}

export function isManagersDelete(request: { url(): string; method(): string }): boolean {
  return request.url().includes('/managers/') && request.method() === 'DELETE';
}

export function countManagerWriteRequests(page: Page): { readonly postCount: number; readonly deleteCount: number } {
  let postCount = 0;
  let deleteCount = 0;
  page.on('request', (request) => {
    if (isManagersPost(request)) postCount += 1;
    if (isManagersDelete(request)) deleteCount += 1;
  });
  return {
    get postCount() {
      return postCount;
    },
    get deleteCount() {
      return deleteCount;
    },
  };
}

export async function gotoManagers(
  page: Page,
  options: { initial?: OrgClaManagerList; afterPost?: OrgClaManagerList; afterDelete?: OrgClaManagerList; postBody?: OrgClaManager } = {}
): Promise<void> {
  await gotoEasyclaDetail(page, STUB_CLA_GROUP_ID, async (p) => {
    await fulfillJson(p, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
    await stubManagers(p, options);
  });
  await openManagersTab(page);
}

export async function openManagersTab(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-detail-tab-managers').click();
  await expect(page.getByTestId('org-easycla-managers')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}

export function addManagerFirstName(page: Page): Locator {
  return page.locator('[data-test="org-easycla-add-manager-first-name"]');
}

export function addManagerLastName(page: Page): Locator {
  return page.locator('[data-test="org-easycla-add-manager-last-name"]');
}

export function addManagerEmail(page: Page): Locator {
  return page.locator('[data-test="org-easycla-add-manager-email"]');
}

// ---------------------------------------------------------------------------
// The Contributor Acknowledgments tab (#2806)
// ---------------------------------------------------------------------------

export function acknowledgment(overrides: Partial<OrgClaContributorAcknowledgment> = {}): OrgClaContributorAcknowledgment {
  return {
    signatureId: 'ecla-sig-1',
    name: 'Ada Lovelace',
    lfLogin: 'ada',
    cclaVersion: 'v2.1',
    signedOn: '2026-03-11T09:20:00Z',
    approved: true,
    ...overrides,
  };
}

export function acknowledgmentList(overrides: Partial<OrgClaContributorAcknowledgmentList> = {}): OrgClaContributorAcknowledgmentList {
  return {
    signatureId: 'signature-uuid-1',
    list: [acknowledgment()],
    canEdit: true,
    resultCount: 1,
    totalCount: 1,
    nextKey: null,
    ...overrides,
  };
}

/**
 * Stubs GET on the acknowledgments path. A search term and a nextKey select a different page
 * when the case supplied one, so Load more and search are real requests against the stub.
 */
export async function stubAcknowledgments(
  page: Page,
  options: { initial?: OrgClaContributorAcknowledgmentList; search?: OrgClaContributorAcknowledgmentList; next?: OrgClaContributorAcknowledgmentList } = {}
): Promise<void> {
  const initial = options.initial ?? acknowledgmentList({ list: [], resultCount: 0, totalCount: 0 });

  await page.route(ACKNOWLEDGMENTS_ROUTE, (route) => {
    if (route.request().method() !== 'GET') return route.abort();
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search')?.trim() ?? '';
    const nextKey = url.searchParams.get('nextKey')?.trim() ?? '';
    const body = search && options.search ? options.search : nextKey && options.next ? options.next : initial;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

export async function gotoAcknowledgments(
  page: Page,
  options: { initial?: OrgClaContributorAcknowledgmentList; search?: OrgClaContributorAcknowledgmentList; next?: OrgClaContributorAcknowledgmentList } = {}
): Promise<void> {
  await gotoEasyclaDetail(page, STUB_CLA_GROUP_ID, async (p) => {
    await fulfillJson(p, CLA_GROUPS_ROUTE, claGroupList([claGroup()]));
    await stubAcknowledgments(p, options);
  });
  await openAcknowledgmentsTab(page);
}

export async function openAcknowledgmentsTab(page: Page): Promise<void> {
  await page.getByTestId('org-easycla-detail-tab-acknowledgments').click();
  await expect(page.getByTestId('org-easycla-acknowledgments')).toBeVisible({ timeout: PAGE_LOAD_TIMEOUT });
}
