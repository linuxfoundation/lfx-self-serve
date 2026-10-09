// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Stubs for the reads the admin enroll wizard makes on its first step (linuxfoundation/lfx-mentorship#259): the
 * programs the admin can import from, the program-name check and the Linux Foundation project search. All data is
 * synthetic. The wizard's writes are never stubbed here: a create sent to the programs route is aborted, so a spec
 * that sends one fails loudly.
 */

import { Page, Route } from '@playwright/test';

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
  prerequisites: [{ id: 'imported-0', name: 'Read the guide', description: 'Start with chapter one', required: true, requireFile: false, custom: true }],
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
    route.request().method() === 'GET'
      ? fulfillJson(route, { data: [{ id: ENROLL_IMPORT_SOURCE_ID, name: ENROLL_IMPORT_SOURCE_NAME }], total: 1 })
      : route.abort()
  );
  await page.route(/\/api\/mentorship\/admin\/programs\/[^/]+\/enroll-template$/, (route) =>
    options.templateFails
      ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'upstream down' }) })
      : fulfillJson(route, ENROLL_IMPORT_TEMPLATE)
  );
}
