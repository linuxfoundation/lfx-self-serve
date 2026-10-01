// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee My Tasks status change — structural / data-testid contract (linuxfoundation/lfx-mentorship#191).
 *
 * Companion to `mentorship-mentee-task-status.spec.ts` (content, toasts and error copy). This spec
 * asserts, without user-facing copy, that every task row attaches its status cell and dropdown, that
 * the status hint is attached exactly for the states that have one, and that the saving spinner is
 * attached while a write is held open. The applications read and the status write are stubbed via
 * `page.route`, so the rows are synthetic rather than whatever the signed-in user holds upstream.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTEE_TASKS_URL } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PENDING_ID = '1f6c2a9e-3b7d-4e81-9c05-7a4d2e8b6f10';
const FILE_REQUIRED_ID = '2a7d3b0f-4c8e-4f92-8d16-8b5e3f9c7a21';
const IN_PROGRESS_ID = '3b8e4c1a-5d9f-4a03-9e27-9c6f4a0d8b32';
const SUBMITTED_ID = '4c9f5d2b-6e0a-4b14-8f38-0d7a5b1e9c43';

/** Shape of one synthetic task the applications stub serves. */
interface StubTask {
  id: string;
  status: string;
  submitFile: string | null;
}

const TASKS: StubTask[] = [
  { id: PENDING_ID, status: 'incomplete', submitFile: null },
  { id: FILE_REQUIRED_ID, status: 'in_progress', submitFile: 'required' },
  { id: IN_PROGRESS_ID, status: 'in_progress', submitFile: null },
  { id: SUBMITTED_ID, status: 'submitted', submitFile: null },
];

/** One synthetic accepted application carrying the given non-prerequisite tasks. */
function acceptedApplication(tasks: StubTask[]) {
  return {
    id: 'app-accepted',
    programId: 'prog-1',
    programName: 'Test Program One',
    term: { id: 'term-1', name: 'Fall 2026' },
    upstreamStatus: 'accepted',
    createdOn: '2026-06-01T10:00:00Z',
    updatedOn: '2026-06-02T10:00:00Z',
    tasks: tasks.map((task, index) => ({
      id: task.id,
      name: `Test Task ${index + 1}`,
      description: 'Test description',
      category: 'non_prerequisite',
      status: task.status,
      submitFile: task.submitFile,
      updatedOn: '2026-06-02T10:00:00Z',
    })),
  };
}

async function stubApplications(page: Page): Promise<void> {
  await page.route('**/api/mentorship/mentee/applications*', (route) => {
    const data = [acceptedApplication(TASKS)];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
  });
}

const dropdown = (page: Page, id: string) => page.locator(`[data-test="mentee-tasks-status-dropdown-${id}"]`);

async function openTasksTab(page: Page): Promise<void> {
  await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);
  await expect(dropdown(page, PENDING_ID)).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
}

test.describe('Mentee task status — Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubApplications(page);
  });

  test('every task row attaches its status cell and dropdown, with no saving spinner at rest', async ({ page }) => {
    await openTasksTab(page);

    for (const task of TASKS) {
      await expect(page.getByTestId(`mentee-tasks-task-row-${task.id}`)).toBeAttached();
      await expect(page.getByTestId(`mentee-tasks-status-cell-${task.id}`)).toBeAttached();
      await expect(dropdown(page, task.id)).toBeAttached();
      await expect(page.getByTestId(`mentee-tasks-status-saving-${task.id}`)).toHaveCount(0);
    }
  });

  test('the status hint is attached for the pending, file-required and submitted rows only', async ({ page }) => {
    await openTasksTab(page);

    for (const id of [PENDING_ID, FILE_REQUIRED_ID, SUBMITTED_ID]) {
      await expect(page.getByTestId(`mentee-tasks-status-hint-${id}`)).toBeAttached();
    }
    await expect(page.getByTestId(`mentee-tasks-status-hint-${IN_PROGRESS_ID}`)).toHaveCount(0);
  });

  test('the saving spinner is attached while a status write is held open', async ({ page }) => {
    let releaseWrite!: () => void;
    const heldWrite = new Promise<void>((resolve) => (releaseWrite = resolve));
    await page.route('**/api/mentorship/mentee/tasks/*', async (route) => {
      await heldWrite;
      return route.fulfill({ status: 204, body: '' });
    });
    await openTasksTab(page);

    await dropdown(page, PENDING_ID).click();
    await page.getByRole('option', { name: 'In Progress' }).click();

    await expect(page.getByTestId(`mentee-tasks-status-saving-${PENDING_ID}`)).toBeAttached();
    await expect(page.getByTestId(`mentee-tasks-status-cell-${PENDING_ID}`)).toHaveAttribute('aria-busy', 'true');

    releaseWrite();
    await expect(page.getByTestId(`mentee-tasks-status-saving-${PENDING_ID}`)).toHaveCount(0);
  });
});
