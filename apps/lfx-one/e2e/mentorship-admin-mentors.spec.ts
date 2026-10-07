// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin Mentors tab — manage a program's mentors (linuxfoundation/lfx-mentorship#238).
 *
 * Accept or Decline a mentor request, Revoke an invite, Remove an active mentor. The reads are stubbed as in
 * `mentorship-admin-program-tabs.spec.ts`; the status write is stubbed here via `page.route`, recording each request
 * so a spec asserts the body the browser sent as well as what it rendered. All data is synthetic.
 * Delete is not offered: upstream's DELETE only withdraws an active mentor, which Remove already does.
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
import {
  MENTOR_ACTIVE_ID,
  MENTOR_DECLINED_ID,
  MENTOR_INVITED_ID,
  MENTOR_REQUESTED_AGAIN_ID,
  MENTOR_REQUESTED_ID,
  MentorStubState,
  newMentorStubState,
  stubMentorActions,
} from './helpers/mentorship-admin-mentors.helper';
import { ADMIN_PROGRAM_ID, ADMIN_PROGRAM_URL, stubAdminMentees, stubAdminProgramPage, stubAdminTasks } from './helpers/mentorship-admin-program.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

/** Counts the program page reads (the source of the tab counts) the browser makes. */
function countProgramReads(page: Page): { count: () => number } {
  let reads = 0;
  page.on('request', (request) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname === `/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}`) reads += 1;
  });
  return { count: () => reads };
}

async function open(page: Page, state: MentorStubState, writeStatus?: number): Promise<void> {
  await enableMentorshipFlag(page);
  await stubAdminProgramPage(page);
  await stubAdminMentees(page, { mentees: [], tasks: [] });
  await stubAdminTasks(page, { mentees: [], tasks: [] });
  await stubMentorActions(page, state, writeStatus);
  await openMentorPage(page, ADMIN_PROGRAM_URL);
  await expect(page.getByTestId('mentorship-current-mentees-tab')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  await page.getByTestId('mentorship-program-detail-tab-mentors').click();
  await expect(page.getByTestId('mentorship-mentors-tab')).toBeVisible();
  await expect(page.getByTestId(`mentorship-mentor-row-${MENTOR_REQUESTED_ID}`)).toBeVisible();
}

const rowAction = (page: Page, key: string, id: string) => page.getByTestId(`mentorship-admin-mentors-${key}-${id}`);

/** Confirms the open confirmation dialog with its accept button. */
async function confirm(page: Page, label: string): Promise<void> {
  await page.locator('.p-confirmdialog').getByRole('button', { name: label, exact: true }).click();
}

test.describe('Admin Mentors tab — manage mentors', () => {
  let state: MentorStubState;

  test.beforeEach(() => {
    state = newMentorStubState();
  });

  test('offers each mentor the actions its status allows, and no Delete', async ({ page }) => {
    await open(page, state);

    await expect(rowAction(page, 'accept', MENTOR_REQUESTED_ID)).toBeVisible();
    await expect(rowAction(page, 'decline', MENTOR_REQUESTED_ID)).toBeVisible();
    await expect(rowAction(page, 'accept', MENTOR_REQUESTED_AGAIN_ID)).toBeVisible();
    await expect(rowAction(page, 'revoke', MENTOR_INVITED_ID)).toHaveAccessibleName('Revoke invite Test Mentor Invited');
    await expect(rowAction(page, 'remove', MENTOR_ACTIVE_ID)).toBeVisible();
    await expect(page.getByTestId(`mentorship-mentor-row-${MENTOR_DECLINED_ID}`).getByRole('button')).toHaveCount(0);
    await expect(page.locator('[data-testid^="mentorship-admin-mentors-delete-"]')).toHaveCount(0);
  });

  test('accepts a mentor request after the confirmation, then reloads the rows and the tab counts', async ({ page }) => {
    const programReads = countProgramReads(page);
    await open(page, state);
    const mentorReadsBefore = state.reads;
    const programReadsBefore = programReads.count();

    await rowAction(page, 'accept', MENTOR_REQUESTED_ID).click();
    expect(state.writes).toHaveLength(0);
    await confirm(page, 'Accept');

    await expect(page.getByText('Mentor accepted.')).toBeVisible();
    expect(state.writes).toEqual([{ id: MENTOR_REQUESTED_ID, method: 'PATCH', body: { status: 'active' } }]);
    await expect(page.getByTestId(`mentorship-mentor-row-${MENTOR_REQUESTED_ID}`)).toContainText('Accepted');
    expect(state.reads).toBeGreaterThan(mentorReadsBefore);
    await expect.poll(() => programReads.count()).toBeGreaterThan(programReadsBefore);
  });

  test('declines a mentor request only after the confirmation, and not when it is cancelled', async ({ page }) => {
    await open(page, state);

    await rowAction(page, 'decline', MENTOR_REQUESTED_AGAIN_ID).click();
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(state.writes).toHaveLength(0);

    await rowAction(page, 'decline', MENTOR_REQUESTED_AGAIN_ID).click();
    await confirm(page, 'Decline');

    await expect(page.getByText('Mentor declined.')).toBeVisible();
    expect(state.writes.map((write) => [write.id, write.body])).toEqual([[MENTOR_REQUESTED_AGAIN_ID, { status: 'declined' }]]);
    await expect(rowAction(page, 'accept', MENTOR_REQUESTED_AGAIN_ID)).toHaveCount(0);
  });

  test('revokes an invite by declining it', async ({ page }) => {
    await open(page, state);

    await rowAction(page, 'revoke', MENTOR_INVITED_ID).click();
    await confirm(page, 'Revoke invite');

    await expect(page.getByText('Invite revoked.')).toBeVisible();
    expect(state.writes.map((write) => [write.id, write.body])).toEqual([[MENTOR_INVITED_ID, { status: 'declined' }]]);
  });

  test('removes an active mentor by withdrawing them', async ({ page }) => {
    await open(page, state);

    await rowAction(page, 'remove', MENTOR_ACTIVE_ID).click();
    await confirm(page, 'Remove');

    await expect(page.getByText('Mentor removed.')).toBeVisible();
    expect(state.writes.map((write) => [write.id, write.body])).toEqual([[MENTOR_ACTIVE_ID, { status: 'withdrawn' }]]);
    await expect(page.getByTestId(`mentorship-mentor-row-${MENTOR_ACTIVE_ID}`)).toContainText('Withdrawn');
  });

  test('shows the changed message and reloads when the mentor changed (409)', async ({ page }) => {
    await open(page, state, 409);
    const readsBefore = state.reads;

    await rowAction(page, 'remove', MENTOR_ACTIVE_ID).click();
    await confirm(page, 'Remove');

    await expect(page.getByText('This mentor changed. The list has been refreshed.')).toBeVisible();
    await expect.poll(() => state.reads).toBeGreaterThan(readsBefore);
  });

  test('shows the generic error and keeps the rows when the write fails (502)', async ({ page }) => {
    await open(page, state, 502);
    const readsBefore = state.reads;

    await rowAction(page, 'accept', MENTOR_REQUESTED_ID).click();
    await confirm(page, 'Accept');

    await expect(page.getByText("The change couldn't be saved. Please try again.")).toBeVisible();
    expect(state.reads).toBe(readsBefore);
    await expect(rowAction(page, 'accept', MENTOR_REQUESTED_ID)).toBeVisible();
  });
});

const CANDIDATES_ROUTE = `**/api/mentorship/admin/programs/${ADMIN_PROGRAM_ID}/mentor-candidates`;

/** Stubs the invite search, recording each body the browser sent; the search travels in the body, never the URL. */
async function stubCandidates(page: Page, status: number, body: unknown): Promise<{ searches: unknown[]; urls: string[] }> {
  const searches: unknown[] = [];
  const urls: string[] = [];
  await page.route(CANDIDATES_ROUTE, (route) => {
    searches.push(route.request().postDataJSON());
    urls.push(route.request().url());
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return { searches, urls };
}

const inviteSearch = (page: Page) => page.locator('#mentorship-mentors-invitee-input');

test.describe('Admin Mentors tab — invite search', () => {
  test('lists each candidate by name and LFID, never an email, and sends the search in the body', async ({ page }) => {
    const stub = await stubCandidates(page, 200, { data: [{ lfid: 'test-mentor-ada', name: 'Test Mentor Ada' }] });
    await open(page, newMentorStubState());

    await inviteSearch(page).fill('test-mentor-ada');

    const option = page.getByTestId('mentorship-mentors-candidate-test-mentor-ada');
    await expect(option).toContainText('Test Mentor Ada');
    await expect(option).toContainText('test-mentor-ada');
    await expect(option).not.toContainText('@');
    expect(stub.searches).toEqual([{ search: 'test-mentor-ada' }]);
    expect(stub.urls.every((url) => !url.includes('search='))).toBe(true);
  });

  for (const [label, status, body, message] of [
    [
      'an email with no LF account',
      200,
      { data: [] },
      'No LF account found. Ask them to create one at sso.linuxfoundation.org, then invite them by email or username.',
    ],
    [
      'a name with no Mentorship user',
      200,
      { data: [] },
      'No one matches that search. Name search only finds people already in Mentorship; try their exact LF username or full email address.',
    ],
    ['an unavailable account lookup (503)', 503, { message: 'unavailable' }, "Couldn't look up accounts right now. Try again."],
    ['an unpublished program (400)', 400, { message: 'not published' }, 'Mentors can only be invited to a published program.'],
  ] as const) {
    test(`shows the empty-state message for ${label}`, async ({ page }) => {
      await stubCandidates(page, status, body);
      await open(page, newMentorStubState());

      await inviteSearch(page).fill(label.startsWith('a name') ? 'Nobody Known' : 'nobody@example.invalid');

      await expect(page.getByTestId('mentorship-mentors-candidates-empty')).toHaveText(message);
      await expect(page.getByTestId('mentorship-mentors-invite').locator('button')).toBeDisabled();
    });
  }
});
