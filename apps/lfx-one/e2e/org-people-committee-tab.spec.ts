// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** People → Committee tab E2E (spec 027 US1 read + US2 filter/expand/sort). Deterministic via route mocks. */

import { expect, Page, test } from '@playwright/test';

const PEOPLE_COMMITTEE_URL = '/org/people?tab=committee';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Toyota';
const MOCK_ACCOUNT_SLUG = 'toyota';

// SC-001 dev-mode budget multiplier — `ng serve` adds 3–10× per interaction vs the production build.
const PERF_DEV_MULTIPLIER = 5;

const CHIANING_EMAIL = 'johnny.wang@toyota.com';

// Three entitlement seats for Chianing Wang, all on Ultra Ethernet Consortium, plus a second person
// on a different foundation so the stats tiles have concrete multi-foundation values.
function committeeMembersResponse() {
  const uec = (uid: string, committeeUid: string, committeeName: string) => ({
    seatId: uid,
    memberUid: uid,
    committeeUid,
    committeeName,
    committeeCategory: 'Working Group',
    projectUid: 'uec-root',
    foundationSlug: 'ultra-ethernet-consortium',
    foundationName: 'Ultra Ethernet Consortium',
    role: '',
    votingStatus: 'Non-voting',
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
    person: { email: CHIANING_EMAIL, firstName: 'Chianing', lastName: 'Wang', fullName: 'Chianing Wang', jobTitle: 'Infrastructure Architect', initials: 'CW' },
  });
  return {
    orgUid: MOCK_UID,
    assignments: [
      uec('m-inc', 'c-inc', 'INC Software Working Area'),
      uec('m-perf', 'c-perf', 'Performance Working Group'),
      uec('m-link', 'c-link', 'Link Layer Working Group'),
      {
        seatId: 'm-erick',
        memberUid: 'm-erick',
        committeeUid: 'c-tsc',
        committeeName: 'Technical Steering Committee',
        committeeCategory: 'Technical',
        projectUid: 'cncf-root',
        foundationSlug: 'cncf',
        foundationName: 'Cloud Native Computing Foundation',
        role: 'Member',
        votingStatus: 'Voting Rep',
        appointedBy: 'Community',
        isOrgEditable: false,
        reason: "This seat is held by foundation election or appointment, not by your organization's membership entitlement.",
        person: { email: 'erick.mau@toyota.com', firstName: 'Erick', lastName: 'Mau', fullName: 'Erick Mau', jobTitle: 'Maintainer', initials: 'EM' },
      },
    ],
    stats: { individualCount: 2, committeeCount: 4, foundationsCovered: 2 },
  };
}

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

async function stubAccountContext(page: Page, opts: { writers: string[]; auditors?: string[] } = { writers: [MOCK_UID] }): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: MOCK_ACCOUNT_NAME, accountSlug: MOCK_ACCOUNT_SLUG, membershipTier: '', uid: MOCK_UID }],
        isRootWriter: false,
      }),
    })
  );
  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: opts.writers,
        auditors: opts.auditors ?? [],
        cascadingWriters: [],
        cascadingAuditors: [],
        username: 'e2e-org-people-committee',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubCommitteeMembers(page: Page, body: unknown = committeeMembersResponse(), status = 200): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/committee-members$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function gotoCommitteeTab(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_COMMITTEE_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }
  await expect(page.getByTestId('org-people-panel-committee')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.setTimeout(120_000);

test.describe('Org People → Committee tab (spec 027 US1 + US2)', () => {
  test('renders the org committee roster grouped by person with correct stats (SC-001 perf + SC-004 counts)', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);

    const start = Date.now();
    await gotoCommitteeTab(page);
    await expect(page.getByTestId('org-people-committee-stat-individuals')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const elapsed = Date.now() - start;
    // SC-001: prod budget 3000 ms; dev allowance generous (regression guard only).
    // eslint-disable-next-line no-console
    console.log(`[SC-001] committee tab load → stats visible: ${elapsed} ms (prod budget 3000 ms; dev allowance ${3000 * PERF_DEV_MULTIPLIER} ms)`);
    expect(elapsed).toBeLessThan(3000 * PERF_DEV_MULTIPLIER);

    // One row per person (Chianing Wang + Erick Mau).
    await expect(page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId('org-people-committee-row-erick.mau@toyota.com')).toBeVisible();

    // SC-004: stat tiles match the table-derived counts.
    const individuals = await page.getByTestId('org-people-committee-stat-individuals').innerText();
    const rowCount = await page.locator('[data-testid^="org-people-committee-row-"]').count();
    expect(parseInt(individuals, 10)).toBe(rowCount);
    expect(await page.getByTestId('org-people-committee-stat-committees').innerText()).toContain('4');
    expect(await page.getByTestId('org-people-committee-stat-foundations').innerText()).toContain('2');
  });

  test('renders the empty state for an org with no committee seats', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page, { orgUid: MOCK_UID, assignments: [], stats: { individualCount: 0, committeeCount: 0, foundationsCovered: 0 } });

    await gotoCommitteeTab(page);
    await expect(page.getByTestId('org-people-committee-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('fetch failure renders the error state with a Retry button', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page, { error: { message: 'boom' } }, 500);

    await gotoCommitteeTab(page);
    await expect(page.getByTestId('org-people-committee-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('as an auditor (read-only), Reassign pencils are disabled', async ({ page }) => {
    await stubAccountContext(page, { writers: [], auditors: [MOCK_UID] });
    await stubCommitteeMembers(page);

    await gotoCommitteeTab(page);
    const pencil = page.getByTestId(`org-people-committee-reassign-${CHIANING_EMAIL}`);
    await expect(pencil).toBeDisabled();
  });

  test('expands Chianing Wang and shows 3 sub-rows on Ultra Ethernet Consortium (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);

    await gotoCommitteeTab(page);
    await page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`).click();

    const expanded = page.getByTestId(`org-people-committee-expanded-${CHIANING_EMAIL}`);
    await expect(expanded).toBeVisible();
    await expect(expanded.locator('[data-testid^="org-people-committee-subrow-"]')).toHaveCount(3);
  });

  test('search narrows to the matching person row (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);

    await gotoCommitteeTab(page);
    await page.getByTestId('org-people-committee-search-input').locator('input').fill('performance');

    await expect(page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId('org-people-committee-row-erick.mau@toyota.com')).toHaveCount(0);
  });

  test('committee filter narrows the rows to that committee (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubCommitteeMembers(page);

    await gotoCommitteeTab(page);
    // The committee dropdown wrapper opens a PrimeNG select; choose "Performance Working Group".
    await page.getByTestId('org-people-committee-committee-filter').click();
    await page.getByRole('option', { name: 'Performance Working Group' }).click();

    await expect(page.getByTestId(`org-people-committee-row-${CHIANING_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId('org-people-committee-row-erick.mau@toyota.com')).toHaveCount(0);
  });
});
