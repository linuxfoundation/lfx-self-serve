// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { CREATIVE_ASSET_READ_RETRIES } from '@lfx-one/shared/constants';
import { CreativeAssetPlan } from '@lfx-one/shared/interfaces';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  /** #5385: the plan is re-read after every stored file, as the library is, so it rides out a busy service the same way. */
  it('sends the plan read again after a 503, backed off, and answers with the retry', () => {
    vi.useFakeTimers();
    try {
      let plan: CreativeAssetPlan | null = null;
      service.getCreativeAssetPlan('tlf', BRIEF_ID, ['google-ads']).subscribe((answer) => (plan = answer));
      const planUrl = (r: { url: string }) => r.url === '/api/campaigns/brief/creative-assets/plan';

      http.expectOne(planUrl).flush({ message: 'busy' }, { status: 503, statusText: 'Unavailable' });
      vi.advanceTimersByTime(999);
      http.expectNone(planUrl);
      vi.advanceTimersByTime(1);
      http.expectOne(planUrl).flush(EMPTY_PLAN);

      expect(plan).toEqual(EMPTY_PLAN);
    } finally {
      vi.useRealTimers();
    }
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

  it('rethrows a refused read at once instead of defaulting to an empty library', () => {
    let status = 0;
    service.listCreativeAssets('tlf', BRIEF_ID).subscribe({ error: (e: { status: number }) => (status = e.status) });

    // A refusal is not retried: only a transient failure is.
    http.expectOne((r) => r.url === '/api/campaigns/brief/creative-assets').flush({ message: 'brief not found' }, { status: 404, statusText: 'Not Found' });

    expect(status).toBe(404);
  });

  describe('a transient failure during an upload run (#5385)', () => {
    const LIBRARY = { assets: [], count: 0, countLimit: 50, bytesUsed: 0, bytesLimit: 1 };
    const libraryUrl = (r: { url: string }) => r.url === '/api/campaigns/brief/creative-assets';

    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('sends the read again after a 503, waiting 1 s then 2 s, and answers with the retry without an error', () => {
      let count = -1;
      let failed = false;
      service.listCreativeAssets('tlf', BRIEF_ID).subscribe({ next: (library) => (count = library.count), error: () => (failed = true) });

      http.expectOne(libraryUrl).flush({ message: 'busy' }, { status: 503, statusText: 'Unavailable' });
      vi.advanceTimersByTime(999);
      http.expectNone(libraryUrl);
      vi.advanceTimersByTime(1);
      http.expectOne(libraryUrl).flush({ message: 'busy' }, { status: 503, statusText: 'Unavailable' });
      vi.advanceTimersByTime(1999);
      http.expectNone(libraryUrl);
      vi.advanceTimersByTime(1);
      http.expectOne(libraryUrl).flush({ ...LIBRARY, count: 3 });

      expect(count).toBe(3);
      expect(failed).toBe(false);
    });

    it('retries a dropped connection too', () => {
      let count = -1;
      service.listCreativeAssets('tlf', BRIEF_ID).subscribe((library) => (count = library.count));

      http.expectOne(libraryUrl).error(new ProgressEvent('error'));
      vi.advanceTimersByTime(1000);
      http.expectOne(libraryUrl).flush(LIBRARY);

      expect(count).toBe(0);
    });

    it('reports the failure once the retries are spent, never an empty library', () => {
      let status = 0;
      let answered = false;
      service.listCreativeAssets('tlf', BRIEF_ID).subscribe({ next: () => (answered = true), error: (e: { status: number }) => (status = e.status) });

      for (let attempt = 0; attempt <= CREATIVE_ASSET_READ_RETRIES; attempt++) {
        http.expectOne(libraryUrl).flush({ message: 'busy' }, { status: 503, statusText: 'Unavailable' });
        vi.advanceTimersByTime(1000 * 2 ** attempt);
      }

      http.expectNone(libraryUrl);
      expect(status).toBe(503);
      expect(answered).toBe(false);
    });
  });
});
