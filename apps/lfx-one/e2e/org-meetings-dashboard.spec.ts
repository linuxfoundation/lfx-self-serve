// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Deep import the constants file directly (not the '@lfx-one/shared/constants' barrel) so the suite can
// load the demo data without bootstrapping Angular. org-meetings.constants.ts only imports types, so this is safe.
import { DEMO_PAST_MEETINGS } from '@lfx-one/shared/constants/org-meetings.constants';
import { expect, Locator, Page, Route, test } from '@playwright/test';

const ORG_MEETINGS_URL = '/org/meetings';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

// Mirrors `deriveDemoViewerInvited`/`splitOrgMeetingsByPrivacy` in `@lfx-one/shared/utils/org-meetings.util` —
// can't import that module directly because it pulls in the `../constants` barrel, which transitively imports
// `@angular/forms` (via form.utils.ts) and crashes the plain-Node Playwright runtime (no Angular JIT compiler loaded).
function isVisibleToDemoViewer(meeting: { id: string; privacy: string }): boolean {
  if (meeting.privacy !== 'private') return true;
  let hash = 0;
  for (const char of meeting.id) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return hash % 3 !== 0;
}

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

/** Stub a single-page meetings response (total = the given list length). */
async function stubSinglePage(page: Page, meetings: StubMeeting[]): Promise<void> {
  await stubOrgMeetingsRoutes(page, (route) => fulfillJson(route, { data: meetings, total: meetings.length, pageSize: 10, offset: 0 }));
}

/** Asserts the private-meetings rollup card, if rendered, is the last card-like element in the list — never interspersed with or before individual meeting cards. */
async function expectRollupRendersLast(list: Locator, cardPrefix: string, rollupTestId: string): Promise<void> {
  const testIds = await list
    .locator(`[data-testid^="${cardPrefix}"], [data-testid="${rollupTestId}"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''));
  const rollupIndex = testIds.indexOf(rollupTestId);
  expect(rollupIndex, `expected ${rollupTestId} to be rendered`).toBeGreaterThan(-1);
  expect(testIds.slice(rollupIndex)).toEqual([rollupTestId]);
}

test.describe('Org Meetings Dashboard', () => {
  test('renders KPI strip and real upcoming cards by default', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1), makeMeeting(2)]);
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
    await stubSinglePage(page, [makeMeeting(1, { agenda })]);
    await gotoOrgMeetingsPage(page);

    const card = page.getByTestId('org-upcoming-meeting-card-mtg-1');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const link = card.locator('#org-upcoming-meeting-agenda-mtg-1 a[href="https://docs.google.com/document/d/abc123/edit"]');
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  test('KPI strip renders the Snowflake-backed summary counts', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);
    const strip = page.getByTestId('org-meetings-kpi-strip');
    await expect(strip).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(strip).toContainText('Upcoming Meetings');
    await expect(strip).toContainText('12');
    await expect(strip).toContainText('Recurring Series');
  });

  test('card date/time shows a timezone abbreviation', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);
    const card = page.getByTestId('org-upcoming-meeting-card-mtg-1');
    await expect(card).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(card).toContainText('GMT');
  });

  test('shows the empty state when the org has no upcoming meetings', async ({ page }) => {
    await stubSinglePage(page, []);
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
      await fulfillJson(route, { data: [makeMeeting(10)], total: 1, pageSize: 10, offset: 0 });
    });
    await gotoOrgMeetingsPage(page);

    await expect(page.getByTestId('org-upcoming-meetings-error')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-upcoming-meetings-empty')).toHaveCount(0);

    await page.getByTestId('org-upcoming-meetings-retry').click();
    await expect(page.getByTestId('org-upcoming-meeting-card-mtg-10')).toBeVisible();
    await expect(page.getByTestId('org-upcoming-meetings-error')).toHaveCount(0);
  });

  test('load more appends the next page', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const offset = Number(url.searchParams.get('offset') ?? '0');
      if (offset === 0) {
        await fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2)], total: 3, pageSize: 10, offset: 0 });
        return;
      }
      await fulfillJson(route, { data: [makeMeeting(4)], total: 3, pageSize: 10, offset });
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

  test('renders org invitee rows and the total invitee count', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);

    const panel = page.getByTestId('org-upcoming-meeting-people-invited-mtg-1');
    await expect(panel).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    // rsvpTally 2/1/0/1 => totalInvited = 4.
    await expect(panel).toContainText('4 invitees');
    const firstInvitee = page.getByTestId('org-upcoming-meeting-invitee-mtg-1-0');
    await expect(firstInvitee).toContainText('Jeffrey Osier-Mixon');
    await expect(firstInvitee).toContainText('Community Architect');
  });

  test('search re-fetches server-side with the searchQuery param', async ({ page }) => {
    await stubOrgMeetingsRoutes(page, async (route, url) => {
      const search = url.searchParams.get('searchQuery');
      if (search) {
        await fulfillJson(route, { data: [makeMeeting(7, { title: 'Security TAG Monthly' })], total: 1, pageSize: 10, offset: 0 });
        return;
      }
      await fulfillJson(route, { data: [makeMeeting(1), makeMeeting(2), makeMeeting(4)], total: 3, pageSize: 10, offset: 0 });
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

  test('switches to the past tab and back, clearing the tab query param', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);
    await expect(page.getByTestId('org-meetings-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    await page.getByTestId('org-meetings-tab-past').click();
    await expect(page).toHaveURL(/tab=past/);
    await expect(page.getByTestId('org-past-meetings-list')).toBeVisible();

    await page.getByTestId('org-meetings-tab-upcoming').click();
    await expect(page).not.toHaveURL(/tab=/);
    await expect(page.getByTestId('org-meetings-upcoming-tab')).toBeVisible();
  });

  test('private meetings rollup card renders after every individual meeting card, on both tabs', async ({ page }) => {
    // mtg-1 and mtg-3 are both private with no real invitee data, so the demo viewer-invited hash
    // (deriveDemoViewerInvited) decides visibility: mtg-1 hashes visible, mtg-3 hashes hidden — this
    // mix is required so the upcoming tab renders a visible card AND a rollup simultaneously.
    await stubSinglePage(page, [makeMeeting(1), makeMeeting(3)]);
    await gotoOrgMeetingsPage(page);

    const upcomingList = page.getByTestId('org-upcoming-meetings-list');
    await expect(upcomingList.getByTestId('org-upcoming-meetings-private-rollup')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expectRollupRendersLast(upcomingList, 'org-upcoming-meeting-card-', 'org-upcoming-meetings-private-rollup');

    await page.getByTestId('org-meetings-tab-past').click();
    const pastList = page.getByTestId('org-past-meetings-list');
    await expect(pastList.getByTestId('org-past-meetings-private-rollup')).toBeVisible();
    await expectRollupRendersLast(pastList, 'org-past-meeting-card-', 'org-past-meetings-private-rollup');
  });

  test('Recordings Available KPI reflects only recordings from the past 30 days the viewer can actually access', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);
    await page.getByTestId('org-meetings-tab-past').click();

    // The past tab always renders DEMO_PAST_MEETINGS (no stub/fetch path exists for it), so the expected
    // count is derived straight from that fixed data via the same privacy-visibility and 30-day-window rules
    // the component uses.
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const expectedRecordings = DEMO_PAST_MEETINGS.filter((meeting) => new Date(meeting.startTime).getTime() < now)
      .filter((meeting) => new Date(meeting.startTime).getTime() >= cutoff)
      .filter((meeting) => isVisibleToDemoViewer(meeting))
      .filter((meeting) => meeting.artifact.recordingUrl !== null).length;
    // Sanity check the demo data actually exercises this path — a KPI that's coincidentally right at 0 would prove nothing.
    expect(expectedRecordings).toBeGreaterThan(0);

    const pastList = page.getByTestId('org-past-meetings-list');
    await expect(pastList).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    const recordingsCard = page.getByTestId('stat-card-Recordings Available');
    await expect(recordingsCard).toContainText(String(expectedRecordings));
    await expect(recordingsCard).toContainText('From past 30 days');
  });

  test('Past Meetings KPI shows an attendance-rate subtext computed across all past meetings', async ({ page }) => {
    await stubSinglePage(page, [makeMeeting(1)]);
    await gotoOrgMeetingsPage(page);
    await page.getByTestId('org-meetings-tab-past').click();

    // Same fixed-data premise as the Recordings Available KPI test above: the past tab always renders
    // DEMO_PAST_MEETINGS, so the expected rate is derived straight from that data via the same
    // attendanceTally aggregation the component uses (unfiltered by privacy — the headline count isn't either).
    const now = Date.now();
    const totals = DEMO_PAST_MEETINGS.filter((meeting) => new Date(meeting.startTime).getTime() < now).reduce(
      (acc, meeting) => {
        acc.attended += meeting.attendanceTally.attended;
        acc.total += meeting.attendanceTally.attended + meeting.attendanceTally.missed + meeting.attendanceTally.excused;
        return acc;
      },
      { attended: 0, total: 0 }
    );
    const expectedRate = Math.round((totals.attended / totals.total) * 100);

    const pastList = page.getByTestId('org-past-meetings-list');
    await expect(pastList).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('stat-card-Past Meetings')).toContainText(`${expectedRate}% attendance rate`);
  });
});
