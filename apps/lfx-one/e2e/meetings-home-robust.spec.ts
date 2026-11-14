// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Me lens meetings home page (#4883): data-testid and ARIA contract, meetings-redesign flag on, synthetic feeds.
 * Requires the authenticated storage state from global setup; skips without credentials.
 */
import { expect, Locator, test } from '@playwright/test';

import { MEETINGS_HOME_TITLES as TITLES } from './fixtures/mock-data';
import { gotoMeetingsHome, homeRow, homeRows, MEETINGS_HOME_TEST_OPTIONS, rightColumn } from './helpers/meetings-home.helper';

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  await expect(locator).toBeVisible();
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect as { x: number; y: number; width: number; height: number };
}

/** Top and bottom of the row's date tile, which marks the row's first grid line. */
async function firstLine(row: Locator): Promise<{ top: number; bottom: number }> {
  const date = await box(row.getByTestId('meetings-home-row-date'));
  return { top: date.y, bottom: date.y + date.height };
}

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
      await expect(groups).toHaveCount(5);
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

      await expect(homeRows(page)).toHaveCount(5);
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

    test('Pending RSVPs opens a drawer of rows with a date tile, title link and RSVP buttons', async ({ page }) => {
      await gotoMeetingsHome(page);

      // The modal hides the page behind it, opener included, from the accessibility tree.
      const button = page.getByTestId('meetings-home-pending-rsvps-button').getByRole('button', { includeHidden: true });
      await button.click();
      const drawer = page.getByRole('dialog', { name: 'Pending RSVPs' });
      await expect(drawer.getByTestId('ui-drawer')).toBeVisible();
      await expect(button).toHaveAttribute('aria-expanded', 'true');
      const row = drawer.getByTestId('meetings-home-pending-rsvps-row').first();
      for (const id of ['meetings-home-pending-rsvps-row-date-month', 'meetings-home-pending-rsvps-row-date-day', 'meetings-home-pending-rsvps-row-title']) {
        await expect(row.getByTestId(id)).toBeVisible();
      }
      await expect(row.getByTestId('meetings-home-rsvp-accepted')).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      await expect(button).toBeFocused();
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

  // The narrowest centres beside the right column: 1025-1059px on the navbar rail, 1200px docked open.
  for (const width of [1025, 1059, 1200, 1280]) {
    test.describe(`Tabs bar at ${width}px`, () => {
      test.use({ viewport: { width, height: 900 } });

      test('the tabs, search and Filters share one line without overflowing', async ({ page, isMobile }) => {
        test.skip(isMobile, 'A touch device docks the navbar open; covered by the touch tablet case');
        await gotoMeetingsHome(page);

        const bar = page.getByTestId('meetings-redesign-tabs-bar');
        const tabs = await box(page.getByTestId('meetings-redesign-tabs').getByRole('tablist'));
        const search = await box(page.getByTestId('meetings-redesign-search'));
        const filters = await box(page.getByTestId('meetings-home-filters-button'));
        expect(search.y).toBeLessThan(tabs.y + tabs.height);
        expect(filters.y).toBeLessThan(tabs.y + tabs.height);
        expect(search.x).toBeGreaterThanOrEqual(tabs.x + tabs.width);
        expect(filters.x).toBeGreaterThanOrEqual(search.x + search.width);
        expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      });
    });
  }

  test.describe('Tabs bar on a 1025px touch tablet', () => {
    test.use({ viewport: { width: 1025, height: 900 }, isMobile: true, hasTouch: true });
    test.skip(({ browserName }) => browserName === 'firefox', 'Firefox has no mobile emulation');

    test('the navbar stays docked, so search and Filters wrap under the tabs inside the bar', async ({ page }) => {
      await gotoMeetingsHome(page);

      const bar = await box(page.getByTestId('meetings-redesign-tabs-bar'));
      const tabs = await box(page.getByTestId('meetings-redesign-tabs').getByRole('tablist'));
      const search = await box(page.getByTestId('meetings-redesign-search'));
      const filters = await box(page.getByTestId('meetings-home-filters-button'));
      expect(search.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
      expect(filters.y).toBeLessThan(search.y + search.height);
      expect(search.x).toBeGreaterThanOrEqual(bar.x);
      expect(filters.x + filters.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
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
      await expect(homeRows(page)).toHaveCount(5);
    });

    test('a centre wider than 860px keeps the folded cards side by side and each row on one flex line', async ({ page, isMobile }) => {
      test.skip(isMobile, 'The mobile shell leaves the centre narrower than 861px at this width');
      await gotoMeetingsHome(page);

      const next = await box(page.getByTestId('meetings-redesign-folded-next-meeting'));
      const last = await box(page.getByTestId('meetings-redesign-folded-last-meeting'));
      expect(last.x).toBeGreaterThanOrEqual(next.x + next.width);
      expect(last.y).toBeLessThan(next.y + next.height);

      const row = homeRow(page, TITLES.oneOff);
      await expect(row).toHaveCSS('display', 'flex');
      const line = await firstLine(row);
      expect((await box(row.getByTestId('meetings-home-row-rsvp-cell'))).y).toBeLessThan(line.bottom);
    });
  });

  test.describe('Row grid in a centre of 860px or less', () => {
    test.use({ viewport: { width: 900, height: 900 } });

    test('upcoming rows keep RSVP and the menu on the first line', async ({ page }) => {
      await gotoMeetingsHome(page);

      const row = homeRow(page, TITLES.oneOff);
      await expect(row).toHaveCSS('display', 'grid');
      const line = await firstLine(row);
      const rsvp = await box(row.getByTestId('meetings-home-row-rsvp-cell'));
      const menu = await box(row.getByTestId('meetings-home-row-actions-trigger'));
      expect(rsvp.y).toBeLessThan(line.bottom);
      expect(menu.y).toBeLessThan(line.bottom);
      expect(menu.x).toBeGreaterThanOrEqual(rsvp.x + rsvp.width);
    });

    test('past rows keep Recording and AI Summary on the first line, before the menu', async ({ page }) => {
      await gotoMeetingsHome(page, { query: '?time=past' });

      const row = homeRow(page, TITLES.pastRecent);
      await expect(row).toHaveCSS('display', 'grid');
      const line = await firstLine(row);
      const artifacts = await box(row.getByTestId('meetings-home-row-artifacts'));
      const menu = await box(row.getByTestId('meetings-home-row-actions-trigger'));
      expect(artifacts.y).toBeLessThan(line.bottom);
      expect(menu.y).toBeLessThan(line.bottom);
      expect(menu.x).toBeGreaterThanOrEqual(artifacts.x + artifacts.width);
    });
  });

  test.describe('Layout at 640px', () => {
    test.use({ viewport: { width: 640, height: 900 } });

    test('the folded cards stack and Filters wraps below the full-width search', async ({ page }) => {
      await gotoMeetingsHome(page);

      const next = await box(page.getByTestId('meetings-redesign-folded-next-meeting'));
      const last = await box(page.getByTestId('meetings-redesign-folded-last-meeting'));
      expect(last.y).toBeGreaterThanOrEqual(next.y + next.height);

      const search = await box(page.getByTestId('meetings-redesign-search'));
      expect((await box(page.getByTestId('meetings-home-filters-button'))).y).toBeGreaterThanOrEqual(search.y + search.height);
      expect(Math.abs(search.width - (await box(page.getByTestId('meetings-redesign-tabs-bar'))).width)).toBeLessThanOrEqual(1);
    });
  });

  test.describe('Layout at 480px', () => {
    test.use({ viewport: { width: 480, height: 900 } });

    test('RSVP drops below the date while the menu stays on the first line', async ({ page }) => {
      await gotoMeetingsHome(page);

      const row = homeRow(page, TITLES.oneOff);
      const line = await firstLine(row);
      expect((await box(row.getByTestId('meetings-home-row-rsvp-cell'))).y).toBeGreaterThanOrEqual(line.bottom);
      expect((await box(row.getByTestId('meetings-home-row-actions-trigger'))).y).toBeLessThan(line.bottom);
    });

    test('Pending RSVPs drawer rows put Yes / Maybe / No on a second line, right-aligned', async ({ page }) => {
      // No slide-in, so every box is read from the settled drawer.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await gotoMeetingsHome(page);

      await page.getByTestId('meetings-home-pending-rsvps-button').click();
      const row = page.getByRole('dialog', { name: 'Pending RSVPs' }).getByTestId('meetings-home-pending-rsvps-row').first();
      const title = await box(row.getByTestId('meetings-home-pending-rsvps-row-title'));
      const rsvp = await box(row.getByTestId('meetings-home-rsvp'));
      const rowBox = await box(row);
      expect(rsvp.y).toBeGreaterThan(title.y + title.height);
      expect(Math.abs(rowBox.x + rowBox.width - (rsvp.x + rsvp.width))).toBeLessThanOrEqual(1);
    });
  });
});
