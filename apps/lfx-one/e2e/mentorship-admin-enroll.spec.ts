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
import { stubEnrollWizardReads } from './helpers/mentorship-admin-enroll.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const ENROLL_URL = '/mentorship/admin/enroll';
const PROGRAM_NAME = 'Acme Rocket Mentorship';

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function openWizard(page: Page): Promise<void> {
  await enableMentorshipFlag(page);
  await stubEnrollWizardReads(page, fulfillJson);
  await openMentorPage(page, ENROLL_URL);
  await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
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
