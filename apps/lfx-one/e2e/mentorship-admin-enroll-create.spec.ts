// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin enroll wizard — creating a program (linuxfoundation/lfx-mentorship#259, #261), covered end to end for
 * linuxfoundation/lfx-mentorship#378.
 *
 * Submit sends the create, then uploads the logo to the program it made. A program saved without its logo shows the
 * partial-save banner, and Retry uploads only the logo. A name another program has (409) sends the admin back to the
 * details step, and any other create failure keeps the answers for another try. Every read and write is stubbed with
 * synthetic data; the wizard is filled from an imported program so each step has its required answers.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  ENROLL_CREATED_PROGRAM,
  ENROLL_IMPORT_TEMPLATE,
  ENROLL_NEW_TERM,
  fillEnrollWizardToSubmit,
  stubEnrollCreateWrites,
  stubEnrollImportReads,
  stubEnrollWizardReads,
} from './helpers/mentorship-admin-enroll.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(90_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ENROLL_URL = '/mentorship/admin/enroll';
const PROGRAM_NAME = 'Acme Rocket Mentorship';
const LOGO_PATH = `/api/mentorship/admin/programs/${ENROLL_CREATED_PROGRAM.id}/logo`;

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openWizard(page: Page): Promise<void> {
  await stubEnrollWizardReads(page, fulfillJson);
  await stubEnrollImportReads(page, fulfillJson);
  await openMentorPage(page, ENROLL_URL);
  await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

function submitButton(page: Page) {
  return page.getByTestId('mentorship-enroll-next').getByRole('button');
}

test.describe('Admin enroll wizard — create a program', () => {
  test('creates the program, uploads its logo, and goes back to My Programs', async ({ page }) => {
    await openWizard(page);
    const writes = await stubEnrollCreateWrites(page, fulfillJson);
    await fillEnrollWizardToSubmit(page, PROGRAM_NAME);

    await submitButton(page).click();

    await expect(page.getByText('Program submitted for review.')).toBeVisible();
    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    expect(writes.map((write) => `${write.method} ${write.path}`)).toEqual(['POST /api/mentorship/admin/programs', `POST ${LOGO_PATH}`]);
    expect(writes[1].contentType).toBe('image/png');
    expect(writes[0].body).toMatchObject({
      name: PROGRAM_NAME,
      projectId: ENROLL_IMPORT_TEMPLATE.project.id,
      projectSlug: ENROLL_IMPORT_TEMPLATE.project.slug,
      repositoryUrl: ENROLL_IMPORT_TEMPLATE.repositoryUrl,
      industry: ENROLL_IMPORT_TEMPLATE.technologies.join(', '),
      skills: ENROLL_IMPORT_TEMPLATE.skills,
      termsAccepted: true,
      terms: [
        {
          name: ENROLL_NEW_TERM.name,
          applicationStartDate: ENROLL_NEW_TERM.applicationStartDate,
          applicationEndDate: ENROLL_NEW_TERM.applicationEndDate,
        },
      ],
    });
  });

  test('keeps the saved program when the logo fails, and Retry uploads only the logo', async ({ page }) => {
    await openWizard(page);
    // 415 is a refusal the upload does not repeat on its own, so the banner shows at once.
    const writes = await stubEnrollCreateWrites(page, fulfillJson, { logoStatuses: [415] });
    await fillEnrollWizardToSubmit(page, PROGRAM_NAME);

    await submitButton(page).click();

    const banner = page.getByTestId('mentorship-enroll-partial-save');
    await expect(banner).toContainText("Program saved and sent for review, but the logo didn't upload.");
    await expect(page.getByTestId('mentorship-enroll-partial-save-logo-error')).toBeVisible();
    await expect(page).toHaveURL(/\/mentorship\/admin\/enroll$/);

    await page.getByTestId('mentorship-enroll-partial-save-retry').getByRole('button').click();

    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    expect(writes.map((write) => `${write.method} ${write.path}`)).toEqual(['POST /api/mentorship/admin/programs', `POST ${LOGO_PATH}`, `POST ${LOGO_PATH}`]);
  });

  test('sends the admin back to the name when another program has it (409)', async ({ page }) => {
    await openWizard(page);
    const writes = await stubEnrollCreateWrites(page, fulfillJson, { createStatus: 409 });
    await fillEnrollWizardToSubmit(page, PROGRAM_NAME);

    await submitButton(page).click();

    await expect(page.getByTestId('mentorship-enroll-details')).toBeVisible();
    await expect(page.locator('#name')).toHaveValue(PROGRAM_NAME);
    await expect(page.locator('#name')).toBeEnabled();
    expect(writes.map((write) => write.path)).toEqual(['/api/mentorship/admin/programs']);
  });

  test('keeps the answers and says so when the create fails, then creates on the next Submit', async ({ page }) => {
    await openWizard(page);
    const failed = await stubEnrollCreateWrites(page, fulfillJson, { createStatus: 500 });
    await fillEnrollWizardToSubmit(page, PROGRAM_NAME);

    await submitButton(page).click();

    await expect(page.getByTestId('mentorship-enroll-submit-error')).toContainText("We couldn't save the program. Your answers are kept");
    await expect(page.getByTestId('mentorship-enroll-partial-save')).toHaveCount(0);
    await expect(submitButton(page)).toBeEnabled();
    expect(failed).toHaveLength(1);

    // The later stub wins, so the next Submit is answered with the created program.
    const writes = await stubEnrollCreateWrites(page, fulfillJson);
    await submitButton(page).click();

    await expect(page).toHaveURL(/\/mentorship\/admin$/);
    expect(writes.map((write) => `${write.method} ${write.path}`)).toEqual(['POST /api/mentorship/admin/programs', `POST ${LOGO_PATH}`]);
  });
});
