// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** People → Board tab E2E (read + filter/expand/sort). Deterministic via route mocks. Inverted-filter sibling of org-people-committee-tab.spec.ts. */

import { ORG_LENS_PRIVATE_RELEASE_FLAG } from '@lfx-one/shared/constants/feature-flags.constants';
import { expect, Page, test } from '@playwright/test';

import { stubFeatureFlags } from './helpers/org-roi.helper';

const PEOPLE_BOARD_URL = '/org/people?tab=board';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Acme Motors';
const MOCK_ACCOUNT_SLUG = 'acme-motors';

// SC-001 dev-mode budget multiplier — `ng serve` adds 3–10× per interaction vs the production build.
const PERF_DEV_MULTIPLIER = 5;

const JORDAN_EMAIL = 'jordan.reyes@acme-motors.example';
// Identity and address are deliberately unrelated strings: the lookup is keyed on the username, and
// a test whose address is derivable from its username could not tell the two directions apart.
const JORDAN_USERNAME = 'jreyes';
const JORDAN_COMPANY_EMAIL = 'j.reyes@acme-motors.example';
const SAM_EMAIL = 'sam.rivera@acme-motors.example';
const ALEX_EMAIL = 'alex.chen@acme-motors.example';
const TAYLOR_EMAIL = 'taylor.kim@acme-motors.example';

// Models the Acme Motors board screenshot: 4 members, 2 voting + 3 non-voting seats, 3 foundations.
// Jordan + Taylor are foundation-controlled (read-only → "Why can't I edit?"); Sam + Alex hold
// Membership-Entitlement seats (editable). Alex spans 2 foundations with mixed voting status.
//
// `username` is omitted by default, which is the common upstream shape and the one that must render
// the drawer's "not available from this view" state. Pass it to exercise the identity-keyed lookup.
function boardMembersResponse(opts: { username?: string } = {}) {
  const seat = (
    uid: string,
    committeeName: string,
    projectUid: string,
    foundationName: string,
    foundationSlug: string,
    votingStatus: string,
    isOrgEditable: boolean,
    person: { email: string; firstName: string; lastName: string; fullName: string; jobTitle: string; initials: string }
  ) => ({
    seatId: uid,
    memberUid: uid,
    committeeUid: `c-${uid}`,
    committeeName,
    committeeCategory: 'Board',
    projectUid,
    foundationSlug,
    foundationName,
    role: '',
    votingStatus,
    appointedBy: isOrgEditable ? 'Membership Entitlement' : 'Board Election',
    isOrgEditable,
    reason: isOrgEditable ? null : "This seat is held by foundation election or appointment, not by your organization's membership entitlement.",
    person,
  });
  const jordan = {
    email: JORDAN_EMAIL,
    firstName: 'Jordan',
    lastName: 'Reyes',
    fullName: 'Jordan Reyes',
    jobTitle: 'Engineer',
    initials: 'JR',
    ...(opts.username ? { username: opts.username } : {}),
  };
  const sam = { email: SAM_EMAIL, firstName: 'Sam', lastName: 'Rivera', fullName: 'Sam Rivera', jobTitle: 'Principal Software Engineer', initials: 'SR' };
  const alex = {
    email: ALEX_EMAIL,
    firstName: 'Alex',
    lastName: 'Chen',
    fullName: 'Alex Chen',
    jobTitle: 'Senior Manager, Open Source Strategy',
    initials: 'AC',
  };
  const taylor = {
    email: TAYLOR_EMAIL,
    firstName: 'Taylor',
    lastName: 'Kim',
    fullName: 'Taylor Kim',
    jobTitle: 'Distinguished Engineer',
    initials: 'TK',
  };
  return {
    orgUid: MOCK_UID,
    assignments: [
      seat('m-jordan', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Non-voting', false, jordan),
      seat('m-sam', 'Governing Board', 'ebpf-root', 'eBPF Foundation', 'ebpf-foundation', 'Voting', true, sam),
      seat('m-alex-agl', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Voting', true, alex),
      seat('m-alex-hl', 'Governing Board', 'hl-root', 'Hyperledger Foundation', 'hyperledger-foundation', 'Non-voting', true, alex),
      seat('m-taylor', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Non-voting', false, taylor),
    ],
    stats: { totalBoardMembers: 4, votingCount: 2, nonVotingCount: 3, foundationsCovered: 3 },
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
        username: 'e2e-org-people-board',
        loaded_at: new Date().toISOString(),
      }),
    })
  );
}

async function stubBoardMembers(page: Page, body: unknown = boardMembersResponse(), status = 200): Promise<void> {
  await page.route(/\/api\/orgs\/[^/]+\/lens\/people\/board-members(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function gotoBoardTab(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.goto(PEOPLE_BOARD_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);

  if (!page.url().includes('/org/people')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/people redirected away');
  }
  await expect(page.getByTestId('org-people-panel-board')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

test.setTimeout(120_000);

test.describe('Org People → Board tab', () => {
  test('renders the org board roster grouped by person with correct stats (SC-001 perf + SC-004 counts)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    const start = Date.now();
    await gotoBoardTab(page);
    await expect(page.getByTestId('org-people-board-stat-total')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const elapsed = Date.now() - start;
    // eslint-disable-next-line no-console
    console.log(`[SC-001] board tab load → stats visible: ${elapsed} ms (prod budget 3000 ms; dev allowance ${3000 * PERF_DEV_MULTIPLIER} ms)`);
    expect(elapsed).toBeLessThan(3000 * PERF_DEV_MULTIPLIER);

    // One row per person (4 members).
    await expect(page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${ALEX_EMAIL}`)).toBeVisible();

    // SC-004: total tile == distinct row count; voting + non-voting == total seat count.
    const total = await page.getByTestId('org-people-board-stat-total').innerText();
    const rowCount = await page.locator('[data-testid^="org-people-board-row-"]').count();
    expect(Number(total.replace(/,/g, ''))).toBe(rowCount);
    expect(await page.getByTestId('org-people-board-stat-voting').innerText()).toContain('2');
    expect(await page.getByTestId('org-people-board-stat-nonvoting').innerText()).toContain('3');
    expect(await page.getByTestId('org-people-board-stat-foundations').innerText()).toContain('3');

    // FR-024 provenance caption.
    await expect(page.getByTestId('org-people-board-source-caption')).toContainText('LFX Membership Board Representatives');
  });

  test('single-seat member shows one verbatim voting pill; multi-foundation member shows aggregate count pills', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    // Jordan holds one board seat → a single "Non-voting" pill.
    await expect(page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}`)).toContainText('Non-voting');
    // Alex holds 2 foundations with mixed voting → "1 Voting" + "1 Non-voting" count pills + a Foundations badge.
    const alex = page.getByTestId(`org-people-board-row-${ALEX_EMAIL}`);
    await expect(alex).toContainText('1 Voting');
    await expect(alex).toContainText('1 Non-voting');
    await expect(alex).toContainText('2 Foundations');
  });

  test('renders the empty state for an org with no board seats', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page, {
      orgUid: MOCK_UID,
      assignments: [],
      stats: { totalBoardMembers: 0, votingCount: 0, nonVotingCount: 0, foundationsCovered: 0 },
    });

    await gotoBoardTab(page);
    await expect(page.getByTestId('org-people-board-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('fetch failure renders the error state with a Retry button', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page, { error: { message: 'boom' } }, 500);

    await gotoBoardTab(page);
    await expect(page.getByTestId('org-people-board-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // The error state's recovery affordance is the shared empty-state CTA button labelled "Retry".
    const retry = page.getByRole('button', { name: /Retry/i });
    await expect(retry).toBeVisible();
    await expect(retry).toBeEnabled();
  });

  test('foundation-controlled seat shows "Why can\'t I edit?" instead of a Reassign pencil', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    // Jordan is foundation-controlled → no enabled pencil, the "Why can't I edit?" affordance instead.
    await expect(page.getByTestId(`org-people-board-why-${JORDAN_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-reassign-${JORDAN_EMAIL}`)).toHaveCount(0);
    // Sam holds an entitlement seat → the live Reassign pencil.
    await expect(page.getByTestId(`org-people-board-reassign-${SAM_EMAIL}`)).toBeVisible();
  });

  test('clicking "Why can\'t I edit?" opens the explanatory modal and "Got it" closes it', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-why-${JORDAN_EMAIL}`).click();

    const modal = page.getByTestId('org-people-board-modal-why');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('org-people-board-modal-why-title')).toHaveText("Why can't I edit this member?");
    await expect(page.getByTestId('org-people-board-modal-why-body')).not.toBeEmpty();

    await page.getByTestId('org-people-board-modal-why-got-it').click();
    await expect(page.getByTestId('org-people-board-modal-why')).toHaveCount(0);
  });

  test('as an auditor (read-only), every row shows "Why can\'t I edit?" and no enabled pencil', async ({ page }) => {
    await stubAccountContext(page, { writers: [], auditors: [MOCK_UID] });
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await expect(page.getByTestId(`org-people-board-why-${SAM_EMAIL}`)).toBeVisible();
    await expect(page.locator('[data-testid^="org-people-board-reassign-"]')).toHaveCount(0);
  });

  test('expands Alex and shows 2 board sub-rows (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${ALEX_EMAIL}`).click();

    const expanded = page.getByTestId(`org-people-board-expanded-${ALEX_EMAIL}`);
    await expect(expanded).toBeVisible();
    await expect(expanded.locator('[data-testid^="org-people-board-subrow-"]')).toHaveCount(2);
  });

  test('search narrows to the matching person row (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-search-input').locator('input').fill('Reyes');

    await expect(page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${SAM_EMAIL}`)).toHaveCount(0);
  });

  test('foundation filter narrows the rows (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-foundation-filter').click();
    await page.getByRole('option', { name: 'eBPF Foundation', exact: true }).click();

    // Only people with an eBPF board seat (Sam) remain.
    await expect(page.getByTestId(`org-people-board-row-${SAM_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}`)).toHaveCount(0);
  });

  test('status filter "Voting" narrows to people with a voting board seat (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-status-filter').click();
    await page.getByRole('option', { name: 'Voting', exact: true }).click();

    // Sam (voting) + Alex (one voting seat) remain; Jordan + Taylor (non-voting only) removed.
    await expect(page.getByTestId(`org-people-board-row-${SAM_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${ALEX_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${TAYLOR_EMAIL}`)).toHaveCount(0);
  });

  test('sort by Foundations desc puts the most-foundations person first (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByRole('button', { name: /Foundations/i }).click();

    const firstRow = page.locator('[data-testid^="org-people-board-row-"]').first();
    // Alex holds 2 foundations — the max — so descending sort floats them to the top.
    await expect(firstRow).toHaveAttribute('data-testid', `org-people-board-row-${ALEX_EMAIL}`);
  });

  // Board rows have no personKey — drawer opens on Governance from table seats only.
  test('clicking a board member name opens the person-detail drawer on Governance from table seats (no fetch)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);
    let personDetailCalls = 0;
    await page.route('**/api/orgs/*/lens/people/*/detail', (route) => {
      personDetailCalls += 1;
      return route.fulfill({ status: 500, body: 'unexpected person-detail fetch' });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}-name`).click();

    // Drawer opens with the row's header and lands on the Governance tab.
    await expect(page.getByTestId('person-detail-drawer-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('person-detail-drawer-header')).toContainText('Jordan Reyes');
    await expect(page.getByTestId('person-detail-drawer-tab-governance')).toHaveAttribute('aria-selected', 'true');

    // Governance renders the seat from the table (real data, not a demo pool): Board pill + foundation · committee.
    const drawer = page.getByTestId('person-detail-drawer');
    await expect(drawer).toContainText('Board');
    await expect(drawer).toContainText('Automotive Grade Linux · Steering Committee');

    // Events needs the personKey-keyed fetch the board opener can't supply → not-available state.
    await page.getByTestId('person-detail-drawer-tab-events').click();
    await expect(page.getByTestId('person-detail-drawer-detail-unavailable')).toBeVisible();

    // The name click stopped propagation, so the row did not also expand.
    await expect(page.getByTestId(`org-people-board-expanded-${JORDAN_EMAIL}`)).toHaveCount(0);
    expect(personDetailCalls).toBe(0);
  });

  // Board rows have no personKey, so the drawer's only address source is the username-keyed
  // company-emails GET. With org-lens-private-release OFF, the fetch-side gate in
  // PersonDetailDrawerService must skip this request entirely — not just hide the result
  // client-side — so assert it never fires.
  test('company-emails request never fires when org-lens-private-release is OFF', async ({ page }) => {
    await stubFeatureFlags(page, { [ORG_LENS_PRIVATE_RELEASE_FLAG]: false });
    await stubAccountContext(page);
    await stubBoardMembers(page);
    let companyEmailCalls = 0;
    // The address read is keyed on identity: `…/lens/people/by-username/:username/company-emails`.
    // Matching the old address-keyed POST path here would make this test pass no matter what the
    // client does, since nothing requests that path any more.
    await page.route('**/api/orgs/*/lens/people/by-username/*/company-emails', (route) => {
      companyEmailCalls += 1;
      return route.fulfill({ status: 500, body: 'unexpected company-emails fetch' });
    });

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}-name`).click();
    await expect(page.getByTestId('person-detail-drawer-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // With the flag off none of the four address states renders at all.
    await expect(page.getByTestId('person-detail-drawer-email')).toHaveCount(0);
    await expect(page.getByTestId('person-detail-drawer-email-failed')).toHaveCount(0);
    await expect(page.getByTestId('person-detail-drawer-email-not-available')).toHaveCount(0);
    await expect(page.getByTestId('person-detail-drawer-email-none')).toHaveCount(0);
    expect(companyEmailCalls).toBe(0);
  });

  // The four rendered states are mutually exclusive and each says something materially different to
  // an administrator, so each is asserted against the response that must produce it. Conflating
  // "failed" or "not available" with "none on record" would assert, from a lookup that never
  // succeeded, that a person holds no company address — the false statement this panel must not make.
  //
  // Board seats resolve identity from the seat's username (never from the row's email address), so
  // the first three cases stub a roster whose seats agree on one; the fourth uses the default roster,
  // whose seats carry none.
  test('renders each company-email state from its own response', async ({ page }) => {
    await stubFeatureFlags(page, { [ORG_LENS_PRIVATE_RELEASE_FLAG]: true });
    await stubAccountContext(page);

    const openDrawer = async (): Promise<void> => {
      await gotoBoardTab(page);
      await page.getByTestId(`org-people-board-row-${JORDAN_EMAIL}-name`).click();
      await expect(page.getByTestId('person-detail-drawer-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    };

    const stubCompanyEmails = async (fulfil: Parameters<Page['route']>[1]): Promise<void> => {
      await page.route('**/api/orgs/*/lens/people/by-username/*/company-emails', fulfil);
    };

    // 1. Resolved WITH addresses → the addresses render verbatim.
    await stubBoardMembers(page, boardMembersResponse({ username: JORDAN_USERNAME }));
    await stubCompanyEmails((route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ companyEmails: [JORDAN_COMPANY_EMAIL] }) })
    );
    await openDrawer();
    await expect(page.getByTestId('person-detail-drawer-email-0')).toHaveText(JORDAN_COMPANY_EMAIL);

    // 2. Resolved EMPTY → "no company email on record". Only this state may make that claim.
    await stubCompanyEmails((route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ companyEmails: [] }) }));
    await openDrawer();
    await expect(page.getByTestId('person-detail-drawer-email-none')).toBeVisible();
    await expect(page.getByTestId('person-detail-drawer-email')).toHaveCount(0);

    // 3. Lookup FAILED → "couldn't be loaded", never an assertion about what the person holds.
    await stubCompanyEmails((route) => route.fulfill({ status: 500, body: 'warehouse unavailable' }));
    await openDrawer();
    await expect(page.getByTestId('person-detail-drawer-email-failed')).toBeVisible();
    await expect(page.getByTestId('person-detail-drawer-email-none')).toHaveCount(0);

    // 4. No identity to look up → "not available from this view", and NO request is made: with no
    //    username there is nothing to key on, and the address must never be used as one.
    let callsWithoutIdentity = 0;
    await stubBoardMembers(page);
    await stubCompanyEmails((route) => {
      callsWithoutIdentity += 1;
      return route.fulfill({ status: 500, body: 'unexpected lookup without an identity' });
    });
    await openDrawer();
    await expect(page.getByTestId('person-detail-drawer-email-not-available')).toBeVisible();
    await expect(page.getByTestId('person-detail-drawer-email-none')).toHaveCount(0);
    expect(callsWithoutIdentity).toBe(0);
  });
});
