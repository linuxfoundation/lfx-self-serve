// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin program page — its actions (linuxfoundation/lfx-mentorship#378).
 *
 * The header's View Public Page and Hide/Unhide (linuxfoundation/lfx-mentorship#280, #385) on the published statuses
 * In Progress and Upcoming as well as Accepting (#426); Undo graduation and Re-open on Current Mentees (#395); Contact
 * Mentee at every status (#376); and Download By Status on Current and Past Mentees (#296). Every read and write is
 * stubbed with synthetic data (`mentorship-admin-actions.helper.ts`), each recording what it answered, and the page
 * is reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs answer them.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_ADMIN_REOPEN_CONFLICT_MESSAGE,
  MENTORSHIP_ADMIN_UNDO_GRADUATION_CONFIRM_MESSAGE,
  MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE,
  MENTORSHIP_PROGRAM_STATUS_LABELS,
} from '@lfx-one/shared/constants';
import { MentorshipMenteeStatus, MentorshipProgramStatus } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ACTION_NO_EMAIL_ID,
  ACTION_ROW_STATUSES,
  ActionState,
  actionRowEmail,
  actionRowId,
  ExportAnswer,
  newActionState,
  stubActionProgram,
  stubMenteesExport,
  stubStatusWrites,
  stubVisibilityWrites,
} from './helpers/mentorship-admin-actions.helper';
import { ADMIN_PROGRAM_ID, ADMIN_PROGRAM_URL, stubAdminTerms } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_PATH = `/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}`;

interface OpenOptions {
  status?: MentorshipProgramStatus;
  visibilityWrite?: number;
  statusWrite?: number;
  exportAnswer?: ExportAnswer;
}

async function open(page: Page, options: OpenOptions = {}): Promise<ActionState> {
  const state = newActionState(options.status ?? 'accepting');
  await stubActionProgram(page, state);
  await stubVisibilityWrites(page, state, options.visibilityWrite);
  await stubStatusWrites(page, state, options.statusWrite);
  await stubMenteesExport(page, state, options.exportAnswer);
  // A program under review opens on Terms, its only tab.
  await stubAdminTerms(page, []);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  const firstTab = state.status === 'pending-review' ? 'mentorship-terms-tab' : 'mentorship-current-mentees-tab';
  await expect(page.getByTestId(firstTab)).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  return state;
}

const statusBadge = (page: Page) => page.getByTestId('mentorship-program-detail-status');

async function openMoreMenu(page: Page): Promise<void> {
  await page.getByTestId('mentorship-program-detail-more').getByRole('button').click();
}

async function pickRowAction(page: Page, id: string, label: string): Promise<void> {
  await page.getByTestId(`mentorship-current-mentee-actions-${id}`).getByRole('button').click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}

const confirmDialog = (page: Page) => page.locator('.p-confirmdialog');

async function confirm(page: Page, label: string): Promise<void> {
  await confirmDialog(page).getByRole('button', { name: label, exact: true }).click();
}

test.describe('Admin program header — published statuses', () => {
  for (const status of ['in-progress', 'upcoming'] satisfies MentorshipProgramStatus[]) {
    test(`labels a ${status} program, links its public page and offers Hide`, async ({ page }) => {
      await open(page, { status });

      await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS[status]);
      await expect(page.getByTestId('mentorship-program-detail-view-public')).toHaveAttribute('href', new RegExp(`/programs/${ADMIN_PROGRAM_ID}$`));
      await openMoreMenu(page);
      await expect(page.getByTestId('mentorship-program-detail-menu-hide')).toContainText('Hide Program');
    });
  }

  for (const status of ['pending-review', 'rejected'] satisfies MentorshipProgramStatus[]) {
    test(`offers neither View Public Page nor Hide on a ${status} program`, async ({ page }) => {
      await open(page, { status });

      await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS[status]);
      await expect(page.getByTestId('mentorship-program-detail-view-public')).toHaveCount(0);
      await expect(page.getByTestId('mentorship-program-detail-more')).toHaveCount(0);
    });
  }
});

test.describe('Admin program header — Hide and Unhide', () => {
  test('hides a published program after the confirm, and the header follows', async ({ page }) => {
    const state = await open(page, { status: 'in-progress' });

    await openMoreMenu(page);
    await page.getByTestId('mentorship-program-detail-menu-hide').click();
    await confirm(page, 'Hide');

    await expect(page.getByText('Program hidden.')).toBeVisible();
    expect(state.writes.map((write) => `${write.method} ${write.path}`)).toEqual([`POST ${PROGRAM_PATH}/hide`]);
    await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS.hidden);
    await expect(page.getByTestId('mentorship-program-detail-view-public')).toHaveCount(0);
  });

  test('sends nothing when the hide is cancelled', async ({ page }) => {
    const state = await open(page, { status: 'upcoming' });

    await openMoreMenu(page);
    await page.getByTestId('mentorship-program-detail-menu-hide').click();
    await confirm(page, 'Cancel');

    await expect(confirmDialog(page)).toHaveCount(0);
    expect(state.writes).toEqual([]);
    await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS.upcoming);
  });

  test('unhides a hidden program, which links its public page again', async ({ page }) => {
    const state = await open(page, { status: 'hidden' });
    await expect(page.getByTestId('mentorship-program-detail-view-public')).toHaveCount(0);

    await openMoreMenu(page);
    await page.getByTestId('mentorship-program-detail-menu-unhide').click();
    await confirm(page, 'Unhide');

    await expect(page.getByText('Program unhidden.')).toBeVisible();
    expect(state.writes.map((write) => `${write.method} ${write.path}`)).toEqual([`POST ${PROGRAM_PATH}/unhide`]);
    await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS.accepting);
    await expect(page.getByTestId('mentorship-program-detail-view-public')).toBeVisible();
  });

  test('says why a hide was refused (409) and reads the program again', async ({ page }) => {
    const state = await open(page, { status: 'accepting', visibilityWrite: 409 });
    const readsBefore = state.pageReads;

    await openMoreMenu(page);
    await page.getByTestId('mentorship-program-detail-menu-hide').click();
    await confirm(page, 'Hide');

    await expect(page.getByText(MENTORSHIP_PROGRAM_HIDE_BLOCKED_MESSAGE)).toBeVisible();
    await expect.poll(() => state.pageReads).toBeGreaterThan(readsBefore);
    await expect(statusBadge(page)).toHaveText(MENTORSHIP_PROGRAM_STATUS_LABELS.accepting);
  });
});

test.describe('Admin Current Mentees — walking a decision back', () => {
  test('undoes a graduation back to Accepted after the confirm', async ({ page }) => {
    const state = await open(page);

    await pickRowAction(page, actionRowId('graduated'), 'Undo graduation');
    await expect(confirmDialog(page)).toContainText(MENTORSHIP_ADMIN_UNDO_GRADUATION_CONFIRM_MESSAGE);
    await confirm(page, 'Undo graduation');

    await expect(page.getByText('Graduation undone')).toBeVisible();
    expect(state.writes).toEqual([
      { method: 'PATCH', path: `/api/mentorship/admin/applications/${actionRowId('graduated')}/status`, body: { status: 'accepted' } },
    ]);
  });

  for (const status of ['declined', 'withdrawn'] satisfies MentorshipMenteeStatus[]) {
    test(`re-opens a ${status} application back to review`, async ({ page }) => {
      const state = await open(page);

      await pickRowAction(page, actionRowId(status), 'Re-open');
      await confirm(page, 'Re-open');

      await expect(page.getByText('Application re-opened')).toBeVisible();
      expect(state.writes).toEqual([
        { method: 'PATCH', path: `/api/mentorship/admin/applications/${actionRowId(status)}/status`, body: { status: 'pending' } },
      ]);
    });
  }

  test('says why a re-open was refused (409)', async ({ page }) => {
    await open(page, { statusWrite: 409 });

    await pickRowAction(page, actionRowId('declined'), 'Re-open');
    await confirm(page, 'Re-open');

    await expect(page.getByText(MENTORSHIP_ADMIN_REOPEN_CONFLICT_MESSAGE)).toBeVisible();
  });

  test('offers no walk-back on a row still under review or accepted', async ({ page }) => {
    await open(page);

    for (const status of ['pending', 'accepted'] satisfies MentorshipMenteeStatus[]) {
      await page
        .getByTestId(`mentorship-current-mentee-actions-${actionRowId(status)}`)
        .getByRole('button')
        .click();
      await expect(page.getByRole('menuitem', { name: 'Contact Mentee', exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: 'Undo graduation', exact: true })).toHaveCount(0);
      await expect(page.getByRole('menuitem', { name: 'Re-open', exact: true })).toHaveCount(0);
      await page.keyboard.press('Escape');
    }
  });
});

test.describe('Admin Current Mentees — Contact Mentee', () => {
  test('links every status to the mentee address', async ({ page }) => {
    await open(page);

    for (const status of ACTION_ROW_STATUSES) {
      const id = actionRowId(status);
      await page.getByTestId(`mentorship-current-mentee-actions-${id}`).getByRole('button').click();
      await expect(page.getByRole('menuitem', { name: 'Contact Mentee', exact: true }).locator('a')).toHaveAttribute('href', `mailto:${actionRowEmail(id)}`);
      await page.keyboard.press('Escape');
    }
  });

  test('leaves Contact Mentee out when the mentee has no usable address', async ({ page }) => {
    await open(page);

    await page.getByTestId(`mentorship-current-mentee-actions-${ACTION_NO_EMAIL_ID}`).getByRole('button').click();

    await expect(page.getByRole('menuitem', { name: 'Accept', exact: true })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Contact Mentee', exact: true })).toHaveCount(0);
  });
});

test.describe('Admin mentees — Download By Status', () => {
  async function download(page: Page, tab: 'current' | 'past', entry: string): Promise<void> {
    await page.getByTestId(`mentorship-${tab}-mentees-download`).getByRole('button').click();
    await page.getByTestId(`mentorship-${tab}-mentees-download-${entry}`).click();
  }

  test('saves the Accepted current mentees under the name the server sends', async ({ page }) => {
    const state = await open(page);
    const saved = page.waitForEvent('download');

    await download(page, 'current', 'accepted');

    expect((await saved).suggestedFilename()).toBe('current-mentees-accepted.csv');
    expect(state.exports.map((params) => params.toString())).toEqual(['type=current&status=accepted']);
  });

  test('saves every past mentee with All, sending no status', async ({ page }) => {
    const state = await open(page);
    await page.getByTestId('mentorship-program-detail-tab-past-mentees').click();
    await expect(page.getByTestId('mentorship-past-mentees-tab')).toBeVisible();
    const saved = page.waitForEvent('download');

    await download(page, 'past', 'all');

    expect((await saved).suggestedFilename()).toBe('past-mentees-all.csv');
    expect(state.exports.map((params) => params.toString())).toEqual(['type=past']);
  });

  test('says there is nothing to download when no mentee has the status (204)', async ({ page }) => {
    await open(page, { exportAnswer: { status: 204 } });

    await download(page, 'current', 'withdrawn');

    await expect(page.getByText('Nothing to download')).toBeVisible();
    await expect(page.getByText('No current mentees have this status.')).toBeVisible();
  });

  test('names the missing access when the download is refused (403)', async ({ page }) => {
    await open(page, { exportAnswer: { status: 403 } });

    await download(page, 'current', 'all');

    await expect(page.getByText("Couldn't download mentees")).toBeVisible();
    await expect(page.getByText("You don't have access to this program's mentees.")).toBeVisible();
  });

  test('still saves a file cut short at the page cap, and warns how many rows it holds', async ({ page }) => {
    await open(page, { exportAnswer: { truncatedAt: 5000 } });
    const saved = page.waitForEvent('download');

    await download(page, 'current', 'all');

    expect((await saved).suggestedFilename()).toBe('current-mentees-all.csv');
    await expect(page.getByText('Download incomplete')).toBeVisible();
    await expect(page.getByText('The file holds only the first 5,000 mentees')).toBeVisible();
  });
});
