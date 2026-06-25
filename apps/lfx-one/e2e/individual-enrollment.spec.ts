// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Generated with [Claude Code](https://claude.ai/code)

import { expect, Page, test } from '@playwright/test';

const ENROLLMENT_URL = '/profile/individual-enrollment';
const DATA_LOAD_TIMEOUT = 15_000;
const MEMBERSHIP_ID = 'test-membership-stripe-001';

test.setTimeout(60_000);

/** Mock enrollment response with an active Stripe membership — auto-renew enabled. */
const stripeActiveMembership = [
  {
    projectName: 'The Linux Foundation',
    projectSlug: 'tlf',
    ProductName: 'The Linux Foundation Individual Supporter',
    projectDesc: 'Test project description.',
    enrollButton: 'Enroll as an Individual Supporter',
    price: 99,
    projectLogo: 'https://lf-master-project-logos-prod.s3.us-east-2.amazonaws.com/thelinuxfoundation-color.svg',
    benefits: ['Weekly newsletter', 'Up to 10% discount on training courses'],
    projectId: 'a0941000002wBz9AAE',
    productSFID: 'a0I2M00000PQymQUAT',
    productId: '01t2M000005wBb0QAE',
    ctaPath: '?product=01t2M000005wBb0QAE&project=tlf',
    activeButtonText: '',
    activeButtonURL: '',
    membership: {
      Status: 'Active',
      AutoRenew: true,
      PurchaseDate: '2025-06-01',
      EndDate: '2027-06-01',
      Price: 99,
      ID: MEMBERSHIP_ID,
      ExtPaymentType: 'stripe',
    },
  },
];

/** Same membership but AutoRenew: false. */
const stripeActiveMembershipAutoRenewOff = [{ ...stripeActiveMembership[0], membership: { ...stripeActiveMembership[0].membership, AutoRenew: false } }];

/** Builds a local YYYY-MM-DD string N days from today — keeps date-sensitive fixtures from going stale.
 *  Uses local getters to match parseLocalDateString, which builds dates as local midnight. */
function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/** Expired Stripe membership — displayStatus: 'Expired'. */
const expiredMembership = [
  {
    ...stripeActiveMembership[0],
    membership: { ...stripeActiveMembership[0].membership, Status: 'Expired' as const, AutoRenew: false, EndDate: '2024-01-01' },
  },
];

/** Expiring-soon Stripe membership (EndDate ~14 days out) — displayStatus: 'Expiring Soon'. */
const expiringSoonMembership = [
  {
    ...stripeActiveMembership[0],
    membership: { ...stripeActiveMembership[0].membership, Status: 'Active' as const, AutoRenew: false, EndDate: daysFromNow(14) },
  },
];

/** Not-enrolled item (membership: null) — displayStatus: 'Not Enrolled'. */
const notEnrolledItem = [{ ...stripeActiveMembership[0], membership: null }];

async function setupStripeEnrollmentMock(page: Page, autoRenew = true): Promise<void> {
  const body = autoRenew ? stripeActiveMembership : stripeActiveMembershipAutoRenewOff;
  await page.route('**/api/enrollments', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function setupCustomEnrollmentMock(page: Page, body: unknown[]): Promise<void> {
  await page.route('**/api/enrollments', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function setupPatchMock(page: Page, status: 200 | 204 | 500 = 204): Promise<void> {
  await page.route(`**/api/enrollments/${MEMBERSHIP_ID}/auto-renew`, async (route) => {
    if (status === 500) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Upstream error' }) });
    } else {
      await route.fulfill({ status, body: '' });
    }
  });
}

async function gotoAndWaitForCard(page: Page): Promise<void> {
  await page.goto(ENROLLMENT_URL, { waitUntil: 'domcontentloaded' });
  await expect(page).not.toHaveURL(/auth0\.com/);
  await expect(page.getByTestId('individual-enrollment-card')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
}

/** The auto-renew action is a button (label "Enable auto-renew" / "Disable auto-renew"). */
function autoRenewControl(page: Page) {
  return page.getByTestId('individual-enrollment-auto-renew-toggle');
}

test.describe('Individual Enrollment — Content Tests', () => {
  test.describe('Page rendering', () => {
    test('shows enrollment card with product name and status', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      const card = page.getByTestId('individual-enrollment-card');
      await expect(card).toContainText('The Linux Foundation Individual Supporter');
      await expect(page.getByTestId('individual-enrollment-status')).toBeVisible();
    });

    test('shows enrollment dates and price', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      const details = page.getByTestId('individual-enrollment-details');
      await expect(details).toContainText('$99');
      await expect(details).toContainText('Purchased');
    });
  });

  test.describe('Auto-renew control visibility', () => {
    test('shows the auto-renew button for an active Stripe membership', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toBeVisible();
    });

    test('button reads "Disable auto-renew" when auto-renew is on', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toContainText('Disable auto-renew');
    });

    test('button reads "Enable auto-renew" when auto-renew is off', async ({ page }) => {
      await setupStripeEnrollmentMock(page, false);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toContainText('Enable auto-renew');
    });
  });

  test.describe('Disable auto-renew → accept', () => {
    test('confirm dialog appears after clicking Disable', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await setupPatchMock(page);
      await gotoAndWaitForCard(page);

      // Auto-renew is currently ON — click to disable
      await autoRenewControl(page).click();

      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.p-confirmdialog')).toContainText('Disable auto-renew');
    });

    test('accepting the dialog shows success toast', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await setupPatchMock(page);
      await gotoAndWaitForCard(page);

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

      // Click the accept button (acceptLabel "Disable auto-renew")
      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Disable/i })
        .click();

      // Toast should appear
      await expect(page.locator('.p-toast')).toContainText('Auto renew disabled successfully', { timeout: 10_000 });
    });

    test('accepting the dialog dismisses it', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await setupPatchMock(page);
      await gotoAndWaitForCard(page);

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Disable/i })
        .click();

      await expect(page.locator('.p-confirmdialog')).not.toBeVisible({ timeout: 5000 });
    });
  });

  test.describe('Disable auto-renew → cancel (reject)', () => {
    test('cancelling the dialog dismisses it without a toast', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Cancel/i })
        .click();

      await expect(page.locator('.p-confirmdialog')).not.toBeVisible({ timeout: 5000 });
      await expect(page.locator('.p-toast')).not.toBeVisible();
    });

    test('the card does not change until the dialog is confirmed', async ({ page }) => {
      await setupStripeEnrollmentMock(page, true); // AutoRenew: true → "Disable auto-renew"
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toContainText('Disable auto-renew');

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      // While the dialog is open, the card must NOT reflect the pending change
      await expect(autoRenewControl(page)).toContainText('Disable auto-renew');

      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Cancel/i })
        .click();
      await expect(page.locator('.p-confirmdialog')).not.toBeVisible({ timeout: 5000 });

      // After cancel, nothing changed
      await expect(autoRenewControl(page)).toContainText('Disable auto-renew');
    });
  });

  test.describe('Disable auto-renew → upstream error', () => {
    test('shows error toast on PATCH failure', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await setupPatchMock(page, 500);
      await gotoAndWaitForCard(page);

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Disable/i })
        .click();

      await expect(page.locator('.p-toast')).toContainText('Failed to update membership', { timeout: 10_000 });
    });

    test('reverts the button to its original label on PATCH failure', async ({ page }) => {
      await setupStripeEnrollmentMock(page, true); // AutoRenew: true
      await setupPatchMock(page, 500);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toContainText('Disable auto-renew');

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Disable/i })
        .click();

      // After error, the button reverts to "Disable auto-renew"
      await expect(autoRenewControl(page)).toContainText('Disable auto-renew', { timeout: 10_000 });
    });
  });

  test.describe('Enable auto-renew path (false → true)', () => {
    test('confirm dialog shows the Enable action when turning on', async ({ page }) => {
      await setupStripeEnrollmentMock(page, false); // AutoRenew: false → "Enable auto-renew"
      await setupPatchMock(page);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).toContainText('Enable auto-renew');
      await autoRenewControl(page).click();

      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('.p-confirmdialog')).toContainText('Enable auto-renew');
      await expect(page.locator('.p-confirmdialog').getByRole('button', { name: /Enable auto-renew/i })).toBeVisible();
    });

    test('accepting Enable shows success toast', async ({ page }) => {
      await setupStripeEnrollmentMock(page, false);
      await setupPatchMock(page);
      await gotoAndWaitForCard(page);

      await autoRenewControl(page).click();
      await expect(page.locator('.p-confirmdialog')).toBeVisible({ timeout: 5000 });

      await page
        .locator('.p-confirmdialog')
        .getByRole('button', { name: /Enable/i })
        .click();

      await expect(page.locator('.p-toast')).toContainText('Auto renew enabled successfully', { timeout: 10_000 });
    });
  });

  test.describe('Active card — benefits + chip', () => {
    test('shows all benefit strings in the benefits section', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      const benefits = page.getByTestId('individual-enrollment-benefits');
      await expect(benefits).toBeVisible();
      for (const benefit of stripeActiveMembership[0].benefits) {
        await expect(benefits).toContainText(benefit);
      }
    });

    test('status chip shows Active', async ({ page }) => {
      await setupStripeEnrollmentMock(page);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-status')).toContainText('Active');
    });
  });

  test.describe('Expired state', () => {
    test('chip text shows Expired', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiredMembership);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-status')).toContainText('Expired');
    });

    test('CTA shows Repurchase', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiredMembership);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-cta')).toContainText('Repurchase');
    });

    test('auto-renew control is not rendered', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiredMembership);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).not.toBeAttached();
    });

    test('the end date is labelled "Expired on"', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiredMembership);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-details')).toContainText('Expired on');
    });
  });

  test.describe('Expiring Soon state', () => {
    test('chip text shows Expiring Soon', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiringSoonMembership);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-status')).toContainText('Expiring Soon');
    });

    test('CTA shows Renew My Enrollment', async ({ page }) => {
      await setupCustomEnrollmentMock(page, expiringSoonMembership);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-cta')).toContainText('Renew My Enrollment');
    });
  });

  test.describe('Not Enrolled state', () => {
    test('card renders with Enroll CTA', async ({ page }) => {
      await setupCustomEnrollmentMock(page, notEnrolledItem);
      await gotoAndWaitForCard(page);

      await expect(page.getByTestId('individual-enrollment-cta')).toContainText('Enroll');
    });

    test('auto-renew control is not rendered', async ({ page }) => {
      await setupCustomEnrollmentMock(page, notEnrolledItem);
      await gotoAndWaitForCard(page);

      await expect(autoRenewControl(page)).not.toBeAttached();
    });
  });
});
