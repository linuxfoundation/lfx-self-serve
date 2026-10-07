// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Admin enroll wizard — structural / data-testid contract (linuxfoundation/lfx-mentorship#259).
 *
 * Companion to `mentorship-admin-enroll.spec.ts` (content). This spec asserts, by testid and role rather than
 * copy, that the wizard shell renders its stepper, first step and footer buttons, that the submit button is idle
 * (not loading) on a fresh wizard, and that the partial-save banner is absent until a program is saved. Every read
 * is stubbed with synthetic data and reached by client-side navigation; no write is sent.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (tests skip otherwise)
 */

import { expect, Route, test } from '@playwright/test';

import { skipWhenAuthMissing } from './helpers/auth.helper';
import { enableMentorshipFlag, MENTOR_PAGE_LOAD_TIMEOUT, openMentorPage } from './helpers/mentor-profile.helper';
import { stubEnrollWizardReads } from './helpers/mentorship-admin-enroll.helper';

test.beforeEach(() => skipWhenAuthMissing());

test.setTimeout(60_000);

// The sidebar `openMentorPage` waits on is `hidden lg:flex`, so pin a desktop viewport.
test.use({ viewport: { width: 1440, height: 900 } });

const fulfillJson = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

test.describe('Admin enroll wizard — structure', () => {
  test.beforeEach(async ({ page }) => {
    await enableMentorshipFlag(page);
    await stubEnrollWizardReads(page, fulfillJson);
    await openMentorPage(page, '/mentorship/admin/enroll');
    await expect(page.getByTestId('mentorship-enroll-title')).toBeVisible({ timeout: MENTOR_PAGE_LOAD_TIMEOUT });
  });

  test('renders the stepper, the details step and both footer buttons', async ({ page }) => {
    await expect(page.getByTestId('mentorship-enroll-stepper')).toBeVisible();
    await expect(page.getByTestId('mentorship-enroll-details')).toBeVisible();
    await expect(page.getByTestId('mentorship-enroll-back').getByRole('button')).toBeVisible();
    await expect(page.getByTestId('mentorship-enroll-next').getByRole('button')).toBeVisible();
  });

  test('leaves the footer buttons enabled and not busy before anything is submitted', async ({ page }) => {
    await expect(page.getByTestId('mentorship-enroll-back').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mentorship-enroll-next').getByRole('button')).toBeEnabled();
    await expect(page.getByTestId('mentorship-enroll-next').getByRole('button')).not.toHaveAttribute('aria-busy', 'true');
  });

  test('shows neither the partial-save banner nor a submit error on a fresh wizard', async ({ page }) => {
    await expect(page.getByTestId('mentorship-enroll-partial-save')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-enroll-partial-save-retry')).toHaveCount(0);
    await expect(page.getByTestId('mentorship-enroll-submit-error')).toHaveCount(0);
  });

  test('gives the leave prompt a Stay button and an accept button', async ({ page }) => {
    await page.locator('#name').fill('Acme Rocket Mentorship');
    await page.getByTestId('mentorship-enroll-back-to-programs').click();

    const confirmation = page.locator('.p-confirmdialog');
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button')).toHaveCount(2);
    await expect(confirmation.getByRole('button', { name: 'Stay', exact: true })).toBeVisible();
  });
});
