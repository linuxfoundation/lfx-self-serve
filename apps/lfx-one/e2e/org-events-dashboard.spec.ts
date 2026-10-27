// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

import { SYNTHETIC_ORG_ACCOUNT_ID, SYNTHETIC_ORG_NAME } from './fixtures/mock-data/synthetic-org.mock';

const ORG_EVENTS_URL = '/org/events';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = SYNTHETIC_ORG_ACCOUNT_ID;

/**
 * The fields an event row needs to render, minus the three the staff-goal test varies. Deliberately
 * separate from the base stub, which omits `eventRegistrationsGoal` because that is the EXTERNAL
 * admin shape (#4432); spread this and add the goal to get the LF staff shape.
 */
const STAFF_EVENT = {
  eventName: 'Open Source Summit',
  foundation: 'Linux Foundation',
  eventStartDate: '2026-06-30',
  eventEndDate: '2026-07-02',
  eventLocation: null,
  eventCity: 'Seattle',
  eventCountry: 'United States',
  eventUrl: 'https://events.linuxfoundation.org/open-source-summit',
  eventRegistrationUrl: null,
  orgSpeakerAcceptedCount: 1,
  orgSpeakerSubmittedCount: 2,
  isOrgSponsor: false,
} as const;

test.setTimeout(120_000);

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

async function stubOrgEventsRoutes(page: Page): Promise<void> {
  // #2961: Org pages wait for the role grants before rendering; stub them so the page does not wait on the
  // live dev lookup. The seeded organization is held, so no contractor read check is owed.
  await page.route('**/api/orgs/me/role-grants*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        writers: [MOCK_ACCOUNT_ID],
        auditors: [],
        cascadingWriters: [],
        cascadingAuditors: [],
        isStaff: false,
        isContractor: false,
        degraded: false,
        lookupOutcome: 'ok',
        staffCheck: 'ok',
        username: 'e2e-org-page',
        loaded_at: new Date().toISOString(),
      }),
    })
  );

  await page.route('**/api/user/personas*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        personas: ['contributor'],
        personaProjects: {},
        projects: [],
        organizations: [
          {
            accountId: MOCK_ACCOUNT_ID,
            accountName: SYNTHETIC_ORG_NAME,
            membershipTier: '',
            uid: MOCK_ACCOUNT_ID,
          },
        ],
        isRootWriter: false,
      }),
    })
  );

  await page.route('**/api/analytics/org-lens-account-context*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          accountId: MOCK_ACCOUNT_ID,
          accountName: SYNTHETIC_ORG_NAME,
          membershipTier: 'Gold',
        },
      ]),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events/summary`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalEvents: 12, pastEvents: 3, upcomingEvents: 9 }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events?**`, (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get('offset') ?? 0);

    const firstPageData = [
      {
        eventId: 'event-1',
        eventName: 'Open Source Summit',
        foundation: 'Linux Foundation',
        eventStartDate: '2026-06-30',
        eventEndDate: '2026-07-02',
        eventLocation: null,
        eventCity: 'Seattle',
        eventCountry: 'United States',
        eventUrl: 'https://events.linuxfoundation.org/open-source-summit',
        eventRegistrationUrl: 'https://events.linuxfoundation.org/open-source-summit/register',
        orgAttendeeCount: 3,
        orgSpeakerAcceptedCount: 1,
        orgSpeakerSubmittedCount: 2,
        isOrgSponsor: true,
      },
    ];

    const secondPageData = [
      {
        eventId: 'event-2',
        eventName: 'CloudNativeCon',
        foundation: 'CNCF',
        eventStartDate: '2026-09-10',
        eventEndDate: '2026-09-12',
        eventLocation: null,
        eventCity: 'San Diego',
        eventCountry: 'United States',
        eventUrl: 'https://events.linuxfoundation.org/kubecon-cloudnativecon-north-america',
        eventRegistrationUrl: null,
        orgAttendeeCount: 2,
        orgSpeakerAcceptedCount: 0,
        orgSpeakerSubmittedCount: 1,
        isOrgSponsor: false,
      },
    ];

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: offset >= 10 ? secondPageData : firstPageData,
        total: 12,
        pageSize: 10,
        offset,
      }),
    });
  });

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events/event-1/attendees*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        eventId: 'event-1',
        eventName: 'Open Source Summit',
        total: 1,
        data: [{ contactId: 'person@example.org', name: 'Jane Doe', jobTitle: 'Engineer' }],
      }),
    })
  );

  await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events/event-1/speakers*`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        eventId: 'event-1',
        eventName: 'Open Source Summit',
        acceptedCount: 1,
        submittedCount: 1,
        data: [{ contactId: 'speaker@example.org', name: 'Alex Speaker', jobTitle: 'Maintainer', status: 'ACCEPTED' }],
      }),
    })
  );
}

async function gotoOrgEventsPage(page: Page): Promise<void> {
  await seedSelectedOrgCookie(page);
  await stubOrgEventsRoutes(page);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.goto(ORG_EVENTS_URL, { waitUntil: 'domcontentloaded' });
  skipWhenAuthMissing(page);
  await expect(page).not.toHaveURL(/auth0\.com/);
}

test.describe('Org Events Dashboard', () => {
  test('supports sorting, pagination, and action CTAs', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });
    await expect(page.getByTestId('org-events-data-table')).toBeVisible();
    await expect(page.getByTestId('org-event-action-event-1').getByRole('link', { name: 'Register' })).toBeVisible();

    const sortRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith(`/api/orgs/${MOCK_ACCOUNT_ID}/lens/events`) && url.searchParams.get('sortField') === 'EVENT_CITY';
    });
    await page.getByTestId('sort-location').getByRole('button').click();
    await sortRequest;

    const pageRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith(`/api/orgs/${MOCK_ACCOUNT_ID}/lens/events`) && url.searchParams.get('offset') === '10';
    });
    await page.locator('button[aria-label="Next Page"]').first().click();
    await pageRequest;
  });

  test('past tab renders the events table without the Action column', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    const pastRequest = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith(`/api/orgs/${MOCK_ACCOUNT_ID}/lens/events`) && url.searchParams.get('isPast') === 'true';
    });
    await page.getByTestId('org-events-stat-past').click();
    await pastRequest;

    await expect(page.getByTestId('org-events-panel-past')).toBeVisible();
    await expect(page.getByTestId('org-events-data-table')).toBeVisible();
    // Shared columns still render, but the Action column is dropped on the past tab.
    await expect(page.getByTestId('org-event-attendees-event-1')).toBeVisible();
    // The org's own registrant count only. The goal is no longer in the payload at all (#4432).
    await expect(page.getByTestId('org-event-attendees-event-1')).toHaveText('3');
    await expect(page.getByTestId('org-event-action-event-1')).toHaveCount(0);
  });

  test('past tab shows the past-specific empty state when there are no past events', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Override only the isPast=true response with an empty payload; registered after the
    // base stub so it takes precedence, falling back to the base stub for upcoming requests.
    await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events?**`, (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('isPast') === 'true') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: [], total: 0, pageSize: 10, offset: 0 }),
        });
      }
      return route.fallback();
    });

    await page.getByTestId('org-events-stat-past').click();

    const panel = page.getByTestId('org-events-panel-past');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No past events', { exact: true })).toBeVisible();
  });

  test('renders the goal for an LF staff response, on both tabs and at zero attendees', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // The base stub omits `eventRegistrationsGoal`, which is what an EXTERNAL admin receives — the
    // server leaves the key off entirely (#4432). This override is the LF staff shape: the key is
    // present, so the template must render it. Without a staff-shaped fixture a regression that
    // hid the goal from staff would pass every other check on this page.
    await page.route(`**/api/orgs/${MOCK_ACCOUNT_ID}/lens/events?**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          data: [
            { ...STAFF_EVENT, eventId: 'event-1', orgAttendeeCount: 3, eventRegistrationsGoal: 1500 },
            // Zero attendees takes the other template branch, which renders a span rather than a button.
            { ...STAFF_EVENT, eventId: 'event-2', orgAttendeeCount: 0, eventRegistrationsGoal: 2200 },
          ],
          total: 2,
          pageSize: 10,
          offset: 0,
        }),
      })
    );

    // PAST FIRST, deliberately. The override has to be registered after the base stub to take
    // precedence, by which point the upcoming tab has already loaded through that base stub — and
    // `switchTab` returns early when the requested tab is already active, so clicking `upcoming`
    // here would not refetch and the assertions would run against the external-admin data.
    // Visiting past first makes the return to upcoming a real tab change, so both fetch through
    // the override.
    for (const tab of ['past', 'upcoming'] as const) {
      await page.getByTestId(`org-events-stat-${tab}`).click();
      const panel = page.getByTestId(`org-events-panel-${tab}`);
      await expect(panel).toBeVisible();

      await expect(panel.getByText('My Org / Goal')).toBeVisible();
      await expect(panel.getByTestId('org-event-attendees-event-1')).toHaveText('3 / 1,500');
      await expect(panel.getByTestId('org-event-attendees-event-2')).toHaveText('0 / 2,200');
    }
  });

  test('opens attendee and speaker drawers with non-PII row test ids', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

    // Upcoming tab: the cell is the org's count alone; no goal is served or rendered (#4432).
    await expect(page.getByTestId('org-event-attendees-event-1')).toHaveText('3');

    await page.getByTestId('org-event-attendees-event-1').getByRole('button').click();
    await expect(page.getByTestId('event-attendees-drawer-title')).toBeVisible();
    await expect(page.getByTestId('event-attendee-0')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('event-attendees-drawer-title')).not.toBeVisible();

    await page.getByTestId('org-event-speakers-event-1').getByRole('button').click();
    await expect(page.getByTestId('event-speakers-drawer-title')).toBeVisible();
    await expect(page.getByTestId('event-speaker-0')).toBeVisible();
  });
});
