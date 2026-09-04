// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { CAMPAIGN_JOB_POLL_INTERVAL_MS, JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import {
  AudienceDemographics,
  BriefMetrics,
  BuildAudienceResult,
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignDeliveryType,
  CampaignEmailStage,
  CampaignJobOutcome,
  CampaignJobStatus,
  CampaignListResult,
  CampaignMetricsWindow,
  CampaignMonitorResponse,
  CampaignSSEEventType,
  CampaignStatusToggleParams,
  CampaignStatusUpdateResult,
  GenerateEmailCopyResult,
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

  public generateBrief(projectSlug: string, request: CampaignBriefRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    const url = `/api/campaigns/brief/generate?project=${encodeURIComponent(projectSlug)}`;
    return this.sse.connect<CampaignSSEEventType>(url, {
      method: 'POST',
      body: request,
    });
  }

  public refineBrief(projectSlug: string, request: CampaignBriefRefineRequest): Observable<SSEEvent<CampaignSSEEventType>> {
    const url = `/api/campaigns/brief/refine?project=${encodeURIComponent(projectSlug)}`;
    return this.sse.connect<CampaignSSEEventType>(url, {
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
        // No validator BY CHOICE: either the user saw the stale-brief warning and proceeded, or
        // they restored a brief whose read carried no ETag. Both are decisions taken on content
        // that was displayed. Without this the server cannot tell either from "the write returned
        // no ETag", and substituting a freshly read validator for THAT would bypass the
        // precondition silently.
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
  public loadBrief(
    eventSlug: string,
    projectSlug: string,
    deliveryType: CampaignDeliveryType = 'paid-marketing',
    // Which send in an email series to open. Empty addresses the paid brief, which has no series.
    stage: CampaignEmailStage | '' = ''
  ): Observable<CampaignBriefLoadResult> {
    return this.http.get<CampaignBriefLoadResult>('/api/campaigns/brief', {
      // `delivery_type` and `stage` are two of the four parts of a brief's identity upstream, which
      // keys a row on `(project, event_slug, delivery_type, stage)`. They are not filters over a
      // result set: an event holds a paid brief AND one per stage of its email series, so a lookup
      // naming only the slug does not name one brief. Sending them is what makes a send
      // addressable; omitting them is what once handed an email caller a paid brief and kept the
      // email restore path disabled.
      //
      // Both are defaulted here as well as on the server so the two agree on what an omitted
      // parameter means: `paid-marketing` and the empty stage — the identity every brief written
      // before the widening carries, since paid was the only surface that could save one.
      params: new HttpParams().set('event_slug', eventSlug).set('project', projectSlug).set('delivery_type', deliveryType).set('stage', stage),
    });
  }

  /**
   * Build the brief's send audience. No body — campaign-service derives it from the brief itself.
   */
  public buildAudience(projectSlug: string, briefId: string): Observable<BuildAudienceResult> {
    return this.http.post<BuildAudienceResult>(
      '/api/campaigns/audience/build',
      {},
      { params: new HttpParams().set('project', projectSlug).set('brief_id', briefId) }
    );
  }

  /**
   * Generate email copy for a brief. Brief-scoped upstream, so both ids are required.
   */
  public generateEmailCopy(projectSlug: string, briefId: string, stage?: CampaignEmailStage): Observable<GenerateEmailCopyResult> {
    // `stage` travels in this request's BODY, and in the BFF's own request to campaign-service it
    // travels in the QUERY STRING. The two hops differ deliberately: declaring it as a Goa body
    // attribute upstream made the whole request body mandatory -- Goa emits
    // `requestBody.required: true` and answers `MissingPayloadError` on EOF -- so every body-less
    // POST began failing with a 400. The comment above previously described only the upstream hop
    // and read as a claim about this one.
    //
    // Omitted when absent rather than sent empty, because those mean different things to a caller
    // reading the request: absence is "did not say". Upstream resolves BOTH to Registration Push
    // (LFXV2-1940 specifies a fallback, and the enum that would have rejected a typo was removed
    // for it), so an unrecognised value returns 200 with registration copy rather than an error.
    return this.http.post<GenerateEmailCopyResult>('/api/campaigns/email-copy', stage ? { stage } : {}, {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
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

  public getMonitorData(projectSlug: string, days: number = 30): Observable<CampaignMonitorResponse> {
    return this.http.get<CampaignMonitorResponse>('/api/campaigns/monitor', { params: { project: projectSlug, days } });
  }

  public getLinkedInAccounts(projectSlug: string): Observable<LinkedInAccount[]> {
    return this.http.get<LinkedInAccount[]>('/api/campaigns/linkedin/accounts', { params: { project: projectSlug } });
  }

  public getLinkedInMonitorData(projectSlug: string, accountKey: string, days: number = 30): Observable<LinkedInMonitorResponse> {
    return this.http.get<LinkedInMonitorResponse>('/api/campaigns/linkedin/monitor', { params: { project: projectSlug, days, accountKey } });
  }

  public getRedditAccounts(projectSlug: string): Observable<RedditAccountOption[]> {
    return this.http.get<RedditAccountOption[]>('/api/campaigns/reddit/accounts', { params: { project: projectSlug } });
  }

  public getRedditMonitorData(projectSlug: string, accountKey: string, days: number = 30): Observable<RedditMonitorResponse> {
    return this.http.get<RedditMonitorResponse>('/api/campaigns/reddit/monitor', { params: { project: projectSlug, days, accountKey } });
  }

  public getMetaAccounts(projectSlug: string): Observable<MetaAccountOption[]> {
    return this.http.get<MetaAccountOption[]>('/api/campaigns/meta/accounts', { params: { project: projectSlug } });
  }

  public getMetaMonitorData(projectSlug: string, accountKey: string, days: number = 30): Observable<MetaMonitorResponse> {
    return this.http.get<MetaMonitorResponse>('/api/campaigns/meta/monitor', { params: { project: projectSlug, days, accountKey } });
  }

  public getKeywords(projectSlug: string, days: number = 30): Observable<KeywordMetricsResponse> {
    return this.http.get<KeywordMetricsResponse>('/api/campaigns/keywords', { params: { project: projectSlug, days } });
  }

  public getAudience(projectSlug: string, days: number = 30): Observable<AudienceDemographics> {
    return this.http.get<AudienceDemographics>('/api/campaigns/audience', { params: { project: projectSlug, days } });
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

  /**
   * Pause or resume a campaign on its ad platform.
   *
   * This is the only write in this service that changes money-affecting state on a third party:
   * a successful response means the ad platform itself moved, not that a row was updated. Pause
   * is the primary cost-control lever on a mis-targeted or overspending campaign, which is why
   * it is worth reaching from the UI rather than sending someone to the platform's own console.
   *
   * `etag` is REQUIRED, not defensive. The server sends it upstream as `If-Match`, and a 412 back
   * means another editor moved the campaign since this view read it — the toggle is refused
   * rather than applied on the strength of a stale view. Callers must pass the etag they read
   * with the campaign, not one cached from an earlier render.
   *
   * `projectSlug` travels as a query param for the reason `searchHubSpotEmails` takes one: the
   * campaign is addressed per-project upstream and the server refuses rather than defaulting.
   */
  public updateCampaignStatus(request: CampaignStatusToggleParams): Observable<CampaignStatusUpdateResult> {
    const { projectSlug, briefId, campaignId, platform, status, etag } = request;
    return this.http.patch<CampaignStatusUpdateResult>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/status`,
      { platform, status, briefId, etag },
      { params: new HttpParams().set('project', projectSlug) }
    );
  }

  /**
   * List the campaigns a brief created.
   *
   * The read that makes a campaign addressable after the creating session ends. The create job
   * returns ids only to the tab that ran it, so without this a reload loses every handle to the
   * campaigns it just made — which is why per-campaign pause and metrics are unreachable today.
   *
   * `possiblyStale` on the result matters and should not be discarded: indexing is asynchronous,
   * so an empty list moments after a create means "not indexed yet", not "nothing was created".
   * Rendering "no campaigns" for that window would tell the user their spend does not exist.
   */
  public listBriefCampaigns(projectSlug: string, briefId: string): Observable<CampaignListResult> {
    return this.http.get<CampaignListResult>('/api/campaigns/list', {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
    });
  }

  /**
   * Reads campaign-service's own metrics for every campaign on one brief.
   *
   * `window` is deliberately optional and is NOT defaulted here. campaign-service resolves a
   * per-platform default inside its fan-out, so sending a constant would override a considered
   * per-row choice with a guess made in the browser. The BFF refuses a present-but-empty or
   * repeated value, so only omit it — never send `''`.
   *
   * Callers must read `rows[].status` before `rows[].metrics`: a row that could not be measured
   * omits `metrics` entirely rather than zero-filling it, and defaulting the absence to zeroes
   * would render an unsent draft or an outage as a measurement of nothing.
   */
  public getBriefMetrics(projectSlug: string, briefId: string, window?: CampaignMetricsWindow): Observable<BriefMetrics> {
    let params = new HttpParams().set('project', projectSlug).set('brief_id', briefId);
    if (window !== undefined) {
      params = params.set('window', window);
    }
    return this.http.get<BriefMetrics>('/api/campaigns/brief/metrics', { params });
  }

  public lookupHubSpotUtm(projectSlug: string, eventName: string): Observable<HubSpotUtmLookupResult> {
    return this.http.get<HubSpotUtmLookupResult>('/api/campaigns/hubspot/utm', { params: { project: projectSlug, event_name: eventName } });
  }

  public createHubSpotUtm(projectSlug: string, eventName: string): Observable<HubSpotUtmCreateResult> {
    return this.http.post<HubSpotUtmCreateResult>('/api/campaigns/hubspot/utm/create', {}, { params: { project: projectSlug, event_name: eventName } });
  }

  public executeKeywordActions(projectSlug: string, request: BulkKeywordActionRequest): Observable<BulkKeywordActionResponse> {
    return this.http.post<BulkKeywordActionResponse>('/api/campaigns/keywords/actions', request, { params: { project: projectSlug } });
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
