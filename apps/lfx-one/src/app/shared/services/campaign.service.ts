// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CAMPAIGN_JOB_POLL_INTERVAL_MS } from '@lfx-one/shared/constants';
import {
  AudienceDemographics,
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignJobStatus,
  CampaignMonitorResponse,
  CampaignSSEEventType,
  HubSpotUtmCreateResult,
  HubSpotUtmLookupResult,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInMonitorResponse,
  MetaAccountOption,
  MetaMonitorResponse,
  RedditAccountOption,
  RedditMonitorResponse,
  SSEEvent,
} from '@lfx-one/shared/interfaces';
import { exhaustMap, last, map, Observable, of, take, takeWhile, timer } from 'rxjs';

import { ProjectContextService } from './project-context.service';
import { SseService } from './sse.service';

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly http = inject(HttpClient);
  private readonly sse = inject(SseService);
  private readonly projectContextService = inject(ProjectContextService);

  /**
   * Returns the `foundationSlug` of the currently selected foundation.
   * Sent on every campaign request so the server can resolve the foundation
   * project and enforce the campaign_viewer / campaign_manager FGA relation.
   * See LFXV2-2235.
   */
  private get foundationSlug(): string | undefined {
    return this.projectContextService.selectedFoundation()?.slug ?? undefined;
  }

  public generateBrief(request: CampaignBriefRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    const slug = this.foundationSlug;
    const url = slug ? `/api/campaigns/brief/generate?foundationSlug=${encodeURIComponent(slug)}` : '/api/campaigns/brief/generate';
    return this.sse.connect<CampaignSSEEventType>(url, { method: 'POST', body: request });
  }

  public refineBrief(request: CampaignBriefRefineRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    const slug = this.foundationSlug;
    const url = slug ? `/api/campaigns/brief/refine?foundationSlug=${encodeURIComponent(slug)}` : '/api/campaigns/brief/refine';
    return this.sse.connect<CampaignSSEEventType>(url, { method: 'POST', body: request });
  }

  public createCampaign(request: CampaignCreateRequest): Observable<{ jobId: string; result?: CampaignCreateResponse; error?: string }> {
    const slug = this.foundationSlug;
    return this.http.post<{ jobId: string; result?: CampaignCreateResponse; error?: string }>('/api/campaigns/create', request, {
      ...(slug && { params: { foundationSlug: slug } }),
    });
  }

  public getCreateResult(jobId: string): Observable<CampaignCreateResponse | null> {
    if (!jobId) {
      return of(null);
    }

    return this.pollJobStatus(jobId).pipe(
      last(),
      map((status) => {
        if (status.status === 'done') return status.result ?? null;
        if (status.status === 'error') throw new Error(status.error || 'Campaign creation was unsuccessful. Please try again.');
        if (status.status === 'not_found') throw new Error('Lost connection to the campaign creation process. Please try again.');
        throw new Error('Campaign creation is taking longer than expected. Check Google Ads to see if your campaign was created.');
      })
    );
  }

  public getMonitorData(days: number = 30): Observable<CampaignMonitorResponse> {
    return this.http.get<CampaignMonitorResponse>('/api/campaigns/monitor', { params: { days, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getLinkedInAccounts(): Observable<LinkedInAccount[]> {
    return this.http.get<LinkedInAccount[]>('/api/campaigns/linkedin/accounts', { params: { ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getLinkedInMonitorData(accountKey: string, days: number = 30): Observable<LinkedInMonitorResponse> {
    return this.http.get<LinkedInMonitorResponse>('/api/campaigns/linkedin/monitor', { params: { days, accountKey, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getRedditAccounts(): Observable<RedditAccountOption[]> {
    return this.http.get<RedditAccountOption[]>('/api/campaigns/reddit/accounts', { params: { ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getRedditMonitorData(accountKey: string, days: number = 30): Observable<RedditMonitorResponse> {
    return this.http.get<RedditMonitorResponse>('/api/campaigns/reddit/monitor', { params: { days, accountKey, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getMetaAccounts(): Observable<MetaAccountOption[]> {
    return this.http.get<MetaAccountOption[]>('/api/campaigns/meta/accounts', { params: { ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getMetaMonitorData(accountKey: string, days: number = 30): Observable<MetaMonitorResponse> {
    return this.http.get<MetaMonitorResponse>('/api/campaigns/meta/monitor', { params: { days, accountKey, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getKeywords(days: number = 30): Observable<KeywordMetricsResponse> {
    return this.http.get<KeywordMetricsResponse>('/api/campaigns/keywords', { params: { days, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public getAudience(days: number = 30): Observable<AudienceDemographics> {
    return this.http.get<AudienceDemographics>('/api/campaigns/audience', { params: { days, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public lookupHubSpotUtm(eventName: string): Observable<HubSpotUtmLookupResult> {
    return this.http.get<HubSpotUtmLookupResult>('/api/campaigns/hubspot/utm', { params: { event_name: eventName, ...(this.foundationSlug && { foundationSlug: this.foundationSlug }) } });
  }

  public createHubSpotUtm(eventName: string): Observable<HubSpotUtmCreateResult> {
    const slug = this.foundationSlug;
    return this.http.post<HubSpotUtmCreateResult>('/api/campaigns/hubspot/utm/create', {}, { params: { event_name: eventName, ...(slug && { foundationSlug: slug }) } });
  }

  public executeKeywordActions(request: BulkKeywordActionRequest): Observable<BulkKeywordActionResponse> {
    const slug = this.foundationSlug;
    return this.http.post<BulkKeywordActionResponse>('/api/campaigns/keywords/actions', request, {
      ...(slug && { params: { foundationSlug: slug } }),
    });
  }

  private pollJobStatus(jobId: string): Observable<CampaignJobStatus> {
    const maxPolls = Math.ceil(300_000 / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    const slug = this.foundationSlug;
    return timer(0, CAMPAIGN_JOB_POLL_INTERVAL_MS).pipe(
      take(maxPolls),
      exhaustMap(() =>
        this.http.get<CampaignJobStatus>(`/api/campaigns/jobs/${encodeURIComponent(jobId)}`, {
          params: { ...(slug && { foundationSlug: slug }) },
        })
      ),
      takeWhile((status) => status.status === 'running', true)
    );
  }
}
