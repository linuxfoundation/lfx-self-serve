// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Terms tab actions — structural / data-testid contract (linuxfoundation/lfx-mentorship#239).
 *
 * Companion to `mentorship-admin-terms.spec.ts` (content). This spec asserts, by testid and role rather than copy,
 * which actions each term row's menu carries and that each confirmation has Cancel and an accept button. Every read
 * is stubbed with synthetic data and reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { ADMIN_PROGRAM_URL, stubAdminMentees, stubAdminProgramPage, stubAdminTasks } from './helpers/mentorship-admin-program.helper';
import { newTermStubState, stubTermActions, TERM_CLOSABLE_ID, TERM_CLOSED_ID, TERM_EMPTY_ID } from './helpers/mentorship-admin-terms.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const menuLabels = async (page: Page, termId: string): Promise<string[]> => {
  await page.getByTestId(`mentorship-term-actions-${termId}`).getByRole('button').click();
  const labels = await page.getByRole('menuitem').allInnerTexts();
  await page.keyboard.press('Escape');
  return labels.map((label) => label.trim());
};

test.describe('Admin Terms tab actions — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, { mentees: [], tasks: [] });
    await stubAdminTasks(page, { mentees: [], tasks: [] });
    await stubTermActions(page, newTermStubState());
    await openMentorPage(page, ADMIN_PROGRAM_URL);
    await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
    await page.getByTestId('mentorship-program-detail-tab-terms').click();
    await expect(page.getByTestId(`mentorship-term-row-${TERM_CLOSABLE_ID}`)).toBeVisible();
  });

  test('gives each row the menu actions its status and applications allow', async ({ page }) => {
    expect(await menuLabels(page, TERM_CLOSABLE_ID)).not.toContain('Delete');
    expect(await menuLabels(page, TERM_CLOSABLE_ID)).toContain('Close');
    expect(await menuLabels(page, TERM_CLOSED_ID)).toContain('Re-Open');
    expect(await menuLabels(page, TERM_EMPTY_ID)).toEqual(expect.arrayContaining(['Re-Open', 'Delete']));
  });

  test('names every row menu button for the term it acts on', async ({ page }) => {
    await expect(page.getByTestId(`mentorship-term-actions-${TERM_CLOSABLE_ID}`).getByRole('button')).toHaveAttribute('aria-label', /Test Term 1$/);
  });

  test('opens a confirmation with Cancel and an accept button for Close', async ({ page }) => {
    await page.getByTestId(`mentorship-term-actions-${TERM_CLOSABLE_ID}`).getByRole('button').click();
    await page.getByRole('menuitem', { name: 'Close', exact: true }).click();

    const confirmation = page.locator('.p-confirmdialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button')).toHaveCount(2);
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(confirmation).toHaveCount(0);
  });
});
