// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CAMPAIGN_JOB_POLL_INTERVAL_MS, JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import {
  AudienceDemographics,
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignJobOutcome,
  CampaignJobStatus,
  CampaignMonitorResponse,
  CampaignSSEEventType,
  CampaignStatusUpdateRequest,
  CampaignStatusUpdateResult,
  HubSpotEmailSearchResult,
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
import { retryTransientHttpError } from '@shared/utils/http-error.utils';
import { exhaustMap, last, map, Observable, of, take, takeWhile, timer } from 'rxjs';

import { SseService } from './sse.service';

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

  public refineBrief(request: CampaignBriefRefineRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    return this.sse.connect<CampaignSSEEventType>('/api/campaigns/brief/refine', {
      method: 'POST',
      body: request,
    });
  }

  /**
   * Store the approved brief in campaign-service.
   *
   * Storage only — nothing reads it back yet, so a reload still loses the brief from the page.
   * The read path is LFXV2-3108. Saying "survives a reload" here would describe a round trip only
   * half of which exists.
   *
   * Fire-and-forget from the caller's point of view — the Planning → Implementation handoff must
   * not wait on it, because campaign creation still runs entirely client-side and a slow or
   * failing save would block work that does not depend on it. The result is reported in the UI
   * instead of thrown away; see `CampaignBriefPersistenceState`.
   *
   * `projectSlug` travels as a query param rather than in the body because the body IS the brief
   * — the server reads `req.body` as one — and because `?project=<slug>` is already how this
   * application names the active foundation on every route it scopes.
   */
  public persistBrief(
    brief: CampaignBriefOutput,
    projectSlug: string,
    knownBriefId: string | null = null,
    knownEtag: string | null = null,
    allowEtagFallback = false
  ): Observable<CampaignBriefPersistResult> {
    // `brief_id` is sent only when this session has established ownership of that row, which on
    // this branch has TWO sources: the page loaded the brief from campaign-service, or it created
    // the brief itself on an earlier save.
    //
    // Either is proof, and its absence is MEANINGFUL rather than merely missing: the server
    // refuses to replace a stored brief for a caller that cannot name it, so a freshly generated
    // brief creates and never overwrites one nobody here has seen (LFXV2-3200).
    let params = new HttpParams().set('project', projectSlug);
    if (knownBriefId !== null && knownBriefId !== '') {
      params = params.set('brief_id', knownBriefId);
      // Only alongside the id. An ETag on its own names no row, and the server pairs them.
      if (knownEtag !== null && knownEtag !== '') {
        params = params.set('etag', knownEtag);
      } else if (allowEtagFallback) {
        // No validator BY CHOICE: the user saw the stale-brief warning and proceeded. Without
        // this the server cannot tell that from "the write returned no ETag", and substituting a
        // freshly read validator for the second would bypass the precondition silently.
        params = params.set('etag_fallback', '1');
      }
    }
    return this.http.post<CampaignBriefPersistResult>('/api/campaigns/brief/persist', brief, { params });
  }

  /**
   * Load the brief previously saved for this event slug.
   *
   * `HttpParams` rather than string interpolation: an event slug is derived from a pasted URL's
   * last path segment and is not guaranteed to be URL-safe.
   *
   * `projectSlug` for the same reason `persistBrief` takes one — briefs are scoped and authorised
   * per project in campaign-service, and `/foundation/campaigns` is reachable by an ED of any
   * foundation. Reading without it would either 403 or, for a staffer holding several, offer to
   * restore a brief filed under a foundation they are not looking at. The server refuses the
   * request outright when it is missing rather than defaulting.
   */
  public loadBrief(eventSlug: string, projectSlug: string): Observable<CampaignBriefLoadResult> {
    return this.http.get<CampaignBriefLoadResult>('/api/campaigns/brief', {
      params: new HttpParams().set('event_slug', eventSlug).set('project', projectSlug),
    });
  }

  /**
   * `projectSlug` and `briefId` travel as query params because the campaign-service cutover reads
   * them there, not from the body: creation posts to
   * `/projects/{slug}/briefs/{id}/campaigns`, so both are path segments upstream and the server
   * has no other source for them. They are not optional in practice — with the cutover flag on,
   * a request missing either is refused outright and deliberately does NOT fall through to the
   * legacy path, since falling through would create the campaigns on the ad platforms while the
   * user is told creation failed.
   */
  public createCampaign(
    request: CampaignCreateRequest,
    projectSlug: string,
    briefId: string
  ): Observable<{ jobId: string; result?: CampaignCreateResponse; error?: string }> {
    return this.http.post<{ jobId: string; result?: CampaignCreateResponse; error?: string }>('/api/campaigns/create', request, {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
    });
  }

  public getCreateResult(jobId: string, projectSlug: string): Observable<CampaignJobOutcome | null> {
    if (!jobId) {
      return of(null);
    }

    return this.pollJobStatus(jobId, projectSlug).pipe(
      last(),
      map((status) => {
        // A `done` job always yields an outcome, even when neither field is populated.
        // Returning null for a finished job would leave the caller unable to tell "the job
        // ended" from "there is nothing yet", and the caller's timeout branch would then
        // report a completed create as one that took too long.
        if (status.status === 'done') {
          return {
            campaigns: status.result?.campaigns ?? [],
            errors: status.result?.errors ?? (status.error ? [status.error] : []),
            // NOT coalesced to `[]`, unlike the two above, and the asymmetry is deliberate.
            // `campaigns` and `errors` are non-optional on `CampaignJobOutcome`, so a caller
            // may iterate them unguarded. `platformResults` is optional precisely so that
            // "this path does not report per-platform outcomes" (the vendor-direct path)
            // stays distinguishable from "it does, and every platform failed". Defaulting it
            // to `[]` here would erase that distinction at the only place it is still visible.
            platformResults: status.platformResults,
          };
        }
        if (status.status === 'error') {
          const message = status.error || 'Campaign creation was unsuccessful. Please try again.';
          // A failed job that still reported per-platform results is a terminal OUTCOME, not a
          // bare error, and it must not be flattened into a thrown message. campaign-service
          // attaches `result` to `failed` jobs as well as successful ones, and a failed entry
          // can carry a `campaignId`: the campaign really was created upstream and only the
          // recording of it failed. That orphaned id is the one piece of state nobody can
          // recover from anywhere else — throwing here would leave real paid campaigns running
          // with nothing in this system pointing at them. Report the failure AND the rows.
          if (status.platformResults?.length) {
            return { campaigns: [], errors: [message], platformResults: status.platformResults };
          }
          throw new Error(message);
        }
        if (status.status === 'not_found') throw new Error(JOB_LOST_MESSAGE);
        throw new Error('Campaign creation is taking longer than expected. Check Google Ads to see if your campaign was created.');
      })
    );
  }

  public getMonitorData(days: number = 30): Observable<CampaignMonitorResponse> {
    return this.http.get<CampaignMonitorResponse>('/api/campaigns/monitor', { params: { days } });
  }

  /**
   * Pause or resume a campaign on its ad platform.
   *
   * The BFF route (`PATCH /api/campaigns/:campaignId/status`) and its handler have existed since
   * the status-toggle work landed, but nothing in this service called them — so the capability was
   * unreachable from the UI (LFXV2-3226). Pause is the primary cost-control lever: without it,
   * stopping a mis-targeted campaign means logging into the ad platform directly.
   *
   * `platform` is restricted to Meta and Reddit by the BFF's `SUPPORTED_STATUS_PLATFORMS`, and that
   * allowlist is CORRECT rather than stale — the handler dispatches through the legacy proxy, whose
   * switch has cases for exactly those two. campaign-service implements all six, but the BFF does
   * not route this endpoint to it yet, so a wider list here would produce a request the path below
   * cannot serve.
   *
   * `campaignId` is the PLATFORM's campaign id, not a campaign-service row id.
   */
  public updateCampaignStatus(campaignId: string, request: CampaignStatusUpdateRequest): Observable<CampaignStatusUpdateResult> {
    return this.http.patch<CampaignStatusUpdateResult>(`/api/campaigns/${encodeURIComponent(campaignId)}/status`, request);
  }

  public getLinkedInAccounts(): Observable<LinkedInAccount[]> {
    return this.http.get<LinkedInAccount[]>('/api/campaigns/linkedin/accounts');
  }

  public getLinkedInMonitorData(accountKey: string, days: number = 30): Observable<LinkedInMonitorResponse> {
    return this.http.get<LinkedInMonitorResponse>('/api/campaigns/linkedin/monitor', { params: { days, accountKey } });
  }

  public getRedditAccounts(): Observable<RedditAccountOption[]> {
    return this.http.get<RedditAccountOption[]>('/api/campaigns/reddit/accounts');
  }

  public getRedditMonitorData(accountKey: string, days: number = 30): Observable<RedditMonitorResponse> {
    return this.http.get<RedditMonitorResponse>('/api/campaigns/reddit/monitor', { params: { days, accountKey } });
  }

  public getMetaAccounts(): Observable<MetaAccountOption[]> {
    return this.http.get<MetaAccountOption[]>('/api/campaigns/meta/accounts');
  }

  public getMetaMonitorData(accountKey: string, days: number = 30): Observable<MetaMonitorResponse> {
    return this.http.get<MetaMonitorResponse>('/api/campaigns/meta/monitor', { params: { days, accountKey } });
  }

  public getKeywords(days: number = 30): Observable<KeywordMetricsResponse> {
    return this.http.get<KeywordMetricsResponse>('/api/campaigns/keywords', { params: { days } });
  }

  public getAudience(days: number = 30): Observable<AudienceDemographics> {
    return this.http.get<AudienceDemographics>('/api/campaigns/audience', { params: { days } });
  }

  /**
   * Search the project's HubSpot marketing emails, for the Email channel's template picker.
   *
   * `projectSlug` travels as a query param for the reason `loadBrief` takes one: a HubSpot
   * connection is per-project, and the server refuses the request rather than defaulting — so
   * one foundation's templates can never be listed to another.
   *
   * `query` may be empty, which lists the most recently updated templates. That is the useful
   * default before a user knows what they are looking for, and the service already orders by
   * last-modified.
   */
  public searchHubSpotEmails(projectSlug: string, query: string): Observable<HubSpotEmailSearchResult> {
    let params = new HttpParams().set('project', projectSlug);
    if (query !== '') {
      params = params.set('q', query);
    }
    return this.http.get<HubSpotEmailSearchResult>('/api/campaigns/hubspot/emails', { params });
  }

  public lookupHubSpotUtm(eventName: string): Observable<HubSpotUtmLookupResult> {
    return this.http.get<HubSpotUtmLookupResult>('/api/campaigns/hubspot/utm', { params: { event_name: eventName } });
  }

  public createHubSpotUtm(eventName: string): Observable<HubSpotUtmCreateResult> {
    return this.http.post<HubSpotUtmCreateResult>('/api/campaigns/hubspot/utm/create', {}, { params: { event_name: eventName } });
  }

  public executeKeywordActions(request: BulkKeywordActionRequest): Observable<BulkKeywordActionResponse> {
    return this.http.post<BulkKeywordActionResponse>('/api/campaigns/keywords/actions', request);
  }

  /**
   * Polls one create job until it reaches a terminal state, or until the five-minute budget runs out.
   *
   * The retry sits INSIDE `exhaustMap`, on the single status read, and that placement is the whole
   * point: an error raised in the outer pipe kills `timer` itself, so without it one 502 from a
   * redeploying pod ends the poll permanently while the job it was watching carries on creating paid
   * campaigns upstream. The user is then shown a failure next to a "Create Another" button, and the
   * campaigns that did get made are invisible to this system. Retrying the outer pipe instead would
   * restart the timer and re-run the whole schedule, which is not the same thing.
   *
   * Only transient reads are retried — `retryTransientHttpError` re-throws 4xx immediately, so an
   * expired session still surfaces at once rather than after two pointless round trips. Two attempts
   * past the first, rather than the shared default of one, because the cost of giving up early here
   * is an orphaned paid campaign and the cost of trying again is one more GET. A failure that
   * outlives all three still propagates: `getCreateResult` reports it, which is correct, because at
   * that point the job status genuinely is unknown.
   */
  private pollJobStatus(jobId: string, projectSlug: string): Observable<CampaignJobStatus> {
    const maxPolls = Math.ceil(300_000 / CAMPAIGN_JOB_POLL_INTERVAL_MS);
    return timer(0, CAMPAIGN_JOB_POLL_INTERVAL_MS).pipe(
      take(maxPolls),
      exhaustMap(() =>
        this.http
          .get<CampaignJobStatus>(`/api/campaigns/jobs/${encodeURIComponent(jobId)}`, {
            params: new HttpParams().set('project', projectSlug),
          })
          .pipe(retryTransientHttpError(2))
      ),
      takeWhile((status) => status.status === 'running', true)
    );
  }
}
