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

export async function mockCommitteeApis(
  page: Page,
  uid: string,
  opts: { committee: Record<string, unknown>; meetings?: unknown[]; members?: unknown[]; detailReady?: Promise<void>; membersReady?: Promise<void> }
): Promise<void> {
  await page.route(
    (url) => url.pathname === `/api/committees/${uid}` || url.pathname.startsWith(`/api/committees/${uid}/`),
    async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      // Unknown subresources must not receive a detail object or reach the live synthetic-ID API.
      if (new URL(route.request().url()).pathname !== `/api/committees/${uid}`) return route.abort();
      await opts.detailReady;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.committee) });
    }
  );
  await page.route(`**/api/committees/${uid}/children`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/members*`, async (route) => {
    await opts.membersReady;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(opts.members ?? []) });
  });
  await page.route(`**/api/committees/${uid}/invites*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/applications*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/my-applications*`, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"not found"}' })
  );
  await page.route(`**/api/committees/${uid}/documents*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route(`**/api/committees/${uid}/activity*`, (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.route(`**/api/committees/${uid}/engagement*`, (route) =>
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' })
  );
  await page.route('**/api/user/pending-invitations', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  for (const projectId of [opts.committee['project_uid'], opts.committee['project_slug']]) {
    if (typeof projectId !== 'string') continue;
    await page.route(
      (url) => url.pathname === `/api/projects/${projectId}` || url.pathname.startsWith(`/api/projects/${projectId}/`),
      (route) => {
        if (new URL(route.request().url()).pathname !== `/api/projects/${projectId}`) return route.abort();
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ uid: opts.committee['project_uid'], slug: opts.committee['project_slug'], name: 'E2E Project', is_foundation: false }),
        });
      }
    );
  }
  await page.route('**/api/mailing-lists*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/api/meetings*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: opts.meetings ?? [] }) });
  });
  await page.route('**/api/meetings/count*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"count":0}' }));
  await page.route('**/api/past-meetings*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.route('**/api/votes*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' }));
  await page.route('**/api/surveys*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
}

export async function gotoCommitteeTab(page: Page, uid: string, query = '?tab=about'): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.goto(`/groups/${uid}${query}`, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
}
