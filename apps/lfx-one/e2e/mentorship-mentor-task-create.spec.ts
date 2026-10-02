// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentor task create — one mentee, a group, a partial group failure and a refused create on the program
 * detail page (linuxfoundation/lfx-mentorship#214).
 *
 * The Mentees tab creates tasks through `POST /api/mentorship/mentor/tasks` when the task dialog is
 * submitted, then re-reads the detail so the new task shows. Each test stubs the detail read and that
 * write via `page.route` with synthetic data, so the suite never creates a task on a real program. Only
 * an accepted mentee can be given a task, so a graduated mentee has no create control.
 *
 * The page is reached by client-side navigation (`openMentorPage`), so the detail read is made by the
 * browser and the stub answers it; a direct `page.goto()` would read it during SSR, where no stub runs.
 * The module is behind the `mentorship-enabled` client flag, pinned per test by `enableMentorshipFlag`.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipMentorProgramDetail, MentorshipMentorTaskCreateResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, MENTOR_PROGRAMS_URL, openMentorPage } from './helpers/mentor-profile.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const PROGRAM_ID = '71111111-1111-4111-8111-111111111111';
const DETAIL_URL = `${MENTOR_PROGRAMS_URL}/${PROGRAM_ID}`;
const DETAIL_ROUTE = `**/api/mentorship/mentor/programs/${PROGRAM_ID}`;
const TASKS_ROUTE = '**/api/mentorship/mentor/tasks';
const FIRST_ID = '72222222-2222-4222-8222-222222222222';
const SECOND_ID = '73333333-3333-4333-8333-333333333333';
const GRADUATED_ID = '74444444-4444-4444-8444-444444444444';

const mentee = (id: string, name: string, status: 'accepted' | 'graduated'): MentorshipMentorProgramDetail['mentees'][number] => ({
  id,
  name,
  email: `${name.toLowerCase().replace(/ /g, '.')}@example.com`,
  status,
  termName: 'Test Term Fall',
  tasksSubmitted: 0,
  tasksTotal: 0,
  tasks: [],
});

/** Two accepted mentees and a graduated one; `taskFor` lists one pending task on that mentee, as a re-read after a create would. */
function detailWith(taskFor?: string): MentorshipMentorProgramDetail {
  const mentees = [
    mentee(FIRST_ID, 'Test Mentee One', 'accepted'),
    mentee(SECOND_ID, 'Test Mentee Two', 'accepted'),
    mentee(GRADUATED_ID, 'Test Mentee Three', 'graduated'),
  ];
  return {
    program: {
      id: PROGRAM_ID,
      slug: 'test-program-tasks',
      name: 'Test Program Tasks',
      projectName: 'Test Project',
      term: 'Test Term Fall',
      termStatus: 'active-term',
      stats: { mentees: 3, tasksToReview: 0, applicants: 0 },
    },
    tabCounts: { tasks: taskFor ? 1 : 0, mentees: 3, applicants: 0 },
    mentees: mentees.map((person) =>
      person.id === taskFor
        ? {
            ...person,
            tasksTotal: 1,
            tasks: [
              {
                id: '75555555-5555-4555-8555-555555555555',
                name: 'Write a design doc',
                description: 'One page on the plan.',
                status: 'pending',
                prerequisite: false,
                createdOn: '2026-10-01',
                updatedOn: '2026-10-01',
              },
            ],
          }
        : person
    ),
    applicants: [],
  };
}

/** Answers the first detail read with `first` and every later one with `later`. */
async function stubDetail(page: Page, first: MentorshipMentorProgramDetail, later: MentorshipMentorProgramDetail = first): Promise<void> {
  let reads = 0;
  await page.route(DETAIL_ROUTE, (route) => {
    reads += 1;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reads === 1 ? first : later) });
  });
}

/** Answers the task create with `status` and `body`, and returns the bodies the page sent. */
async function stubTaskCreate(page: Page, status: number, body: MentorshipMentorTaskCreateResponse | { error: string }): Promise<unknown[]> {
  const sent: unknown[] = [];
  await page.route(TASKS_ROUTE, (route) => {
    sent.push(route.request().postDataJSON());
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return sent;
}

async function openMenteesTab(page: Page): Promise<void> {
  await openMentorPage(page, DETAIL_URL);
  await page.getByTestId('mentorship-mentor-program-detail-tab-mentees').click({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

/** Fills the open task dialog and submits it. */
async function submitTask(page: Page): Promise<void> {
  const dialog = page.getByTestId('mentorship-task-form-dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#mentorship-task-name').fill('Write a design doc');
  await dialog.locator('#mentorship-task-description').fill('One page on the plan.');
  await page.getByTestId('mentorship-task-form-submit').click();
}

const SENT_TASK = { name: 'Write a design doc', description: 'One page on the plan.', requiresFileSubmission: false };

test.describe('Mentor task create', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
  });

  test("creates a task for one mentee and lists it on the mentee's row", async ({ page }) => {
    await stubDetail(page, detailWith(), detailWith(FIRST_ID));
    const sent = await stubTaskCreate(page, 200, { created: [FIRST_ID], failed: [] });
    await openMenteesTab(page);

    await expect(page.getByTestId(`mentorship-mentor-mentee-view-tasks-${FIRST_ID}`)).toHaveCount(0);
    await page.getByTestId(`mentorship-mentor-mentee-create-task-${FIRST_ID}`).click();
    await submitTask(page);

    await expect(page.getByText('Task created')).toBeVisible();
    expect(sent).toEqual([{ applicationIds: [FIRST_ID], ...SENT_TASK }]);
    await expect(page.getByTestId(`mentorship-mentor-mentee-view-tasks-${FIRST_ID}`)).toBeVisible();
  });

  test('offers no task create on a graduated mentee', async ({ page }) => {
    await stubDetail(page, detailWith());
    await openMenteesTab(page);

    await expect(page.getByTestId(`mentorship-mentor-mentee-row-${GRADUATED_ID}`)).toBeVisible();
    await expect(page.getByTestId(`mentorship-mentor-mentee-create-task-${GRADUATED_ID}`)).toHaveCount(0);
    await expect(page.getByTestId(`mentorship-mentor-mentee-create-task-${FIRST_ID}`)).toBeVisible();
  });

  test('creates a group task for every accepted mentee', async ({ page }) => {
    await stubDetail(page, detailWith());
    const sent = await stubTaskCreate(page, 200, { created: [FIRST_ID, SECOND_ID], failed: [] });
    await openMenteesTab(page);

    await page.getByTestId('mentorship-mentor-mentees-create-group-task').click();
    await expect(page.getByTestId(`mentorship-task-form-assignee-${GRADUATED_ID}`)).toHaveCount(0);
    await submitTask(page);

    await expect(page.getByText('2 mentees were given the task.')).toBeVisible();
    expect(sent).toEqual([{ applicationIds: [FIRST_ID, SECOND_ID], ...SENT_TASK }]);
  });

  test('warns when a group task reaches only some mentees', async ({ page }) => {
    await stubDetail(page, detailWith());
    await stubTaskCreate(page, 200, { created: [FIRST_ID], failed: [SECOND_ID] });
    await openMenteesTab(page);

    await page.getByTestId('mentorship-mentor-mentees-create-group-task').click();
    await submitTask(page);

    await expect(page.getByText('Some tasks were not created')).toBeVisible();
    await expect(page.getByText('1 of 2 tasks were not created. Refresh the page and try again.')).toBeVisible();
  });

  test('explains a refused single create', async ({ page }) => {
    await stubDetail(page, detailWith());
    await stubTaskCreate(page, 400, { error: 'assignee is not an accepted mentee' });
    await openMenteesTab(page);

    await page.getByTestId(`mentorship-mentor-mentee-create-task-${FIRST_ID}`).click();
    await submitTask(page);

    await expect(page.getByText('Could not create the task')).toBeVisible();
    await expect(page.getByText('This mentee can no longer be given tasks. Refresh the page and try again.')).toBeVisible();
  });
});
