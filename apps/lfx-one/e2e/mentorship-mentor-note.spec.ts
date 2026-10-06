// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor reviewer notes — saving, clearing and a refused save on the program detail page
 * (linuxfoundation/lfx-mentorship#213).
 *
 * The page saves a note through `PUT /api/mentorship/mentor/applications/:applicationId/note` when
 * its dialog closes, and shows it on the row once saved. Each test stubs the detail read and that
 * write via `page.route` with synthetic data, so the suite never writes a note on a real program. An
 * accepted mentee is listed on both tabs under one application id, so one save must show on both.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipMentorProgramDetail } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '61111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const ACCEPTED_ID = '62222222-2222-4222-8222-222222222222';
const NOTE_ROUTE = `**/api/mentorship/mentor/applications/${ACCEPTED_ID}/note`;

const ACCEPTED_MENTEE: MentorshipMentorProgramDetail['mentees'][number] = {
  id: ACCEPTED_ID,
  name: 'Test Mentee One',
  email: 'test.mentee.one@example.com',
  status: 'accepted',
  termName: 'Test Term Fall',
  tasksSubmitted: 0,
  tasksTotal: 0,
  tasks: [],
};

/** One accepted mentee, listed on Mentees and Applicants, with `note` as the saved reviewer note. */
function detailWith(note?: string): MentorshipMentorProgramDetail {
  return {
    program: {
      id: PROGRAM_ID,
      slug: 'test-program-notes',
      name: 'Test Program Notes',
      projectName: 'Test Project',
      term: 'Test Term Fall',
      termStatus: 'active-term',
      stats: { mentees: 1, tasksToReview: 0, applicants: 1 },
    },
    tabCounts: { tasks: 0, mentees: 1, applicants: 1 },
    mentees: [{ ...ACCEPTED_MENTEE, note }],
    applicants: [{ ...ACCEPTED_MENTEE, note, createdOn: '2026-08-01', updatedOn: '2026-08-15' }],
  };
}

/** Answers the note write with `status`, and returns the bodies the page sent. */
async function stubNoteSave(page: Page, status: number, body?: unknown): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(NOTE_ROUTE, (route) => {
    sent.push(route.request().postDataJSON());
    return status === 204
      ? route.fulfill({ status })
      : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body ?? { error: 'Forbidden' }) });
  });
  return sent;
}

/** Opens the Mentees tab, then the accepted mentee's note dialog, and saves `note` in it. */
async function saveNoteFromMentees(page: Page, note: string): Promise<void> {
  await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId(`mentorship-mentor-mentee-note-${ACCEPTED_ID}`).click();
  const dialog = page.getByTestId('mentorship-mentee-note-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#dialog-mentee-note').fill(note);
  await dialog.getByTestId('mentorship-mentee-note-save').click();
}

test.describe('Mentor reviewer notes', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test('saves a note and shows it on the mentee and applicant rows', async ({ page }) => {
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailWith()) }));
    const sent = await stubNoteSave(page, 204);
    await openMentorPage(page, DETAIL_URL);

    await saveNoteFromMentees(page, '  Strong first task.  ');

    await expect(page.getByText('Note saved')).toBeVisible();
    expect(sent).toEqual([{ note: 'Strong first task.' }]);
    await expect(page.getByTestId(`mentorship-mentor-mentee-note-${ACCEPTED_ID}`)).toContainText('Strong first task.');

    await page.getByTestId('mentorship-mentor-program-detail-tab-applicants').click();
    await page.getByTestId('mentorship-mentor-applicants-status-pill-all').click();
    await expect(page.getByTestId(`mentorship-mentor-applicant-note-${ACCEPTED_ID}`)).toContainText('Strong first task.');
  });

  test('clears a saved note', async ({ page }) => {
    await page.route(DETAIL_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailWith('An earlier note.')) })
    );
    const sent = await stubNoteSave(page, 204);
    await openMentorPage(page, DETAIL_URL);

    await saveNoteFromMentees(page, '');

    await expect(page.getByText('Note cleared')).toBeVisible();
    expect(sent).toEqual([{ note: '' }]);
    await expect(page.getByTestId(`mentorship-mentor-mentee-note-${ACCEPTED_ID}`)).toHaveText('Add note');
  });

  test('keeps the row as it was when the save is refused', async ({ page }) => {
    await page.route(DETAIL_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailWith()) }));
    await stubNoteSave(page, 403);
    await openMentorPage(page, DETAIL_URL);

    await saveNoteFromMentees(page, 'A note that will not save.');

    await expect(page.getByText('Could not save the note')).toBeVisible();
    await expect(page.getByText('You can no longer edit notes on this program. Refresh the page and try again.')).toBeVisible();
    await expect(page.getByTestId(`mentorship-mentor-mentee-note-${ACCEPTED_ID}`)).toHaveText('Add note');
  });
});
