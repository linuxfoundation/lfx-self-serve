// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee My Tasks submission file — structural / data-testid contract (linuxfoundation/lfx-mentorship#204).
 *
 * Companion to `mentorship-mentee-task-file.spec.ts` (content, toasts and requests). This spec asserts, without
 * user-facing copy, which file actions each task state attaches, that the picker accepts only the allowed
 * extensions, and that the file spinner is attached while an upload is held open. The applications read and the
 * file routes are stubbed via `page.route`, so the rows are synthetic and no object storage is needed.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MENTORSHIP_MENTEE_TASK_FILE_ACCEPT, MENTORSHIP_MENTEE_TASKS_URL } from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const NEEDS_FILE_ID = '6e1b7f4d-8a2c-4d36-8b5a-2f9c7d3a1e65';
const HAS_FILE_ID = '7f2c8a5e-9b3d-4e47-9c6b-3a0d8e4b2f76';
const SUBMITTED_ID = '8a3d9b6f-0c4e-4f58-8d7c-4b1e9f5c3a87';
const COMPLETE_ID = '9b4e0c7a-1d5f-4a69-9e8d-5c2f0a6d4b98';
const NO_FILE_ID = '0c5f1d8b-2e6a-4b70-8f9e-6d3a1b7e5c09';

/** Shape of one synthetic task the applications stub serves. */
interface StubTask {
  id: string;
  status: string;
  submitFile: 'required' | null;
  hasFile: boolean;
}

const TASKS: StubTask[] = [
  { id: NEEDS_FILE_ID, status: 'in_progress', submitFile: 'required', hasFile: false },
  { id: HAS_FILE_ID, status: 'in_progress', submitFile: 'required', hasFile: true },
  { id: SUBMITTED_ID, status: 'submitted', submitFile: 'required', hasFile: true },
  { id: COMPLETE_ID, status: 'complete', submitFile: 'required', hasFile: true },
  { id: NO_FILE_ID, status: 'in_progress', submitFile: null, hasFile: false },
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
      hasFile: task.hasFile,
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

async function openTasksTab(page: Page): Promise<void> {
  await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);
  await expect(page.getByTestId(`mentee-tasks-file-actions-${NEEDS_FILE_ID}`)).toBeAttached({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
}

/** Whether each file action is attached on the row, in the order Upload, Download, Replace, Remove. */
async function attachedActions(page: Page, id: string): Promise<boolean[]> {
  const actions = ['upload', 'download-file', 'replace-file', 'remove-file'];
  return Promise.all(actions.map(async (action) => (await page.getByTestId(`mentee-tasks-${action}-${id}`).count()) > 0));
}

test.describe('Mentee task file — Robust Tests', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubApplications(page);
  });

  test('every row attaches a picker that accepts only the allowed extensions', async ({ page }) => {
    await openTasksTab(page);

    for (const task of TASKS) {
      await expect(page.getByTestId(`mentee-tasks-file-input-${task.id}`)).toHaveAttribute('accept', MENTORSHIP_MENTEE_TASK_FILE_ACCEPT);
      await expect(page.getByTestId(`mentee-tasks-file-saving-${task.id}`)).toHaveCount(0);
    }
  });

  test('each task state attaches only the file actions upstream allows', async ({ page }) => {
    await openTasksTab(page);

    expect(await attachedActions(page, NEEDS_FILE_ID)).toEqual([true, false, false, false]);
    expect(await attachedActions(page, HAS_FILE_ID)).toEqual([false, true, true, true]);
    expect(await attachedActions(page, SUBMITTED_ID)).toEqual([false, true, true, false]);
    expect(await attachedActions(page, COMPLETE_ID)).toEqual([false, true, false, false]);
    expect(await attachedActions(page, NO_FILE_ID)).toEqual([false, false, false, false]);
  });

  test('the file spinner is attached while an upload is held open', async ({ page }) => {
    let releaseUpload!: () => void;
    const heldUpload = new Promise<void>((resolve) => (releaseUpload = resolve));
    await page.route('**/api/mentorship/mentee/tasks/*/file**', async (route) => {
      await heldUpload;
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ fileName: 'a.pdf', contentType: 'application/pdf', size: 3 }),
      });
    });
    await openTasksTab(page);

    await page
      .getByTestId(`mentee-tasks-file-input-${NEEDS_FILE_ID}`)
      .setInputFiles({ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('pdf') });

    await expect(page.getByTestId(`mentee-tasks-file-saving-${NEEDS_FILE_ID}`)).toBeAttached();
    await expect(page.getByTestId(`mentee-tasks-file-actions-${NEEDS_FILE_ID}`)).toHaveAttribute('aria-busy', 'true');

    releaseUpload();
    await expect(page.getByTestId(`mentee-tasks-file-saving-${NEEDS_FILE_ID}`)).toHaveCount(0);
  });
});
