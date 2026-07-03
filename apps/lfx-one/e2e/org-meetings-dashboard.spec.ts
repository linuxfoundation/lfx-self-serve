// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, Route, test } from '@playwright/test';

const ORG_MEETINGS_URL = '/org/meetings';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

test.setTimeout(120_000);

interface StubInvitee {
  name: string;
  title: string;
  avatarUrl: string | null;
  rsvpStatus: 'yes' | 'maybe' | 'no' | null;
}

interface StubMeeting {
  id: string;
  title: string;
  privacy: 'public' | 'private';
  type: 'board' | 'working-group' | 'other';
  recurrenceLabel: string | null;
  startTime: string;
  endTime: string;
  foundation: string;
  orgName: string;
  project: string;
  agenda: string | null;
  resources: string[];
  rsvpTally: { yes: number; maybe: number; no: number; noResponse: number };
  orgInvitees: StubInvitee[];
  guestCount: number;
  joinUrl: string | null;
  statusFlags: { recording: boolean; transcripts: boolean; aiSummary: boolean };
}

function makeMeeting(index: number, overrides: Partial<StubMeeting> = {}): StubMeeting {
  return {
    id: `mtg-${index}`,
    title: `Governing Board Meeting ${index}`,
    privacy: 'private',
    type: 'board',
    recurrenceLabel: 'Every week on Thu',
    startTime: '2026-08-14T17:00:00.000Z',
    endTime: '2026-08-14T18:00:00.000Z',
    foundation: 'RISC-V International',
    orgName: 'Red Hat, Inc.',
    project: 'RISC-V International',
    agenda: `Agenda for meeting ${index}`,
    resources: [],
    rsvpTally: { yes: 2, maybe: 1, no: 0, noResponse: 1 },
    orgInvitees: [
      { name: 'Jeffrey Osier-Mixon', title: 'Community Architect', avatarUrl: 'https://example.com/a.png', rsvpStatus: 'yes' },
      { name: 'Ada Lovelace', title: 'Engineer', avatarUrl: null, rsvpStatus: null },
    ],
    guestCount: 2,
    joinUrl: null,
    statusFlags: { recording: true, transcripts: true, aiSummary: false },
    ...overrides,
  };
}

function fulfillJson(route: Route, body: unknown): Promise<void> {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
}

function skipWhenAuthMissing(page: Page): void {
  try {
    const { hostname } = new URL(page.url());
    if (hostname === 'auth0.com' || hostname.endsWith('.auth0.com')) {
      test.skip(true, 'TEST_USERNAME / TEST_PASSWORD not configured — see global-setup.ts');
    }
  } catch {
    // Let malformed URLs fail naturally.
  }
}

async function seedSelectedOrgCookie(page: Page): Promise<void> {
  await page.context().addCookies([
    {
      name: 'lfx-selected-account',
      value: JSON.stringify({ uid: MOCK_ACCOUNT_ID }),
      domain: 'localhost',
      path: '/',
    },
  ]);
}

async function stubOrgMeetingsRoutes(page: Page, listResponder: (route: Route, url: URL) => Promise<void>): Promise<void> {
  await page.route('**/api/user/personas*', (route) =>
    fulfillJson(route, {
      personas: ['contributor'],
      personaProjects: {},
      projects: [],
      organizations: [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: '', uid: MOCK_ACCOUNT_ID }],
      isRootWriter: false,
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    fulfillJson(route, [{ accountId: MOCK_ACCOUNT_ID, accountName: 'Red Hat, Inc.', accountSlug: 'red-hat', membershipTier: 'Gold' }])
  );

  await page.route('**/api/orgs/**/lens/meetings**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/lens/meetings/summary')) {
      await fulfillJson(route, { upcomingMeetings: 12, recurringSeries: 4, recurringFoundations: 3, nextMeeting: '2026-07-03T12:00:00.000Z' });
      return;
    }
    if (url.pathname.endsWith('/lens/meetings/projects')) {
      await fulfillJson(route, { projects: ['RISC-V International', 'Cloud Native Computing Foundation'] });
      return;
    }
    await listResponder(route, url);
  });
}

async function gotoOrgMeetingsPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_MEETINGS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
  if (!page.url().includes('/org/meetings')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/meetings redirected away');
  }
}

test.describe('Org Meetings Dashboard', () => {
  test('renders KPI strip and real upcoming cards by default', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2)], total: 2, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-meetings-kpi-strip')).toBeVisible();
    await expect(page.getByTestId('org-meetings-upcoming-tab')).toBeVisible();
    const list = page.getByTestId('org-upcoming-meetings-list');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);
    await expect(list).toContainText('Governing Board Meeting 1');
  });

  test('renders URLs in the agenda as clickable links', async ({ page }) => {
    const agenda = 'Planning doc: https://docs.google.com/document/d/abc123/edit';
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1, { agenda })], total: 1, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);

    const card = page.getByTestId('org-upcoming-meeting-card-mtg-1');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const link = card.locator('#org-upcoming-meeting-agenda-mtg-1 a[href="https://docs.google.com/document/d/abc123/edit"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('KPI strip renders the Snowflake-backed summary counts', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1)], total: 1, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);
    const strip = page.getByTestId('org-meetings-kpi-strip');
    await expect(strip).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(strip).toContainText('Upcoming Meetings');
    await expect(strip).toContainText('12');
    await expect(strip).toContainText('Recurring Series');
  });

  test('card date/time shows a timezone abbreviation', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1)], total: 1, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);
    const card = page.getByTestId('org-upcoming-meeting-card-mtg-1');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card).toContainText('GMT');
  });

  test('shows the empty state when the org has no upcoming meetings', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [], total: 0, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-upcoming-meetings-empty')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-upcoming-meetings-error')).toHaveCount(0);
  });

  test('shows a distinct error state with retry that re-requests', async ({ page }) => {
    let calls = 0;
    await stubOrgMeetingsRoutes(page, async (route) => {
      calls += 1;
      if (calls === 1) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
        return;
      }
      await fulfillJson(route, { data: [makeMeeting(9)], total: 1, pageSize: 10, offset: 0 });
    });
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-upcoming-meetings-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-upcoming-meetings-empty')).toHaveCount(0);

    await page.getByTestId('org-upcoming-meetings-retry').click();
    await expect(page.getByTestId('org-upcoming-meeting-card-mtg-9')).toBeVisible();
    await expect(page.getByTestId('org-upcoming-meetings-error')).toHaveCount(0);
  });

  test('load more appends the next page', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      if (offset === 0) {
        await fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2)], total: 3, pageSize: 10, offset: 0 });
        return;
      }
      await fulfillJson(route, { data: [makeMeeting(3)], total: 3, pageSize: 10, offset });
    });
    await gotoOrgMeetingsPage(page);

    const list = page.getByTestId('org-upcoming-meetings-list');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);
    await page.getByTestId('org-upcoming-meetings-load-more').click();
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(3);
  });

  test('a failed load more keeps the already-loaded cards visible', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      if (offset === 0) {
        await fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2)], total: 3, pageSize: 10, offset: 0 });
        return;
      }
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await gotoOrgMeetingsPage(page);

    const list = page.getByTestId('org-upcoming-meetings-list');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);

    await page.getByTestId('org-upcoming-meetings-load-more').click();
    await expect(page.getByTestId('org-upcoming-meetings-load-more-error')).toBeVisible();
    await expect(page.getByTestId('org-upcoming-meetings-load-more')).toContainText('Retry');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);
    await expect(page.getByTestId('org-upcoming-meetings-error')).toHaveCount(0);

    // Retry also fails: the loaded cards must still stay, never the full-page error.
    await page.getByTestId('org-upcoming-meetings-load-more').click();
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);
    await expect(page.getByTestId('org-upcoming-meetings-error')).toHaveCount(0);
  });

  test('renders org invitee rows and the reconciling attendance tally', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1)], total: 1, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);

    const panel = page.getByTestId('org-upcoming-meeting-people-invited-mtg-1');
    await expect(panel).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // rsvpTally 2/1/0/1 => 2 of 4 attending; orgInvitees(2) + guests(2) = total(4).
    await expect(panel).toContainText('2 of 4 attending');
    const firstInvitee = page.getByTestId('org-upcoming-meeting-invitee-mtg-1-0');
    await expect(firstInvitee).toContainText('Jeffrey Osier-Mixon');
    await expect(firstInvitee).toContainText('Community Architect');
    await expect(page.getByTestId('org-upcoming-meeting-guests-mtg-1')).toContainText('2');
  });

  test('search re-fetches server-side with the searchQuery param', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const search = url.searchParams.get('searchQuery');
      if (search) {
        await fulfillJson(route, { data: [makeMeeting(7, { title: 'Security TAG Monthly' })], total: 1, pageSize: 10, offset: 0 });
        return;
      }
      await fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2), makeMeeting(3)], total: 3, pageSize: 10, offset: 0 });
    });
    await gotoOrgMeetingsPage(page);

    const list = page.getByTestId('org-upcoming-meetings-list');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(3);

    const request = page.waitForRequest((req) => req.url().includes('/lens/meetings?') && req.url().includes('searchQuery=Security'));
    await page.getByTestId('org-meetings-search').locator('input').fill('Security');
    await request;
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(1);
    await expect(list).toContainText('Security TAG Monthly');
  });

  test('pending RSVP toggle re-fetches with the pendingRsvpOnly param', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const pending = url.searchParams.get('pendingRsvpOnly') === 'true';
      const data = pending ? [makeMeeting(1)] : [makeMeeting(1), makeMeeting(2)];
      await fulfillJson(route, { data, total: data.length, pageSize: 10, offset: 0 });
    });
    await gotoOrgMeetingsPage(page);

    const list = page.getByTestId('org-upcoming-meetings-list');
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(2);
    const request = page.waitForRequest((req) => req.url().includes('/lens/meetings?') && req.url().includes('pendingRsvpOnly=true'));
    await page.getByTestId('org-meetings-pending-rsvp-toggle').click();
    await request;
    await expect(list.locator('[data-testid^="org-upcoming-meeting-card-"]')).toHaveCount(1);
  });

  test('switches to the past tab and back, clearing the tab query param', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: [makeMeeting(1)], total: 1, pageSize: 10, offset: 0 }));
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-meetings-tab-past').click();
    await expect(page).toHaveURL(/tab=past/);
    await expect(page.getByTestId('org-past-meetings-list')).toBeVisible();

    await page.getByTestId('org-meetings-tab-upcoming').click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page.getByTestId('org-meetings-upcoming-tab')).toBeVisible();
  });
});
