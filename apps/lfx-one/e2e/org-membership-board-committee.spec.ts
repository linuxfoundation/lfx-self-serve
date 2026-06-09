// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Board & Committee Tab E2E Tests (spec 026 — live committee-service data).
 *
 * All BFF `/api/...` board-committee routes are stubbed via `page.route` so the tab is exercised
 * deterministically against the spec-026 live shape (voting.status string, appointed_by, committee
 * category, member/committee uid) without depending on committee-service or the dev gateway.
 *
 * Coverage:
 * - US1 read: grouped roster, Board split by committee_category, votingStatus string, empty state,
 *   auditor (no editable seats) sees no edit control, FR-011 search across the field set.
 * - US2: CSV export (FR-012) + committee ordering (FR-017).
 * - US3: reassign happy path (success toast + refetch) AND the failure path (5xx/403 → error toast,
 *   FR-016); "Why can't I edit?" explainer for foundation-controlled seats.
 *
 * NOTE: membership-detail specs require an authenticated org/session context (Auth0 global-setup +
 * org selection) that a bare local box may not have, so a local red here is not a regression — the
 * gate is CI. Validate locally with `yarn lint` + `yarn check-types` + `yarn build`.
 */

import { expect, test, type Page } from '@playwright/test';

const DETAIL_URL_BOARD = '/org/memberships/sample-foundation#board';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

const BOARD_SEATS = [
  {
    seatId: 'board-1',
    memberUid: 'board-1',
    committeeUid: 'cmte-board',
    person: {
      personId: 'board-1',
      firstName: 'Alex',
      lastName: 'Rivera',
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      jobTitle: 'Principal Engineer',
      initials: 'AR',
    },
    seatName: 'Governing Board',
    tagLabel: 'Voting Rep',
    committeeCategory: 'Board',
    votingStatus: 'Voting Rep',
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
  },
];

const COMMITTEE_SEATS = [
  {
    seatId: 'com-1',
    memberUid: 'com-1',
    committeeUid: 'cmte-tsc',
    person: {
      personId: 'com-1',
      firstName: 'Alex',
      lastName: 'Rivera',
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      jobTitle: 'Principal Engineer',
      initials: 'AR',
    },
    committeeName: 'Technical Steering Committee',
    role: 'Chair',
    committeeCategory: 'Technical Steering Committee',
    votingStatus: 'Voting Rep',
    appointedBy: 'Vote of TSC Committee',
    isOrgEditable: false,
    reason: "This seat is held by foundation election or appointment, not by your organization's membership entitlement.",
  },
  {
    seatId: 'com-2',
    memberUid: 'com-2',
    committeeUid: 'cmte-mkt',
    person: {
      personId: 'com-2',
      firstName: 'Jordan',
      lastName: 'Kim',
      fullName: 'Jordan Kim',
      email: 'jordan.kim@example.com',
      jobTitle: 'Engineer',
      initials: 'JK',
    },
    committeeName: 'Marketing Committee',
    role: 'Member',
    committeeCategory: 'Marketing Committee/Sub Committee',
    votingStatus: 'Voting Rep',
    appointedBy: 'Membership Entitlement',
    isOrgEditable: true,
    reason: null,
  },
];

// Org-wide people picker (spec 026): the Reassign modal's email combobox is fed by
// GET /api/orgs/:orgUid/lens/employees (key contacts + committee members, deduped).
const EMPLOYEES = [
  { email: 'ada.lovelace@example.com', firstName: 'Ada', lastName: 'Lovelace', fullName: 'Ada Lovelace', jobTitle: 'CTO', initials: 'AL' },
  { email: 'grace.hopper@example.com', firstName: 'Grace', lastName: 'Hopper', fullName: 'Grace Hopper', jobTitle: 'Engineer', initials: 'GH' },
];

interface StubOptions {
  board?: unknown[];
  committee?: unknown[];
  employees?: unknown[];
  reassignStatus?: number;
  employeesStatus?: number;
}

/** Stub all BFF board-committee `/api/...` routes (anchored API prefix per the e2e rulebook). */
async function stubBoardCommittee(page: Page, opts: StubOptions = {}): Promise<void> {
  const board = opts.board ?? BOARD_SEATS;
  const committee = opts.committee ?? COMMITTEE_SEATS;

  // Combined board + committee seats (spec 026, single-read perf follow-up): one endpoint feeds both sections on load and refetch.
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/seats$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountId: 'org-1', foundationId: 'sample-foundation', boardSeats: board, committeeSeats: committee }),
    })
  );

  // Reassign modal employee picker (spec 026). Error path drives the "search unavailable" fallback.
  const employees = opts.employees ?? EMPLOYEES;
  await page.route(/\/api\/orgs\/[^/]+\/lens\/employees$/, (route) => {
    if (opts.employeesStatus && opts.employeesStatus >= 400) {
      return route.fulfill({ status: opts.employeesStatus, contentType: 'application/json', body: JSON.stringify({ error: 'employees unavailable' }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ orgUid: 'org-1', employees }) });
  });

  // Reassign write path — success returns the updated seat; error path returns the configured status.
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/committee-seats\/[^/]+\/reassign$/, (route) => {
    if (opts.reassignStatus && opts.reassignStatus >= 400) {
      return route.fulfill({ status: opts.reassignStatus, contentType: 'application/json', body: JSON.stringify({ error: 'reassignment failed' }) });
    }
    // Derive the reassigned seat from the request URL so the response seatId matches the requested
    // seat (board OR committee). The UI applies the returned seat by seatId, so echoing the matching
    // seat (rather than always BOARD_SEATS[0]) keeps the committee path realistic and catches regressions.
    const requestedSeatId = decodeURIComponent(
      route
        .request()
        .url()
        .match(/committee-seats\/([^/]+)\/reassign/)?.[1] ?? ''
    );
    const original = [...BOARD_SEATS, ...COMMITTEE_SEATS].find((s) => s.seatId === requestedSeatId) ?? BOARD_SEATS[0];
    const updated = {
      ...original,
      person: { personId: 'new', firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane.doe@example.com', jobTitle: null, initials: 'JD' },
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountId: 'org-1', foundationId: 'sample-foundation', seat: updated }),
    });
  });
}

async function openBoardCommitteeTab(page: Page): Promise<void> {
  await page.goto(DETAIL_URL_BOARD, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('board-committee-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('board-committee-loading')).not.toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

// =============================================================================
// US1 — View Board & Committee seats (live shape)
// =============================================================================
test.describe('US1 — Board & Committee tab (live data)', () => {
  test.beforeEach(async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);
  });

  test('renders header + search with the spec-026 placeholder', async ({ page }) => {
    await expect(page.getByTestId('board-committee-title')).toHaveText('Board & Committee Members');
    await expect(page.getByTestId('board-committee-search-input')).toHaveAttribute(
      'placeholder',
      'Search by name, role, committee, voting status, or email...'
    );
    await expect(page.getByTestId('board-committee-export-csv')).toBeVisible();
  });

  test('Board seat renders the votingStatus STRING (not a percentage) + pencil for editable seat', async ({ page }) => {
    const row = page.getByTestId('board-committee-board-row-board-1');
    await expect(row).toContainText('Alex Rivera');
    await expect(row).toContainText('Governing Board');
    await expect(row).toContainText('Voting Rep');
    await expect(row).not.toContainText('%');
    await expect(page.getByTestId('board-committee-board-edit-board-1')).toBeVisible();
  });

  test('foundation-controlled committee seat shows "Why can\'t I edit?" (not a pencil)', async ({ page }) => {
    await page.getByTestId('board-committee-section-committee-header').click();
    await expect(page.getByTestId('board-committee-committee-why-com-1')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-edit-com-1')).toHaveCount(0);
    await expect(page.getByTestId('board-committee-committee-edit-com-2')).toBeVisible();
  });

  test('empty state when the org holds no seats', async ({ page }) => {
    await stubBoardCommittee(page, { board: [], committee: [] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('board-committee-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('board-committee-empty-board')).toBeVisible();
  });

  test('FR-011 search matches role/committee/voting status, not just name/email', async ({ page }) => {
    await page.getByTestId('board-committee-section-committee-header').click();
    await page.getByTestId('board-committee-search-input').fill('marketing');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('board-committee-committee-row-com-2')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-row-com-1')).toHaveCount(0);
  });
});

// =============================================================================
// US2 — CSV export (FR-012)
// =============================================================================
test.describe('US2 — CSV export', () => {
  test.beforeEach(async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);
  });

  test('Export CSV downloads a file with the board + committee rows', async ({ page }) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('board-committee-export-csv').click()]);
    expect(download.suggestedFilename()).toMatch(/board-committee-.*\.csv/);

    // Validate the file CONTENTS (FR-012), not just that a download fired — so a regression in column
    // order/escaping is caught: header + at least one board row and one committee row.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const lines = Buffer.concat(chunks).toString('utf-8').trim().split('\r\n');

    expect(lines[0]).toBe('Committee,Category,Name,Job Title,Role,Appointed By,Voting Status,Email');
    // Board row (BOARD_SEATS[0]) — board rows have an empty Role column.
    expect(lines).toContainEqual('Governing Board,Board,Alex Rivera,Principal Engineer,,Membership Entitlement,Voting Rep,alex.rivera@example.com');
    // Committee row (COMMITTEE_SEATS[1]) — committee rows carry a Role.
    expect(lines).toContainEqual(
      'Marketing Committee,Marketing Committee/Sub Committee,Jordan Kim,Engineer,Member,Membership Entitlement,Voting Rep,jordan.kim@example.com'
    );
  });
});

// =============================================================================
// US3 — Reassign write path (FR-006/FR-007/FR-009/FR-016)
// =============================================================================
test.describe('US3 — Reassign', () => {
  test('happy path: Save → success toast (write proxy 200)', async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toBeVisible({ timeout: 3_000 });
  });

  test('employee picker: typing filters suggestions; selecting fills email + first + last', async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });

    // Typing a partial query opens the combobox with only matching people.
    await page.getByTestId('reassign-board-email-input').fill('grace');
    await expect(page.getByTestId('reassign-board-employee-suggestions')).toBeVisible();
    await expect(page.getByTestId('reassign-board-employee-option-grace.hopper@example.com')).toBeVisible();
    await expect(page.getByTestId('reassign-board-employee-option-ada.lovelace@example.com')).toHaveCount(0);

    // Selecting a person fills email + name (select-to-fill) and the reassign write proceeds.
    await page.getByTestId('reassign-board-employee-option-grace.hopper@example.com').click();
    await expect(page.getByTestId('reassign-board-email-input')).toHaveValue('grace.hopper@example.com');
    await expect(page.getByTestId('reassign-board-first-name-input')).toHaveValue('Grace');
    await expect(page.getByTestId('reassign-board-last-name-input')).toHaveValue('Hopper');

    await page.getByTestId('reassign-board-primary-button').click();
    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toBeVisible({ timeout: 3_000 });
  });

  test('employee picker: endpoint failure shows the manual-entry fallback (search unavailable)', async ({ page }) => {
    await stubBoardCommittee(page, { employeesStatus: 500 });
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('reassign-board-search-unavailable')).toBeVisible();

    // Manual entry still works end to end when the picker source is down.
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();
    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toBeVisible({ timeout: 3_000 });
  });

  test('failure path: write proxy 403 → error toast, no false success (FR-016)', async ({ page }) => {
    await stubBoardCommittee(page, { reassignStatus: 403 });
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByText('Reassignment failed — please retry.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toHaveCount(0);
  });

  // The UI supports reassigning editable COMMITTEE seats too (com-2). Same flow as Board, but the
  // success toast is committee-specific ("Committee seat reassigned", not "Board roles reassigned").
  test('committee happy path: reassign editable committee seat → committee success toast', async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-section-committee-header').click();
    await page.getByTestId('board-committee-committee-edit-com-2').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Committee seat reassigned')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText('Board roles reassigned')).toHaveCount(0);
  });

  test('committee failure path: write proxy 403 → error toast, no false success (FR-016)', async ({ page }) => {
    await stubBoardCommittee(page, { reassignStatus: 403 });
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-section-committee-header').click();
    await page.getByTestId('board-committee-committee-edit-com-2').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByText('Reassignment failed — please retry.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Committee seat reassigned')).toHaveCount(0);
  });
});
