// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Account Settings — email management, structural spec (#1852).
 *
 * Asserts the data-testid contract the Email Settings section promises to maintain:
 * section/heading/card ids, per-address row and kebab ids, badge scoping, the loading
 * placeholder, and where the validation banner sits in the tree. Kept free of user-facing
 * copy so a wording change breaks only the content spec — the one exception is the kebab
 * popup, whose PrimeNG MenuItem model carries no testid and must be queried by role.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, test } from '@playwright/test';

import {
  ALTERNATE_EMAIL,
  DATA_LOAD_TIMEOUT,
  ELEMENT_TIMEOUT,
  emailRow,
  installEmailMocks,
  INVITE_VALIDATION_MESSAGE,
  MENU_USE_FOR_INVITES,
  menuItem,
  openEmailSettings,
  openRowMenu,
  PRIMARY_EMAIL,
  SECOND_ALTERNATE_EMAIL,
  skipWhenAuthMissing,
  suppressCookieBanner,
} from './helpers/account-settings-email.helper';

test.setTimeout(60_000);

const ALL_EMAILS = [PRIMARY_EMAIL, ALTERNATE_EMAIL, SECOND_ALTERNATE_EMAIL];
const INVITE_ON_ALTERNATE = { email_id: 'email-id-alt', email: ALTERNATE_EMAIL };

test.describe('Account Settings — Email Management — Robust Tests', () => {
  test.describe('Data-testid presence', () => {
    test.beforeEach(async ({ page }) => {
      await openEmailSettings(page);
    });

    test('exposes the section, heading and list card', async ({ page }) => {
      await expect(page.getByTestId('section-email-settings')).toBeAttached();
      await expect(page.getByTestId('email-settings-heading')).toBeAttached();
      await expect(page.getByTestId('email-list-card')).toBeAttached();
      await expect(page.getByTestId('email-settings-loading')).toHaveCount(0);
      await expect(page.getByTestId('no-emails-message')).toHaveCount(0);
    });

    test('renders one row per address, keyed by address', async ({ page }) => {
      await expect(page.locator('[data-testid^="email-row-"]')).toHaveCount(ALL_EMAILS.length);
      for (const email of ALL_EMAILS) {
        await expect(emailRow(page, email)).toBeAttached();
      }
    });

    test('scopes the primary and verified badges to the primary row', async ({ page }) => {
      await expect(page.getByTestId('primary-badge')).toHaveCount(1);
      await expect(emailRow(page, PRIMARY_EMAIL).getByTestId('primary-badge')).toBeAttached();
      await expect(page.getByTestId('verified-badge')).toHaveCount(ALL_EMAILS.length);
    });
  });

  test.describe('Loading state', () => {
    test('shows email-settings-loading before the list card', async ({ page }) => {
      skipWhenAuthMissing();
      await suppressCookieBanner(page);
      await installEmailMocks(page, { emailsDelayMs: 3_000 });
      await page.goto('/profile/settings', { waitUntil: 'domcontentloaded' });

      const loading = page.getByTestId('email-settings-loading');
      const card = page.getByTestId('email-list-card');
      await expect(loading).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(card).toHaveCount(0);

      await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
      await expect(loading).toHaveCount(0);
    });
  });

  test.describe('Meeting-invite badge contract', () => {
    test('attaches no invite badge while the primary address is in effect', async ({ page }) => {
      await openEmailSettings(page);
      await expect(page.getByTestId('meeting-invites-badge')).toHaveCount(0);
    });

    test('attaches exactly one invite badge, inside the overriding row', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: INVITE_ON_ALTERNATE });
      await expect(page.getByTestId('meeting-invites-badge')).toHaveCount(1);
      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId('meeting-invites-badge')).toBeAttached();
    });
  });

  test.describe('Menu trigger contract', () => {
    test('labels each kebab trigger with its address', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: INVITE_ON_ALTERNATE });
      for (const email of ALL_EMAILS) {
        await expect(page.getByTestId(`email-menu-${email}`).locator('button')).toHaveAttribute('aria-label', `Email actions for ${email}`);
      }
    });

    test('renders the popup outside its row (appendTo="body")', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: INVITE_ON_ALTERNATE });
      await openRowMenu(page, SECOND_ALTERNATE_EMAIL);

      await expect(menuItem(page, MENU_USE_FOR_INVITES)).toBeAttached();

      // Row-scoped queries would silently miss the popup — assert it really is detached from the row.
      const row = await emailRow(page, SECOND_ALTERNATE_EMAIL).elementHandle();
      const menu = await page.getByRole('menu').elementHandle();
      const nestedInRow = await page.evaluate(([rowEl, menuEl]) => rowEl!.contains(menuEl), [row, menu]);
      expect(nestedInRow).toBe(false);
    });
  });

  test.describe('Banner contract', () => {
    test('places the banner inside the section but outside the list card', async ({ page }) => {
      await openEmailSettings(page, { putBehavior: { kind: 'error', status: 400, message: INVITE_VALIDATION_MESSAGE } });

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      const banner = page.getByTestId('meeting-invite-error-banner');
      await expect(banner).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('section-email-settings').getByTestId('meeting-invite-error-banner')).toBeAttached();
      await expect(page.getByTestId('email-list-card').getByTestId('meeting-invite-error-banner')).toHaveCount(0);
    });

    test('attaches no banner on the success path', async ({ page }) => {
      await openEmailSettings(page);

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId('meeting-invites-badge')).toBeAttached({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId('meeting-invite-error-banner')).toHaveCount(0);
    });
  });
});
