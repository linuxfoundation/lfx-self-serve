// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { GoogleAdsAudiencesResult } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignService } from './campaign.service';

// The audience pickers' read (#5244, #5262): the Demand Gen read sends the project alone, the Display
// reads add their type, and the interest search its trimmed `q`, which must survive the query string intact.
describe('CampaignService google audience read request', () => {
  const EMPTY: GoogleAdsAudiencesResult = { accountId: '1', audiences: [], truncated: false };

  let service: CampaignService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends only the project for the default Audience read, and a blank q not at all', () => {
    service.getGoogleAdsAudiences('tlf', 'audience', '   ').subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/audiences');
    expect(req.request.params.keys()).toEqual(['project']);
    req.flush(EMPTY);
  });

  it('sends the type and the trimmed q', () => {
    service.getGoogleAdsAudiences('tlf', 'user_interest', ' cloud ').subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/audiences');
    expect(req.request.params.get('type')).toBe('user_interest');
    expect(req.request.params.get('q')).toBe('cloud');
    req.flush(EMPTY);
  });

  /**
   * Express reads a literal `+` as a space, so a typed `+` must reach the wire as `%2B`. The strict codec
   * also keeps the characters Angular's default codec un-escapes (`=` here) encoded, so every typed
   * character reaches the BFF exactly as typed.
   */
  it("encodes a typed '+' and '=' so the BFF reads the search exactly as typed", () => {
    service.getGoogleAdsAudiences('tlf', 'user_interest', 'C++ & Go=fast').subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/google/audiences');
    expect(req.request.urlWithParams).toContain('q=C%2B%2B%20%26%20Go%3Dfast');
    req.flush(EMPTY);
  });
});
