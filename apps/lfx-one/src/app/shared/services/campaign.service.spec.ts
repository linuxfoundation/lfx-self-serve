// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CAMPAIGN_NEWSLETTER_CACHE_TTL_MS } from '@lfx-one/shared/constants';

import { CampaignService } from './campaign.service';
import { SseService } from './sse.service';

describe('CampaignService', () => {
  let service: CampaignService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SseService, useValue: { connect: vi.fn() } }],
    });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends a Meta targeting search with a literal plus encoded, so C++ is not read as C', () => {
    service.searchMetaTargetingOptions('tlf', 'work_position', 'C++ developer').subscribe();
    const req = http.expectOne((r) => r.url === '/api/campaigns/meta/targeting-search');
    expect(req.request.urlWithParams).toBe('/api/campaigns/meta/targeting-search?project=tlf&type=work_position&query=C%2B%2B%20developer');
    req.flush({ type: 'work_position', options: [] });
  });

  it('reads the LinkedIn audiences of the default account, or of the account named', () => {
    service.getLinkedInAudiences('tlf').subscribe();
    service.getLinkedInAudiences('tlf', '100000002').subscribe();
    const reqs = http.match((r) => r.url === '/api/campaigns/linkedin/audiences');
    expect(reqs.map((req) => req.request.urlWithParams)).toEqual([
      '/api/campaigns/linkedin/audiences?project=tlf',
      '/api/campaigns/linkedin/audiences?project=tlf&accountId=100000002',
    ]);
    reqs.forEach((req) => req.flush({ accountId: '', audiences: [] }));
  });

  it('reads the LinkedIn conversion rules of the default account, or of the account named', () => {
    service.getLinkedInConversions('tlf').subscribe();
    service.getLinkedInConversions('tlf', '100000002').subscribe();
    const reqs = http.match((r) => r.url === '/api/campaigns/linkedin/conversions');
    expect(reqs.map((req) => req.request.urlWithParams)).toEqual([
      '/api/campaigns/linkedin/conversions?project=tlf',
      '/api/campaigns/linkedin/conversions?project=tlf&accountId=100000002',
    ]);
    reqs.forEach((req) => req.flush({ accountId: '', conversions: [] }));
  });

  it('reads the LinkedIn lead gen forms of the default account, or of the account named', () => {
    service.getLinkedInLeadForms('tlf').subscribe();
    service.getLinkedInLeadForms('tlf', '100000002').subscribe();
    const reqs = http.match((r) => r.url === '/api/campaigns/linkedin/lead-forms');
    expect(reqs.map((req) => req.request.urlWithParams)).toEqual([
      '/api/campaigns/linkedin/lead-forms?project=tlf',
      '/api/campaigns/linkedin/lead-forms?project=tlf&accountId=100000002',
    ]);
    reqs.forEach((req) => req.flush({ accountId: '', forms: [] }));
  });

  describe('newsletter caches', () => {
    afterEach(() => vi.useRealTimers());

    it("reuses a brand's previous-issue read for a few minutes, then reads again so a newly sent issue shows", () => {
      vi.useFakeTimers();
      const url = '/api/campaigns/audience-builder/brand-newsletters';
      service.getAudienceBrandNewsletters('tlf', 'Acme', 3).subscribe();
      http.expectOne((req) => req.url === url).flush([]);
      service.getAudienceBrandNewsletters('tlf', 'Acme', 3).subscribe();
      http.expectNone((req) => req.url === url);

      vi.advanceTimersByTime(CAMPAIGN_NEWSLETTER_CACHE_TTL_MS + 1);
      service.getAudienceBrandNewsletters('tlf', 'Acme', 3).subscribe();
      http.expectOne((req) => req.url === url).flush([]);
    });
  });
});
