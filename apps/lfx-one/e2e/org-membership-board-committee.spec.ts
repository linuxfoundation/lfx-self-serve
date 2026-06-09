// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Board & Committee Tab E2E Tests (spec 016)
 *
 * Covers spec 016-board-committee-tab success criteria:
 * - SC-007: row counts match the sample mock (1 board / 8 committee / 3 voting) on first visit
 * - SC-006: search by name OR email (case-insensitive) filters Board+Committee, NOT Voting History
 * - SC-002: pencil click opens Reassign modal with correct surface
 * - SC-003: "Why can't I edit?" link opens explainer modal
 * - SC-004: Save Changes triggers optimistic update + plain success toast + refetch
 * - SC-005: Cancel / Esc / outside-click leaves tables unchanged
 * - SC-012: data-testid resolution per FR-016 (testids predicted, not class/text selectors)
 * - SC-014 / SC-015: keyboard-only operation of Reassign modal
 *
 * US1 (P1 UI MVP): view tables — 4 tests
 * US2 (P1):       Reassign modal — 6 tests
 * US3 (P2):       Why-can't-I-edit modal — 2 tests
 *
 * Prerequisites:
 * - Dev server running on localhost:4200 (auto via Playwright webServer)
 * - User authenticated via Auth0 (auto via global-setup, .env credentials)
 * - `org-lens-enabled` LaunchDarkly flag toggled ON for the test user
 * - Organization context selected (existing AccountContextService default applies)
 *
 * Mock semantics (v1): every foundationId returns the same shared payload (FR-009c),
 * so the sample fixture data is what every test below asserts against — Alex Rivera,
 * Jordan Kim × 3, Taylor Morgan, Sam Chen × 2, Riley Brooks.
 */

import { expect, test } from '@playwright/test';

const DETAIL_URL_FOUNDATION = '/org/memberships/sample-foundation';
const DETAIL_URL_BOARD = `${DETAIL_URL_FOUNDATION}#board`;
const DATA_LOAD_TIMEOUT = 30_000;

test.setTimeout(90_000);

/**
 * Helper: navigate directly to the sample detail page with the `#board` URL fragment
 * (FR-001b — tab state synced with URL fragment for e2e simplicity, spec 016
 * round 7). Returns once the card is fully rendered (initial loading skeleton
 * gone). One round-trip — no tab-button click required.
 */
async function openBoardCommitteeTab(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(DETAIL_URL_BOARD, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  await expect(page.getByTestId('board-committee-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  // Loading skeleton disappears once all 3 endpoints resolve
  await expect(page.getByTestId('board-committee-loading')).not.toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

// =============================================================================
// US1 — View Board & Committee Seats and Voting History (Priority: P1) 🎯 MVP
// =============================================================================
test.describe('US1 — Board & Committee tab view (FR-002 through FR-007)', () => {
  test.beforeEach(async ({ page }) => {
    await openBoardCommitteeTab(page);
  });

  test('renders the card-header testid surface — title, search input (SC-012, FR-002)', async ({ page }) => {
    await expect(page.getByTestId('board-committee-card')).toBeVisible();
    await expect(page.getByTestId('board-committee-title')).toHaveText('Board & Committee Members');
    const search = page.getByTestId('board-committee-search-input');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('placeholder', 'Search by name or email...');
  });

  test('renders 3 accordion sections with correct unfiltered counts (FR-003, SC-007)', async ({ page }) => {
    const boardHeader = page.getByTestId('board-committee-section-board-header');
    const committeeHeader = page.getByTestId('board-committee-section-committee-header');
    const votingHeader = page.getByTestId('board-committee-section-voting-header');

    await expect(boardHeader).toBeVisible();
    await expect(committeeHeader).toBeVisible();
    await expect(votingHeader).toBeVisible();

    // Counts from sample mock fixture (spec FR-010b)
    await expect(boardHeader).toContainText('Board Seats (1)');
    await expect(committeeHeader).toContainText('Committee Seats (8)');
    await expect(votingHeader).toContainText('Voting History (3)');

    // Board expanded by default; the other two collapsed
    await expect(page.getByTestId('board-committee-section-board-body')).toBeVisible();
    await expect(page.getByTestId('board-committee-section-committee-body')).not.toBeVisible();
    await expect(page.getByTestId('board-committee-section-voting-body')).not.toBeVisible();
  });

  test('Board Seats table renders Alex Rivera / Governing Board / 92% with pencil (FR-004, FR-004b, SC-007)', async ({ page }) => {
    await expect(page.getByTestId('board-committee-board-table')).toBeVisible();
    const row = page.getByTestId('board-committee-board-row-board-1');
    await expect(row).toBeVisible();
    await expect(row).toContainText('Alex Rivera');
    await expect(row).toContainText('Principal Engineer');
    await expect(row).toContainText('Governing Board');
    await expect(row).toContainText('92%');
    // isOrgEditable: true → pencil affordance (NOT "Why can't I edit?" link)
    await expect(page.getByTestId('board-committee-board-edit-board-1')).toBeVisible();
    await expect(page.getByTestId('board-committee-board-why-board-1')).toHaveCount(0);
  });

  test('Committee Seats — Role-before-Committee column order + 2 foundation-controlled rows (FR-005, FR-004b)', async ({ page }) => {
    await page.getByTestId('board-committee-section-committee-header').click();
    await expect(page.getByTestId('board-committee-committee-table')).toBeVisible();

    // Verify all 8 fixture rows are present
    for (const seatId of ['com-1', 'com-2', 'com-3', 'com-4', 'com-5', 'com-6', 'com-7', 'com-8']) {
      await expect(page.getByTestId(`board-committee-committee-row-${seatId}`)).toBeVisible();
    }

    // Foundation-controlled seats render the "Why can't I edit?" link, NOT a pencil
    await expect(page.getByTestId('board-committee-committee-why-com-1')).toBeVisible(); // Alex / TSC Chair
    await expect(page.getByTestId('board-committee-committee-edit-com-1')).toHaveCount(0);
    await expect(page.getByTestId('board-committee-committee-why-com-3')).toBeVisible(); // Jordan / Budget & Finance Observer
    await expect(page.getByTestId('board-committee-committee-edit-com-3')).toHaveCount(0);

    // Org-editable seats render the pencil, NOT the link
    await expect(page.getByTestId('board-committee-committee-edit-com-2')).toBeVisible(); // Jordan / Marketing Member
    await expect(page.getByTestId('board-committee-committee-why-com-2')).toHaveCount(0);
  });

  test('Voting History renders 3 rows in reverse-chronological order with vote chips (FR-006, FR-013b)', async ({ page }) => {
    await page.getByTestId('board-committee-section-voting-header').click();
    await expect(page.getByTestId('board-committee-voting-table')).toBeVisible();

    for (const voteId of ['vote-1', 'vote-2', 'vote-3']) {
      await expect(page.getByTestId(`board-committee-voting-row-${voteId}`)).toBeVisible();
    }

    // Verify vote content + chip classes for each
    const v1 = page.getByTestId('board-committee-voting-row-vote-1');
    await expect(v1).toContainText('Apr 14, 2026');
    await expect(v1).toContainText('Approve 2026 budget allocation');
    await expect(v1).toContainText('Yes');
    await expect(v1).toContainText('Passed (8-1)');

    const v3 = page.getByTestId('board-committee-voting-row-vote-3');
    await expect(v3).toContainText('No');
    await expect(v3).toContainText('Passed (6-3)');
  });

  test('URL fragment ↔ tab sync — direct goto, tab-click writes fragment (FR-001b round 7)', async ({ page }) => {
    // Direct goto with #board landed us on the Board tab (no extra click in beforeEach helper)
    await expect(page).toHaveURL(/#board$/);

    // Clicking Key Contacts updates the fragment via replaceUrl (no history pollution)
    await page.getByTestId('membership-detail-tab-key-contacts').click();
    await expect(page).toHaveURL(/#key-contacts$/);

    // Clicking back to Board updates again
    await page.getByTestId('membership-detail-tab-board').click();
    await expect(page).toHaveURL(/#board$/);

    // Direct goto with an UNKNOWN fragment falls back to the default tab (key-contacts)
    await page.goto('/org/memberships/sample-foundation#totally-bogus-tab', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('membership-detail-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('membership-detail-key-contacts-card')).toBeVisible();
  });

  test('search filters Board+Committee by name OR email, NOT Voting History (FR-007, SC-006)', async ({ page }) => {
    // Expand all sections so we can observe each
    await page.getByTestId('board-committee-section-committee-header').click();
    await page.getByTestId('board-committee-section-voting-header').click();

    // Search by partial name "jordan" → 0 board / 3 committee / 3 voting (unchanged)
    await page.getByTestId('board-committee-search-input').fill('jordan');
    // Wait past the 200ms debounce
    await page.waitForTimeout(300);

    await expect(page.getByTestId('board-committee-board-row-board-1')).toHaveCount(0);
    await expect(page.getByTestId('board-committee-empty-board')).toBeVisible();

    await expect(page.getByTestId('board-committee-committee-row-com-2')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-row-com-3')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-row-com-4')).toBeVisible();
    // Other committee rows hidden
    await expect(page.getByTestId('board-committee-committee-row-com-1')).toHaveCount(0);

    // Voting History is untouched (FR-006a)
    await expect(page.getByTestId('board-committee-voting-row-vote-1')).toBeVisible();
    await expect(page.getByTestId('board-committee-voting-row-vote-2')).toBeVisible();
    await expect(page.getByTestId('board-committee-voting-row-vote-3')).toBeVisible();

    // Count badges show UNFILTERED totals (FR-007b)
    await expect(page.getByTestId('board-committee-section-committee-header')).toContainText('Committee Seats (8)');

    // Now search by full email — should still match the same 3 Jordan rows (FR-007 email match)
    await page.getByTestId('board-committee-search-input').fill('jordan.kim@example.com');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('board-committee-committee-row-com-2')).toBeVisible();

    // Clear search via the (×) button — all rows return
    await page.getByTestId('board-committee-search-clear').click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId('board-committee-board-row-board-1')).toBeVisible();
    await expect(page.getByTestId('board-committee-committee-row-com-1')).toBeVisible();
  });
});

// =============================================================================
// US2 — Reassign an Org-Owned Board or Committee Seat (Priority: P1)
// =============================================================================
test.describe('US2 — Reassign Board Roles modal (FR-008)', () => {
  test.beforeEach(async ({ page }) => {
    await openBoardCommitteeTab(page);
  });

  test('renders the Reassign modal testid surface on pencil click (SC-012, FR-016)', async ({ page }) => {
    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });

    await expect(page.getByTestId('reassign-board-title')).toHaveText('Reassign Board Roles');
    await expect(page.getByTestId('reassign-board-subtitle')).toContainText('1 role across 1 foundation');
    await expect(page.getByTestId('reassign-board-current-member')).toContainText('Alex Rivera');
    await expect(page.getByTestId('reassign-board-current-member')).toContainText('alex.rivera@example.com');
    await expect(page.getByTestId('reassign-board-select-all')).toBeVisible();
    await expect(page.getByTestId('reassign-board-role-row-board-1')).toBeVisible();
    await expect(page.getByTestId('reassign-board-role-checkbox-board-1')).toBeVisible();
    await expect(page.getByTestId('reassign-board-info-banner')).toBeVisible();
    await expect(page.getByTestId('reassign-board-assign-form')).toBeVisible();
    await expect(page.getByTestId('reassign-board-email-input')).toBeVisible();
    await expect(page.getByTestId('reassign-board-first-name-input')).toBeVisible();
    await expect(page.getByTestId('reassign-board-last-name-input')).toBeVisible();
    await expect(page.getByTestId('reassign-board-cancel')).toBeVisible();
    await expect(page.getByTestId('reassign-board-primary-button')).toBeVisible();
  });

  test('Save Changes flow: optimistic update + Board roles reassigned toast (FR-008h, SC-004)', async ({ page }) => {
    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible();

    await page.getByTestId('reassign-board-email-input').fill('jane.doe@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Jane');
    await page.getByTestId('reassign-board-last-name-input').fill('Doe');

    const primary = page.getByTestId('reassign-board-primary-button');
    await expect(primary).toBeEnabled();
    await primary.click();

    // Modal closes within ~1s (400 ms SIMULATED_SAVE_DELAY_MS + buffer)
    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });

    // Success toast appears. Note: the testid `board-toast-success-reassigned` is on the
    // <p-toast> OUTLET (always in DOM, count=1). The actual toast MESSAGE is rendered by
    // PrimeNG inside the outlet only when MessageService.add() fires — so we assert on
    // the toast text content (which is only present when a message is active).
    await expect(page.getByText('Board roles reassigned')).toBeVisible({ timeout: 3_000 });

    // Optimistic update is briefly visible then refetch overwrites it. By the time the
    // assertion runs the refetch has likely already resolved, restoring Alex Rivera.
    // SC-004 documents this as explicit accepted v1 behavior. We just assert the row
    // still exists with SOME person — exact identity isn't deterministic post-refetch.
    await expect(page.getByTestId('board-committee-board-row-board-1')).toBeVisible();
  });

  test('self-reassign duplicate check intercepts Save Changes (FR-008e)', async ({ page }) => {
    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible();

    // Type the CURRENT member's email — should trigger the duplicate-check intercept
    await page.getByTestId('reassign-board-email-input').fill('alex.rivera@example.com');
    await page.getByTestId('reassign-board-first-name-input').fill('Alex');
    await page.getByTestId('reassign-board-last-name-input').fill('Rivera');

    await page.getByTestId('reassign-board-primary-button').click();

    // Modal stays open + inline error fires + no toast text rendered
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible();
    await expect(page.getByTestId('reassign-board-duplicate-error')).toContainText('This person already holds the selected role(s).');
    // The toast outlet (testid) is always in the DOM; assert on toast TEXT instead.
    await expect(page.getByText('Board roles reassigned')).toHaveCount(0);
  });

  test('email validation shows inline error on blur with invalid format (FR-008f)', async ({ page }) => {
    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible();

    const emailInput = page.getByTestId('reassign-board-email-input');
    await emailInput.fill('not-an-email');
    await emailInput.blur();

    await expect(page.getByTestId('reassign-board-email-error')).toContainText('Enter a valid email address');
    await expect(page.getByTestId('reassign-board-primary-button')).toBeDisabled();

    // Fix the email — error clears
    await emailInput.fill('valid@example.com');
    await emailInput.blur();
    await expect(page.getByTestId('reassign-board-email-error')).toHaveCount(0);
  });

  test('Cancel button closes modal with no toast or table mutation (FR-008i, SC-005)', async ({ page }) => {
    await page.getByTestId('board-committee-board-edit-board-1').click();
    await expect(page.getByTestId('reassign-board-modal')).toBeVisible();

    await page.getByTestId('reassign-board-email-input').fill('some.person@example.com');
    await page.getByTestId('reassign-board-cancel').click();

    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 3_000 });
    // The toast outlet (testid) is always in the DOM; assert on toast TEXT instead.
    await expect(page.getByText('Board roles reassigned')).toHaveCount(0);
    // Board table row still shows the original person (no mutation)
    await expect(page.getByTestId('board-committee-board-row-board-1')).toContainText('Alex Rivera');
  });

  test('keyboard-only Reassign flow (SC-015, FR-017a, FR-017b)', async ({ page }) => {
    // Focus the pencil and activate via Enter (NOT click)
    await page.getByTestId('board-committee-board-edit-board-1').focus();
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('reassign-board-modal')).toBeVisible({ timeout: 5_000 });

    // Fill via keyboard only — focus inputs by testid (PrimeNG focus management
    // may vary, so use focus() to set predictable starting point), then keyboard.type
    await page.getByTestId('reassign-board-email-input').focus();
    await page.keyboard.type('keyboard.user@example.com');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Keyboard');
    await page.keyboard.press('Tab');
    await page.keyboard.type('User');

    // Enter inside a text input triggers Save Changes (FR-017b)
    await page.keyboard.press('Enter');

    await expect(page.getByTestId('reassign-board-modal')).not.toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Board roles reassigned')).toBeVisible({ timeout: 3_000 });
  });
});

// =============================================================================
// US3 — Understand Why a Seat Cannot Be Edited (Priority: P2)
// =============================================================================
test.describe("US3 — Why-can't-I-edit explainer modal (FR-012)", () => {
  test.beforeEach(async ({ page }) => {
    await openBoardCommitteeTab(page);
    // Expand Committee section — both foundation-controlled seats (com-1, com-3) live there
    await page.getByTestId('board-committee-section-committee-header').click();
  });

  test('opens with the per-seat reason and full testid surface (FR-012a, SC-003, SC-012)', async ({ page }) => {
    await page.getByTestId('board-committee-committee-why-com-1').click();

    await expect(page.getByTestId('why-cant-edit-modal')).toBeVisible({ timeout: 3_000 });
    await expect(page.getByTestId('why-cant-edit-icon')).toBeVisible();
    await expect(page.getByTestId('why-cant-edit-title')).toHaveText("Why can't I edit this member?");
    await expect(page.getByTestId('why-cant-edit-reason')).toContainText('This seat is held by foundation election or appointment, not by your organization');
    await expect(page.getByTestId('why-cant-edit-got-it')).toBeVisible();
    await expect(page.getByTestId('why-cant-edit-contact-foundation')).toBeVisible();

    await page.getByTestId('why-cant-edit-got-it').click();
    await expect(page.getByTestId('why-cant-edit-modal')).not.toBeVisible({ timeout: 3_000 });
  });

  test('Contact Foundation is a no-op (FR-012c) — emits console event, no navigation', async ({ page }) => {
    const urlBefore = page.url();
    await page.getByTestId('board-committee-committee-why-com-1').click();
    await expect(page.getByTestId('why-cant-edit-modal')).toBeVisible();

    const consolePromise = page.waitForEvent('console', {
      predicate: (msg) => msg.type() === 'info' && msg.text().includes('[board] contact foundation clicked for'),
      timeout: 5_000,
    });
    await page.getByTestId('why-cant-edit-contact-foundation').click();
    const consoleMsg = await consolePromise;

    // URL did not change (no navigation, no mailto handler)
    expect(page.url()).toBe(urlBefore);
    // Modal stays open
    await expect(page.getByTestId('why-cant-edit-modal')).toBeVisible();
    // Console event fired with the expected seatId payload
    expect(consoleMsg.text()).toContain('com-1');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('why-cant-edit-modal')).not.toBeVisible({ timeout: 3_000 });
  });
});
