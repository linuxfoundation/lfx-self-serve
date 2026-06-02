// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  AudienceDemographics,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignJobStatus,
  CampaignMonitorResponse,
  CampaignSSEEventType,
  HubSpotUtmCreateResult,
  HubSpotUtmLookupResult,
  KeywordMetricsResponse,
  SSEEvent,
} from '@lfx-one/shared/interfaces';
import { exhaustMap, last, map, Observable, of, take, takeWhile, timer } from 'rxjs';

import { SseService } from './sse.service';

const CAMPAIGN_JOB_POLL_INTERVAL_MS = 2000;

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly http = inject(HttpClient);
  private readonly sse = inject(SseService);

  public generateBrief(request: CampaignBriefRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    return this.sse.connect<CampaignSSEEventType>('/api/campaigns/brief/generate', {
      method: 'POST',
      body: request,
    });
  }

  public createCampaign(request: CampaignCreateRequest): Observable<{ jobId: string }> {
    return this.http.post<{ jobId: string }>('/api/campaigns/create', request);
  }

  public getCreateResult(jobId: string): Observable<CampaignCreateResponse | null> {
    if (!jobId) {
      return of(null);
    }

    return this.pollJobStatus(jobId).pipe(
      last(),
      map((status) => {
        if (status.status === 'done') return status.result ?? null;
        if (status.status === 'error') throw new Error(status.error || 'Campaign creation failed');
        if (status.status === 'not_found') throw new Error('Job not found');
        throw new Error('Campaign creation timed out');
      })
    );
  }

  public getMonitorData(days: number = 14): Observable<CampaignMonitorResponse> {
    return this.http.get<CampaignMonitorResponse>('/api/campaigns/monitor', { params: { days } });
  }

  public getKeywords(days: number = 14): Observable<KeywordMetricsResponse> {
    return this.http.get<KeywordMetricsResponse>('/api/campaigns/keywords', { params: { days } });
  }

  public getAudience(days: number = 14): Observable<AudienceDemographics> {
    return this.http.get<AudienceDemographics>('/api/campaigns/audience', { params: { days } });
  }

  public lookupHubSpotUtm(eventName: string): Observable<HubSpotUtmLookupResult> {
    return this.http.get<HubSpotUtmLookupResult>('/api/campaigns/hubspot/utm', { params: { event_name: eventName } });
  }

  public createHubSpotUtm(eventName: string): Observable<HubSpotUtmCreateResult> {
    return this.http.post<HubSpotUtmCreateResult>('/api/campaigns/hubspot/utm/create', {}, { params: { event_name: eventName } });
  }

  private pollJobStatus(jobId: string): Observable<CampaignJobStatus> {
    const maxPolls = Math.ceil(300_000 / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    return timer(0, CAMPAIGN_JOB_POLL_INTERVAL_MS).pipe(
      take(maxPolls),
      exhaustMap(() => this.http.get<CampaignJobStatus>(`/api/campaigns/jobs/${encodeURIComponent(jobId)}`)),
      takeWhile((status) => status.status === 'running', true)
    );
  }
}
