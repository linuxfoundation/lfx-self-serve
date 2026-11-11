// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin program page actions — structural / data-testid contract (linuxfoundation/lfx-mentorship#378).
 *
 * Companion to `mentorship-admin-program-actions.spec.ts` (content). This spec asserts, by testid, role and
 * attribute rather than copy, that View Public Page opens a new tab safely, that the More trigger is a menu
 * button holding the one visibility entry the status allows, that Contact Mentee opens a new tab, and that
 * Download By Status lists its entries in the filter's order and stays disabled while a download is in flight.
 * Every read and write is stubbed with synthetic data and reached by client-side navigation.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS } from '@lfx-one/shared/constants';
import { MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  actionRowId,
  ActionState,
  ExportAnswer,
  newActionState,
  stubActionProgram,
  stubMenteesExport,
  stubVisibilityWrites,
} from './helpers/mentorship-admin-actions.helper';
import { ADMIN_PROGRAM_URL } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page: Page, status: MentorshipProgramStatus = 'accepting', exportAnswer?: ExportAnswer): Promise<ActionState> {
  const state = newActionState(status);
  await stubActionProgram(page, state);
  await stubVisibilityWrites(page, state);
  await stubMenteesExport(page, state, exportAnswer);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  return state;
}

/** The test ids of the open menu's entries under `prefix`, in the order they render. */
const entryIds = (page: Page, prefix: string) =>
  page.locator(`[data-testid^="${prefix}"]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid')));

test.describe('Admin program header — action structure', () => {
  test('opens View Public Page in a new tab without an opener, and tells screen readers so', async ({ page }) => {
    await open(page);

    const link = page.getByTestId('mentorship-program-detail-view-public');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link.locator('.sr-only')).toHaveText('(opens in a new tab)');
  });

  test('marks the More trigger as a menu button whose expanded state follows the menu', async ({ page }) => {
    await open(page);

    const trigger = page.getByTestId('mentorship-program-detail-more').getByRole('button');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await trigger.click();

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  for (const [status, entry] of [
    ['upcoming', 'hide'],
    ['hidden', 'unhide'],
  ] as const) {
    test(`holds only the ${entry} entry in the More menu of a ${status} program`, async ({ page }) => {
      await open(page, status);

      await page.getByTestId('mentorship-program-detail-more').getByRole('button').click();
      await expect(page.getByTestId(`mentorship-program-detail-menu-${entry}`)).toBeVisible();

      expect(await entryIds(page, 'mentorship-program-detail-menu-')).toEqual([`mentorship-program-detail-menu-${entry}`]);
    });
  }
});

test.describe('Admin mentees — action structure', () => {
  test('opens Contact Mentee in a new tab', async ({ page }) => {
    await open(page);

    await page
      .getByTestId(`mentorship-current-mentee-actions-${actionRowId('accepted')}`)
      .getByRole('button')
      .click();

    await expect(page.getByRole('menuitem', { name: 'Contact Mentee', exact: true }).locator('a')).toHaveAttribute('target', '_blank');
  });

  for (const tab of ['current', 'past'] as const) {
    test(`lists All, then each ${tab} status filter, in the ${tab} download menu`, async ({ page }) => {
      await open(page);
      if (tab === 'past') await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();
      const trigger = page.getByTestId(`mentorship-${tab}-mentees-download`).getByRole('button');
      await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');

      await trigger.click();
      await expect(page.getByTestId(`mentorship-${tab}-mentees-download-all`)).toBeVisible();

      const prefix = `mentorship-${tab}-mentees-download-`;
      expect(await entryIds(page, prefix)).toEqual(['all', ...MENTORSHIP_ADMIN_MENTEE_STATUS_FILTERS[tab]].map((entry) => `${prefix}${entry}`));
    });
  }

  test('keeps Download By Status disabled while a download is in flight', async ({ page }) => {
    let release: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => (release = resolve));
    await open(page, 'accepting', { hold });
    const trigger = page.getByTestId('mentorship-current-mentees-download').getByRole('button');
    const saved = page.waitForEvent('download');

    await trigger.click();
    await page.getByTestId('mentorship-current-mentees-download-all').click();

    await expect(trigger).toBeDisabled();
    release();
    await saved;
    await expect(trigger).toBeEnabled();
  });
});
