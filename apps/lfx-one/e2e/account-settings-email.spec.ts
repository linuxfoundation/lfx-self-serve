// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Account Settings — email management, content spec (#1852).
 *
 * Drives the Email Settings section of /profile/settings through the meeting-invitation
 * preference workflow: choosing an alternate address, resetting to the primary via the
 * sentinel, the delete guard, the cross-row in-flight lock, and the 400-only validation
 * banner. The email API surface is mocked (see helpers/account-settings-email.helper.ts)
 * so the spec doesn't depend on a seeded backend test user.
 *
 * Prerequisites:
 *   - Dev server reachable at the Playwright baseURL (default http://localhost:4200)
 *   - apps/lfx-one/.env populated with TEST_USERNAME / TEST_PASSWORD (see global-setup.ts)
 */

import { expect, test } from '@playwright/test';

import {
  ALTERNATE_EMAIL,
  closeRowMenu,
  DELETE_BLOCKED_BY_INVITE_TITLE,
  DELETE_BLOCKED_BY_SAVE_TITLE,
  ELEMENT_TIMEOUT,
  emailRow,
  INVITE_VALIDATION_MESSAGE,
  MEETING_INVITE_PRIMARY_SENTINEL,
  MENU_DELETE,
  MENU_MAKE_PRIMARY,
  MENU_RESET_TO_PRIMARY,
  MENU_USE_FOR_INVITES,
  menuItem,
  openEmailSettings,
  openRowMenu,
  PRIMARY_EMAIL,
  SECOND_ALTERNATE_EMAIL,
} from './helpers/account-settings-email.helper';

test.setTimeout(60_000);

const INVITE_BADGE = 'meeting-invites-badge';
const ERROR_BANNER = 'meeting-invite-error-banner';
const SUPPORT_BUTTON = { name: 'contact support' } as const;

test.describe('Account Settings — Email Management', () => {
  test.describe('Meeting-invitation selection', () => {
    test('sets an alternate address as the meeting-invitation email', async ({ page }) => {
      const mocks = await openEmailSettings(page);

      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId(INVITE_BADGE)).toHaveCount(0);

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId(INVITE_BADGE)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(emailRow(page, PRIMARY_EMAIL).getByTestId(INVITE_BADGE)).toHaveCount(0);
      expect(mocks.putBodies()).toEqual([{ email: ALTERNATE_EMAIL }]);
    });

    test('refreshes the badge from a refetch, not from optimistic rendering', async ({ page }) => {
      const mocks = await openEmailSettings(page);
      const initialInviteGets = mocks.inviteGetCount();

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();
      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId(INVITE_BADGE)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

      // The badge is only reachable through the post-write emailRefresh refetch — a purely
      // optimistic render would leave the GET count untouched.
      expect(mocks.inviteGetCount()).toBeGreaterThan(initialInviteGets);
    });

    test('resets to the primary address via the sentinel', async ({ page }) => {
      const mocks = await openEmailSettings(page, { initialInvite: { email_id: 'email-id-alt', email: ALTERNATE_EMAIL } });

      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId(INVITE_BADGE)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

      await openRowMenu(page, PRIMARY_EMAIL);
      await menuItem(page, MENU_RESET_TO_PRIMARY).click();

      await expect(page.locator(`[data-testid="${INVITE_BADGE}"]`)).toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
      expect(mocks.putBodies()).toEqual([{ email: MEETING_INVITE_PRIMARY_SENTINEL }]);
    });

    test('offers no no-op invite action on the row that already holds the override', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: { email_id: 'email-id-alt', email: ALTERNATE_EMAIL } });

      await openRowMenu(page, ALTERNATE_EMAIL);
      await expect(menuItem(page, MENU_USE_FOR_INVITES)).toHaveCount(0);
      await expect(menuItem(page, MENU_RESET_TO_PRIMARY)).toHaveCount(0);
      // The row still offers its unrelated actions, so the absence above isn't an empty menu.
      await expect(menuItem(page, MENU_MAKE_PRIMARY)).toBeVisible();
    });

    test('offers no reset action while the primary address is already in effect', async ({ page }) => {
      await openEmailSettings(page);

      // With no override the primary row has no actions at all, so no kebab renders for it.
      await expect(page.getByTestId(`email-menu-${PRIMARY_EMAIL}`)).toHaveCount(0);
    });
  });

  test.describe('Delete guard', () => {
    test('disables Delete on the meeting-invitation address and explains why', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: { email_id: 'email-id-alt', email: ALTERNATE_EMAIL } });

      await openRowMenu(page, ALTERNATE_EMAIL);
      const blocked = menuItem(page, MENU_DELETE);
      await expect(blocked).toHaveAttribute('aria-disabled', 'true');
      await expect(blocked.locator('a')).toHaveAttribute('title', DELETE_BLOCKED_BY_INVITE_TITLE);
    });

    test('leaves Delete enabled on the other alternate address', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: { email_id: 'email-id-alt', email: ALTERNATE_EMAIL } });

      await openRowMenu(page, SECOND_ALTERNATE_EMAIL);
      await expect(menuItem(page, MENU_DELETE)).toHaveAttribute('aria-disabled', 'false');
    });

    test('offers no Delete on the primary address', async ({ page }) => {
      await openEmailSettings(page, { initialInvite: { email_id: 'email-id-alt', email: ALTERNATE_EMAIL } });

      await openRowMenu(page, PRIMARY_EMAIL);
      await expect(menuItem(page, MENU_DELETE)).toHaveCount(0);
    });
  });

  test.describe('Write in flight', () => {
    test('locks every row while the preference write is pending', async ({ page }) => {
      const mocks = await openEmailSettings(page);
      const releasePut = mocks.holdPut();

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      // The lock is deliberately global, not per-row: a *different* row is checked here.
      await openRowMenu(page, SECOND_ALTERNATE_EMAIL);
      await expect(menuItem(page, MENU_USE_FOR_INVITES)).toHaveAttribute('aria-disabled', 'true');
      const blocked = menuItem(page, MENU_DELETE);
      await expect(blocked).toHaveAttribute('aria-disabled', 'true');
      await expect(blocked.locator('a')).toHaveAttribute('title', DELETE_BLOCKED_BY_SAVE_TITLE);

      await closeRowMenu(page);
      releasePut();
      await expect(emailRow(page, ALTERNATE_EMAIL).getByTestId(INVITE_BADGE)).toBeVisible({ timeout: ELEMENT_TIMEOUT });

      await openRowMenu(page, SECOND_ALTERNATE_EMAIL);
      await expect(menuItem(page, MENU_USE_FOR_INVITES)).toHaveAttribute('aria-disabled', 'false');
      await expect(menuItem(page, MENU_DELETE)).toHaveAttribute('aria-disabled', 'false');
    });
  });

  test.describe('Validation banner', () => {
    test('surfaces a 400 from the preference endpoint inline and dismisses it', async ({ page }) => {
      await openEmailSettings(page, { putBehavior: { kind: 'error', status: 400, message: INVITE_VALIDATION_MESSAGE } });

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      const banner = page.getByTestId(ERROR_BANNER);
      await expect(banner).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(banner).toContainText(INVITE_VALIDATION_MESSAGE);
      await expect(banner.getByRole('button', SUPPORT_BUTTON)).toBeVisible();
      // A rejected write must not move the badge.
      await expect(page.locator(`[data-testid="${INVITE_BADGE}"]`)).toHaveCount(0);

      await banner.getByRole('button', { name: 'Close' }).click();
      await expect(banner).toHaveCount(0, { timeout: ELEMENT_TIMEOUT });
    });

    test('routes a non-validation failure to a toast rather than the inline banner', async ({ page }) => {
      const unavailable = 'Meeting service is temporarily unavailable. Try again shortly.';
      await openEmailSettings(page, { putBehavior: { kind: 'error', status: 503, message: unavailable } });

      await openRowMenu(page, ALTERNATE_EMAIL);
      await menuItem(page, MENU_USE_FOR_INVITES).click();

      await expect(page.getByText(unavailable)).toBeVisible({ timeout: ELEMENT_TIMEOUT });
      await expect(page.getByTestId(ERROR_BANNER)).toHaveCount(0);
    });
  });
});
