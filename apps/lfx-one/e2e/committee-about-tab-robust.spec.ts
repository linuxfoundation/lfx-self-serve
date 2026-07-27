// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Group "About" tab — robust structural tests (LFXV2-1713). Asserts the data-testid contract. */

import { expect, Page, test } from '@playwright/test';

const DATA_LOAD_TIMEOUT = 30_000;
const COMMITTEE_UID = 'e2e-about-robust-committee';

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
    name: 'E2E About Tab Robust Working Group',
    description: 'A working group used to exercise the About tab structural contract in e2e tests.',
    category: 'Working Group',
    public: true,
    enable_voting: false,
    join_mode: 'open',
    website: 'https://example.org/e2e-about-robust',
    mailing_list: 'e2e-about-robust@example.org',
    chat_channel: 'https://slack.example.org/e2e-about-robust',
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
    my_role: 'Member',
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

async function gotoCommitteeTab(page: Page, query = '?tab=about'): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/groups/${COMMITTEE_UID}${query}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}

test.setTimeout(120_000);

test.describe('Group About tab — Robust Structural Tests (LFXV2-1713)', () => {
  test.beforeEach(async ({ page }) => {
    await mockCommitteeApis(page, { committee: baseCommittee() });
    await gotoCommitteeTab(page);
    await expect(page.getByTestId('committee-about')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
  });

  test.describe('Container structure', () => {
    test('About root container carries the two-column grid layout contract', async ({ page }) => {
      const root = page.getByTestId('committee-about');
      await expect(root).toBeAttached();
      await expect(root).toHaveClass(/lg:grid-cols-2/);
    });

    test('description, cadence, parent, and key-information cards are nested inside the About root', async ({ page }) => {
      const about = page.getByTestId('committee-about');
      await expect(about.getByTestId('committee-about-description-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-cadence-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-parent-card')).toBeAttached();
      await expect(about.getByTestId('committee-about-key-info-card')).toBeAttached();
    });

    test('channels card is nested inside the About root and lists the configured chat/website rows', async ({ page }) => {
      const channelsCard = page.getByTestId('committee-about').getByTestId('committee-about-channels-card');
      await expect(channelsCard).toBeAttached();
      await expect(channelsCard.getByTestId('committee-about-chat-channel-row')).toBeAttached();
      await expect(channelsCard.getByTestId('committee-about-website-row')).toBeAttached();
    });

    test('cadence card contains the subscribe button and a summary node', async ({ page }) => {
      const cadenceCard = page.getByTestId('committee-about-cadence-card');
      await expect(cadenceCard.getByTestId('committee-about-subscribe-btn')).toBeAttached();
      await expect(cadenceCard.getByTestId('committee-about-cadence-summary')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
    });
  });

  test.describe('Header/About duplication contract', () => {
    test('the header description/channels block toggles off for About and back on for Overview', async ({ page }) => {
      await expect(page.getByTestId('committee-view-description')).not.toBeAttached();
      await expect(page.getByTestId('committee-view-channels-card')).not.toBeAttached();

      await gotoCommitteeTab(page, '?tab=overview');
      await expect(page.getByTestId('committee-view-description')).toBeAttached({ timeout: DATA_LOAD_TIMEOUT });
      await expect(page.getByTestId('committee-view-channels-card')).toBeAttached();
    });

    test('the committee-view tab strip remains attached above the About body', async ({ page }) => {
      await expect(page.getByTestId('committee-view-tabs')).toBeAttached();
    });
  });
});
