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
};

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
