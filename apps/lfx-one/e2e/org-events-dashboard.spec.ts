// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { expect, Page, test } from '@playwright/test';

const ORG_EVENTS_URL = '/org/events';
const DATA_LOAD_TIMEOUT = 30_000;
const MOCK_ACCOUNT_ID = '0014100000Te2QjAAJ';

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
            accountName: 'Red Hat LLC',
            accountSlug: 'red-hat-llc',
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
          accountName: 'Red Hat LLC',
          accountSlug: 'red-hat-llc',
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
        eventRegistrationsGoal: 1500,
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
        eventRegistrationsGoal: 2200,
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

  if (!page.url().includes('/org/events')) {
    test.skip(true, 'org-lens-enabled flag appears off — /org/events redirected away');
  }
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

  test('opens attendee and speaker drawers with non-PII row test ids', async ({ page }) => {
    await gotoOrgEventsPage(page);
    await expect(page.getByTestId('org-events-page')).toBeVisible({ timeout: DATA_LOAD_TIMEOUT });

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
