// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Mentorship Programs in the Projects and Foundation lenses (linuxfoundation/lfx-mentorship#398), covered end to end for
 * linuxfoundation/lfx-mentorship#378.
 *
 * A project or foundation writer sees Mentorship Programs in the lens sidebar. The page lists the lens project's programs
 * (the Foundation lens adds its sub-projects' through `includeSubprojects=true`), opens a program and enrolls a new one without
 * leaving the lens: every link keeps `?project=<slug>`. In the Projects lens the wizard is locked to the project; in the
 * Foundation lens it offers the foundation and its direct sub-projects. A 403 on the list is the no-access state. Every read and
 * write is stubbed with synthetic data.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { MentorshipProgram, MentorshipProgramsResponse } from '@lfx-one/shared/interfaces';
import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import {
  ADMIN_PROGRAM_ID,
  ADMIN_PROGRAM_PAGE,
  AdminProgramRequests,
  stubAdminMentees,
  stubAdminProgramPage,
  stubAdminTasks,
} from './helpers/mentorship-admin-program.helper';
import {
  ENROLL_CREATED_PROGRAM,
  fillEnrollWizardToSubmit,
  stubEnrollCreateWrites,
  stubEnrollImportReads,
  stubEnrollWizardReads,
} from './helpers/mentorship-admin-enroll.helper';
import {
  LENS_FOUNDATION,
  LENS_PROJECT,
  LENS_SUB_PROJECT,
  lensContextOf,
  lensPath,
  MENTORSHIP_LENS_PAGE_TIMEOUT,
  MentorshipLensKind,
  openLensPage,
  stubMentorshipLens,
} from './helpers/mentorship-lens.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(90_000);

// The sidebar is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const fulfillJson = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const program = (id: string, name: string, projectName: string): MentorshipProgram => ({
  id,
  slug: id,
  name,
  projectName,
  status: 'accepting',
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  createdOn: '2026-06-01',
  updatedOn: '2026-07-20',
});

const SUB_PROJECT_PROGRAM_ID = '75555555-5555-4555-8555-555555555555';

/** The program the detail specs open is `ADMIN_PROGRAM_PAGE`'s, so its page stubs answer the card's link. */
const LENS_PROGRAMS: MentorshipProgramsResponse = {
  data: [program(ADMIN_PROGRAM_ID, ADMIN_PROGRAM_PAGE.program.name, LENS_PROJECT.name)],
  total: 1,
};

const FOUNDATION_PROGRAMS: MentorshipProgramsResponse = {
  data: [
    program(ADMIN_PROGRAM_ID, ADMIN_PROGRAM_PAGE.program.name, LENS_FOUNDATION.name),
    program(SUB_PROJECT_PROGRAM_ID, 'Example Sub-project Program', LENS_SUB_PROJECT.name),
  ],
  total: 2,
};

/** Answers the lens list read and records each request URL; `status` answers with that error instead. */
async function stubLensPrograms(page: Page, body: MentorshipProgramsResponse, status = 200): Promise<URL[]> {
  const requests: URL[] = [];
  await page.route('**/api/mentorship/admin/projects/*/programs*', (route) => {
    requests.push(new URL(route.request().url()));
    return status === 200 ? fulfillJson(route, body) : fulfillJson(route, { error: 'stubbed' }, status);
  });
  return requests;
}

async function openLensList(page: Page, lens: MentorshipLensKind): Promise<void> {
  await openLensPage(page, lens, lensPath(lens));
  await expect(page.getByTestId('mentorship-admin-title')).toHaveText('Mentorship Programs', { timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });
}

test.describe('Mentorship Programs — Projects lens', () => {
  test.beforeEach(async ({ page }) => {
    await stubMentorshipLens(page, 'project');
  });

  test('shows Mentorship Programs in the sidebar for a project writer, linked within the lens', async ({ page }) => {
    await stubLensPrograms(page, LENS_PROGRAMS);
    await openLensList(page, 'project');

    const item = page.getByTestId('sidebar-project-mentorship-programs');
    await expect(item).toBeVisible();
    await expect(item).toContainText('Mentorship Programs');
  });

  test("lists the project's own programs, reading them by the project's uid without sub-projects", async ({ page }) => {
    const requests = await stubLensPrograms(page, LENS_PROGRAMS);
    await openLensList(page, 'project');

    await expect(page.getByTestId(`mentorship-program-card-${ADMIN_PROGRAM_ID}`)).toContainText(ADMIN_PROGRAM_PAGE.program.name);
    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(1);
    const read = requests.at(-1)!;
    expect(read.pathname).toBe(`/api/mentorship/admin/projects/${LENS_PROJECT.uid}/programs`);
    expect(read.searchParams.has('includeSubprojects')).toBe(false);
  });

  test('opens a program inside the lens, and its back link returns to the lens list', async ({ page }) => {
    await stubLensPrograms(page, LENS_PROGRAMS);
    const requests: AdminProgramRequests = { mentees: [], tasks: [] };
    await stubAdminProgramPage(page);
    await stubAdminMentees(page, requests);
    await stubAdminTasks(page, requests);
    await openLensList(page, 'project');

    await page.getByTestId(`mentorship-program-card-${ADMIN_PROGRAM_ID}`).getByRole('button', { name: ADMIN_PROGRAM_PAGE.program.name }).click();

    await expect(page).toHaveURL(new RegExp(`/project/mentorship/${ADMIN_PROGRAM_ID}\\?project=${LENS_PROJECT.slug}$`));
    await expect(page.getByTestId('mentorship-program-detail-title')).toHaveText(ADMIN_PROGRAM_PAGE.program.name);

    await page.getByTestId('mentorship-program-detail-back').getByRole('link').click();

    await expect(page).toHaveURL(new RegExp(`/project/mentorship\\?project=${LENS_PROJECT.slug}$`));
  });

  test('shows the no-access state, with no Retry, when the list read is a 403', async ({ page }) => {
    await stubLensPrograms(page, LENS_PROGRAMS, 403);
    await openLensList(page, 'project');

    const noAccess = page.getByTestId('mentorship-admin-programs-no-access');
    await expect(noAccess).toContainText('No access to this project’s programs');
    await expect(noAccess).toContainText('You need Manage access on this project to see its mentorship programs.');
    await expect(page.getByTestId('mentorship-admin-programs-retry')).toHaveCount(0);
  });

  test('says the project has no programs yet when the list is empty', async ({ page }) => {
    await stubLensPrograms(page, { data: [], total: 0 });
    await openLensList(page, 'project');

    await expect(page.getByTestId('mentorship-programs-empty-state')).toContainText('This project has no mentorship programs yet.');
  });

  test('enrolls a program under the locked lens project and returns to the lens list', async ({ page }) => {
    await stubLensPrograms(page, LENS_PROGRAMS);
    await stubEnrollWizardReads(page, fulfillJson);
    await stubEnrollImportReads(page, fulfillJson);
    const lfProjectReads: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/mentorship/lf-projects')) lfProjectReads.push(request.url());
    });
    await openLensList(page, 'project');

    await page.getByTestId('mentorship-admin-enroll-button').getByRole('button').click();

    await expect(page).toHaveURL(new RegExp(`/project/mentorship/enroll\\?project=${LENS_PROJECT.slug}$`));
    await expect(page.getByTestId('mentorship-enroll-back-to-programs')).toContainText('Mentorship Programs');
    await expect(page.getByTestId('mentorship-enroll-details')).toContainText(LENS_PROJECT.name);

    const writes = await stubEnrollCreateWrites(page, fulfillJson);
    await fillEnrollWizardToSubmit(page, 'Acme Lens Mentorship');
    await page.getByTestId('mentorship-enroll-next').getByRole('button').click();

    await expect(page).toHaveURL(new RegExp(`/project/mentorship\\?project=${LENS_PROJECT.slug}$`));
    expect(writes[0].body).toMatchObject({ name: 'Acme Lens Mentorship', projectId: LENS_PROJECT.uid, projectSlug: LENS_PROJECT.slug });
    expect(writes.map((write) => write.path)).toEqual(['/api/mentorship/admin/programs', `/api/mentorship/admin/programs/${ENROLL_CREATED_PROGRAM.id}/logo`]);
    expect(lfProjectReads).toEqual([]);
  });

  test('leaves an untouched wizard for the lens list without asking', async ({ page }) => {
    await stubLensPrograms(page, LENS_PROGRAMS);
    await stubEnrollWizardReads(page, fulfillJson);
    await openLensPage(page, 'project', lensPath('project', '/enroll'));
    await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });

    await page.getByTestId('mentorship-enroll-back-to-programs').getByRole('button').click();

    await expect(page).toHaveURL(new RegExp(`/project/mentorship\\?project=${LENS_PROJECT.slug}$`));
    await expect(page.locator('.p-confirmdialog')).toHaveCount(0);
  });
});

test.describe('Mentorship Programs — Projects lens without write access', () => {
  test('leaves Mentorship Programs out of the sidebar', async ({ page }) => {
    await stubMentorshipLens(page, 'project', { writer: false });
    await stubLensPrograms(page, LENS_PROGRAMS, 403);
    await openLensList(page, 'project');

    await expect(page.getByTestId('mentorship-admin-programs-no-access')).toBeVisible();
    await expect(page.getByTestId('sidebar-project-mentorship-programs')).toHaveCount(0);
  });
});

test.describe('Mentorship Programs — Foundation lens', () => {
  test.beforeEach(async ({ page }) => {
    await stubMentorshipLens(page, 'foundation');
  });

  test('shows Mentorship Programs in the foundation sidebar', async ({ page }) => {
    await stubLensPrograms(page, FOUNDATION_PROGRAMS);
    await openLensList(page, 'foundation');

    await expect(page.getByTestId('sidebar-foundation-mentorship-programs')).toContainText('Mentorship Programs');
  });

  test("lists the foundation's programs with its sub-projects', reading with includeSubprojects", async ({ page }) => {
    const requests = await stubLensPrograms(page, FOUNDATION_PROGRAMS);
    await openLensList(page, 'foundation');

    await expect(page.getByTestId('mentorship-programs-cards')).toHaveCount(2);
    await expect(page.getByTestId(`mentorship-program-card-${SUB_PROJECT_PROGRAM_ID}`)).toContainText('Example Sub-project Program');
    const read = requests.at(-1)!;
    expect(read.pathname).toBe(`/api/mentorship/admin/projects/${LENS_FOUNDATION.uid}/programs`);
    expect(read.searchParams.get('includeSubprojects')).toBe('true');
  });

  test('names the foundation in the no-access state', async ({ page }) => {
    await stubLensPrograms(page, FOUNDATION_PROGRAMS, 403);
    await openLensList(page, 'foundation');

    await expect(page.getByTestId('mentorship-admin-programs-no-access')).toContainText('No access to this foundation’s programs');
  });

  test('says the foundation and its projects have no programs yet when the list is empty', async ({ page }) => {
    await stubLensPrograms(page, { data: [], total: 0 });
    await openLensList(page, 'foundation');

    await expect(page.getByTestId('mentorship-programs-empty-state')).toContainText('This foundation and its projects have no mentorship programs yet.');
  });

  test('offers the foundation first, then its direct sub-projects, in the enroll project picker', async ({ page }) => {
    await stubLensPrograms(page, FOUNDATION_PROGRAMS);
    await stubEnrollWizardReads(page, fulfillJson);
    const lfProjectReads: URL[] = [];
    await page.route('**/api/mentorship/lf-projects*', (route) => {
      lfProjectReads.push(new URL(route.request().url()));
      return fulfillJson(route, { data: [{ id: LENS_SUB_PROJECT.uid, name: LENS_SUB_PROJECT.name, slug: LENS_SUB_PROJECT.slug }] });
    });
    await openLensPage(page, 'foundation', lensPath('foundation', '/enroll'));
    await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTORSHIP_LENS_PAGE_TIMEOUT });

    await page.locator('#projectId').click();

    const options = page.getByRole('option');
    await expect(options).toHaveCount(2);
    await expect(options.nth(0)).toContainText(LENS_FOUNDATION.name);
    await expect(options.nth(1)).toContainText(LENS_SUB_PROJECT.name);
    expect(lfProjectReads[0].searchParams.get('parentUid')).toBe(lensContextOf('foundation').uid);
  });
});
