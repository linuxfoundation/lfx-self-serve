// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GoogleAdsGeoTargetSearchResult } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignService } from './campaign.service';

// The location picker's request. `targetTypes` must REPEAT on the query string — the BFF reads an
// array that way and campaign-service decodes `target_types` the same way — and an option the caller
// did not set must be absent rather than sent empty, so upstream's own default applies.
describe('CampaignService google geo target search request', () => {
  const EMPTY: GoogleAdsGeoTargetSearchResult = { suggestions: [], truncated: false };

  let service: CampaignService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends only the project and the query when no option is set', () => {
    service.searchGoogleAdsGeoTargets('tlf', 'Austin').subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/geo-targets');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys().sort()).toEqual(['project', 'q']);
    expect(req.request.params.get('project')).toBe('tlf');
    expect(req.request.params.get('q')).toBe('Austin');
    req.flush(EMPTY);
  });

  it('appends one targetTypes param per entry, and the country and limit beside them', () => {
    service.searchGoogleAdsGeoTargets('tlf', '78701', { countryCode: 'US', targetTypes: ['Postal Code', 'City'], limit: 20 }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/geo-targets');
    expect(req.request.params.getAll('targetTypes')).toEqual(['Postal Code', 'City']);
    expect(req.request.params.get('countryCode')).toBe('US');
    expect(req.request.params.get('limit')).toBe('20');
    req.flush(EMPTY);
  });

  /** Express reads a literal `+` as a space, so the typed `+` must reach the wire as `%2B`. */
  it("encodes a typed '+' so the BFF does not read it as a space", () => {
    service.searchGoogleAdsGeoTargets('tlf', 'St. Kitts + Nevis').subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/geo-targets');
    expect(req.request.urlWithParams).toContain('q=St.%20Kitts%20%2B%20Nevis');
    req.flush(EMPTY);
  });

  it('leaves an empty location type list off the wire', () => {
    service.searchGoogleAdsGeoTargets('tlf', 'Austin', { targetTypes: [] }).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/geo-targets');
    expect(req.request.params.has('targetTypes')).toBe(false);
    req.flush(EMPTY);
  });
});
