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
 * - S3: picking a type opens the dialog (header + project select) with Continue disabled,
 *       and choosing an eligible project enables Continue
 *
 * Prerequisites:
 * - Dev server reachable at the Playwright baseURL
 * - `apps/lfx-one/.env` populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 * - The test user must hold `writer` on at least one project for S1–S3 to run;
 *   otherwise the suite skips (no create permission → no button, by design).
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

  // S3 — picking a type opens the dialog; choosing an eligible project enables Continue
  test('S3: picking "Meeting" opens the dialog and enabling Continue requires a project', async ({ page }) => {
    await openDialogForType(page, 'meeting');

    // Nothing chosen yet — Continue disabled.
    await expect(continueButton(page)).toBeDisabled();

    // The dropdown is populated from the user's real eligible projects; pick the first.
    // `lfx-select` emits the id as `data-test` (not Playwright's default `data-testid`), so
    // target the attribute the wrapper actually renders.
    await page.locator('[data-test="create-artifact-project-select"]').click();
    const firstOption = page.getByRole('option').first();
    await expect(firstOption).toBeVisible({ timeout: 5_000 });
    await firstOption.click();

    await expect(continueButton(page)).toBeEnabled();
  });
});
