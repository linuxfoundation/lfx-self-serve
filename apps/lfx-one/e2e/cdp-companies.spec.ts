// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Company Lens: CDP companies, `/company/{CDP id}/{section}` (lfx-self-serve#2092).
 *
 * The harness logs in one identity, so per-identity UI states are stubbed at the network edge (`page.route`) and the
 * server guarantees are asserted against the real BFF with `page.request`, each guarded on the identity the harness
 * has (skipped with the reason when it does not apply). Other identities are checked by hand against a deployed environment.
 *
 * - Search and open: CDP rows load below the B2B rows, tagged "CDP"; a same-name B2B and CDP company are both listed,
 *   B2B rows unchanged; picking a CDP row opens `/company/{CDP id}`; under `/company`, a B2B slug and a static page
 *   (`/company/overview`) still open their B2B pages, and a CDP id opens the CDP page without reaching the B2B resolver.
 * - Outside the audience: availability false hides every CDP surface and `/company/{CDP id}` reads "no company"; a
 *   malformed address reads the same with no page request; callers outside the audience (non-staff global org admin
 *   with the switch off, global-org-auditors with it on or off) get exactly what the server gives an outsider; against
 *   the real BFF an unknown and a malformed id get identical status and body, and search answers an outsider 404.
 * - Navigation: sections the page marks `on` are links, every other Company Lens section is greyed with "Not available
 *   for CDP companies"; off and refused sections render their state; against the real BFF an off section is refused
 *   403 `SECTION_OFF_BY_DESIGN` and a low-activity company's sections 404; every CDP response, stubbed or real, carries
 *   only allow-listed keys (no person-level field).
 * - Meetings and Groups: off by design while their flag is off; with it on, rows for LF staff and the no-access state
 *   for anyone else; against the real BFF the staff identity reads rows when the flag is on.
 * - Redirects: merged (CDP redirect, same section), B2B-linked (the company's Company Lens home), unknown, no-activity
 *   and not-enough-activity ids.
 *
 * Optional environment for the real-BFF cases: `E2E_CDP_COMPANY_ID` (a searchable CDP id; otherwise one is found by
 * search) and `E2E_CDP_LOW_ACTIVITY_ID` (an addressable CDP id below the search rule).
 */

import { APIResponse, expect, Page, test } from '@playwright/test';
// Deep-imported, not from the `constants` barrel: the barrel pulls in modules that fail to load outside the app.
import { CDP_COMPANY_OFF_BY_DESIGN_REASON, CDP_COMPANY_SEARCH_TAG } from '@lfx-one/shared/constants/cdp-company.constants';
import type { CdpCompanyPage, CdpCompanyResponse, CdpCompanySection, CdpCompanySectionPayloads, CdpSectionKey } from '@lfx-one/shared/interfaces';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_DOMAIN, SYNTHETIC_ORG_NAME, SYNTHETIC_ORG_SLUG } from './fixtures/mock-data/synthetic-org.mock';

test.setTimeout(120_000);
test.use({ viewport: { width: 1440, height: 900 } });

const UI_TIMEOUT = 30_000;

// Made-up crowd.dev organization ids (lowercase UUIDs).
const OK_ID = '1a2b3c4d-0000-4000-8000-000000000001';
const MERGED_ID = '1a2b3c4d-0000-4000-8000-000000000002';
const B2B_LINKED_ID = '1a2b3c4d-0000-4000-8000-000000000003';
const UNKNOWN_ID = '1a2b3c4d-0000-4000-8000-000000000004';
const NO_ACTIVITY_ID = '1a2b3c4d-0000-4000-8000-000000000005';
const NOT_ENOUGH_ID = '1a2b3c4d-0000-4000-8000-000000000006';
const MALFORMED_ID = '1A2B3C4D-0000-4000-8000-000000000001';

const COMPANY_NAME = SYNTHETIC_ORG_NAME;
const TOP_PROJECT = 'Kubernetes';

// The B2B company a linked CDP id redirects to, and a B2B company sharing the CDP company's name.
const B2B_UID = SYNTHETIC_ORG_ACCOUNT_ID;
const B2B_SLUG = SYNTHETIC_ORG_SLUG;

const SEARCH_TERM = 'acme';

const ROLE_GRANTS_STAFF = {
  writers: [B2B_UID],
  auditors: [],
  cascadingWriters: [],
  cascadingAuditors: [],
  isStaff: true,
  username: 'e2e-cdp-companies',
  loaded_at: new Date().toISOString(),
};

const B2B_ROW = {
  uid: B2B_UID,
  accountId: B2B_UID,
  name: COMPANY_NAME,
  slug: B2B_SLUG,
  logoUrl: null,
  primaryDomain: SYNTHETIC_ORG_DOMAIN,
  isMember: true,
  parentName: null,
};

const ON_SECTIONS: CdpCompanySection[] = [
  { key: 'dashboard', state: 'on' },
  { key: 'projects', state: 'on' },
  { key: 'profile', state: 'on' },
  { key: 'events', state: 'on' },
  { key: 'training', state: 'on' },
];

function sections(meetingsGroups: 'on' | 'off-by-design'): CdpCompanySection[] {
  return [...ON_SECTIONS, { key: 'meetings', state: meetingsGroups }, { key: 'groups', state: meetingsGroups }];
}

function okPage(meetingsGroups: 'on' | 'off-by-design' = 'off-by-design'): CdpCompanyPage {
  return {
    state: 'ok',
    company: { cdpId: OK_ID, name: COMPANY_NAME, topProjectName: TOP_PROJECT, lastActiveMonth: '2026-10' },
    sections: sections(meetingsGroups),
  };
}

const SECTION_PAYLOADS: CdpCompanySectionPayloads = {
  dashboard: { contributors730d: 1234, activities730d: 56789, lastActiveMonth: '2026-10', topProjectName: TOP_PROJECT },
  projects: {
    rows: [
      { projectName: TOP_PROJECT, contributors: 900, activities: 40000 },
      { projectName: 'Envoy', contributors: 120, activities: 3000 },
    ],
  },
  profile: { name: COMPANY_NAME, topProjectName: TOP_PROJECT, lastActiveMonth: '2026-10' },
  events: { rows: [{ eventName: 'KubeCon + CloudNativeCon North America 2025', eventDate: '2025-11-10', attendees: 42 }] },
  training: { enrollments: 87 },
  meetings: { rows: [{ projectName: TOP_PROJECT, meetingType: 'Technical', attendance: 31 }] },
  groups: { rows: [{ committeeName: 'Technical Oversight Committee', projectName: TOP_PROJECT, activeSeats: 4 }] },
};

type StubAnswer = { status: number; body: unknown };

interface CdpStub {
  availability: StubAnswer;
  pages: Record<string, StubAnswer>;
  /** Per section key; defaults to the payload above. */
  sections?: Partial<Record<CdpSectionKey, StubAnswer>>;
  search?: StubAnswer;
}

interface CdpTraffic {
  /** Every `/api/companies/*` request path the browser made. */
  requests: string[];
  /** Every JSON body the browser received from `/api/companies/*`, for the key allow-list. */
  bodies: unknown[];
  /** Every B2B resolver segment the browser asked about. */
  resolved: string[];
}

const NOT_FOUND: StubAnswer = { status: 404, body: { code: 'NOT_FOUND' } };

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep the test running.
  }
}

/**
 * Stubs the CDP BFF and the B2B identity calls the shell makes. A merged id answers a CDP redirect to `OK_ID`, a
 * linked id a B2B redirect to `B2B_UID` (the server answers a B2B target by its SFID, never its slug), which the
 * stubbed resolver answers with the company's canonical slug.
 */
async function stubCdp(page: Page, stub: CdpStub): Promise<CdpTraffic> {
  const traffic: CdpTraffic = { requests: [], bodies: [], resolved: [] };

  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ROLE_GRANTS_STAFF) })
  );
  await page.route('**/api/nav/org-items*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [B2B_ROW], next_page_token: null, upstream_failed: false, total: 1 }),
    })
  );
  await page.route('**/api/orgs/resolve/*', (route) => {
    const segment = decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop() ?? '');
    traffic.resolved.push(segment);
    if (segment !== B2B_SLUG && segment !== B2B_UID) {
      return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Organization not found' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ uid: B2B_UID, slug: B2B_SLUG, name: COMPANY_NAME }) });
  });

  await page.route('**/api/companies/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    traffic.requests.push(path);
    const parts = path.split('/').filter(Boolean); // ['api', 'companies', …]
    let answer: StubAnswer = NOT_FOUND;
    if (parts[2] === 'availability') {
      answer = stub.availability;
    } else if (parts[2] === 'search') {
      answer = stub.search ?? NOT_FOUND;
    } else if (parts[3] === 'sections') {
      const key = parts[4] as CdpSectionKey;
      answer = stub.sections?.[key] ?? { status: 200, body: SECTION_PAYLOADS[key] };
    } else if (parts.length === 3) {
      answer = stub.pages[decodeURIComponent(parts[2])] ?? NOT_FOUND;
    }
    traffic.bodies.push(answer.body);
    return route.fulfill({ status: answer.status, contentType: 'application/json', body: JSON.stringify(answer.body) });
  });

  return traffic;
}

const AVAILABLE: StubAnswer = { status: 200, body: { available: true } };
const UNAVAILABLE: StubAnswer = { status: 200, body: { available: false } };

const STANDARD_PAGES: Record<string, StubAnswer> = {
  [OK_ID]: { status: 200, body: okPage() },
  [MERGED_ID]: { status: 200, body: { redirect: { kind: 'cdp', target: OK_ID } } },
  [B2B_LINKED_ID]: { status: 200, body: { redirect: { kind: 'b2b', target: B2B_UID } } },
  [NO_ACTIVITY_ID]: {
    status: 200,
    body: { state: 'no-activity', company: { cdpId: NO_ACTIVITY_ID, name: 'Quiet Company', lastActiveMonth: '2023-03' }, sections: [] },
  },
  [NOT_ENOUGH_ID]: {
    status: 200,
    body: { state: 'not-enough-activity', company: { cdpId: NOT_ENOUGH_ID, name: 'Small Company', lastActiveMonth: '2025-11' }, sections: [] },
  },
};

/** Every key a CDP response may carry: counts and labels only. */
const ALLOWED_KEYS: Record<string, true> = {
  available: true,
  code: true,
  items: true,
  unavailable: true,
  cdpId: true,
  name: true,
  logoUrl: true,
  state: true,
  company: true,
  sections: true,
  key: true,
  topProjectName: true,
  lastActiveMonth: true,
  redirect: true,
  kind: true,
  target: true,
  contributors730d: true,
  activities730d: true,
  rows: true,
  projectName: true,
  contributors: true,
  activities: true,
  eventName: true,
  eventDate: true,
  attendees: true,
  enrollments: true,
  certifications: true,
  meetingType: true,
  attendance: true,
  committeeName: true,
  activeSeats: true,
};

/** Keys that name a person-level field; listed so a failure says what leaked. */
const PERSON_KEY_PATTERN = /e-?mail|avatar|title|user_?name|login|first_?name|last_?name|full_?name|person|people|member|github|linkedin|photo/i;

/**
 * Fails on any key outside the allow-list, on any person-level key, and on a `name` anywhere but a company: a search
 * item or page summary (they carry `cdpId`) or the Profile payload's root.
 */
function assertCompanyLevelOnly(body: unknown, where: string, isProfileRoot = false): void {
  if (Array.isArray(body)) {
    body.forEach((entry, index) => assertCompanyLevelOnly(entry, `${where}[${index}]`));
    return;
  }
  if (!body || typeof body !== 'object') return;
  const entries = Object.entries(body);
  const keys = entries.map(([key]) => key);
  for (const [key, value] of entries) {
    expect(PERSON_KEY_PATTERN.test(key), `${where}.${key} is a person-level field`).toBe(false);
    expect(ALLOWED_KEYS[key] === true, `${where}.${key} is not an allow-listed CDP key`).toBe(true);
    if (key === 'name') {
      expect(isProfileRoot || keys.includes('cdpId'), `${where}.name is not a company name`).toBe(true);
    }
    assertCompanyLevelOnly(value, `${where}.${key}`);
  }
}

async function openSelector(page: Page): Promise<void> {
  const trigger = page.getByTestId('org-selector');
  await expect(trigger).toBeVisible({ timeout: UI_TIMEOUT });
  await trigger.click();
  await expect(page.getByTestId('org-selector-list')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------------------------------------------
// Real-BFF helpers
// ---------------------------------------------------------------------------------------------------------------

type Audience = 'available' | 'unavailable';

/** Skips the running test; typed `never` so the code after it is narrowed. */
function skip(reason: string): never {
  test.skip(true, reason);
  throw new Error(reason);
}

/** One field of a parsed JSON body, or undefined when the body is not an object carrying it. */
function jsonField(body: unknown, key: string): unknown {
  return body && typeof body === 'object' ? Reflect.get(body, key) : undefined;
}

async function readJson(response: APIResponse): Promise<unknown> {
  const body: unknown = JSON.parse(await response.text());
  return body;
}

/** The harness identity's audience answer, or a skip when the CDP BFF is not reachable in this environment. */
async function realAudience(page: Page): Promise<Audience> {
  const response = await page.request.get('/api/companies/availability', { failOnStatusCode: false });
  const contentType = response.headers()['content-type'] ?? '';
  if (response.status() === 503) skip('CDP audience check unavailable (503 ROLE_GRANTS_UNAVAILABLE) in this environment');
  if (response.status() !== 200 || !contentType.includes('application/json')) {
    skip(`CDP BFF not deployed here — /api/companies/availability answered ${response.status()}`);
  }
  const body = await readJson(response);
  assertCompanyLevelOnly(body, 'availability');
  return jsonField(body, 'available') === true ? 'available' : 'unavailable';
}

/** A searchable CDP id the harness identity can open: `E2E_CDP_COMPANY_ID`, else the first search hit. */
async function realCompanyId(page: Page): Promise<string> {
  const configured = process.env['E2E_CDP_COMPANY_ID'];
  if (configured) return configured;
  for (const term of ['tech', 'labs', 'soft', 'data']) {
    const response = await page.request.get(`/api/companies/search?name=${term}`, { failOnStatusCode: false });
    if (response.status() !== 200) continue;
    const body = await readJson(response);
    assertCompanyLevelOnly(body, `search(${term})`);
    const items = jsonField(body, 'items');
    const first = Array.isArray(items) ? jsonField(items[0], 'cdpId') : undefined;
    if (typeof first === 'string') return first;
  }
  return skip('No CDP company found by search in this environment — set E2E_CDP_COMPANY_ID');
}

async function realPage(page: Page, cdpId: string): Promise<CdpCompanyPage> {
  const response = await page.request.get(`/api/companies/${cdpId}`, { failOnStatusCode: false });
  expect(response.status(), `/api/companies/${cdpId}`).toBe(200);
  const parsed = await readJson(response);
  assertCompanyLevelOnly(parsed, 'page');
  // Shape checked by the allow-list above and the status; the contract types the rest.
  const body = parsed as CdpCompanyResponse;
  if ('redirect' in body) skip(`${cdpId} redirects — set E2E_CDP_COMPANY_ID to a current CDP id`);
  return body;
}

// ---------------------------------------------------------------------------------------------------------------
// Search and open
// ---------------------------------------------------------------------------------------------------------------

test.describe('CDP companies — search and open', () => {
  test('CDP rows load below the B2B rows, tagged CDP, and a pick opens the CDP page', async ({ page }) => {
    const traffic = await stubCdp(page, {
      availability: AVAILABLE,
      pages: STANDARD_PAGES,
      search: { status: 200, body: { items: [{ cdpId: OK_ID, name: COMPANY_NAME }] } },
    });
    await page.goto('/company/overview', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await openSelector(page);
    await page.getByTestId('org-search-input').fill(SEARCH_TERM);

    const group = page.getByTestId('org-selector-cdp-group');
    await expect(group).toBeVisible({ timeout: UI_TIMEOUT });
    const cdpRow = page.getByTestId(`org-selector-cdp-row-${OK_ID}`);
    await expect(cdpRow).toBeVisible({ timeout: UI_TIMEOUT });
    await expect(cdpRow).toContainText(COMPANY_NAME);
    await expect(page.getByTestId(`org-selector-cdp-row-${OK_ID}-tag`)).toHaveText(CDP_COMPANY_SEARCH_TAG);

    // Same name, both kinds: no de-duplication. The B2B row is unchanged and sits above the CDP group.
    const b2bRow = page.getByTestId(`org-item-${B2B_UID}`);
    await expect(b2bRow).toBeVisible();
    await expect(b2bRow).toContainText(COMPANY_NAME);
    await expect(b2bRow).not.toContainText(CDP_COMPANY_SEARCH_TAG);
    const b2bBox = await b2bRow.boundingBox();
    const groupBox = await group.boundingBox();
    expect(b2bBox && groupBox && b2bBox.y < groupBox.y).toBe(true);

    expect(traffic.requests.some((path) => path === '/api/companies/search')).toBe(true);

    await cdpRow.click();
    await expect(page).toHaveURL(new RegExp(`/company/${OK_ID}/dashboard$`), { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-name')).toHaveText(COMPANY_NAME, { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-dashboard-stats')).toBeVisible();
    await expect(page.getByTestId('cdp-company-top-project')).toContainText(TOP_PROJECT);

    for (const body of traffic.bodies) assertCompanyLevelOnly(body, 'stub');
  });

  test('a slow CDP search shows its loading state while the B2B rows are already listed', async ({ page }) => {
    await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    // Registered after `stubCdp`, so it answers search first: held for 3 s.
    await page.route('**/api/companies/search*', async (route) => {
      await page.waitForTimeout(3_000);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], unavailable: true }) });
    });
    await page.goto('/company/overview', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    await openSelector(page);
    await page.getByTestId('org-search-input').fill(SEARCH_TERM);
    await expect(page.getByTestId('org-selector-cdp-loading')).toBeVisible({ timeout: UI_TIMEOUT });
    await expect(page.getByTestId(`org-item-${B2B_UID}`)).toBeVisible();
    await expect(page.getByTestId('org-selector-cdp-unavailable')).toBeVisible({ timeout: UI_TIMEOUT });
  });

  test('under /company, a B2B slug and a static page open their B2B pages and a CDP id opens the CDP page', async ({ page }) => {
    const traffic = await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });

    await page.goto(`/company/${B2B_SLUG}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect.poll(() => traffic.resolved, { timeout: UI_TIMEOUT }).toContain(B2B_SLUG);
    await expect(page).toHaveURL(new RegExp(`/company/${B2B_SLUG}(/|$)`), { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-page')).toHaveCount(0);
    await expect(page.getByTestId('org-not-found')).toHaveCount(0);

    await page.goto('/company/overview', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/company\/overview(\?|$)/, { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-page')).toHaveCount(0);
    expect(traffic.resolved).not.toContain('overview');

    await page.goto(`/company/${OK_ID}`, { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(new RegExp(`/company/${OK_ID}/dashboard$`), { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-page')).toHaveAttribute('data-state', 'ok', { timeout: UI_TIMEOUT });
    expect(traffic.resolved.filter((segment) => segment.toLowerCase() === OK_ID)).toEqual([]);
    await expect(page.getByTestId('org-not-found')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Outside the audience
// ---------------------------------------------------------------------------------------------------------------

test.describe('CDP companies — outside the audience', () => {
  // What the server answers each of these callers is the same as for any outsider; the browser
  // only ever sees `available: false` and 404s. Stubbed per caller so each case names what it stands for.
  const OUTSIDERS = [
    'a caller in no CDP audience team',
    'a non-staff global_org_admin member with the global org admins switch off',
    'a global-org-auditors member with the switch off',
    'a global-org-auditors member with the switch on',
  ];

  for (const caller of OUTSIDERS) {
    test(`${caller}: no CDP rows, and a CDP address reads "no company"`, async ({ page }) => {
      const traffic = await stubCdp(page, { availability: UNAVAILABLE, pages: {}, search: NOT_FOUND });
      await page.goto('/company/overview', { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);

      await openSelector(page);
      await page.getByTestId('org-search-input').fill(SEARCH_TERM);
      await expect(page.getByTestId(`org-item-${B2B_UID}`)).toBeVisible({ timeout: UI_TIMEOUT });
      await expect(page.getByTestId('org-selector-cdp-group')).toHaveCount(0);
      expect(traffic.requests.some((path) => path.startsWith('/api/companies/search'))).toBe(false);

      await page.goto(`/company/${OK_ID}`, { waitUntil: 'domcontentloaded' });
      const state = page.getByTestId('cdp-company-state');
      await expect(state).toHaveAttribute('data-state', 'no-company', { timeout: UI_TIMEOUT });
      await expect(page.getByTestId('cdp-company-page')).not.toContainText(OK_ID);
      await expect(page.getByTestId('cdp-company-header')).toHaveCount(0);
      // An outsider's browser never asks for the company.
      expect(traffic.requests.includes(`/api/companies/${OK_ID}`)).toBe(false);
    });
  }

  test('a malformed and an unknown address read the same, and the malformed one is never sent', async ({ page }) => {
    const traffic = await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${UNKNOWN_ID}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    const state = page.getByTestId('cdp-company-state');
    await expect(state).toHaveAttribute('data-state', 'no-company', { timeout: UI_TIMEOUT });
    const unknownText = await page.getByTestId('cdp-company-page').innerText();

    await page.goto(`/company/${MALFORMED_ID}`, { waitUntil: 'domcontentloaded' });
    await expect(state).toHaveAttribute('data-state', 'no-company', { timeout: UI_TIMEOUT });
    expect(await page.getByTestId('cdp-company-page').innerText()).toBe(unknownText);
    expect(unknownText).not.toContain(UNKNOWN_ID);
    expect(traffic.requests.some((path) => path.includes(MALFORMED_ID))).toBe(false);
  });

  test('a failed audience check reads "could not verify", with a retry', async ({ page }) => {
    await stubCdp(page, { availability: { status: 503, body: { code: 'ROLE_GRANTS_UNAVAILABLE' } }, pages: STANDARD_PAGES });
    await page.goto(`/company/${OK_ID}`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-state')).toHaveAttribute('data-state', 'section-could-not-verify', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-retry')).toBeVisible();
  });

  test('real BFF: an unknown and a malformed id get identical status and body; search refuses outsiders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    const audience = await realAudience(page);

    const unknown = await page.request.get(`/api/companies/${UNKNOWN_ID}`, { failOnStatusCode: false });
    const malformed = await page.request.get('/api/companies/not-a-cdp-id', { failOnStatusCode: false });
    expect(malformed.status()).toBe(unknown.status());
    expect(await malformed.text()).toBe(await unknown.text());
    expect(unknown.status()).toBe(404);
    expect(await readJson(unknown)).toEqual({ code: 'NOT_FOUND' });

    const unknownSection = await page.request.get(`/api/companies/${UNKNOWN_ID}/sections/dashboard`, { failOnStatusCode: false });
    const malformedSection = await page.request.get('/api/companies/not-a-cdp-id/sections/dashboard', { failOnStatusCode: false });
    expect(malformedSection.status()).toBe(unknownSection.status());
    expect(await malformedSection.text()).toBe(await unknownSection.text());

    if (audience === 'unavailable') {
      const search = await page.request.get(`/api/companies/search?name=${SEARCH_TERM}`, { failOnStatusCode: false });
      expect(search.status()).toBe(404);
      expect(await readJson(search)).toEqual({ code: 'NOT_FOUND' });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Reduced page and navigation
// ---------------------------------------------------------------------------------------------------------------

test.describe('CDP companies — reduced page', () => {
  test('on sections are links; every other Company Lens section is greyed with its reason', async ({ page }) => {
    const traffic = await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${OK_ID}/projects`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-projects-row')).toHaveCount(2, { timeout: UI_TIMEOUT });

    for (const key of ['dashboard', 'projects', 'profile', 'events', 'training']) {
      await expect(page.getByTestId(`sidebar-cdp-${key}`)).toHaveAttribute('href', `/company/${OK_ID}/${key}`);
    }
    for (const key of ['memberships', 'people', 'contributions', 'initiatives', 'easycla', 'meetings', 'groups']) {
      const item = page.getByTestId(`sidebar-cdp-off-${key}`);
      await expect(item).toBeVisible();
      await expect(item).toHaveAttribute('aria-disabled', 'true');
      await expect(item).toHaveAttribute('data-disabled-reason', CDP_COMPANY_OFF_BY_DESIGN_REASON);
      await expect(item).not.toHaveAttribute('href', /.*/);
    }
    // No B2B navigation alongside it, and nothing that edits, invites or sets permissions.
    await expect(page.getByTestId('sidebar-org-easycla')).toHaveCount(0);
    await expect(page.getByTestId('cdp-company-page').getByRole('button', { name: /edit|invite|permission|settings/i })).toHaveCount(0);

    // An off section renders "off by design" with no request for it.
    await page.goto(`/company/${OK_ID}/meetings`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('cdp-company-meetings-state')).toHaveAttribute('data-state', 'off-by-design', { timeout: UI_TIMEOUT });
    expect(traffic.requests.some((path) => path.endsWith('/sections/meetings'))).toBe(false);

    for (const body of traffic.bodies) assertCompanyLevelOnly(body, 'stub', body === SECTION_PAYLOADS.profile);
  });

  test('every on section renders its counts and labels', async ({ page }) => {
    await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${OK_ID}/events`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-events-row')).toContainText('KubeCon', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-events-row')).toContainText('42');

    await page.getByTestId('sidebar-cdp-training').click();
    const training = page.getByTestId('cdp-company-training-stats');
    await expect(training).toContainText('87', { timeout: UI_TIMEOUT });
    // Certifications are withheld under 5 people: shown as hidden, never as 0.
    await expect(training).toContainText('Fewer than 5');

    await page.getByTestId('sidebar-cdp-profile').click();
    await expect(page.getByTestId('cdp-company-profile-name')).toHaveText(COMPANY_NAME, { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-profile-last-active')).toHaveText('October 2026');
  });

  test('a section refusal renders by its code, and an empty section says so', async ({ page }) => {
    await stubCdp(page, {
      availability: AVAILABLE,
      pages: { [OK_ID]: { status: 200, body: okPage('on') } },
      sections: {
        projects: { status: 200, body: { rows: [] } },
        events: { status: 403, body: { code: 'SECTION_OFF_BY_DESIGN' } },
        training: { status: 503, body: { code: 'SECTION_COULD_NOT_LOAD' } },
        dashboard: { status: 503, body: { code: 'SECTION_COULD_NOT_VERIFY' } },
      },
    });
    await page.goto(`/company/${OK_ID}/projects`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-projects-state')).toHaveAttribute('data-state', 'section-empty', { timeout: UI_TIMEOUT });

    await page.getByTestId('sidebar-cdp-events').click();
    await expect(page.getByTestId('cdp-company-events-state')).toHaveAttribute('data-state', 'off-by-design', { timeout: UI_TIMEOUT });

    await page.getByTestId('sidebar-cdp-training').click();
    await expect(page.getByTestId('cdp-company-training-state')).toHaveAttribute('data-state', 'section-could-not-load', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-training-retry')).toBeVisible();

    await page.getByTestId('sidebar-cdp-dashboard').click();
    await expect(page.getByTestId('cdp-company-dashboard-state')).toHaveAttribute('data-state', 'section-could-not-verify', { timeout: UI_TIMEOUT });
  });

  test('real BFF: an off section is refused, and every section answer is company-level only', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    test.skip((await realAudience(page)) !== 'available', 'The harness identity is outside the CDP audience');

    const cdpId = await realCompanyId(page);
    const companyPage = await realPage(page, cdpId);
    test.skip(companyPage.state !== 'ok', `${cdpId} is not a searchable company`);

    for (const section of companyPage.sections) {
      const response = await page.request.get(`/api/companies/${cdpId}/sections/${section.key}`, { failOnStatusCode: false });
      const body = await readJson(response);
      assertCompanyLevelOnly(body, `sections/${section.key}`, section.key === 'profile' && response.status() === 200);
      if (section.state === 'off-by-design') {
        expect(response.status(), `${section.key} is off`).toBe(403);
        expect(body).toEqual({ code: 'SECTION_OFF_BY_DESIGN' });
      }
    }
    expect(companyPage.sections.find((section) => section.key === 'dashboard')?.state).toBe('on');
  });

  test('real BFF: a low-activity company has no counts and its sections 404', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    test.skip((await realAudience(page)) !== 'available', 'The harness identity is outside the CDP audience');
    const lowActivityId = process.env['E2E_CDP_LOW_ACTIVITY_ID'];
    if (!lowActivityId) skip('Set E2E_CDP_LOW_ACTIVITY_ID to an addressable CDP id below the search rule');

    const lowPage = await realPage(page, lowActivityId);
    expect(['no-activity', 'not-enough-activity']).toContain(lowPage.state);
    for (const key of ['dashboard', 'projects', 'profile', 'events', 'training'] as const) {
      const section = await page.request.get(`/api/companies/${lowActivityId}/sections/${key}`, { failOnStatusCode: false });
      expect(section.status(), `${key} of a low-activity company`).toBe(404);
      expect(await readJson(section)).toEqual({ code: 'NOT_FOUND' });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Meetings and Groups
// ---------------------------------------------------------------------------------------------------------------

test.describe('CDP companies — Meetings and Groups', () => {
  test('flag off: both are off by design, greyed in the navigation', async ({ page }) => {
    await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${OK_ID}/groups`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-groups-state')).toHaveAttribute('data-state', 'off-by-design', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('sidebar-cdp-off-meetings')).toBeVisible();
    await expect(page.getByTestId('sidebar-cdp-off-groups')).toBeVisible();
  });

  test('flag on, LF staff: rows; anyone else in the audience: no access', async ({ page }) => {
    await stubCdp(page, {
      availability: AVAILABLE,
      pages: { [OK_ID]: { status: 200, body: okPage('on') } },
      sections: { groups: { status: 403, body: { code: 'SECTION_NO_ACCESS' } } },
    });
    await page.goto(`/company/${OK_ID}/meetings`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-meetings-row')).toContainText('Technical', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-meetings-row')).toContainText('31');
    await expect(page.getByTestId('sidebar-cdp-meetings')).toHaveAttribute('href', `/company/${OK_ID}/meetings`);

    // The groups stub answers as the server does for a non-staff caller in the audience.
    await page.getByTestId('sidebar-cdp-groups').click();
    const staffOnly = page.getByTestId('cdp-company-groups-state');
    await expect(staffOnly).toHaveAttribute('data-state', 'section-staff-only', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-groups-title')).toHaveText('Groups');
    await expect(staffOnly).toContainText('Only LF staff can see this section');
    await expect(staffOnly.getByRole('button')).toHaveCount(0);
  });

  test('real BFF: with the flag on, the staff identity reads rows', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    test.skip((await realAudience(page)) !== 'available', 'The harness identity is outside the CDP audience');
    const grants = await page.request.get('/api/orgs/me/role-grants', { failOnStatusCode: false });
    const isStaff = grants.status() === 200 && jsonField(await readJson(grants), 'isStaff') === true;
    test.skip(!isStaff, 'The harness identity is not LF staff');

    const cdpId = await realCompanyId(page);
    const companyPage = await realPage(page, cdpId);
    for (const key of ['meetings', 'groups'] as const) {
      const state = companyPage.sections.find((section) => section.key === key)?.state;
      const response = await page.request.get(`/api/companies/${cdpId}/sections/${key}`, { failOnStatusCode: false });
      const body = await readJson(response);
      assertCompanyLevelOnly(body, `sections/${key}`);
      if (state !== 'on') {
        expect(response.status()).toBe(403);
        expect(body).toEqual({ code: 'SECTION_OFF_BY_DESIGN' });
        continue;
      }
      expect(response.status(), `${key} with the flag on, as staff`).toBe(200);
      expect(Array.isArray(jsonField(body, 'rows'))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Redirects and low activity
// ---------------------------------------------------------------------------------------------------------------

test.describe('CDP companies — redirects and low activity', () => {
  test('a merged id moves to its surviving CDP id on the same section, replacing the address', async ({ page }) => {
    await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto('/company/overview', { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.goto(`/company/${MERGED_ID}/projects`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(`/company/${OK_ID}/projects$`), { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-projects-row')).toHaveCount(2, { timeout: UI_TIMEOUT });
    // Replaced, not pushed: Back leaves the CDP page rather than returning to the merged address.
    await page.goBack();
    await expect(page).not.toHaveURL(new RegExp(MERGED_ID));
  });

  test("a B2B-linked id moves to that company's Company Lens home", async ({ page }) => {
    const traffic = await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${B2B_LINKED_ID}/events`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    // The SFID is resolved, then the address is canonicalized to the slug.
    await expect.poll(() => traffic.resolved, { timeout: UI_TIMEOUT }).toContain(B2B_UID);
    await expect(page).toHaveURL(new RegExp(`/company/${B2B_SLUG}(/|$)`), { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-page')).toHaveCount(0);
  });

  test('an unknown id reads "no company", naming neither the id nor any company', async ({ page }) => {
    await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
    await page.goto(`/company/${UNKNOWN_ID}/dashboard`, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await expect(page.getByTestId('cdp-company-state')).toHaveAttribute('data-state', 'no-company', { timeout: UI_TIMEOUT });
    await expect(page.getByTestId('cdp-company-page')).not.toContainText(UNKNOWN_ID);
    await expect(page.getByTestId('cdp-company-page')).not.toContainText(COMPANY_NAME);
    await expect(page.getByTestId('sidebar-cdp-dashboard')).toHaveCount(0);
  });

  const LOW_ACTIVITY: { id: string; state: string; headline: RegExp }[] = [
    { id: NO_ACTIVITY_ID, state: 'low-activity-none', headline: /No activity in the last 2 years — last active March 2023/ },
    { id: NOT_ENOUGH_ID, state: 'low-activity-not-enough', headline: /Not enough activity to show — last active November 2025/ },
  ];

  for (const { id, state, headline } of LOW_ACTIVITY) {
    test(`${state}: the company is named, with no counts and no section`, async ({ page }) => {
      const traffic = await stubCdp(page, { availability: AVAILABLE, pages: STANDARD_PAGES });
      await page.goto(`/company/${id}/projects`, { waitUntil: 'domcontentloaded' });
      skipWhenAuthMissing(page);
      await expect(page.getByTestId('cdp-company-state')).toHaveAttribute('data-state', state, { timeout: UI_TIMEOUT });
      await expect(page.getByTestId('cdp-company-title')).toHaveText(headline);
      await expect(page.getByTestId('cdp-company-projects-page')).toHaveCount(0);
      expect(traffic.requests.some((path) => path.includes('/sections/'))).toBe(false);
    });
  }
});
