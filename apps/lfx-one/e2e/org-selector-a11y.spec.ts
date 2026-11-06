// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Org Selector — Accessibility Contract E2E.
 *
 * Verifies the WAI-ARIA APG combobox + listbox pattern on the organization switcher
 * and the documented keyboard-navigation contract.
 *
 * Coverage map:
 * - A1: trigger exposes role="combobox", aria-haspopup="listbox", aria-controls,
 *       and a stable aria-label describing the currently active organization.
 * - A2: panel body is modeled as role="listbox".
 * - A3: rows are modeled as role="option"; the currently active row carries
 *       aria-selected="true"; the others carry aria-selected="false".
 * - A4: keyboard-navigation contract — ArrowDown / ArrowUp / Home / End move
 *       focus between rows; Enter and Space activate the focused row; Escape
 *       closes the panel; every activation and Escape restores focus to the
 *       trigger.
 * - A5: the listbox itself carries an accessible name (`aria-label`) — the
 *       trigger's own aria-label names the combobox, not the controlled widget.
 * - A6: initial focus survives a delayed first-batch response — a panel opened
 *       while `/api/nav/org-items` is still in flight still lands focus on the
 *       aria-selected row once rows finally arrive.
 *
 * The two-grant fixture below puts both organizations in one family, so it qualifies for that
 * family's roll-up (#4132) and the listbox holds THREE options: the pinned roll-up first, then the
 * two organizations. Assertions name the
 * kind (`data-option-kind`) wherever the distinction matters, so a change to what is pinned fails
 * loudly instead of silently re-pointing an organization assertion at the roll-up row.
 *
 * All rows and grants in this file are stubbed via `page.route` so the test is
 * deterministic regardless of what the bootstrap identity actually holds.
 */

import { expect, Page, test } from '@playwright/test';

// The org-selector trigger only renders (data-visible=true) while the active lens is 'org'; on the
// default 'me' lens the sidebar keeps it in the DOM but CSS-hidden. Navigating to `/org` sets the
// active lens deterministically so these tests never depend on a per-user cookie preference.
const APP_HOME = '/org';
const SIDEBAR_TIMEOUT = 30_000;

test.setTimeout(120_000);

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

// SFIDs are exactly 18 chars (`001` prefix + 15 alphanumerics).
const ORG_A_UID = '0014100000AaaAAAAA';
const ORG_B_UID = '0014100000BbbBBBBB';
const ORG_A_NAME = 'Alpha Foundation';
const ORG_B_NAME = 'Bravo Foundation';

async function stubTwoDirectGrants(page: Page): Promise<void> {
  await page.route('**/api/orgs/me/role-grants', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [ORG_A_UID, ORG_B_UID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        isStaff: false,
        username: 'e2e-a11y',
        loaded_at: new Date().toISOString(),
      }),
    })
  );

  await page.route('**/api/orgs/me/roll-up-set*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        families: [
          {
            rootUid: ORG_A_UID,
            rootName: ORG_A_NAME,
            rootLogoUrl: null,
            orgs: [
              { uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null },
              { uid: ORG_B_UID, accountId: ORG_B_UID, name: ORG_B_NAME, logoUrl: null },
            ],
          },
        ],
        degraded: false,
        lookupOutcome: 'ok',
      }),
    })
  );

  await page.route('**/api/nav/org-items*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [
          { uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null },
          { uid: ORG_B_UID, accountId: ORG_B_UID, name: ORG_B_NAME, logoUrl: null, primaryDomain: 'bravo.example', isMember: true, parentName: null },
        ],
        next_page_token: null,
        upstream_failed: false,
        total: 2,
      }),
    })
  );
}

test.describe('Org Selector — accessibility contract', () => {
  test.beforeEach(async ({ page }) => {
    await stubTwoDirectGrants(page);
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
  });

  test('A1: trigger exposes combobox role, aria-controls, and a stable aria-label', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await expect(trigger).toHaveAttribute('role', 'combobox');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
    await expect(trigger).toHaveAttribute('aria-controls', 'org-selector-listbox');
    // aria-label carries the currently active organization; the exact copy is bounded but not asserted
    // verbatim so a future rename of the account-name signal doesn't break the a11y spec.
    await expect(trigger).toHaveAttribute('aria-label', /Organization switcher, currently /i);
  });

  test('A2 + A3: panel is modeled as listbox; rows carry aria-selected on the active row', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await expect(listbox).toHaveAttribute('role', 'listbox');

    // Three options: the pinned roll-up the two-grant fixture qualifies for (#4132), then the two
    // organizations. Counted by kind rather than by position so a later change to what is pinned
    // cannot quietly turn an organization assertion into a roll-up one.
    const options = listbox.getByRole('option');
    await expect(options).toHaveCount(3, { timeout: 5_000 });
    await expect(listbox.locator('[role="option"][data-option-kind="rollup"]')).toHaveCount(1);
    await expect(listbox.locator('[role="option"][data-option-kind="org"]')).toHaveCount(2);

    // Exactly one option (the active one) reports aria-selected="true"; the rest report "false".
    const selectedOption = listbox.locator('[role="option"][aria-selected="true"]');
    const unselectedOptions = listbox.locator('[role="option"][aria-selected="false"]');
    await expect(selectedOption).toHaveCount(1);
    await expect(unselectedOptions).toHaveCount(2);
  });

  test('A4: keyboard-navigation contract — ArrowDown / ArrowUp / Home / End / Escape', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(3);
    // Roving focus starts on the selected organization, which the pinned roll-up pushes off index 0.
    const selected = listbox.locator('[role="option"][aria-selected="true"]');
    await expect(selected).toBeFocused({ timeout: 5_000 });

    // ArrowDown moves focus down one row.
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(2)).toBeFocused();

    // ArrowUp moves focus back up one row.
    await page.keyboard.press('ArrowUp');
    await expect(options.nth(1)).toBeFocused();

    // End jumps focus to the last option (boundary branch).
    await page.keyboard.press('End');
    await expect(options.nth(2)).toBeFocused();

    // Home jumps focus to the first option — the pinned roll-up (boundary branch).
    await page.keyboard.press('Home');
    await expect(options.nth(0)).toBeFocused();
    await expect(options.nth(0)).toHaveAttribute('data-option-kind', 'rollup');

    // Escape closes the panel and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });
    await expect(trigger).toBeFocused();
  });

  test('A4b: Enter on a focused option activates that row, closes the panel, and restores focus to the combobox trigger', async ({ page }) => {
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(3);

    // Move focus one row down from the selected organization, then activate it via Enter.
    await page.keyboard.press('ArrowDown');
    await expect(options.nth(2)).toBeFocused();
    await expect(options.nth(2)).toHaveAttribute('data-option-kind', 'org');
    await page.keyboard.press('Enter');

    // Panel closes on selection.
    await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });

    // Focus MUST return to the combobox trigger, mirroring Escape's contract — the row that
    // received Enter is about to be removed from the DOM, so without an explicit restore, the
    // keyboard user is dumped on `body`.
    await expect(trigger).toBeFocused();
  });

  test('A4c: Space on a focused option activates that row and restores focus to the combobox trigger', async ({ page }) => {
    // Space activates a native `role="option"` button just like Enter, so it needs the same
    // focus-restore contract — a row that received Space is about to leave the DOM and without
    // the restore the keyboard user lands on `body`.
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(3);

    await page.keyboard.press('ArrowDown');
    await expect(options.nth(2)).toBeFocused();
    await expect(options.nth(2)).toHaveAttribute('data-option-kind', 'org');
    await page.keyboard.press('Space');

    await expect(page.getByTestId('org-selector-list')).not.toBeVisible({ timeout: 5_000 });
    await expect(trigger).toBeFocused();
  });

  test('A5: listbox carries its own accessible name', async ({ page }) => {
    // The trigger's aria-label names the combobox, not the controlled widget. Per WAI-ARIA APG
    // a listbox needs its own accessible name; without it assistive tech announces an unnamed
    // region when focus arrives.
    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });
    await expect(listbox).toHaveAttribute('aria-label', /.+/);
  });

  test('A6: initial focus survives a delayed first-batch response', async ({ page }) => {
    // Re-route /api/nav/org-items with a deliberate delay so the panel can open before rows exist —
    // this is the async-bootstrap race the initial-focus retry addresses. Only that route is
    // replaced: the grants and families stubs from `beforeEach` stay, so the one pinned roll-up
    // below comes from the fixture rather than the live identity.
    await page.unroute('**/api/nav/org-items*');
    await page.route('**/api/nav/org-items*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            { uid: ORG_A_UID, accountId: ORG_A_UID, name: ORG_A_NAME, logoUrl: null, primaryDomain: 'alpha.example', isMember: true, parentName: null },
            { uid: ORG_B_UID, accountId: ORG_B_UID, name: ORG_B_NAME, logoUrl: null, primaryDomain: 'bravo.example', isMember: true, parentName: null },
          ],
          next_page_token: null,
          upstream_failed: false,
          total: 2,
        }),
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });

    const trigger = page.getByTestId('org-selector');
    await expect(trigger).toBeVisible({ timeout: SIDEBAR_TIMEOUT });
    await trigger.click();

    const listbox = page.locator('#org-selector-listbox');
    await expect(listbox).toBeVisible({ timeout: 5_000 });

    // Rows arrive after the panel opens; once they render, the aria-selected row should end up
    // focused. Without the retry, the first row would render with tabindex=-1 and focus would
    // stay on `body`.
    // The pinned roll-up renders immediately, so the listbox is NOT empty while the organizations
    // are still in flight. Initial focus lands on it provisionally and must move to the selected
    // organization once that row arrives — the roll-up row otherwise ends the retry early and
    // strands focus on an unselected row (#4415, Copilot).
    const rollUp = listbox.locator('[role="option"][data-option-kind="rollup"]');
    await expect(rollUp).toHaveCount(1, { timeout: 5_000 });

    const options = listbox.locator('[role="option"]');
    await expect(options).toHaveCount(3, { timeout: 5_000 });
    const selected = listbox.locator('[role="option"][aria-selected="true"]');
    await expect(selected).toHaveAttribute('data-option-kind', 'org');
    await expect(selected).toBeFocused({ timeout: 5_000 });
  });
});
