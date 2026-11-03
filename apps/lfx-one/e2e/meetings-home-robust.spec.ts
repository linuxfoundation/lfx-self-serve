// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me lens meetings home page (#4883): data-testid and ARIA contract, meetings-redesign flag on, synthetic feeds.
 * Requires the authenticated storage state from global setup; skips without credentials.
 */
import { expect, test } from '@playwright/test';

import { MEETINGS_HOME_TITLES as TITLES } from './fixtures/mock-data';
import { gotoMeetingsHome, homeRow, homeRows, MEETINGS_HOME_TEST_OPTIONS, rightColumn } from './helpers/meetings-home.helper';

test.describe('Meetings home page - Robust Tests', () => {
  test.use(MEETINGS_HOME_TEST_OPTIONS);
  test.setTimeout(90_000);

  test.describe('Page structure', () => {
    test('header, tabs, list and right column carry their testids and roles', async ({ page }) => {
      await gotoMeetingsHome(page);

      const title = page.getByTestId('meetings-redesign-title');
      await expect(title).toBeVisible();
      expect(await title.evaluate((el) => el.tagName)).toBe('H1');
      await expect(page.getByTestId('meetings-redesign-header-actions').getByTestId('meetings-home-pending-rsvps-button')).toBeVisible();

      await expect(page.getByTestId('meetings-redesign-tabs').getByRole('tablist', { name: 'Meetings' })).toBeVisible();
      for (const tab of ['upcoming', 'past']) {
        await expect(page.locator(`#meetings-redesign-tab-${tab}`)).toHaveAttribute('aria-controls', `meetings-redesign-panel-${tab}`);
        await expect(page.locator(`#meetings-redesign-panel-${tab}`)).toHaveAttribute('role', 'tabpanel');
      }
      await expect(page.getByTestId('ui-tab-count-upcoming')).toHaveText('5');
      await expect(page.getByTestId('ui-tab-count-past')).toHaveText('2');
      await expect(page.getByTestId('meetings-redesign-list-past')).toBeHidden();

      await expect(page.getByTestId('meetings-redesign-search').getByRole('searchbox')).toBeVisible();
      await expect(page.getByTestId('meetings-home-filters-button').getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog');

      const rail = rightColumn(page);
      await expect(rail).toHaveAttribute('aria-label', 'Meeting highlights');
      await expect(rail.getByTestId('meetings-redesign-rail-next-meeting').getByTestId('meetings-home-next-card')).toBeVisible();
      await expect(rail.getByTestId('meetings-home-next-card-join')).toBeVisible();
      await expect(rail.getByTestId('meetings-redesign-rail-last-meeting').getByTestId('meetings-home-last-card')).toBeVisible();
      // Folded into the centre only at 1024px and below.
      await expect(page.getByTestId('meetings-redesign-folded-rail')).toBeHidden();
    });

    test('day groups hold a separator and one list item per row', async ({ page }) => {
      await gotoMeetingsHome(page);

      const groups = page.getByTestId('meetings-home-list').getByTestId('meetings-home-day-group');
      await expect(groups).toHaveCount(4);
      for (const group of await groups.all()) {
        await expect(group.getByTestId('meetings-home-day-group-separator').getByRole('heading', { level: 2 })).toBeVisible();
        await expect(group.getByTestId('meetings-home-day-group-count')).toHaveText(/^1\b/);
        await expect(group.getByTestId('meetings-home-day-group-row')).toHaveCount(1);
      }
      expect(
        await page
          .getByTestId('meetings-home-day-group-row')
          .first()
          .evaluate((el) => el.tagName)
      ).toBe('LI');
    });

    test('rows expose date, title and actions, with RSVP controls only where the viewer can answer', async ({ page }) => {
      await gotoMeetingsHome(page);

      await expect(homeRows(page)).toHaveCount(4);
      for (const row of await homeRows(page).all()) {
        for (const id of ['meetings-home-row-date-month', 'meetings-home-row-date-day', 'meetings-home-row-title', 'meetings-home-row-actions-trigger']) {
          await expect(row.getByTestId(id)).toBeVisible();
        }
      }

      const oneOff = homeRow(page, TITLES.oneOff);
      for (const response of ['accepted', 'declined', 'maybe']) {
        await expect(oneOff.getByTestId(`meetings-home-rsvp-${response}`)).toBeVisible();
      }
      await expect(homeRow(page, TITLES.other).getByTestId('meetings-home-rsvp')).toHaveCount(0);
      await expect(homeRow(page, TITLES.series).first().getByTestId('meetings-home-row-recurring')).toBeVisible();
    });
  });

  test.describe('Overlays', () => {
    test('Filters popover has every Upcoming control and a disabled Apply until the draft changes', async ({ page }) => {
      await gotoMeetingsHome(page);

      await page.getByTestId('meetings-home-filters-button').click();
      const panel = page.getByRole('dialog', { name: 'Filters' }).getByTestId('meetings-home-filters-panel');
      for (const id of ['project', 'type', 'rsvp', 'organized', 'hide-declined']) {
        await expect(panel.getByTestId(`meetings-home-filters-${id}`)).toBeVisible();
      }
      await expect(panel.getByRole('switch')).toHaveCount(2);
      await expect(panel.getByTestId('meetings-home-filters-apply').getByRole('button')).toBeDisabled();
      await expect(panel.getByTestId('meetings-home-filters-reset')).toHaveCount(0);
    });

    test('Past Filters popover has only Project and Meeting type', async ({ page }) => {
      await gotoMeetingsHome(page, { query: '?time=past' });

      await page.getByTestId('meetings-home-filters-button').click();
      const panel = page.getByTestId('meetings-home-filters-panel');
      await expect(panel.getByTestId('meetings-home-filters-project')).toBeVisible();
      await expect(panel.getByTestId('meetings-home-filters-type')).toBeVisible();
      await expect(panel.getByTestId('meetings-home-filters-rsvp')).toHaveCount(0);
      await expect(panel.getByRole('switch')).toHaveCount(0);
    });

    test('recurring RSVP scope modal is a dialog with three scope radios and OK / Cancel', async ({ page }) => {
      await gotoMeetingsHome(page);

      await homeRow(page, TITLES.series).first().getByTestId('meetings-home-rsvp-accepted').click();
      const modal = page.getByTestId('meetings-home-rsvp-scope-modal');
      await expect(page.getByRole('dialog').filter({ has: modal })).toBeVisible();
      for (const scope of ['single', 'this_and_following', 'all']) {
        await expect(modal.getByTestId(`meetings-home-rsvp-scope-${scope}`)).toBeVisible();
      }
      await expect(modal.getByRole('radiogroup', { name: 'Apply RSVP to' })).toBeVisible();
      await expect(modal.getByTestId('meetings-home-rsvp-scope-ok')).toBeVisible();
      await expect(modal.getByTestId('meetings-home-rsvp-scope-cancel')).toBeVisible();
    });

    test('row menu is a menu with Copy Link', async ({ page }) => {
      await gotoMeetingsHome(page);

      await homeRow(page, TITLES.other).getByTestId('meetings-home-row-actions-trigger').click();
      const menu = page.getByRole('menu', { name: 'Meeting actions' });
      await expect(menu).toBeVisible();
      await expect(menu.getByTestId('meetings-home-row-actions-copy-link')).toHaveAttribute('role', 'menuitem');
      // Not invited: nothing to resend or remove.
      await expect(menu.getByTestId('meetings-home-row-actions-remove')).toHaveCount(0);
    });
  });

  test.describe('Empty states', () => {
    test('empty Upcoming replaces the list and hides search and filters', async ({ page }) => {
      await gotoMeetingsHome(page, { emptyUpcoming: true });

      await expect(page.getByTestId('meetings-home-empty-upcoming')).toBeVisible();
      await expect(page.getByTestId('meetings-home-list')).toHaveCount(0);
      await expect(page.getByTestId('meetings-redesign-search')).toHaveCount(0);
      await expect(page.getByTestId('meetings-home-filters-button')).toHaveCount(0);
      await expect(rightColumn(page).getByTestId('meetings-home-next-card-empty')).toBeVisible();
    });

    test('no results state carries the reset action', async ({ page }) => {
      await gotoMeetingsHome(page);

      await page.getByTestId('meetings-redesign-search').getByRole('searchbox').fill('zzz-no-such-meeting');
      await expect(page.getByTestId('meetings-home-no-results')).toBeVisible();
      await expect(page.getByTestId('meetings-home-no-results-reset').getByRole('button')).toBeEnabled();
      await expect(page.getByTestId('meetings-home-list')).toHaveCount(0);
    });
  });

  test.describe('Folded layout at 1024px', () => {
    test.use({ viewport: { width: 1024, height: 900 } });

    test('the right column folds into the centre above the tabs', async ({ page }) => {
      await gotoMeetingsHome(page);

      const folded = page.getByTestId('meetings-redesign-folded-rail');
      await expect(rightColumn(page)).toBeHidden();
      await expect(folded.getByTestId('meetings-redesign-folded-next-meeting').getByTestId('meetings-home-next-card')).toBeVisible();
      await expect(folded.getByTestId('meetings-redesign-folded-last-meeting').getByTestId('meetings-home-last-card')).toBeVisible();
      await expect(page.getByTestId('meetings-redesign-description')).toBeHidden();
      await expect(homeRows(page)).toHaveCount(4);
    });
  });
});
