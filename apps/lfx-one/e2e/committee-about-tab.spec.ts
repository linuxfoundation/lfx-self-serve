// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Group "About" tab E2E (LFXV2-1713). Deterministic via route mocks. */

import { expect, Page, test } from '@playwright/test';
import { skipWhenAuthMissing } from './helpers/auth.helper';

import {
  buildBaseCommittee,
  DATA_LOAD_TIMEOUT,
  gotoCommitteeTab as gotoCommitteeTabHelper,
  mockCommitteeApis as mockCommitteeApisHelper,
} from './helpers/committee-about.helper';

test.beforeEach(() => skipWhenAuthMissing());

const COMMITTEE_UID = 'e2e-about-committee';

function baseCommittee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return buildBaseCommittee(COMMITTEE_UID, overrides);
}

function mockCommitteeApis(page: Page, opts: { committee: Record<string, unknown>; meetings?: unknown[] }): Promise<void> {
  return mockCommitteeApisHelper(page, COMMITTEE_UID, opts);
}

function gotoCommitteeTab(page: Page, query = '?tab=about'): Promise<void> {
  return gotoCommitteeTabHelper(page, COMMITTEE_UID, query);
}

test.setTimeout(120_000);

test.describe('Group About tab (LFXV2-1713)', () => {
  test('visitor: About tab renders right after Overview (the only two tabs a visitor sees), edit affordances hidden, join CTA shown', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'open' }) });
    await gotoCommitteeTab(page);

    const tabsStrip = page.getByTestId('committee-view-tabs');
    await expect(tabsStrip).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const tabButtons = tabsStrip.locator('button');
    // Members/Votes/Meetings/Surveys/Documents/Settings are all isMemberOrAdmin()-gated, so a
    // visitor sees exactly these two tabs — pin the count, not just what isn't at some index.
    await expect(tabButtons).toHaveCount(2);
    await expect(tabButtons.nth(0)).toContainText('Overview');
    await expect(tabButtons.nth(1)).toContainText('About');

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about-edit-description-btn')).toHaveCount(0);
    await expect(page.getByTestId('committee-about-join-cta')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-visitor-cta')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-join-btn')).toBeVisible();
  });

  test('visitor of an invite-only group: sees the invite-only notice, not the join CTA', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'invite_only' }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('group-join-cta-invite-only-notice')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-visitor-cta')).toHaveCount(0);
  });

  test('visitor of an application-mode group: sees the apply CTA, not join or invite-only notice', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'application' }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('group-join-cta-application-cta')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-apply-btn')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-visitor-cta')).toHaveCount(0);
    await expect(page.getByTestId('group-join-cta-invite-only-notice')).toHaveCount(0);
  });

  test('visitor of a closed group: sees the closed notice on About and Overview', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'closed', public: true }) });
    await gotoCommitteeTab(page, '?tab=about');

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('group-join-cta-closed-notice')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-closed-notice')).toContainText('This group is closed');
    await expect(page.getByTestId('group-join-cta-closed-notice')).toContainText('admin must add you');
    await expect(page.getByTestId('group-join-cta-visitor-cta')).toHaveCount(0);
    await expect(page.getByTestId('group-join-cta-invite-only-notice')).toHaveCount(0);

    await gotoCommitteeTab(page, '?tab=overview');
    await expect(page.getByTestId('group-join-cta-closed-notice')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('member: no edit affordances, no join CTA', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about-edit-description-btn')).toHaveCount(0);
    await expect(page.getByTestId('committee-about-join-cta')).toHaveCount(0);
  });

  test('About tab: the header description/channels block is hidden (no duplicate content), and stays visible on Overview', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-view-description')).toHaveCount(0);
    await expect(page.getByTestId('committee-view-channels-card')).toHaveCount(0);

    await gotoCommitteeTab(page, '?tab=overview');
    await expect(page.getByTestId('committee-view-description')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-view-channels-card')).toBeVisible();
  });

  test('description empty state: shows "No description yet." when the committee has no description', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false, description: null }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about-description-card')).toContainText('No description yet.', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('channels empty state: an admin with no configured channels sees "No channels configured"', async ({ page }) => {
    await mockCommitteeApis(page, {
      committee: baseCommittee({ my_role: 'Chair', writer: true, chat_channel: null, website: null, mailing_list: null }),
    });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about-channels-card')).toContainText('No channels configured', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('admin (canEdit): edit description button is visible and opens the edit dialog', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Chair', writer: true }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const editBtn = page.getByTestId('committee-about-edit-description-btn');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Edit Description');
  });

  // These two exercise the actual editCharterRequested -> openEditCharter -> saveCharter wiring
  // through committee-view (unit-tested in isolation on the card and the dialog separately, but
  // not through this binding -- the PUT payload, the post-save refresh, and the no-op guard on an
  // unchanged value all live in committee-view, which has no spec file of its own; see
  // committee-view.component.ts:554-564's no-op guard comment).
  test('admin (canEdit): adding a charter PUTs { charter: { url } }, refreshes, and shows the link with attribution', async ({ page }) => {
    const charterUrl = 'https://example.org/e2e-charter.pdf';
    let committeeState = baseCommittee({ my_role: 'Chair', writer: true });
    await mockCommitteeApis(page, { committee: committeeState });

    // Override the plain GET-only route registered above: PUT mutates the closed-over state and
    // returns it, the subsequent GET (fired by saveCharter's refreshCommittee()) reads it back --
    // mirrors the org-profile.spec.ts "S3: edit + save" stubbed-PUT pattern.
    let putBody: unknown = null;
    await page.route(`**/api/committees/${COMMITTEE_UID}`, (route) => {
      const method = route.request().method();
      if (method === 'PUT') {
        putBody = route.request().postDataJSON();
        committeeState = {
          ...committeeState,
          charter: { url: charterUrl, version: 1, updated_at: '2026-09-07T00:00:00Z', updated_by: { name: 'E2E Tester', username: 'e2e-tester', email: 'e2e@example.org' } },
        };
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeState) });
      }
      if (method === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(committeeState) });
      }
      return route.fallback();
    });

    await gotoCommitteeTab(page);
    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about-charter-empty')).toBeVisible();

    await page.getByTestId('committee-about-edit-charter-btn').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Add Charter');

    await page.locator('[data-test="committee-view-charter-input"]').fill(charterUrl);
    await page.getByTestId('charter-dialog-save').click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.p-toast')).toContainText('Charter updated');
    await expect.poll(() => putBody).toEqual({ charter: { url: charterUrl } });

    const link = page.getByTestId('committee-about-charter-link');
    await expect(link).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(link).toHaveAttribute('href', charterUrl);
    await expect(page.getByTestId('committee-about-charter-updated-by')).toContainText('Last updated by E2E Tester');
  });

  test('admin (canEdit): saving the charter dialog dirty-but-unchanged is a no-op -- no PUT, no toast', async ({ page }) => {
    const existingUrl = 'https://example.org/existing-charter.pdf';
    await mockCommitteeApis(page, {
      committee: baseCommittee({
        my_role: 'Chair',
        writer: true,
        charter: { url: existingUrl, version: 3, updated_at: '2026-08-01T00:00:00Z', updated_by: { name: 'Prior Editor', username: 'prior', email: 'prior@example.org' } },
      }),
    });

    let putCalled = false;
    await page.route(`**/api/committees/${COMMITTEE_UID}`, (route) => {
      if (route.request().method() === 'PUT') {
        putCalled = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.fallback();
    });

    await gotoCommitteeTab(page);
    await expect(page.getByTestId('committee-about-charter-link')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('committee-about-edit-charter-btn').click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('Edit Charter');

    const input = page.locator('[data-test="committee-view-charter-input"]');
    await expect(input).toHaveValue(existingUrl);
    // Dirty the control without changing its final value -- FormControl.dirty latches true on
    // any edit and never resets on its own, independent of whether the value ends up matching
    // the original. This is exactly the case saveCharter()'s no-op guard exists for.
    await input.fill(`${existingUrl}/`);
    await input.fill(existingUrl);
    await expect(page.getByTestId('charter-dialog-save')).toBeEnabled();

    await page.getByTestId('charter-dialog-save').click();
    await expect(dialog).toHaveCount(0);

    await page.waitForTimeout(300);
    expect(putCalled).toBe(false);
    await expect(page.locator('.p-toast')).not.toBeVisible();
  });

  test('?tab=about deep-links directly into the About tab', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false }) });
    await gotoCommitteeTab(page, '?tab=about');

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('an invalid ?tab= value falls back to the Overview tab', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false }) });
    await gotoCommitteeTab(page, '?tab=not-a-real-tab');

    await expect(page.getByTestId('committee-overview-stats')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about')).toHaveCount(0);
  });

  test('Meeting Cadence: composes a weekly recurrence string with duration and platform', async ({ page }) => {
    await mockCommitteeApis(page, {
      committee: baseCommittee({ my_role: 'Member', writer: false }),
      meetings: [
        {
          uid: 'm1',
          recurrence: { type: 2, repeat_interval: 1, weekly_days: '3' },
          duration: 60,
          platform: 'Zoom',
        },
      ],
    });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about-cadence-summary')).toHaveText('Weekly on Tuesday · 60 min · Zoom', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('Meeting Cadence: falls back to a static message when there are no meetings', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false }), meetings: [] });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about-cadence-summary')).toHaveText('No recurring meetings scheduled', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('Subscribe to Calendar opens the iCal dialog, including as a visitor', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'invite_only' }) });
    await gotoCommitteeTab(page);

    await expect(page.getByTestId('committee-about-subscribe-btn')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('committee-about-subscribe-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Subscribe');
  });
});
