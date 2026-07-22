// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Create Quick-Link E2E — smoke set.
 *
 * Exercises the rail "Create" button → type popover → project-selection dialog.
 * Visibility is driven by CreatePermissionService, which derives create
 * capability from the project `writer` grant returned by GET /api/projects. The
 * eligible projects are therefore the authenticated test user's real grants, so
 * these tests assert structure/behavior rather than specific project names, and
 * skip entirely when the user has no create permission (the button is hidden).
 *
 * Coverage map:
 * - S1: rail "Create" button renders for a create-capable user
 * - S2: clicking it opens a popover listing the six artifact types, in grouped order, with descriptions
 * - S3: picking a type opens the dialog (header + project selector) with Continue disabled,
 *       and choosing an eligible project via the selector enables Continue
 * - S4: the dialog's project selector reuses the sidebar pattern (search + All/Foundations/Projects
 *       tabs) and renders a selectable list. Writer-scoping of that list is guaranteed by the dialog
 *       feeding the curated `creatableProjects` (verified in production-code review), not asserted here.
 * - S5: a single eligible project is auto-selected on open (Continue enabled without a pick); with
 *       multiple eligible projects nothing is pre-selected and Continue stays gated until the user picks
 * - S6: Continue routes into the create flow — lands on a create page carrying ?project=<slug>
 * - S7: a committee-target type routes with both ?project= (owning project slug) and ?committee_uid=
 * - S8: a committee-writer-only user (no project/foundation writer grant) sees the rail button with
 *       only meeting/vote/survey offered
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 * - The test user must hold `writer` on at least one project for S1–S3 to run;
 *   otherwise the suite skips (no create permission → no button, by design).
 *
 * Note: this suite stops at the dialog boundary. It does not assert the post-Continue
 * create page — that path is enforced by each route's writerGuard.
 *
 * LFXV2-2755: the dialog no longer aligns the navigation lens before navigating (removed the
 * `LensService.setLens` coupling) — it navigates by explicit target selection, resolved by the
 * create-route guards independently of the active lens. So Continue can legitimately land on a
 * flat (non-lens-prefixed) create URL; S6 asserts the query param + successful load, not a URL prefix.
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
    test.skip(true, 'Test user holds `writer` on no project — button hidden by design.');
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

// Scoped to the project/foundation selector specifically — the dialog can render a second,
// independent `lfx-project-selector` instance for committees (LFXV2-2755), so an unscoped
// `dialog.getByTestId('project-selector')` would violate Playwright strict mode whenever both
// are visible for the same artifact type.
function projectSelectorTrigger(dialog: Locator): Locator {
  return dialog.getByTestId('create-artifact-project-select').getByTestId('project-selector');
}

function committeeSelectorTrigger(dialog: Locator): Locator {
  return dialog.getByTestId('create-artifact-committee-select').getByTestId('project-selector');
}

test.describe('Create Quick-Link — rail popover + dialog smoke set', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);
    // Give writer-driven visibility a moment to resolve before gating.
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

  // S3 — picking a project via the selector enables Continue. (On-open enabled/disabled state is S5's
  // job; asserting "disabled on open" here would be wrong for a single-eligible-project account, where
  // the dialog auto-selects and Continue is already enabled.)
  test('S3: picking "Meeting" opens the dialog and choosing a project enables Continue', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    // Open the reused project-selector (same UI as the sidebar). Scope the trigger to the
    // project/foundation selector specifically — the dialog can also render an independent
    // committee selector carrying the same `project-selector` testid (LFXV2-2755).
    const dialog = page.getByTestId('create-artifact-dialog');
    await projectSelectorTrigger(dialog).click();
    const panel = page.getByTestId('project-selector-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const firstItem = panel.locator('[data-testid^="lens-item-"]').first();
    await expect(firstItem).toBeVisible({ timeout: 5_000 });
    await firstItem.click();

    await expect(continueButton(page)).toBeEnabled();
  });

  // S4 — the project selector reuses the sidebar pattern (search + tabs) and renders the writer-scoped list
  test('S4: the project selector reuses the search + tabs pattern and renders selectable projects', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    // Scope to the project/foundation selector — see projectSelectorTrigger doc.
    const dialog = page.getByTestId('create-artifact-dialog');
    await projectSelectorTrigger(dialog).click();
    const panel = page.getByTestId('project-selector-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Familiar sidebar pattern: search input + All/Foundations/Projects tabs.
    await expect(panel.getByTestId('project-search-input')).toBeVisible();
    await expect(panel.getByRole('button', { name: 'All', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Foundations', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Projects', exact: true })).toBeVisible();

    // The list is the dialog's writer-scoped `creatableProjects` (fed via the selector's curated `items`
    // input), never the view-scoped nav catalog. Assert on the selector's contract — a non-empty set of
    // selectable lens items — rather than hardcoding prod catalog names: this suite is real-API and
    // name-agnostic (see file docstring + testing-best-practices "assert on shape, not fixtures").
    await expect(panel.locator('[data-testid^="lens-item-"]').first()).toBeVisible({ timeout: 5_000 });
  });

  // S5 — auto-select single: a lone eligible target (project OR committee, counted together — see
  // CreateArtifactDialogComponent's constructor) is pre-selected so Continue is enabled without a pick.
  test('S5: a single eligible target is auto-selected; multiple require an explicit pick', async ({ page }) => {
    await openDialogForType(page, 'meeting');
    const dialog = page.getByTestId('create-artifact-dialog');
    const trigger = projectSelectorTrigger(dialog);

    // Count eligible project options, then toggle the panel closed via the trigger (Escape could close the dialog).
    await trigger.click();
    const panel = page.getByTestId('project-selector-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    let itemCount = await panel.locator('[data-testid^="lens-item-"]').count();
    await trigger.click();
    await expect(panel).toBeHidden();

    // Meeting is a committee-eligible type — add the committee selector's count, if rendered, since
    // auto-select fires when the two lists sum to exactly one (LFXV2-2755).
    const committeeTrigger = committeeSelectorTrigger(dialog);
    if (await committeeTrigger.isVisible().catch(() => false)) {
      await committeeTrigger.click();
      await expect(panel).toBeVisible({ timeout: 5_000 });
      itemCount += await panel.locator('[data-testid^="lens-item-"]').count();
      await committeeTrigger.click();
      await expect(panel).toBeHidden();
    }

    if (itemCount === 1) {
      // Auto-selected on open — no manual pick needed.
      await expect(continueButton(page)).toBeEnabled();
    } else {
      // Multiple options: nothing pre-selected, Continue gated until the user picks.
      await expect(continueButton(page)).toBeDisabled();
    }
  });

  // S6 — Continue exercises the create-navigation path: lands on a create page carrying ?project=<slug>
  test('S6: Continue navigates to the create page carrying the selected project slug', async ({ page }) => {
    await openDialogForType(page, 'meeting');
    const dialog = page.getByTestId('create-artifact-dialog');
    await projectSelectorTrigger(dialog).click();
    const panel = page.getByTestId('project-selector-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Capture the picked project's slug from its data-testid (`lens-item-<slug>`).
    const firstItem = panel.locator('[data-testid^="lens-item-"]').first();
    await expect(firstItem).toBeVisible({ timeout: 5_000 });
    const slug = (await firstItem.getAttribute('data-testid'))?.replace('lens-item-', '') ?? '';
    expect(slug).not.toBe('');
    await firstItem.click();

    await continueButton(page).click();

    // onContinue navigates by explicit selection (`?project=<slug>`), resolved by the create-route
    // guards independently of the active lens (LFXV2-2755) — no lens-alignment step runs first, so a
    // flat (non-lens-prefixed) URL is an expected, valid outcome here, not a bug. Assert the query
    // param plus a successful landing on the create page rather than a URL prefix.
    await expect(page).toHaveURL(new RegExp(`/meetings/create\\?.*project=${slug}`), { timeout: 15_000 });
    await expect(page.getByTestId('create-artifact-dialog')).toBeHidden();
  });

  // S7 — a committee target carries both ?project= (owning project slug, for writerGuard + slot-seeding)
  // and ?committee_uid= (the committee lock + committee-writer authorization) on navigation.
  test('S7: Continue with a committee target carries both project and committee_uid', async ({ page }) => {
    await openDialogForType(page, 'meeting');
    const dialog = page.getByTestId('create-artifact-dialog');
    const committeeTrigger = committeeSelectorTrigger(dialog);

    const hasCommitteeSelector = await committeeTrigger.isVisible().catch(() => false);
    test.skip(!hasCommitteeSelector, 'Test user holds no committee `writer` grant for a committee-eligible type — selector hidden by design.');

    await committeeTrigger.click();
    const panel = page.getByTestId('project-selector-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
    const firstItem = panel.locator('[data-testid^="lens-item-"]').first();
    await expect(firstItem).toBeVisible({ timeout: 5_000 });
    await firstItem.click();

    await expect(continueButton(page)).toBeEnabled();
    await continueButton(page).click();

    await expect(page).toHaveURL(/\/meetings\/create\?.*project=[^&]+.*committee_uid=[^&]+|\/meetings\/create\?.*committee_uid=[^&]+.*project=[^&]+/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('create-artifact-dialog')).toBeHidden();
  });
});

// S8 — a committee-writer-only user (no project/foundation writer grant at all) still sees the rail
// button, and only the committee-eligible types (meeting/vote/survey) are offered — never
// newsletter/group/mailing-list, which are project-only (LFXV2-2755).
test.describe('Create Quick-Link — committee-writer-only visibility', () => {
  test('S8: a committee-writer-only user sees the rail button with only meeting/vote/survey offered', async ({ page }) => {
    await page.goto(APP_HOME, { waitUntil: 'domcontentloaded' });
    skipWhenAuthMissing(page);

    const trigger = page.getByTestId('create-rail-button');
    const visible = await trigger
      .waitFor({ state: 'visible', timeout: RAIL_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    test.skip(!visible, 'Test user holds no writer grant of any kind — button hidden by design.');

    await openCreateMenu(page);
    const projectOnlyTypes: Array<'newsletter' | 'group' | 'mailing-list'> = ['newsletter', 'group', 'mailing-list'];
    const anyProjectOnlyTypeVisible = await Promise.all(projectOnlyTypes.map((type) => page.getByTestId(`create-menu-option-${type}`).isVisible()));
    test.skip(anyProjectOnlyTypeVisible.some(Boolean), 'Test user holds a project/foundation writer grant — not committee-writer-only.');

    // Committee-writer-only: only the committee-eligible types are offered.
    await expect(page.getByTestId('create-menu-option-meeting')).toBeVisible();
    await expect(page.getByTestId('create-menu-option-vote')).toBeVisible();
    await expect(page.getByTestId('create-menu-option-survey')).toBeVisible();
  });
});
