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

  afterEach(() => {
    http.verify();
  });
});
