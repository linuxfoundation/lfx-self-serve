// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AnalyticsService } from './analytics.service';

/**
 * The ED dashboard renders "Data unavailable" instead of a fabricated zero by turning a failed
 * request into `undefined` — but only if the failure REACHES it. Three of these endpoints used
 * to catch their own HTTP error and resolve to a zero-filled response, so the dashboard's
 * `safe()` wrapper saw a success, `brandReach` was never undefined, and the card printed the
 * zeros as if measured. That is the reported AAIF defect: 17,269 followers across 2 platforms
 * rendered as "0 · 0 platforms".
 *
 * The card-level guards cannot pin this, because from their side a swallowed error and a real
 * zero are the same value. The contract has to be pinned where the error is destroyed.
 */
describe('AnalyticsService — a failed request must reach the caller', () => {
  let service: AnalyticsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AnalyticsService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AnalyticsService);
    http = TestBed.inject(HttpTestingController);
  });

  // Each of these feeds a card that must distinguish "could not measure" from "measured zero".
  const endpoints: { name: string; url: string; call: () => { subscribe: (o: object) => void } }[] = [
    { name: 'getBrandReach', url: '/api/analytics/brand-reach', call: () => service.getBrandReach('aaif') },
    { name: 'getEventGrowth', url: '/api/analytics/event-growth', call: () => service.getEventGrowth('aaif') },
    { name: 'getBrandHealth', url: '/api/analytics/brand-health', call: () => service.getBrandHealth('aaif', false, 'last-6') },
    { name: 'getMemberAcquisition', url: '/api/analytics/member-acquisition', call: () => service.getMemberAcquisition('aaif') },
    { name: 'getMemberRetention', url: '/api/analytics/member-retention', call: () => service.getMemberRetention('aaif') },
    { name: 'getEngagedCommunity', url: '/api/analytics/engaged-community', call: () => service.getEngagedCommunity('aaif') },
    { name: 'getWebActivitiesSummary', url: '/api/analytics/web-activities-summary', call: () => service.getWebActivitiesSummary('aaif', undefined, 'last-6') },
    {
      name: 'getEngagementGroupAttendance',
      url: '/api/analytics/engagement-group-attendance',
      // Its empty state claims the foundation has no matching groups, so a zero-filled response
      // reads as measured absence.
      call: () => service.getEngagementGroupAttendance({ foundationSlug: 'aaif', projectSlug: null, groupType: 'all', range: 'YTD', page: 1, size: 25 }),
    },
    {
      name: 'getEngagementOrgParticipation',
      url: '/api/analytics/engagement-org-participation',
      // An empty table renders "no organizations", which would state a failed read as measured fact.
      call: () => service.getEngagementOrgParticipation({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEngagementNonMemberParticipation',
      url: '/api/analytics/engagement-non-member-participation',
      // Its empty table renders "no non-member organizations", so a swallowed failure would read as
      // a measured absence of non-member attendance.
      call: () => service.getEngagementNonMemberParticipation({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEngagementRepresentatives',
      url: '/api/analytics/engagement-representatives',
      // Its empty table renders "no representatives match this filter", so a swallowed failure would
      // read as a foundation where nobody is in that group.
      call: () => service.getEngagementRepresentatives({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsRegistrationForecast',
      url: '/api/analytics/events-registration-forecast',
      // Its empty list renders "no upcoming events to forecast", which a swallowed failure would fake.
      call: () => service.getEventsRegistrationForecast({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsRegistrationForecastCurve',
      url: '/api/analytics/events-registration-forecast-curve',
      call: () => service.getEventsRegistrationForecastCurve({ foundationSlug: 'aaif', eventId: 'evt-1' }),
    },
    {
      name: 'getEventsPast',
      url: '/api/analytics/events-past',
      // Its empty list renders "no past events in this period", which a swallowed failure would fake.
      call: () => service.getEventsPast({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsAtAGlance',
      url: '/api/analytics/events-at-a-glance',
      // A swallowed failure would fake measured zeros, or once the empty state lands, "No events yet".
      call: () => service.getEventsAtAGlance({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsRegistrationsGrowth',
      url: '/api/analytics/events-registrations-growth',
      // A swallowed failure would read as a foundation with no years of events.
      call: () => service.getEventsRegistrationsGrowth({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsRevenue',
      url: '/api/analytics/events-revenue',
      // A swallowed failure would read as a foundation with no event revenue.
      call: () => service.getEventsRevenue({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsSpeakers',
      url: '/api/analytics/events-speakers',
      // A swallowed failure would read as a foundation with no proposals.
      call: () => service.getEventsSpeakers({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsOrganizations',
      url: '/api/analytics/events-organizations',
      // A swallowed failure would read as a foundation with no organizations at its events.
      call: () => service.getEventsOrganizations({ foundationSlug: 'aaif', range: 'YTD', segment: 'all', search: '', offset: 0, pageSize: 25 }),
    },
    {
      name: 'getEventsSponsorship',
      url: '/api/analytics/events-sponsorship',
      // A swallowed failure would read as a foundation with no sponsorship.
      call: () => service.getEventsSponsorship({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getEventsGeography',
      url: '/api/analytics/events-geography',
      // A swallowed failure would read as a foundation with no registrations by country.
      call: () => service.getEventsGeography({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getMembersTiers',
      url: '/api/analytics/members-tiers',
      // A swallowed failure would read as a foundation with no members in any tier.
      call: () => service.getMembersTiers({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getMembersBridge',
      url: '/api/analytics/members-bridge',
      // A swallowed failure would read as a year in which no member joined, moved or left.
      call: () => service.getMembersBridge({ foundationSlug: 'aaif' }),
    },
    {
      name: 'getMembersMovements',
      url: '/api/analytics/members-movements',
      // A swallowed failure would read as a bar with no organizations behind it.
      call: () => service.getMembersMovements({ foundationSlug: 'aaif', year: 2026, movementType: 'new', offset: 0, pageSize: 25 }),
    },
    {
      name: 'getMembersDirectory',
      url: '/api/analytics/members-directory',
      // A swallowed failure would read as a foundation with no members.
      call: () => service.getMembersDirectory({ foundationSlug: 'aaif', range: 'YTD', tier: '', nps: '', search: '', offset: 0, pageSize: 10 }),
    },
    {
      name: 'getMembersDirectoryTiers',
      url: '/api/analytics/members-directory-tiers',
      // A swallowed failure would read as a foundation with no tiers.
      call: () => service.getMembersDirectoryTiers('aaif'),
    },
  ];

  for (const { name, url, call } of endpoints) {
    it(`${name} propagates a 500 rather than resolving to a zero-filled response`, () => {
      let errored = false;
      let emitted: unknown;

      call().subscribe({
        next: (value: unknown) => (emitted = value),
        error: () => (errored = true),
      });

      http.expectOne((req) => req.url === url).flush('upstream failed', { status: 500, statusText: 'Server Error' });

      expect(errored).toBe(true);
      // The specific regression: an error resolved into a shaped object the caller reads as data.
      expect(emitted).toBeUndefined();
    });
  }

  // Angular's default codec leaves `+` bare, which Express's query parser reads as a space.
  it('getEventsOrganizations sends a typed plus sign encoded, not as a space', () => {
    service.getEventsOrganizations({ foundationSlug: 'aaif', range: 'YTD', segment: 'all', search: 'A+E', offset: 0, pageSize: 25 }).subscribe();

    const req = http.expectOne((request) => request.url === '/api/analytics/events-organizations');
    expect(req.request.urlWithParams).toContain('search=A%2BE');
    req.flush({ rows: [], totalRecords: 0, scopeTotal: 0 });
  });

  it('getMembersDirectory sends a typed plus sign encoded and leaves empty filters out', () => {
    service.getMembersDirectory({ foundationSlug: 'aaif', range: 'YTD', tier: 'Gold+', nps: '', search: 'A+E', offset: 0, pageSize: 10 }).subscribe();

    const req = http.expectOne((request) => request.url === '/api/analytics/members-directory');
    expect(req.request.urlWithParams).toContain('search=A%2BE');
    expect(req.request.urlWithParams).toContain('tier=Gold%2B');
    expect(req.request.params.has('nps')).toBe(false);
    req.flush({ rows: [], totalRecords: 0, scopeTotal: 0, atRiskCount: 0 });
  });

  afterEach(() => {
    http.verify();
  });
});
