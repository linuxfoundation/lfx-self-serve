// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Current Mentees — reviewer notes (linuxfoundation/lfx-mentorship#236).
 *
 * Save, edit and clear one reviewer note per application. The reads are stubbed as in
 * `mentorship-admin-program-tabs.spec.ts`; the note write is stubbed here via `page.route`, recording each request so
 * a spec asserts the body the browser sent as well as what it rendered. All data is synthetic.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the browser makes the calls and the stubs
 * answer them. The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { ADMIN_PROGRAM_URL, AdminProgramRequests, adminApplicationId, stubAdminMentees, stubAdminProgramPage } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const APPLICATION_ID = adminApplicationId(1);

interface NoteRequest {
  id: string;
  method: string;
  body: Record<string, unknown>;
}

async function open(page: Page, requests: AdminProgramRequests, notes: NoteRequest[], noteStatus = 204): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, requests);
  await page.route('**/api/mentorship/admin/applications/*/note', (route) => {
    const request = route.request();
    notes.push({ id: new URL(request.url()).pathname.split('/').slice(-2)[0], method: request.method(), body: request.postDataJSON() });
    return noteStatus === 204
      ? route.fulfill({ status: noteStatus })
      : route.fulfill({ status: noteStatus, contentType: 'application/json', body: JSON.stringify({ error: 'stubbed' }) });
  });
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

/** Opens the row's note dialog, replaces its text and saves. */
async function writeNote(page: Page, id: string, text: string): Promise<void> {
  await page.getByTestId(`mentorship-current-mentee-note-${id}`).click();
  await page.locator('#dialog-mentee-note').fill(text);
  await page.getByTestId('mentorship-mentee-note-save').getByRole('button').click();
}

test.describe('Admin Current Mentees — reviewer notes', () => {
  let requests: AdminProgramRequests;
  let notes: NoteRequest[];

  test.beforeEach(() => {
    requests = { mentees: [], tasks: [] };
    notes = [];
  });

  test('saves a note for the application and shows it on the row', async ({ page }) => {
    await open(page, requests, notes);

    await writeNote(page, APPLICATION_ID, '  Strong screening call.  ');

    await expect(page.getByText('Note saved')).toBeVisible();
    expect(notes).toEqual([{ id: APPLICATION_ID, method: 'PUT', body: { note: 'Strong screening call.' } }]);
    await expect(page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`)).toContainText('Strong screening call.');
  });

  test('keeps the note on the row after leaving the tab and coming back', async ({ page }) => {
    await open(page, requests, notes);
    await writeNote(page, APPLICATION_ID, 'Strong screening call.');
    await expect(page.getByText('Note saved')).toBeVisible();

    await page.getByTestId('mentorship-program-detail-tab-mentors').click();
    await page.getByTestId('mentorship-program-detail-tab-current-mentees').click();

    await expect(page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`)).toContainText('Strong screening call.');
  });

  test('clears the note with an empty text', async ({ page }) => {
    await open(page, requests, notes);
    await writeNote(page, APPLICATION_ID, 'Strong screening call.');
    await expect(page.getByText('Note saved')).toBeVisible();

    await writeNote(page, APPLICATION_ID, '');

    await expect(page.getByText('Note cleared')).toBeVisible();
    expect(notes.map((entry) => entry.body)).toEqual([{ note: 'Strong screening call.' }, { note: '' }]);
    await expect(page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`)).toContainText('Add note');
  });

  test('sends nothing when the note is saved unchanged', async ({ page }) => {
    await open(page, requests, notes);

    await page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`).click();
    await page.getByTestId('mentorship-mentee-note-save').getByRole('button').click();

    expect(notes).toHaveLength(0);
  });

  test('shows the failure and leaves the note as it was when the save fails', async ({ page }) => {
    await open(page, requests, notes, 500);

    await writeNote(page, APPLICATION_ID, 'Strong screening call.');

    await expect(page.getByText('Could not save the note')).toBeVisible();
    await expect(page.getByTestId(`mentorship-current-mentee-note-${APPLICATION_ID}`)).toContainText('Add note');
  });

  test('tells the admin the application is gone when the save is a 404', async ({ page }) => {
    await open(page, requests, notes, 404);

    await writeNote(page, APPLICATION_ID, 'Strong screening call.');

    await expect(page.getByText('This application no longer exists. Refresh the page and try again.')).toBeVisible();
  });
});
