// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Group "About" tab E2E (LFXV2-1713). Deterministic via route mocks. */

import { expect, Page, test } from '@playwright/test';

const DATA_LOAD_TIMEOUT = 30_000;
const COMMITTEE_UID = 'e2e-about-committee';

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

function baseCommittee(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid: COMMITTEE_UID,
    name: 'E2E About Tab Working Group',
    description: 'A working group used to exercise the About tab in e2e tests.',
    category: 'Working Group',
    public: true,
    enable_voting: false,
    join_mode: 'open',
    website: 'https://example.org/e2e-about',
    mailing_list: 'e2e-about@example.org',
    chat_channel: 'https://slack.example.org/e2e-about',
    foundation_name: 'E2E Foundation',
    project_name: 'E2E Project',
    project_uid: 'e2e-project-uid',
    project_slug: 'e2e-project',
    is_foundation: false,
    parent_uid: null,
    parent_project_uid: 'e2e-project-uid',
    total_members: 12,
    created_at: '2025-01-15T00:00:00Z',
    updated_at: '2025-06-01T00:00:00Z',
    member_visibility: 'basic_profile',
    writer: false,
    my_role: null,
    auditors: [],
    ...overrides,
  };
}

async function mockCommitteeApis(page: Page, opts: { committee: Record<string, unknown>; meetings?: unknown[] }): Promise<void> {
  await page.route(`**/api/committees/${COMMITTEE_UID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.committee) });
  });
  await page.route(`**/api/committees/${COMMITTEE_UID}/children`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${COMMITTEE_UID}/members`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${COMMITTEE_UID}/invites*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/mailing-lists*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: opts.meetings ?? [] }) });
  });
}

async function gotoAboutTab(page: Page, query = '?tab=about'): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/groups/${COMMITTEE_UID}${query}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

test.setTimeout(120_000);

test.describe('Group About tab (LFXV2-1713)', () => {
  test('visitor: About tab renders between Overview and Members, edit affordances hidden, join CTA shown', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'open' }) });
    await gotoAboutTab(page);

    const tabsStrip = page.getByTestId('committee-view-tabs');
    await expect(tabsStrip).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const tabButtons = tabsStrip.locator('button');
    await expect(tabButtons.nth(0)).toContainText('Overview');
    await expect(tabButtons.nth(1)).toContainText('About');
    await expect(tabButtons.nth(2)).not.toContainText('About');

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about-edit-description-btn')).toHaveCount(0);
    await expect(page.getByTestId('committee-about-join-cta')).toBeVisible();
    await expect(page.getByTestId('group-join-cta-visitor-cta')).toBeVisible();
  });

  test('member: no edit affordances, no join CTA', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false }) });
    await gotoAboutTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('committee-about-edit-description-btn')).toHaveCount(0);
    await expect(page.getByTestId('committee-about-join-cta')).toHaveCount(0);
  });

  test('admin (canEdit): edit description button is visible and opens the edit dialog', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Chair', writer: true }) });
    await gotoAboutTab(page);

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const editBtn = page.getByTestId('committee-about-edit-description-btn');
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Edit Description');
  });

  test('?tab=about deep-links directly into the About tab', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false }) });
    await gotoAboutTab(page, '?tab=about');

    await expect(page.getByTestId('committee-about')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
  });

  test('an invalid ?tab= value falls back to the Overview tab', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false }) });
    await gotoAboutTab(page, '?tab=not-a-real-tab');

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
    await gotoAboutTab(page);

    await expect(page.getByTestId('committee-about-cadence-summary')).toHaveText('Weekly on Tuesday · 60 min · Zoom', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('Meeting Cadence: falls back to a static message when there are no meetings', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: 'Member', writer: false }), meetings: [] });
    await gotoAboutTab(page);

    await expect(page.getByTestId('committee-about-cadence-summary')).toHaveText('No recurring meetings scheduled', { timeout: DATA_LOAD_TIMEOUT });
  });

  test('Subscribe to Calendar opens the iCal dialog, including as a visitor', async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee({ my_role: null, writer: false, join_mode: 'invite_only' }) });
    await gotoAboutTab(page);

    await expect(page.getByTestId('committee-about-subscribe-btn')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await page.getByTestId('committee-about-subscribe-btn').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('Subscribe');
  });
});
