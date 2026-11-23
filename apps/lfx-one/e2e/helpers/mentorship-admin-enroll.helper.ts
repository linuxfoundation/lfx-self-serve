// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the reads the admin enroll wizard makes on its first step (linuxfoundation/lfx-mentorship#259): the
 * programs the admin can import from, the program-name check and the Linux Foundation project search. All data is
 * synthetic. The reads never answer a write: a create sent to the programs route is aborted unless a spec registers
 * `stubEnrollCreateWrites` (linuxfoundation/lfx-mentorship#378), so a spec that sends one by mistake fails loudly.
 */

import { MentorshipProgram } from '@lfx-one/shared/interfaces';
import { expect, Locator, Page, Route } from '@playwright/test';

type FulfillJson = (route: Route, body: unknown) => Promise<void>;

/** Answers the first-step reads with empty lists and an available name. */
export async function stubEnrollWizardReads(page: Page, fulfillJson: FulfillJson): Promise<void> {
  await page.route('**/api/mentorship/admin/programs*', (route) =>
    route.request().method() === 'GET' ? fulfillJson(route, { data: [], total: 0 }) : route.abort()
  );
  await page.route('**/api/mentorship/programs/name-available*', (route) => fulfillJson(route, { available: true }));
  await page.route('**/api/mentorship/lf-projects*', (route) => fulfillJson(route, { data: [], total: 0 }));
}

/** The program the import specs pick from the import list; its template is the one `ENROLL_IMPORT_TEMPLATE` below. */
export const ENROLL_IMPORT_SOURCE_ID = 'e2e-import-source';
export const ENROLL_IMPORT_SOURCE_NAME = 'Example Source Program';

/** The source program as the programs list returns it: a whole program, so My Programs can render its card after the wizard leaves. */
const ENROLL_IMPORT_SOURCE_PROGRAM: MentorshipProgram = {
  id: ENROLL_IMPORT_SOURCE_ID,
  slug: ENROLL_IMPORT_SOURCE_ID,
  name: ENROLL_IMPORT_SOURCE_NAME,
  projectName: 'Example Project',
  status: 'accepting',
  stats: { mentors: 1, mentees: 2, graduated: 0 },
  createdOn: '2026-06-01',
  updatedOn: '2026-07-20',
};

/** Next year: a date then has not passed whenever the suite runs. */
const NEXT_YEAR = new Date().getFullYear() + 1;

/** What the BFF returns for the source program: the form fields already mapped, `industry` split into technologies. */
export const ENROLL_IMPORT_TEMPLATE = {
  name: 'Example Imported Program',
  project: { id: 'e2e-import-project', name: 'Example Project', slug: 'example-project' },
  description: '<p>A synthetic program used by the import specs.</p>',
  repositoryUrl: 'https://repo.example/org/program',
  websiteUrl: 'https://program.example',
  codeOfConductUrl: 'https://program.example/code-of-conduct',
  ciiProjectId: '',
  technologies: ['GO', 'Kubernetes'],
  skills: ['Documentation'],
  // Submit needs a custom prerequisite's due date, so the import carries one that has not passed.
  prerequisites: [
    {
      id: 'imported-0',
      name: 'Read the guide',
      description: 'Start with chapter one',
      required: true,
      requireFile: false,
      custom: true,
      dueDate: `${NEXT_YEAR}-01-05`,
    },
  ],
  logoUrl: '',
};

/** The program the edit specs open (linuxfoundation/lfx-mentorship#265), and the template the BFF returns for it. */
export const ENROLL_EDIT_PROGRAM_ID = '7d3c2b1a-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const ENROLL_EDIT_TEMPLATE = { ...ENROLL_IMPORT_TEMPLATE, name: 'Example Edited Program', logoUrl: '' };

/** One open term whose dates have passed, which an edit may keep, and one closed term, which it only lists. */
const ENROLL_EDIT_TERMS = [
  {
    id: 'e2e-term-open',
    name: 'Spring',
    status: 'open',
    startDate: '2020-03-01',
    endDate: '2020-05-31',
    applicationStartDate: '2020-01-01',
    applicationEndDate: '2020-02-01',
  },
  {
    id: 'e2e-term-closed',
    name: 'Fall',
    status: 'closed',
    startDate: '2019-09-01',
    endDate: '2019-11-30',
    applicationStartDate: '2019-07-01',
    applicationEndDate: '2019-08-01',
  },
].map((term) => ({ ...term, pending: 0, declined: 0, accepted: 0, graduated: 0 }));

/**
 * Answers the edit wizard's reads for `ENROLL_EDIT_PROGRAM_ID`: its template, or a 500 when `templateFails` is set, and its
 * terms. Writes are not stubbed here. Register after `stubEnrollWizardReads`.
 */
export async function stubEnrollEditReads(page: Page, fulfillJson: FulfillJson, options: { templateFails?: boolean } = {}): Promise<void> {
  await page.route(`**/api/mentorship/admin/programs/${ENROLL_EDIT_PROGRAM_ID}/enroll-template`, (route) =>
    options.templateFails
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'upstream down' }) })
      : fulfillJson(route, ENROLL_EDIT_TEMPLATE)
  );
  await page.route(`**/api/mentorship/admin/programs/${ENROLL_EDIT_PROGRAM_ID}/terms*`, (route) =>
    fulfillJson(route, { data: ENROLL_EDIT_TERMS, total: ENROLL_EDIT_TERMS.length })
  );
}

/**
 * Lists one program to import from and answers its enroll-template read, either with `ENROLL_IMPORT_TEMPLATE` or, when
 * `templateFails` is set, with a 500. Register after `stubEnrollWizardReads`: the later route wins for the program list.
 */
export async function stubEnrollImportReads(page: Page, fulfillJson: FulfillJson, options: { templateFails?: boolean } = {}): Promise<void> {
  await page.route(/\/api\/mentorship\/admin\/programs(\?.*)?$/, (route) =>
    route.request().method() === 'GET' ? fulfillJson(route, { data: [ENROLL_IMPORT_SOURCE_PROGRAM], total: 1 }) : route.abort()
  );
  await page.route(/\/api\/mentorship\/admin\/programs\/[^/]+\/enroll-template$/, (route) =>
    options.templateFails
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'upstream down' }) })
      : fulfillJson(route, ENROLL_IMPORT_TEMPLATE)
  );
}

/**
 * A logo the wizard accepts: the PNG signature is enough, since the browser checks only the name, the type and the size
 * (linuxfoundation/lfx-mentorship#378).
 */
export const ENROLL_LOGO_PNG = { name: 'logo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };

/** What the BFF answers a create with. */
export const ENROLL_CREATED_PROGRAM = { id: 'e2e-created-program', slug: 'e2e-created-program', status: 'pending' };

/** A term next year, so neither the start month nor the application window has passed whenever the suite runs. */
export const ENROLL_NEW_TERM = {
  name: 'Summer',
  startMonth: 'March',
  endMonth: 'June',
  year: String(NEXT_YEAR),
  applicationStartDate: `${NEXT_YEAR}-01-10`,
  applicationEndDate: `${NEXT_YEAR}-02-20`,
};

/** Types a `YYYY-MM-DD` date into an `lfx-calendar`. The datepicker parses only input that follows a keydown, so it is typed, not filled. */
async function typeDate(page: Page, input: Locator, value: string): Promise<void> {
  await input.click();
  await input.pressSequentially(value);
  // Tab, not Escape: it closes the date overlay, while an Escape that lands before the overlay opens closes the term dialog.
  await page.keyboard.press('Tab');
}

/** One write the wizard sent: its method, its path, and the JSON body or, for the logo, the content type. */
export interface EnrollWrite {
  method: string;
  path: string;
  body?: unknown;
  contentType?: string;
}

/**
 * Answers Submit's writes and records each one: the create (`POST /api/mentorship/admin/programs`) with `ENROLL_CREATED_PROGRAM`, or
 * `createStatus` when set, and each logo upload with the next status in `logoStatuses` (200 once they run out). Register after the
 * read stubs: the later route wins, and a read falls through to them.
 */
export async function stubEnrollCreateWrites(
  page: Page,
  fulfillJson: FulfillJson,
  options: { createStatus?: number; logoStatuses?: number[] } = {}
): Promise<EnrollWrite[]> {
  const writes: EnrollWrite[] = [];
  const logoStatuses = [...(options.logoStatuses ?? [])];
  await page.route(/\/api\/mentorship\/admin\/programs(\?.*)?$/, (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    writes.push({ method: 'POST', path: new URL(request.url()).pathname, body: request.postDataJSON() });
    return options.createStatus
      ? route.fulfill({ status: options.createStatus, contentType: 'application/json', body: JSON.stringify({ error: 'refused' }) })
      : fulfillJson(route, ENROLL_CREATED_PROGRAM);
  });
  await page.route(/\/api\/mentorship\/admin\/programs\/[^/]+\/logo$/, (route) => {
    const request = route.request();
    writes.push({ method: request.method(), path: new URL(request.url()).pathname, contentType: request.headers()['content-type'] });
    const status = logoStatuses.shift() ?? 200;
    return status === 200
      ? fulfillJson(route, { logoUrl: 'https://cdn.example/e2e-logo.png' })
      : route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'refused' }) });
  });
  return writes;
}

/** Adds `ENROLL_NEW_TERM` through the term dialog on the setup step. */
export async function addEnrollTerm(page: Page): Promise<void> {
  await page.getByTestId('mentorship-enroll-add-term').getByRole('button').click();
  const dialog = page.getByTestId('mentorship-enroll-term-dialog');
  await expect(dialog).toBeVisible();
  await page.locator('#dialog-term-name').fill(ENROLL_NEW_TERM.name);
  const pick = async (id: string, option: string) => {
    await page.locator(`#${id}`).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await pick('dialog-term-start-month', ENROLL_NEW_TERM.startMonth);
  await pick('dialog-term-start-year', ENROLL_NEW_TERM.year);
  await pick('dialog-term-end-month', ENROLL_NEW_TERM.endMonth);
  await pick('dialog-term-end-year', ENROLL_NEW_TERM.year);
  await typeDate(page, page.locator('#dialog-term-application-start'), ENROLL_NEW_TERM.applicationStartDate);
  await typeDate(page, page.locator('#dialog-term-application-end'), ENROLL_NEW_TERM.applicationEndDate);
  await page.getByTestId('mentorship-enroll-term-submit').getByRole('button').click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Completes the details step of a fresh wizard and moves on to setup: imports the program `stubEnrollImportReads` lists, names it
 * `programName` and picks the logo. The import fills the rest. In a lens the import leaves the project out, so a spec there picks
 * it (or the lens locks it) before this runs.
 */
export async function completeEnrollDetailsStep(page: Page, programName: string): Promise<void> {
  await page.locator('#importProgramId').click();
  await page.getByRole('option', { name: ENROLL_IMPORT_SOURCE_NAME, exact: true }).click();
  await expect(page.locator('#repositoryUrl')).toHaveValue(ENROLL_IMPORT_TEMPLATE.repositoryUrl);

  // Next waits on the name check, so wait for the one for the typed name before moving on.
  const nameChecked = page.waitForResponse(
    (response) => response.url().includes('/api/mentorship/programs/name-available') && new URL(response.url()).searchParams.get('name') === programName
  );
  await page.locator('#name').fill(programName);
  await nameChecked;
  await page.getByTestId('mentorship-enroll-details').locator('input[type="file"]').setInputFiles(ENROLL_LOGO_PNG);

  await page.getByTestId('mentorship-enroll-next').getByRole('button').click();
  await expect(page.getByTestId('mentorship-enroll-setup')).toBeVisible();
}

/** Takes a fresh wizard to Submit: the details step as `completeEnrollDetailsStep` fills it, `ENROLL_NEW_TERM`, and the terms accepted. */
export async function fillEnrollWizardToSubmit(page: Page, programName: string): Promise<void> {
  await completeEnrollDetailsStep(page, programName);
  await addEnrollTerm(page);

  const next = page.getByTestId('mentorship-enroll-next').getByRole('button');
  await next.click();
  await expect(page.getByTestId('mentorship-enroll-prerequisites')).toBeVisible();
  await page.getByTestId('mentorship-enroll-terms').click();
  await expect(page.locator('#mentorship-enroll-terms')).toBeChecked();
  await expect(next).toHaveText('Submit');
}
