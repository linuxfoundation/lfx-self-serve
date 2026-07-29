// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/** Shared fixtures/mocks for the Group "About" tab specs (LFXV2-1713). */

import { Page, test } from '@playwright/test';

export const DATA_LOAD_TIMEOUT = 30_000;

export function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Malformed URL — let the test run and surface a useful failure.
  }
}

export function buildBaseCommittee(uid: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    uid,
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

export async function mockCommitteeApis(page: Page, uid: string, opts: { committee: Record<string, unknown>; meetings?: unknown[] }): Promise<void> {
  await page.route(`**/api/committees/${uid}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.committee) });
  });
  await page.route(`**/api/committees/${uid}/children`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/members`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/invites*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/mailing-lists*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: opts.meetings ?? [] }) });
  });
}

export async function gotoCommitteeTab(page: Page, uid: string, query = '?tab=about'): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/groups/${uid}${query}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}
