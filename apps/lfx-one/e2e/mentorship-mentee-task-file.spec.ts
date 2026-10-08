// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentee My Tasks — upload, replace, remove and download a task's submission file (linuxfoundation/lfx-mentorship#204).
 *
 * Stubs the applications read and the BFF file routes via `page.route`, so the flow runs against a synthetic
 * accepted application rather than whatever the signed-in user holds upstream, and needs no object storage. The
 * applications stub is stateful: once a file write has been answered it serves the task as it is after the write,
 * so the re-read is visible on the page.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import {
  MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES,
  MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE,
  MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY,
  MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
  MENTORSHIP_MENTEE_TASKS_URL,
} from '@lfx-one/shared/constants';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTEE_PROFILE_LOAD_TIMEOUT, openMenteeTab } from './helpers/mentee-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMenteeTab` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const TASK_ID = '5d0a6e3c-7f1b-4c25-9a49-1e8b6c2f0d54';
const STATUS_DROPDOWN = `[data-test="mentee-tasks-status-dropdown-${TASK_ID}"]`;
const PDF = { name: 'My Submission.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7 synthetic') };

/** Shape of the synthetic task the applications stub serves. */
interface StubTask {
  status: string;
  hasFile: boolean;
}

/** The one synthetic accepted application, carrying one task that needs a file. */
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
        submitFile: 'required',
        hasFile: task.hasFile,
        updatedOn: '2026-06-02T10:00:00Z',
      },
    ],
  };
}

interface FileStub {
  /** URLs, content types and encoded file-name headers of the uploads received, in order. */
  uploads: { url: string; contentType: string | undefined; fileName: string | undefined }[];
  removals: number;
}

/**
 * Serves `before` until a file write is answered with `writeStatus`, then `after`. A failed write answers with
 * `errorBody`. Returns what the file routes received.
 */
async function stubFileFlow(
  page: Page,
  before: StubTask,
  writeStatus: number,
  after: StubTask,
  errorBody: object = { error: 'upstream text' }
): Promise<FileStub> {
  const stub: FileStub = { uploads: [], removals: 0 };
  let current = before;

  await page.route('**/api/mentorship/mentee/applications*', (route) => {
    const data = [acceptedApplication(current)];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data, total: data.length }) });
  });

  await page.route('**/api/mentorship/mentee/tasks/*/file**', (route) => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      stub.removals += 1;
    } else {
      stub.uploads.push({ url: request.url(), contentType: request.headers()['content-type'], fileName: request.headers()['x-file-name'] });
    }
    if (writeStatus >= 400) {
      return route.fulfill({ status: writeStatus, contentType: 'application/json', body: JSON.stringify(errorBody) });
    }
    current = after;
    if (request.method() === 'DELETE') {
      return route.fulfill({ status: 204, body: '' });
    }
    return route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ fileName: 'My_Submission.pdf', contentType: 'application/pdf', size: PDF.buffer.length }),
    });
  });

  return stub;
}

async function openTasksTab(page: Page): Promise<void> {
  await openMenteeTab(page, MENTORSHIP_MENTEE_TASKS_URL);
  await expect(page.locator(STATUS_DROPDOWN)).toBeVisible({ timeout: MENTEE_PROFILE_LOAD_TIMEOUT });
}

test.describe('Mentee My Tasks — submission file', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('uploading a file sends the raw bytes with its name, toasts success and unlocks Submitted', async ({ page }) => {
    const stub = await stubFileFlow(page, { status: 'in_progress', hasFile: false }, 201, { status: 'in_progress', hasFile: true });
    await openTasksTab(page);

    await page.getByTestId(`mentee-tasks-file-input-${TASK_ID}`).setInputFiles(PDF);

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_TASK_FILE_UPLOAD_SUCCESS_SUMMARY);
    expect(stub.uploads).toHaveLength(1);
    // The name rides in a header, never the URL the request logger writes.
    expect(decodeURIComponent(stub.uploads[0].fileName ?? '')).toBe('My Submission.pdf');
    expect(new URL(stub.uploads[0].url).search).toBe('');
    expect(stub.uploads[0].contentType).toBe('application/octet-stream');

    await expect(page.getByTestId(`mentee-tasks-download-file-${TASK_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mentee-tasks-upload-${TASK_ID}`)).toHaveCount(0);
    await page.locator(STATUS_DROPDOWN).click();
    await expect(page.getByRole('option', { name: 'Submitted' })).not.toHaveAttribute('data-p-disabled', 'true');
  });

  test('a file of the wrong type is refused in the browser and nothing is sent', async ({ page }) => {
    const stub = await stubFileFlow(page, { status: 'in_progress', hasFile: false }, 201, { status: 'in_progress', hasFile: true });
    await openTasksTab(page);

    await page.getByTestId(`mentee-tasks-file-input-${TASK_ID}`).setInputFiles({ name: 'diagram.png', mimeType: 'image/png', buffer: Buffer.from('png') });

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(MENTORSHIP_MENTEE_TASK_FILE_TYPE_MESSAGE);
    expect(stub.uploads).toHaveLength(0);
  });

  test('the past-due 400 shows its own copy', async ({ page }) => {
    await stubFileFlow(
      page,
      { status: 'in_progress', hasFile: false },
      400,
      { status: 'in_progress', hasFile: false },
      {
        error: 'upstream text',
        code: MENTORSHIP_MENTEE_TASK_PAST_DUE_ERROR_CODE,
      }
    );
    await openTasksTab(page);

    await page.getByTestId(`mentee-tasks-file-input-${TASK_ID}`).setInputFiles(PDF);

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(MENTORSHIP_MENTEE_TASK_FILE_PAST_DUE_MESSAGE);
  });

  test('storage that is not configured upstream shows the unavailable copy', async ({ page }) => {
    await stubFileFlow(page, { status: 'in_progress', hasFile: false }, 503, { status: 'in_progress', hasFile: false });
    await openTasksTab(page);

    await page.getByTestId(`mentee-tasks-file-input-${TASK_ID}`).setInputFiles(PDF);

    await expect(page.locator('p-toast .p-toast-message-error')).toContainText(MENTORSHIP_MENTEE_TASK_FILE_ERROR_MESSAGES[503]);
  });

  test('removing a file before submitting sends a DELETE and brings Upload back', async ({ page }) => {
    const stub = await stubFileFlow(page, { status: 'in_progress', hasFile: true }, 204, { status: 'in_progress', hasFile: false });
    await openTasksTab(page);

    await page.getByTestId(`mentee-tasks-remove-file-${TASK_ID}`).click();

    await expect(page.locator('p-toast .p-toast-message-success')).toContainText(MENTORSHIP_MENTEE_TASK_FILE_REMOVE_SUCCESS_SUMMARY);
    expect(stub.removals).toBe(1);
    await expect(page.getByTestId(`mentee-tasks-upload-${TASK_ID}`)).toBeVisible();
  });

  test('a submitted task offers Replace but not Remove, and Download saves the file under its server name', async ({ page }) => {
    await stubFileFlow(page, { status: 'submitted', hasFile: true }, 201, { status: 'submitted', hasFile: true });
    await page.route('**/api/mentorship/tasks/*/file', (route) =>
      route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename=My_Submission.pdf' },
        body: PDF.buffer,
      })
    );
    await openTasksTab(page);

    await expect(page.getByTestId(`mentee-tasks-replace-file-${TASK_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mentee-tasks-remove-file-${TASK_ID}`)).toHaveCount(0);

    const download = page.waitForEvent('download');
    await page.getByTestId(`mentee-tasks-download-file-${TASK_ID}`).click();
    expect((await download).suggestedFilename()).toBe('My_Submission.pdf');
  });
});
