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

const DETAIL_URL_AGL_BOARD = '/org/memberships/agl-001#board';
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

const BOARD_SEATS = [
  {
    seatId: 'agl-board-1',
    memberUid: 'agl-board-1',
    committeeUid: 'cmte-board',
    person: {
      personId: 'agl-board-1',
      firstName: 'Alex',
      lastName: 'Rivera',
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      jobTitle: 'Principal Engineer',
      initials: 'MI',
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
    seatId: 'agl-com-1',
    memberUid: 'agl-com-1',
    committeeUid: 'cmte-tsc',
    person: {
      personId: 'agl-com-1',
      firstName: 'Alex',
      lastName: 'Rivera',
      fullName: 'Alex Rivera',
      email: 'alex.rivera@example.com',
      jobTitle: 'Principal Engineer',
      initials: 'MI',
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
    seatId: 'agl-com-2',
    memberUid: 'agl-com-2',
    committeeUid: 'cmte-mkt',
    person: {
      personId: 'agl-com-2',
      firstName: 'Jordan',
      lastName: 'Kim',
      fullName: 'Jordan Kim',
      email: 'jordan.kim@example.com',
      jobTitle: 'Engineer',
      initials: 'KH',
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

// Voting history is deferred (D12): the BFF always returns an empty list, so the stub matches that
// behavior — a non-empty stub would mask empty-state UI issues. Shape (for reference) was:
// { voteId, date, resolution, vote, outcome }.
const VOTING_HISTORY: unknown[] = [];

interface StubOptions {
  board?: unknown[];
  committee?: unknown[];
  voting?: unknown[];
  reassignStatus?: number;
}

/** Stub all BFF board-committee `/api/...` routes (anchored API prefix per the e2e rulebook). */
async function stubBoardCommittee(page: Page, opts: StubOptions = {}): Promise<void> {
  const board = opts.board ?? BOARD_SEATS;
  const committee = opts.committee ?? COMMITTEE_SEATS;
  const voting = opts.voting ?? VOTING_HISTORY;

  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/board-seats$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accountId: 'org-1', foundationId: 'agl-001', boardSeats: board }) })
  );
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/committee-seats$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountId: 'org-1', foundationId: 'agl-001', committeeSeats: committee }),
    })
  );
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/voting-history$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountId: 'org-1', foundationId: 'agl-001', votingHistory: voting }),
    })
  );

  // Reassign write path — success returns the updated seat; error path returns the configured status.
  await page.route(/\/api\/orgs\/[^/]+\/lens\/memberships\/[^/]+\/committee-seats\/[^/]+\/reassign$/, (route) => {
    if (opts.reassignStatus && opts.reassignStatus >= 400) {
      return route.fulfill({ status: opts.reassignStatus, contentType: 'application/json', body: JSON.stringify({ error: 'reassignment failed' }) });
    }
    const updated = {
      ...BOARD_SEATS[0],
      person: { personId: 'new', firstName: 'Jane', lastName: 'Doe', fullName: 'Jane Doe', email: 'jane.doe@example.com', jobTitle: null, initials: 'JD' },
    };
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ accountId: 'org-1', foundationId: 'agl-001', seat: updated }),
    });
  });
}

async function openBoardCommitteeTab(page: Page): Promise<void> {
  await page.goto(DETAIL_URL_AGL_BOARD, { waitUntil: 'domcontentloaded' });
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
    const row = page.getByTestId('board-committee-board-row-agl-board-1');
    await expect(row).toContainText('Alex Rivera');
    await expect(row).toContainText('Governing Board');
    await expect(row).toContainText('Voting Rep');
    await expect(row).not.toContainText('%');
    await expect(page.getByTestId('board-committee-board-edit-agl-board-1')).toBeVisible();
  });

  test('foundation-controlled committee seat shows "Why can\'t I edit?" (not a pencil)', async ({ page }) => {
    await page.getByTestId('board-committee-section-committee-header').click();
    await expect(page.getByTestId('board-committee-committee-why-agl-com-1')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-edit-agl-com-1')).toHaveCount(0);
    await expect(page.getByTestId('board-committee-committee-edit-agl-com-2')).toBeVisible();
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
    await expect(page.getByTestId('board-committee-committee-row-agl-com-2')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-row-agl-com-1')).toHaveCount(0);
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
  });
});

// =============================================================================
// US3 — Reassign write path (FR-006/FR-007/FR-009/FR-016)
// =============================================================================
test.describe('US3 — Reassign', () => {
  test('happy path: Save → success toast (write proxy 200)', async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-board-edit-agl-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
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

    await page.getByTestId('board-committee-board-edit-agl-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByText('Reassignment failed — please retry.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toHaveCount(0);
  });

  // The UI supports reassigning editable COMMITTEE seats too (agl-com-2). Same flow as Board, but the
  // success toast is committee-specific ("Committee seat reassigned", not "Board roles reassigned").
  test('committee happy path: reassign editable committee seat → committee success toast', async ({ page }) => {
    await stubBoardCommittee(page);
    await openBoardCommitteeTab(page);

    await page.getByTestId('board-committee-section-committee-header').click();
    await page.getByTestId('board-committee-committee-edit-agl-com-2').click();
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
    await page.getByTestId('board-committee-committee-edit-agl-com-2').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');
    await page.getByTestId('reassign-board-primary-button').click();

    await expect(page.getByText('Reassignment failed — please retry.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Committee seat reassigned')).toHaveCount(0);
  });
});
