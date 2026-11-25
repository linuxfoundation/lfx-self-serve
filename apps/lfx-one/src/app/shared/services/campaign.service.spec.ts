// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
});
