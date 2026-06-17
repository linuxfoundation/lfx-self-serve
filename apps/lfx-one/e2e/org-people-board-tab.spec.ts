// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** People → Board tab E2E (read + filter/expand/sort). Deterministic via route mocks. Inverted-filter sibling of org-people-committee-tab.spec.ts. */

import { expect, Page, test } from '@playwright/test';

const PEOPLE_BOARD_URL = '/org/people?tab=board';
const DATA_LOAD_TIMEOUT = 30_000;

const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';
const MOCK_UID = MOCK_ACCOUNT_ID;
const MOCK_ACCOUNT_NAME = 'Toyota';
const MOCK_ACCOUNT_SLUG = 'toyota';

// SC-001 dev-mode budget multiplier — `ng serve` adds 3–10× per interaction vs the production build.
const PERF_DEV_MULTIPLIER = 5;

const KENSUKE_EMAIL = 'kensuke.hanaoka@toyota.com';
const KENTA_EMAIL = 'kenta.tada@toyota.com';
const MASAKI_EMAIL = 'masaki.isetani@toyota.com';
const YASUSHI_EMAIL = 'yasushi.ando@toyota.com';

// Models the Toyota board screenshot: 4 members, 2 voting + 3 non-voting seats, 3 foundations.
// Kensuke + Yasushi are foundation-controlled (read-only → "Why can't I edit?"); Kenta + Masaki hold
// Membership-Entitlement seats (editable). Masaki spans 2 foundations with mixed voting status.
function boardMembersResponse() {
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
  const kensuke = { email: KENSUKE_EMAIL, firstName: 'Kensuke', lastName: 'Hanaoka', fullName: 'Kensuke Hanaoka', jobTitle: 'Engineer', initials: 'KH' };
  const kenta = { email: KENTA_EMAIL, firstName: 'Kenta', lastName: 'Tada', fullName: 'Kenta Tada', jobTitle: 'Principal Software Engineer', initials: 'KT' };
  const masaki = {
    email: MASAKI_EMAIL,
    firstName: 'Masaki',
    lastName: 'Isetani',
    fullName: 'Masaki Isetani',
    jobTitle: 'Senior Manager, Open Source Strategy',
    initials: 'MI',
  };
  const yasushi = {
    email: YASUSHI_EMAIL,
    firstName: 'Yasushi',
    lastName: 'Ando',
    fullName: 'Yasushi Ando',
    jobTitle: 'Distinguished Engineer',
    initials: 'YA',
  };
  return {
    orgUid: MOCK_UID,
    assignments: [
      seat('m-kensuke', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Non-voting', false, kensuke),
      seat('m-kenta', 'Governing Board', 'ebpf-root', 'eBPF Foundation', 'ebpf-foundation', 'Voting', true, kenta),
      seat('m-masaki-agl', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Voting', true, masaki),
      seat('m-masaki-hl', 'Governing Board', 'hl-root', 'Hyperledger Foundation', 'hyperledger-foundation', 'Non-voting', true, masaki),
      seat('m-yasushi', 'Steering Committee', 'agl-root', 'Automotive Grade Linux', 'automotive-grade-linux', 'Non-voting', false, yasushi),
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
    await expect(page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`)).toBeVisible();

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
    // Kensuke holds one board seat → a single "Non-voting" pill.
    await expect(page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}`)).toContainText('Non-voting');
    // Masaki holds 2 foundations with mixed voting → "1 Voting" + "1 Non-voting" count pills + a Foundations badge.
    const masaki = page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`);
    await expect(masaki).toContainText('1 Voting');
    await expect(masaki).toContainText('1 Non-voting');
    await expect(masaki).toContainText('2 Foundations');
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
    // Kensuke is foundation-controlled → no enabled pencil, the "Why can't I edit?" affordance instead.
    await expect(page.getByTestId(`org-people-board-why-${KENSUKE_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-reassign-${KENSUKE_EMAIL}`)).toHaveCount(0);
    // Kenta holds an entitlement seat → the live Reassign pencil.
    await expect(page.getByTestId(`org-people-board-reassign-${KENTA_EMAIL}`)).toBeVisible();
  });

  test('clicking "Why can\'t I edit?" opens the explanatory modal and "Got it" closes it', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-why-${KENSUKE_EMAIL}`).click();

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
    await expect(page.getByTestId(`org-people-board-why-${KENTA_EMAIL}`)).toBeVisible();
    await expect(page.locator('[data-testid^="org-people-board-reassign-"]')).toHaveCount(0);
  });

  test('expands Masaki and shows 2 board sub-rows (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`).click();

    const expanded = page.getByTestId(`org-people-board-expanded-${MASAKI_EMAIL}`);
    await expect(expanded).toBeVisible();
    await expect(expanded.locator('[data-testid^="org-people-board-subrow-"]')).toHaveCount(2);
  });

  test('search narrows to the matching person row (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-search-input').locator('input').fill('Hanaoka');

    await expect(page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${KENTA_EMAIL}`)).toHaveCount(0);
  });

  test('foundation filter narrows the rows (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-foundation-filter').click();
    await page.getByRole('option', { name: 'eBPF Foundation', exact: true }).click();

    // Only people with an eBPF board seat (Kenta) remain.
    await expect(page.getByTestId(`org-people-board-row-${KENTA_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}`)).toHaveCount(0);
  });

  test('status filter "Voting" narrows to people with a voting board seat (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByTestId('org-people-board-status-filter').click();
    await page.getByRole('option', { name: 'Voting', exact: true }).click();

    // Kenta (voting) + Masaki (one voting seat) remain; Kensuke + Yasushi (non-voting only) removed.
    await expect(page.getByTestId(`org-people-board-row-${KENTA_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${MASAKI_EMAIL}`)).toBeVisible();
    await expect(page.getByTestId(`org-people-board-row-${YASUSHI_EMAIL}`)).toHaveCount(0);
  });

  test('sort by Foundations desc puts the most-foundations person first (US2)', async ({ page }) => {
    await stubAccountContext(page);
    await stubBoardMembers(page);

    await gotoBoardTab(page);
    await page.getByRole('button', { name: /Foundations/i }).click();

    const firstRow = page.locator('[data-testid^="org-people-board-row-"]').first();
    // Masaki holds 2 foundations — the max — so descending sort floats them to the top.
    await expect(firstRow).toHaveAttribute('data-testid', `org-people-board-row-${MASAKI_EMAIL}`);
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
    await page.getByTestId(`org-people-board-row-${KENSUKE_EMAIL}-name`).click();

    // Drawer opens with the row's header and lands on the Governance tab.
    await expect(page.getByTestId('person-detail-drawer-header')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('person-detail-drawer-header')).toContainText('Kensuke Hanaoka');
    await expect(page.getByTestId('person-detail-drawer-tab-governance')).toHaveAttribute('aria-selected', 'true');

    // Governance renders the seat from the table (real data, not a demo pool): Board pill + foundation · committee.
    const drawer = page.getByTestId('person-detail-drawer');
    await expect(drawer).toContainText('Board');
    await expect(drawer).toContainText('Automotive Grade Linux · Steering Committee');

    // Events needs the personKey-keyed fetch the board opener can't supply → not-available state.
    await page.getByTestId('person-detail-drawer-tab-events').click();
    await expect(page.getByTestId('person-detail-drawer-detail-unavailable')).toBeVisible();

    // The name click stopped propagation, so the row did not also expand.
    await expect(page.getByTestId(`org-people-board-expanded-${KENSUKE_EMAIL}`)).toHaveCount(0);
    expect(personDetailCalls).toBe(0);
  });
});
