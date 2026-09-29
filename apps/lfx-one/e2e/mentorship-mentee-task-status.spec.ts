// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee My Tasks — change a task's status (linuxfoundation/lfx-mentorship#191).
 *
 * Stubs the applications read and the status write via `page.route`, so the flow runs against a
 * synthetic accepted application rather than whatever the signed-in user holds upstream. The
 * applications stub is stateful: once the write has been answered it serves the next task status,
 * so the re-read after the write is visible on the page. A test can hold that re-read open to
 * observe the tab while the refresh is still in flight.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED,
  MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASKS_URL,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const TASK_ID = '4d2b7c1e-9a3f-4c58-8e16-0b5a7d9f3c21';
const STATUS_DROPDOWN = `[data-test="mentee-tasks-status-dropdown-${TASK_ID}"]`;

/** Shape of the synthetic task the applications stub serves. */
interface StubTask {
  status: string;
  submitFile: string | null;
}

/** The one synthetic accepted application, carrying the one non-prerequisite task in the given state. */
function acceptedApplication(task: StubTask) {
  return {
    id: 'app-accepted',
    programId: 'prog-1',
    programName: 'Test Program One',
    term: { id: 'term-1', name: 'Fall 2026' },
    upstreamStatus: 'accepted',
    createdOn: '2026-06-01T10:00:00Z',
    updatedOn: '2026-06-02T10:00:00Z',
    tasks: [
      {
        id: TASK_ID,
        name: 'Test Task',
        description: 'Test description',
        category: 'non_prerequisite',
        status: task.status,
        submitFile: task.submitFile,
        updatedOn: '2026-06-02T10:00:00Z',
      },
    ],
  };
}

interface StatusStub {
  /** Bodies the status write received, in order. */
  writes: unknown[];
  applicationReads: number;
}

/**
 * Serves `before` until the status write is answered with `writeStatus`, then `after`. Returns the
 * recorded writes and a read counter so a test can prove what was sent and that the page re-read.
 * When `heldRead` is given, applications reads made after the write wait for it to resolve.
 */
async function stubStatusFlow(page: Page, before: StubTask, writeStatus: number, after: StubTask, heldRead?: Promise<void>): Promise<StatusStub> {
  const stub: StatusStub = { writes: [], applicationReads: 0 };
  let current = before;
  let written = false;

  await page.route('**/api/mentorship/mentee/applications*', async (route) => {
    stub.applicationReads += 1;
    if (written && heldRead) {
      await heldRead;
    }
    const data = [acceptedApplication(current)];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
  });

  await page.route('**/api/mentorship/mentee/tasks/*', (route) => {
    stub.writes.push(route.request().postDataJSON());
    current = after;
    written = true;
    if (writeStatus === 204) {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({ status: writeStatus, contentType: 'application/json', body: JSON.stringify({ error: 'upstream text', code: 'CONFLICT' }) });
  });

  return stub;
}

async function openTasksTab(page: Page): Promise<void> {
  await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);
  await expect(page.locator(STATUS_DROPDOWN)).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
}

test.describe('Mentee My Tasks — status change', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('starting a to-do task saves In Progress, toasts success and re-reads the tasks', async ({ page }) => {
    let releaseRead!: () => void;
    const heldRead = new Promise<void>((resolve) => (releaseRead = resolve));
    const stub = await stubStatusFlow(page, { status: 'incomplete', submitFile: null }, 204, { status: 'in_progress', submitFile: null }, heldRead);
    await openTasksTab(page);
    const readsBefore = stub.applicationReads;

    await page.locator(STATUS_DROPDOWN).click();
    await page.getByRole('option', { name: 'In Progress' }).click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_TASK_STATUS_SUCCESS_SUMMARY);
    // The re-read has reached the network but is still held: the tab must stay mounted through it
    // instead of flashing its loader, and the row keeps the status the mentee just saved.
    await expect.poll(() => stub.applicationReads).toBeGreaterThan(readsBefore);
    await expect(page.locator('lfx-route-loading')).toHaveCount(0);
    await expect(page.locator(STATUS_DROPDOWN)).toBeVisible();
    await expect(page.locator(STATUS_DROPDOWN)).toContainText('In Progress');
    await expect(page.getByTestId(`mentee-tasks-task-row-${TASK_ID}`).locator('.fa-clock')).toHaveCount(1);

    releaseRead();
    await expect(page.locator(STATUS_DROPDOWN)).toContainText('In Progress');
    await expect(page.locator('lfx-route-loading')).toHaveCount(0);
    expect(stub.writes).toEqual([{ status: 'in_progress' }]);
  });

  test('a task that still needs a file explains why Submitted is unavailable and sends nothing', async ({ page }) => {
    const stub = await stubStatusFlow(page, { status: 'in_progress', submitFile: 'required' }, 204, { status: 'submitted', submitFile: 'required' });
    await openTasksTab(page);

    await expect(page.getByTestId(`mentee-tasks-status-hint-${TASK_ID}`)).toContainText(MENTORSHIP_MENTEE_TASK_HINT_FILE_REQUIRED);

    await page.locator(STATUS_DROPDOWN).click();
    await expect(page.getByRole('option', { name: 'Submitted' })).toHaveAttribute('data-p-disabled', 'true');
    await page.getByRole('option', { name: 'Submitted' }).click({ force: true });

    await expect(page.locator(STATUS_DROPDOWN)).toContainText('In Progress');
    expect(stub.writes).toHaveLength(0);
  });

  test('a 409 shows the stale copy, re-reads the tasks and shows the task where upstream left it', async ({ page }) => {
    // A reviewer moved the task on before the mentee's change arrived.
    const stub = await stubStatusFlow(page, { status: 'incomplete', submitFile: null }, 409, { status: 'complete', submitFile: null });
    await openTasksTab(page);
    const readsBefore = stub.applicationReads;

    await page.locator(STATUS_DROPDOWN).click();
    await page.getByRole('option', { name: 'In Progress' }).click();

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(MENTORSHIP_MENTEE_TASK_STATUS_ERROR_MESSAGES[409]);
    await expect(page.locator(STATUS_DROPDOWN)).toContainText('Submitted');
    await expect.poll(() => stub.applicationReads).toBeGreaterThan(readsBefore);
  });
});
