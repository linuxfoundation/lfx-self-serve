// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin enroll wizard — leaving the wizard (linuxfoundation/lfx-mentorship#259).
 *
 * The wizard asks before the admin leaves with answers they would lose. Cancel and "My Programs" only navigate;
 * the route guard on `admin/enroll` does the asking, so an untouched wizard leaves silently and a typed one
 * prompts, and Stay keeps the admin on the page. The reads the first step makes (the programs to import from,
 * the program-name check, the Linux Foundation project search) are stubbed with synthetic data, and the wizard
 * is reached by client-side navigation (`openMentorPage`) so the browser makes those calls and the stubs answer.
 *
 * The create and logo-upload submit flow, with its error mapping and partial-save banner, is covered by the
 * component spec: it needs every step filled in, and the logo route is never sent to a real bucket.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ENROLL_IMPORT_SOURCE_ID,
  ENROLL_IMPORT_SOURCE_NAME,
  ENROLL_IMPORT_TEMPLATE,
  stubEnrollImportReads,
  stubEnrollWizardReads,
} from './helpers/mentorship-admin-enroll.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ENROLL_URL = '/mentorship/admin/enroll';
const PROGRAM_NAME = 'Acme Rocket Mentorship';

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openWizard(page: Page, options: { templateFails?: boolean } = {}): Promise<void> {
  await enableMentorshipFlag(page);
  await stubEnrollWizardReads(page, fulfillJson);
  await stubEnrollImportReads(page, fulfillJson, options);
  await openMentorPage(page, ENROLL_URL);
  await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

async function pickImportProgram(page: Page): Promise<void> {
  await page.locator('#importProgramId').click();
  await page.getByRole('option', { name: ENROLL_IMPORT_SOURCE_NAME, exact: true }).click();
}

test.describe('Admin enroll wizard — leaving', () => {
  test.beforeEach(async ({ page }) => {
    await openWizard(page);
  });

  test('leaves an untouched wizard without asking', async ({ page }) => {
    await page.getByTestId('mentorship-enroll-back-to-programs').click();

    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    await expect(page.locator('.p-confirmdialog')).toHaveCount(0);
  });

  test('asks before leaving once a program name is typed, and Stay keeps the wizard open', async ({ page }) => {
    await page.locator('#name').fill(PROGRAM_NAME);

    await page.getByTestId('mentorship-enroll-back-to-programs').click();

    const confirmation = page.locator('.p-confirmdialog');
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Stay', exact: true }).click();

    await expect(page).toHaveURL(/\/mentorship\/admin\/enroll$/);
    await expect(page.locator('#name')).toHaveValue(PROGRAM_NAME);
  });

  test('leaves for My Programs once the admin accepts the prompt', async ({ page }) => {
    await page.locator('#name').fill(PROGRAM_NAME);

    await page.getByTestId('mentorship-enroll-back').click();
    await page.locator('.p-confirmdialog').getByRole('button', { name: 'Yes, cancel', exact: true }).click();

    await expect(page).toHaveURL(/\/mentorship\/admin$/);
  });

  test('does not send a create request when the admin only reads the first step', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/mentorship/admin/programs')) writes.push(request.url());
    });

    await page.locator('#name').fill(PROGRAM_NAME);
    await page.getByTestId('mentorship-enroll-next').click();

    expect(writes).toEqual([]);
  });
});

test.describe('Admin enroll wizard — import from an existing program', () => {
  test('fills the details from the picked program and shows its technologies', async ({ page }) => {
    await openWizard(page);

    await pickImportProgram(page);

    await expect(page.locator('#name')).toHaveValue(ENROLL_IMPORT_TEMPLATE.name);
    await expect(page.locator('#repositoryUrl')).toHaveValue(ENROLL_IMPORT_TEMPLATE.repositoryUrl);
    await expect(page.locator('#websiteUrl')).toHaveValue(ENROLL_IMPORT_TEMPLATE.websiteUrl);
    await expect(page.locator('#codeOfConductUrl')).toHaveValue(ENROLL_IMPORT_TEMPLATE.codeOfConductUrl);
    const details = page.getByTestId('mentorship-enroll-details');
    await expect(details.getByText('GO', { exact: true })).toBeVisible();
    await expect(details.getByText('Kubernetes', { exact: true })).toBeVisible();
    await expect(page.getByTestId('mentorship-enroll-import-error')).toHaveCount(0);
  });

  test('shows an inline error and keeps what was typed when the template fails to load', async ({ page }) => {
    await openWizard(page, { templateFails: true });
    await page.locator('#name').fill(PROGRAM_NAME);

    await pickImportProgram(page);

    await expect(page.getByTestId('mentorship-enroll-import-error')).toContainText("Couldn't load that program");
    await expect(page.locator('#name')).toHaveValue(PROGRAM_NAME);
  });

  test('never writes to the program it imported from', async ({ page }) => {
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() !== 'GET' && new URL(request.url()).pathname.includes(ENROLL_IMPORT_SOURCE_ID)) writes.push(request.url());
    });
    await openWizard(page);

    await pickImportProgram(page);
    await page.locator('#name').fill(PROGRAM_NAME);

    await expect(page.locator('#name')).toHaveValue(PROGRAM_NAME);
    expect(writes).toEqual([]);
  });
});
