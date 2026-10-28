// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignService } from './campaign.service';
import { SseService } from './sse.service';

/**
 * The account-source marker on the Monitor tab's reads (#2519). A read whose account came from the
 * connection path carries `accountSource=connection`, so a pod with the monitor cutover OFF refuses
 * it instead of serving it from the legacy path; one from a legacy picker carries
 * `accountSource=legacy`, so a pod with it ON refuses that. A read with no source (the Optimize tab's)
 * must stay exactly as it was.
 */
describe('CampaignService monitor reads — account source marker', () => {
  let service: CampaignService;
  let get: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    get = vi.fn().mockReturnValue(of(null));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get } },
        { provide: SseService, useValue: {} },
      ],
    });
    service = TestBed.inject(CampaignService);
  });

  const params = (): Record<string, unknown> => (get.mock.calls[0][1] as { params: Record<string, unknown> }).params;

  it.each([
    ['getLinkedInMonitorData', '/api/campaigns/linkedin/monitor'],
    ['getRedditMonitorData', '/api/campaigns/reddit/monitor'],
    ['getMetaMonitorData', '/api/campaigns/meta/monitor'],
  ] as const)('%s sends no marker when no source is given', (method, url) => {
    service[method]('cncf', 'acct', 14).subscribe();

    expect(get.mock.calls[0][0]).toBe(url);
    expect(params()).toEqual({ project: 'cncf', days: 14, accountKey: 'acct' });
  });

  it.each(['getLinkedInMonitorData', 'getRedditMonitorData', 'getMetaMonitorData'] as const)(
    '%s marks a read whose account came from the connection',
    (method) => {
      service[method]('cncf', 'acct', 14, 'connection').subscribe();

      expect(params()).toEqual({ project: 'cncf', days: 14, accountKey: 'acct', accountSource: 'connection' });
    }
  );

  it.each(['getLinkedInMonitorData', 'getRedditMonitorData', 'getMetaMonitorData'] as const)(
    '%s marks a read whose account came from a legacy picker',
    (method) => {
      service[method]('cncf', 'acct', 14, 'legacy').subscribe();

      expect(params()).toEqual({ project: 'cncf', days: 14, accountKey: 'acct', accountSource: 'legacy' });
    }
  );

  it('always marks the campaign-service-only Microsoft, X and HubSpot reads', () => {
    service.getMicrosoftMonitorData('cncf', '187654321', 7).subscribe();
    service.getTwitterMonitorData('cncf', '18ce54d4x5t', 7).subscribe();
    service.getHubSpotMonitorData('cncf', 7).subscribe();

    for (const call of get.mock.calls) {
      expect((call[1] as { params: Record<string, unknown> }).params['accountSource']).toBe('connection');
    }
  });
});

/** campaign-service Google Ads account discovery, read for the Monitor tab's Google Ads panel. */
describe('CampaignService.getGoogleAdsAccounts', () => {
  it('GETs the project-scoped account list with only the project, no account-source marker', () => {
    const accounts = [{ key: '1000000001', label: 'CNCF Search' }];
    const get = vi.fn().mockReturnValue(of(accounts));
    TestBed.configureTestingModule({
      providers: [
        { provide: HttpClient, useValue: { get } },
        { provide: SseService, useValue: {} },
      ],
    });
    let result: unknown;

    TestBed.inject(CampaignService)
      .getGoogleAdsAccounts('cncf')
      .subscribe((r) => (result = r));

    expect(get).toHaveBeenCalledWith('/api/campaigns/google/accounts', { params: { project: 'cncf' } });
    expect(result).toBe(accounts);
  });
});
