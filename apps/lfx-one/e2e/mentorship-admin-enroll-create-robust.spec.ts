// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin enroll wizard — create structure (linuxfoundation/lfx-mentorship#378): the term dialog's fields, and the
 * partial-save banner and submit error Submit can leave behind. Content checks live in
 * `mentorship-admin-enroll-create.spec.ts`; this spec pins the data-testid contract and the nesting.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Page, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import {
  completeEnrollDetailsStep,
  fillEnrollWizardToSubmit,
  stubEnrollCreateWrites,
  stubEnrollImportReads,
  stubEnrollWizardReads,
} from './helpers/mentorship-admin-enroll.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(90_000);

test.use({ viewport: { width: 1440, height: 900 } });

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openWizard(page: Page): Promise<void> {
  await stubEnrollWizardReads(page, fulfillJson);
  await stubEnrollImportReads(page, fulfillJson);
  await openMentorPage(page, '/mentorship/admin/enroll');
  await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
}

test.describe('Admin enroll wizard — term dialog structure', () => {
  test('nests the name, the four month and year selects, both application dates and submit in the dialog', async ({ page }) => {
    await openWizard(page);
    await completeEnrollDetailsStep(page, 'Acme Rocket Mentorship');

    await page.getByTestId('mentorship-enroll-add-term').getByRole('button').click();

    const dialog = page.getByTestId('mentorship-enroll-term-dialog');
    await expect(dialog).toBeVisible();
    for (const id of [
      'dialog-term-name',
      'dialog-term-start-month',
      'dialog-term-start-year',
      'dialog-term-end-month',
      'dialog-term-end-year',
      'dialog-term-application-start',
      'dialog-term-application-end',
    ]) {
      await expect(dialog.locator(`#${id}`)).toHaveCount(1);
    }
    await expect(dialog.getByTestId('mentorship-enroll-term-submit')).toBeVisible();
  });

  test('keeps the dialog open with its required-field errors when submitted empty', async ({ page }) => {
    await openWizard(page);
    await completeEnrollDetailsStep(page, 'Acme Rocket Mentorship');
    await page.getByTestId('mentorship-enroll-add-term').getByRole('button').click();

    await page.getByTestId('mentorship-enroll-term-submit').getByRole('button').click();

    const dialog = page.getByTestId('mentorship-enroll-term-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Term name is required.')).toBeVisible();
    await expect(dialog.getByText('Application start date is required.')).toBeVisible();
  });
});

test.describe('Admin enroll wizard — submit outcome structure', () => {
  test('nests the replacement logo input and Retry inside the partial-save banner, with no submit error', async ({ page }) => {
    await openWizard(page);
    await stubEnrollCreateWrites(page, fulfillJson, { logoStatuses: [415] });
    await fillEnrollWizardToSubmit(page, 'Acme Rocket Mentorship');

    await page.getByTestId('mentorship-enroll-next').getByRole('button').click();

    const banner = page.getByTestId('mentorship-enroll-partial-save');
    await expect(banner).toHaveAttribute('role', 'alert');
    await expect(banner.getByTestId('mentorship-enroll-partial-save-logo-input')).toHaveAttribute('type', 'file');
    await expect(banner.getByTestId('mentorship-enroll-partial-save-retry')).toBeVisible();
    await expect(page.getByTestId('mentorship-enroll-submit-error')).toHaveCount(0);
    // The program exists now, so Back is off: leaving would drop the logo retry.
    await expect(page.getByTestId('mentorship-enroll-back').getByRole('button')).toBeDisabled();
  });

  test('announces a failed create as an alert, with no partial-save banner', async ({ page }) => {
    await openWizard(page);
    await stubEnrollCreateWrites(page, fulfillJson, { createStatus: 500 });
    await fillEnrollWizardToSubmit(page, 'Acme Rocket Mentorship');

    await page.getByTestId('mentorship-enroll-next').getByRole('button').click();

    await expect(page.getByTestId('mentorship-enroll-submit-error')).toHaveAttribute('role', 'alert');
    await expect(page.getByTestId('mentorship-enroll-partial-save')).toHaveCount(0);
  });
});
