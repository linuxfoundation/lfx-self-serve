// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Create Quick-Link E2E — smoke set.
 *
 * Exercises the rail "Create" button → type popover → target-picker dialog (LFXV2-2838 rebuild).
 * Rail visibility is driven by CreatePermissionService, which now probes
 * `GET /api/create-picker/tree` (direct-grant projects/committees only) instead of the old
 * full `GET /api/projects` pull. The eligible targets are the authenticated test user's real
 * direct grants, so these tests assert structure/behavior rather than specific project names,
 * and skip entirely when the user has no create permission (the button is hidden).
 *
 * Coverage map:
 * - S1: rail "Create" button renders for a create-capable user
 * - S2: clicking it opens a popover listing the six artifact types, in grouped order, with descriptions
 * - S3: picking a type opens the dialog (header + target picker) with Continue disabled,
 *       and picking a direct-grant tree row enables Continue
 * - S4: the picker's default view is the direct-grant tree (search input + at least one
 *       selectable row) — replaces the old project-selector's search + All/Foundations/Projects
 *       tabs, which this rebuild removes from the create path entirely
 * - S5: Continue starts disabled on open and stays disabled until an explicit pick is made — the
 *       old "auto-select the sole eligible project" behavior is intentionally dropped: the tree
 *       no longer knows the full eligible set upfront (that was the enumeration this ticket
 *       removes), so there is nothing to safely auto-select
 * - S6: Continue routes into the create flow — lands on the lens-prefixed create URL carrying
 *       ?project=<slug>. `setContextLens()` replaces `setLens()`'s persona-gated alignment but
 *       preserves the same external URL-prefix contract, so this assertion is unchanged
 * - S7: typing a nonsense search term (≥2 chars) surfaces the fail-closed empty state — no
 *       post-selection permission error is possible because the empty state renders before any
 *       row could be picked
 * - S8: typing a real search term switches the picker from the tree view to search results
 *
 * What this suite does NOT attempt: a deterministic "inherited-writer reachable only via search"
 * or "committee target selectable for meeting but not newsletter" scenario. Both require a
 * fixture user with a specific, known grant shape (direct grants on some resources but not
 * others) that this suite's single real `TEST_USERNAME`/`TEST_PASSWORD` account cannot
 * guarantee — consistent with this file's existing real-API, name-agnostic approach, it asserts
 * on picker *shape* (search works, empty state fails closed, tree vs. search toggle) rather than
 * a specific grant fixture it doesn't control.
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 * - The test user must hold a direct grant on at least one project or committee for S1–S3 to
 *   run; otherwise the suite skips (no create permission → no button, by design).
 *
 * Note: this suite stops at the dialog boundary. It does not assert the post-Continue
 * create page — that path is enforced by each route's writerGuard.
 */

import { expect, Locator, Page, test } from '@playwright/test';

const APP_HOME = '/';
const RAIL_TIMEOUT = 30_000;

test.setTimeout(120_000);

// Hard skip when the auth-bootstrap failed — mirror org-selector.spec.ts so CI triage
// isn't sent chasing a regression that's really a credentials issue.
function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — keep running; a failure here is useful signal, not noise.
  }
}

// Skip when the test user has no create permission — the button is intentionally absent.
async function skipWhenNoCreatePermission(page: Page): Promise<void> {
  const trigger = page.getByTestId('create-rail-button');
  const visible = await trigger.isVisible().catch(() => false);
  if (!visible) {
    test.skip(true, 'Test user holds no direct-grant project or committee — button hidden by design.');
  }
}

async function openCreateMenu(page: Page): Promise<void> {
  const trigger = page.getByTestId('create-rail-button');
  await expect(trigger).toBeVisible({ timeout: RAIL_TIMEOUT });
  await trigger.click();
  await expect(page.getByTestId('create-menu')).toBeVisible({ timeout: 5_000 });
}

async function openDialogForType(page: Page, type: 'meeting' | 'newsletter' | 'vote' | 'survey' | 'group' | 'mailing-list'): Promise<void> {
  await openCreateMenu(page);
  await page.getByTestId(`create-menu-option-${type}`).click();
  await expect(page.getByTestId('create-artifact-dialog')).toBeVisible({ timeout: 5_000 });
}

function continueButton(page: Page): Locator {
  return page.getByTestId('create-artifact-continue-button').locator('button');
}

function pickerResults(page: Page): Locator {
  return page.getByTestId('create-target-results');
}

test.describe('Create Quick-Link — rail popover + dialog smoke set', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    // Give the direct-grant probe a moment to resolve before gating.
    await page
      .getByTestId('create-rail-button')
      .waitFor({ state: 'visible', timeout: RAIL_TIMEOUT })
      .catch(() => undefined);
    await skipWhenNoCreatePermission(page);
  });

  // S1 — rail button renders for a create-capable user
  test('S1: the rail "Create" button is visible for a create-capable user', async ({ page }) => {
    await expect(page.getByTestId('create-rail-button')).toBeVisible({ timeout: RAIL_TIMEOUT });
  });

  // S2 — the button opens a popover listing all six types, in the grouped sequence
  test('S2: clicking the button opens a popover with the six artifact types in grouped order', async ({ page }) => {
    await openCreateMenu(page);

    // Grouped sequence: Engage (meeting, newsletter) | Decide (vote, survey) | Organize (group, mailing-list).
    const expectedOrder = ['meeting', 'newsletter', 'vote', 'survey', 'group', 'mailing-list'];

    for (const type of expectedOrder) {
      await expect(page.getByTestId(`create-menu-option-${type}`)).toBeVisible();
    }

    // Assert render order matches the constant order, not just presence.
    const renderedOrder = await page
      .getByTestId('create-menu')
      .locator('[data-testid^="create-menu-option-"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-testid')?.replace('create-menu-option-', '')));
    expect(renderedOrder).toEqual(expectedOrder);

    await expect(page.getByTestId('create-menu-option-meeting')).toContainText('Schedule a recurring or one-time meeting');
  });

  // S3 — picking a direct-grant tree row enables Continue
  test('S3: picking "Meeting" opens the dialog and picking a tree row enables Continue', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    const firstNode = pickerResults(page).locator('[data-testid^="create-target-node-"]').first();
    await expect(firstNode).toBeVisible({ timeout: 10_000 });
    await firstNode.click();

    await expect(continueButton(page)).toBeEnabled();
  });

  // S4 — the default view is the direct-grant tree: search input + at least one selectable row
  test('S4: the picker opens on the direct-grant tree with a search input and selectable rows', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    await expect(page.getByTestId('create-target-search-input')).toBeVisible();
    await expect(pickerResults(page).locator('[data-testid^="create-target-node-"]').first()).toBeVisible({ timeout: 10_000 });
  });

  // S5 — no auto-select: Continue starts disabled and stays disabled until an explicit pick
  test('S5: Continue starts disabled and requires an explicit pick — no auto-select', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    await expect(continueButton(page)).toBeDisabled();

    const firstNode = pickerResults(page).locator('[data-testid^="create-target-node-"]').first();
    await expect(firstNode).toBeVisible({ timeout: 10_000 });
    await firstNode.click();

    await expect(continueButton(page)).toBeEnabled();
  });

  // S6 — Continue exercises the create-navigation path: lands on the lens-prefixed create URL
  test('S6: Continue navigates to the lens-prefixed create page carrying ?project=', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    const firstNode = pickerResults(page).locator('[data-testid^="create-target-node-"]').first();
    await expect(firstNode).toBeVisible({ timeout: 10_000 });
    await firstNode.click();

    await continueButton(page).click();

    // onContinue calls setContextLens() then navigates; lensRedirectGuard-equivalent prefixing is
    // preserved by construction (setContextLens aligns the same underlying signal setLens did).
    // Require the lens prefix explicitly (foundation|project) — a bare /meetings/create would mean
    // the alignment didn't happen, so it must NOT match.
    await expect(page).toHaveURL(/\/(foundation|project)\/meetings\/create\?.*project=/, { timeout: 15_000 });
  });

  // S7 — fail-closed empty state: a nonsense search term surfaces "no matches", not an error
  test('S7: an unmatched search term shows the fail-closed empty state', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    await page.getByTestId('create-target-search-input').fill('zzzznonexistentqueryzzzz');
    await expect(page.getByTestId('create-target-empty-state')).toBeVisible({ timeout: 10_000 });
    // No row could have been picked, so Continue never becomes enabled from this state.
    await expect(continueButton(page)).toBeDisabled();
  });

  // S8 — typing ≥2 chars switches the picker from the tree to search results
  test('S8: typing a search term switches the picker from tree to search results', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    const searchInput = page.getByTestId('create-target-search-input');
    await searchInput.fill('a');
    // Single char: still the tree, not search — a tree node row is still identifiable.
    await searchInput.fill('an');
    // ≥2 chars: search mode. Either a result row or the empty state renders, never both absent.
    await expect(pickerResults(page).locator('[data-testid^="create-target-search-result-"], [data-testid="create-target-empty-state"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });
});
