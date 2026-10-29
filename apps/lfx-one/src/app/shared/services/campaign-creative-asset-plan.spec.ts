// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CreativeAssetPlan } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CampaignService } from './campaign.service';

// campaign-service reads `platforms` in its REPEATABLE form. A joined string would be read as one
// platform named "a,b", match no published slot rules, and come back as a plan with no gaps — which
// is indistinguishable from a library that is ready to launch. The wire form is the whole test.
describe('CampaignService creative-asset plan request', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
  const EMPTY_PLAN: CreativeAssetPlan = { platforms: [], assignments: [], gaps: [], unclassified: [], unused: [] };

  let service: CampaignService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('appends one platforms param per entry rather than joining them into one value', () => {
    service.getCreativeAssetPlan('tlf', BRIEF_ID, ['google-ads', 'reddit-ads']).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets/plan');
    expect(req.request.params.getAll('platforms')).toEqual(['google-ads', 'reddit-ads']);
    expect(req.request.params.get('project')).toBe('tlf');
    expect(req.request.params.get('brief_id')).toBe(BRIEF_ID);
    req.flush(EMPTY_PLAN);
  });

  it('appends no platforms param at all when none are picked, so the service plans for every platform it publishes rules for', () => {
    service.getCreativeAssetPlan('tlf', BRIEF_ID).subscribe();

    const req = http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets/plan');
    expect(req.request.params.has('platforms')).toBe(false);
    req.flush(EMPTY_PLAN);
  });

  it('rethrows a refused read instead of defaulting to an empty plan', () => {
    let status = 0;
    let plan: CreativeAssetPlan | null = null;
    service.getCreativeAssetPlan('tlf', BRIEF_ID, ['google-ads']).subscribe({
      next: (answer) => (plan = answer),
      error: (e: { status: number }) => (status = e.status),
    });

    http
      .expectOne((r) => r.url === '/api/campaigns/brief/creative-assets/plan')
      .flush({ message: 'brief not found' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
    // An empty plan has no gaps, which is exactly how a launch-ready library reads.
    expect(plan).toBeNull();
  });
});

// The Google image slots read the library to tell which stored images fit them. A failed read must
// stay a failure: an empty library would read as "every held image was deleted".
describe('CampaignService creative-asset library request', () => {
  const BRIEF_ID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';

  let service: CampaignService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(CampaignService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads the library for the project and brief', () => {
    let count = -1;
    service.listCreativeAssets('tlf', BRIEF_ID).subscribe((library) => (count = library.count));

    const req = http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.get('project')).toBe('tlf');
    expect(req.request.params.get('brief_id')).toBe(BRIEF_ID);
    req.flush({ assets: [], count: 0, countLimit: 50, bytesUsed: 0, bytesLimit: 1 });
    expect(count).toBe(0);
  });

  it('rethrows a refused read instead of defaulting to an empty library', () => {
    let status = 0;
    service.listCreativeAssets('tlf', BRIEF_ID).subscribe({ error: (e: { status: number }) => (status = e.status) });

    http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets').flush({ message: 'down' }, { status: 503, statusText: 'Unavailable' });

    expect(status).toBe(503);
  });
});
