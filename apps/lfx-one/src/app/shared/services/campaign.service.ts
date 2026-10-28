// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import {
  CAMPAIGN_JOB_POLL_INTERVAL_MS,
  CREATIVE_ASSET_CANCELLED_UPLOADING_MESSAGE,
  CREATIVE_ASSET_CANCELLED_WAITING_MESSAGE,
  CREATIVE_ASSET_EMPTY_MESSAGE,
  CREATIVE_ASSET_FAILED_FALLBACK_MESSAGE,
  CREATIVE_ASSET_MAX_BYTES,
  CREATIVE_ASSET_PRESENT_MESSAGE,
  CREATIVE_ASSET_QUEUE_RETRIES,
  CREATIVE_ASSET_QUEUE_RETRY_BASE_MS,
  CREATIVE_ASSET_QUOTA_MESSAGE,
  CREATIVE_ASSET_REFUSED_FALLBACK_MESSAGE,
  CREATIVE_ASSET_SUBFOLDER_MESSAGE,
  CREATIVE_ASSET_TOO_LARGE_MESSAGE,
  CREATIVE_ASSET_UPLOADED_MESSAGE,
  CREATIVE_ASSET_WRONG_TYPE_MESSAGE,
  isCreativeAssetMimeType,
  JOB_LOST_MESSAGE,
  MONITOR_ACCOUNT_SOURCE_CONNECTION,
  MONITOR_ACCOUNT_SOURCE_LEGACY,
  MONITOR_ACCOUNT_SOURCE_PARAM,
} from '@lfx-one/shared/constants';
import {
  AudienceAttachExistingRequest,
  AudienceAttachExistingResult,
  AudienceBuilderCapabilities,
  AudienceComposeMasterRequest,
  AudienceComposeMasterResult,
  AudienceDemographics,
  AudienceDiscoverRequest,
  AudienceDiscoverySSEEventType,
  AudienceLastSentEmail,
  AudienceListSearchResult,
  AudienceMasterListBrief,
  AudiencePreviewCount,
  AudiencePreviewCountRequest,
  AudienceQaResult,
  AudienceQaRunRequest,
  AudienceSuppressionListsResult,
  BriefMetrics,
  BulkKeywordActionRequest,
  BulkKeywordActionResponse,
  CampaignBriefApproveResult,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignBriefRefineRequest,
  CampaignBidUpdateParams,
  CampaignBidUpdateRequest,
  CampaignBidUpdateResult,
  CampaignBriefRequest,
  CampaignBudgetUpdateParams,
  CampaignBudgetUpdateRequest,
  CampaignBudgetUpdateResult,
  CampaignCreateRequest,
  CampaignCreateResponse,
  CampaignDeliveryType,
  CampaignEmailSegment,
  CampaignEmailStage,
  CampaignEmailVariant,
  CampaignJobOutcome,
  CampaignJobStatus,
  CampaignListResult,
  CampaignMetricsWindow,
  CampaignMonitorConnections,
  CampaignMonitorResponse,
  CampaignNegativeKeywordInput,
  CampaignNegativeKeywordsRequest,
  CampaignNegativeKeywordsResult,
  CampaignSSEEventType,
  CampaignStatusToggleParams,
  CampaignStatusUpdateResult,
  CreativeAssetLibrary,
  CreativeAssetPlan,
  CreativeAssetQueueItem,
  CreativeAssetQueueRefusal,
  CreativeAssetUploadOwner,
  CreativeAssetUploadResult,
  GenerateEmailCopyResult,
  GoogleAdsAccountOption,
  GoogleAdsGeoTargetSearchOptions,
  GoogleAdsGeoTargetSearchResult,
  HubSpotEmailMonitorResponse,
  HubSpotEmailSearchResult,
  HubSpotUtmCreateResult,
  HubSpotUtmLookupResult,
  KeywordMetricsResponse,
  LinkedInAccount,
  LinkedInMonitorResponse,
  ListAudiencesResult,
  MetaAccountOption,
  MetaMonitorResponse,
  MicrosoftKeywordMetricsResponse,
  MicrosoftKeywordsWindow,
  RedditAccountOption,
  RedditMonitorResponse,
  ReportBackedMonitorResponse,
  SSEEvent,
  TwitterAdsAccountsResult,
  TwitterCreateCapability,
} from '@lfx-one/shared/interfaces';
import type {
  CampaignAdoptableBriefsResponse,
  CampaignAdoptRequest,
  CampaignAudiencePlatform,
  CampaignRecordResult,
  CampaignRefPlatform,
  CampaignServiceCampaign,
  CampaignServiceCampaignMetrics,
  CampaignServiceCampaignResolution,
  CampaignServiceKeywordTargeting,
  CampaignServiceKeywordTargetingRemovals,
  CampaignServiceMetaAds,
  CampaignServiceMetaAdSets,
  CampaignServiceMetaAdSetStatusChange,
  CampaignServicePlatformAudienceMap,
  CampaignServiceSettingsReadback,
  KeywordTargetingRemovalsRequest,
  MetaAdSetStatusParams,
  MetaAdSetStatusRequest,
  MonitorAccountSource,
  RedditKeywordMetricsResponse,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import { extractErrorMessage, isTransientHttpError, retryTransientHttpError } from '@shared/utils/http-error.utils';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { strictHttpParams } from '@shared/utils/http-params.utils';
import {
  catchError,
  concatMap,
  defer,
  EMPTY,
  exhaustMap,
  finalize,
  last,
  map,
  Observable,
  of,
  ReplaySubject,
  retry,
  share,
  Subject,
  take,
  takeUntil,
  takeWhile,
  throwError,
  timer,
} from 'rxjs';

import { SseService } from './sse.service';

@Injectable({ providedIn: 'root' })
export class CampaignService {
  private readonly http = inject(HttpClient);
  /** Each owner's latest creative-asset upload, kept until its answer is taken up or it is cancelled: see `uploadCreativeAsset`. */
  private readonly creativeAssetUploads = new Map<
    CreativeAssetUploadOwner,
    { briefId: string; upload$: Observable<CreativeAssetUploadResult>; cancel: Subject<void> }
  >();
  private readonly sse = inject(SseService);

  /** The library upload, every brief's files in one list: see `enqueueCreativeAssetUploads`. */
  private readonly creativeAssetQueue = signal<CreativeAssetQueueItem[]>([]);
  /** Each file still to send, or to re-send on Retry, by item id — dropped once its outcome is final. */
  private readonly creativeAssetQueueFiles = new Map<string, File>();
  private creativeAssetQueueSequence = 0;
  /** Send attempts in order. `concatMap` is what makes the upload serial: one request at a time, ever. */
  private readonly creativeAssetQueueWork = new Subject<{ id: string; attempt: number }>();
  /**
   * Each item's latest attempt. A Retry queues a NEW attempt at the back; an older one still
   * buffered for the same item is stale and skipped, so a retried file never jumps the queue.
   */
  private readonly creativeAssetQueueAttempts = new Map<string, number>();
  /**
   * Aborts the request in flight. Fired only when the cancelled brief owns it: one file is in
   * flight at a time, so another brief's cancel never reaches this. Waiting items are marked
   * cancelled by the caller.
   */
  private readonly creativeAssetQueueAbort = new Subject<void>();

  /** Every library upload item, in pick order. Each carries its brief; a reader shows only its own brief's. */
  public readonly creativeAssetUploadQueue = this.creativeAssetQueue.asReadonly();

  public constructor() {
    this.creativeAssetQueueWork
      .pipe(
        concatMap((work) => this.sendQueuedCreativeAsset(work.id, work.attempt)),
        takeUntilDestroyed()
      )
      .subscribe();
  }

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
   * The read half exists: `loadBrief` below is called from `planning-tab.component.ts` once a URL
   * is entered, and a restore writes the id and ETag back through `rememberBriefId`, which is what
   * makes a later save owned rather than refused.
   *
   * What a reload does NOT do is rehydrate on its own — the page starts empty and `loadBrief` runs
   * only once a URL is entered (`campaigns.component.ts`), so the brief is offered for restore
   * rather than simply still being there. Saying "survives a reload" here would still overstate it.
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
   * Approve a brief that is already stored in campaign-service, without re-saving it.
   *
   * The companion `persistBrief` could not be: a save APPROVES as its last step, but a save also
   * rewrites the row, and the restore path exists precisely to avoid that — re-saving a restored
   * brief would PUT the client's reconstruction over the stored event details, copy, keywords and
   * targeting. So a restored brief that upstream holds as `draft` had no route to `approved`, and
   * campaign creation refuses anything else.
   *
   * Takes NO body. The brief is the path, the foundation is `?project=` as on every other brief
   * call, and the validator rides as `If-Match`, where a validator belongs — there is no body for
   * it to travel in, and `approve-brief` upstream requires one.
   *
   * `knownEtag` must be the validator from the read that put the displayed brief on screen, and
   * is REQUIRED rather than defaulted. A null one is accepted by the type and then refused by the
   * BFF with `conflict: 'unverified-validator'` — `approveStoredBrief` reads nothing and approves
   * nothing, because approving a row this page cannot prove is the one it restored is exactly the
   * defect this path was built to close (#3801). The default argument this parameter used to
   * carry made that refusal reachable by omission, so it is gone: a caller with no validator has
   * to say so, and the honest answer for it is a fresh read, not an approval.
   */
  public approveBrief(projectSlug: string, briefId: string, knownEtag: string | null): Observable<CampaignBriefApproveResult> {
    const params = new HttpParams().set('project', projectSlug);
    const headers = knownEtag !== null && knownEtag !== '' ? new HttpHeaders({ 'If-Match': knownEtag }) : undefined;
    return this.http.post<CampaignBriefApproveResult>(`/api/campaigns/brief/${encodeURIComponent(briefId)}/approve`, null, { params, headers });
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
      // parameter means: `paid-marketing` and the empty stage. That agreement is the point — it is
      // a wire default for backward-compatible callers, not a claim about stored rows. Pre-field
      // email briefs exist and share that identity after the backfill
      // (linuxfoundation/lfx-self-serve#2214).
      params: new HttpParams().set('event_slug', eventSlug).set('project', projectSlug).set('delivery_type', deliveryType).set('stage', stage),
    });
  }

  /**
   * Read back the audiences campaign-service already holds for this brief, newest first.
   *
   * A GET, and idempotent: this is what lets a page reload recover an attached audience instead
   * of sending the operator back to the Audience tab to compose a second HubSpot list. It is the
   * ONLY audience call this client makes -- audiences are produced on the Audience tab and never
   * derived from here.
   */
  public listAudiences(projectSlug: string, briefId: string): Observable<ListAudiencesResult> {
    return this.http.get<ListAudiencesResult>('/api/campaigns/audiences', {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
    });
  }

  /**
   * Generate email copy for a brief. Brief-scoped upstream, so both ids are required.
   */
  public generateEmailCopy(
    projectSlug: string,
    briefId: string,
    stage?: CampaignEmailStage,
    variant?: CampaignEmailVariant,
    segment?: CampaignEmailSegment
  ): Observable<GenerateEmailCopyResult> {
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
    //
    // `variant` follows the exact same shape as `stage` for the same reason: omitted rather than
    // sent empty, and unrecognised upstream falls back to ordinary stage-based copy under a 200.
    //
    // `segment` likewise, and it is INDEPENDENT of `variant`: the two narrow different things
    // (framing vs which blocks apply), so any combination of the three is a legal request.
    const body = { ...(stage ? { stage } : {}), ...(variant ? { variant } : {}), ...(segment ? { segment } : {}) };
    return this.http.post<GenerateEmailCopyResult>('/api/campaigns/email-copy', body, {
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
  ): Observable<{ jobId: string; result?: CampaignCreateResponse; error?: string; indeterminate?: boolean }> {
    return this.http.post<{ jobId: string; result?: CampaignCreateResponse; error?: string; indeterminate?: boolean }>('/api/campaigns/create', request, {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
    });
  }

  /**
   * Upload an image for a saved brief and get back the creative-asset id a Reddit, Meta, LinkedIn,
   * Google, Microsoft or X create names as `imageAssetId`; `owner` says which control the upload belongs to. The body is the file's raw bytes typed with its own MIME type — the BFF route
   * refuses anything but PNG/JPEG up to `CREATIVE_ASSET_MAX_BYTES` and does the base64 encoding
   * campaign-service's JSON wire needs. `project` and `brief_id` travel as query params, as for
   * `createCampaign`, because they are path segments upstream.
   */
  public uploadCreativeAsset(file: Blob, projectSlug: string, briefId: string, owner: CreativeAssetUploadOwner): Observable<CreativeAssetUploadResult> {
    // A new upload replaces the same owner's previous one outright, and aborts it: two concurrent
    // uploads compete for campaign-service's upload budget, which sheds with a 503, so a discarded
    // one could fail the pick. Another owner's upload is left running — it is a different image the
    // operator still wants — and a 503 from that overlap reads as "try again in a moment".
    this.cancelCreativeAssetUpload(owner);
    const cancel = new Subject<void>();
    // Shared and replayed, never reset: the Implementation tab is destroyed on a tab switch, and
    // unsubscribing must not abort the upload or lose its answer. A remount resumes it by brief
    // (`resumeCreativeAssetUpload`) and gets the id, or the refusal, it would have seen. Only
    // `cancel` (a new pick, or Remove) aborts the request.
    const upload$ = this.postCreativeAsset(file, projectSlug, briefId).pipe(
      takeUntil(cancel),
      share({ connector: () => new ReplaySubject<CreativeAssetUploadResult>(1), resetOnError: false, resetOnComplete: false, resetOnRefCountZero: false })
    );
    // Only each owner's latest upload is kept. The tab resumes the brief it is showing, so an older
    // one (an abandoned brief, a left page) has no one to resume it and would otherwise hold its
    // image, up to CREATIVE_ASSET_MAX_BYTES, for the rest of the session.
    this.creativeAssetUploads.set(owner, { briefId, upload$, cancel });
    return upload$;
  }

  /** The owner's latest upload for the brief, in flight or answered but not yet taken up, or null. */
  public resumeCreativeAssetUpload(owner: CreativeAssetUploadOwner, briefId: string): Observable<CreativeAssetUploadResult> | null {
    const upload = this.creativeAssetUploads.get(owner);
    return upload?.briefId === briefId ? upload.upload$ : null;
  }

  /** Drop `upload$` once its answer is taken up, if it is still its owner's latest. The request has finished. */
  public forgetCreativeAssetUpload(owner: CreativeAssetUploadOwner, upload$: Observable<CreativeAssetUploadResult>): void {
    if (this.creativeAssetUploads.get(owner)?.upload$ === upload$) {
      this.creativeAssetUploads.delete(owner);
    }
  }

  /** Abort the owner's latest upload and drop it: replaced by a new pick, or removed. */
  public cancelCreativeAssetUpload(owner: CreativeAssetUploadOwner): void {
    this.creativeAssetUploads.get(owner)?.cancel.next();
    this.creativeAssetUploads.delete(owner);
  }

  /**
   * Add files to the brief's library upload, which sends them ONE AT A TIME in pick order.
   *
   * Serial because campaign-service's upload admission sheds concurrent uploads with a 503; a
   * parallel run would fail most of a folder through no fault of its own. It is a separate path
   * from the per-platform pickers' `uploadCreativeAsset` — it holds no owner slot, so a library
   * upload never cancels or takes over a picker's upload, nor the other way round.
   *
   * Every file gets an item, including one refused before sending: a wrong type, over
   * `CREATIVE_ASSET_MAX_BYTES`, empty, or — with `folder` — below the folder's top level (a folder
   * pick lists every file under it, and only its top level is uploaded). Over-quota is NOT judged
   * here: re-uploading bytes the brief already holds is idempotent and costs no quota upstream, so
   * only campaign-service can say whether a file would exceed it.
   *
   * Each item carries its brief, so files picked for another brief wait their turn in the same
   * serial lane and the first brief's outcomes stay listed for when the operator returns to it.
   */
  public enqueueCreativeAssetUploads(files: readonly File[], projectSlug: string, briefId: string, options: { folder?: boolean } = {}): void {
    const added = files.map((file): CreativeAssetQueueItem => {
      const id = `asset-${++this.creativeAssetQueueSequence}`;
      const refused = this.refuseQueuedCreativeAsset(file, options.folder === true);
      if (!refused) {
        this.creativeAssetQueueFiles.set(id, file);
      }
      return {
        id,
        briefId,
        projectSlug,
        name: options.folder === true && file.webkitRelativePath ? file.webkitRelativePath : file.name,
        byteSize: file.size,
        status: refused ? 'refused' : 'waiting',
        refusal: refused?.refusal ?? null,
        message: refused?.message ?? '',
        assetId: '',
      };
    });
    this.creativeAssetQueue.update((items) => [...items, ...added]);
    added.filter((item) => item.status === 'waiting').forEach((item) => this.queueCreativeAssetAttempt(item.id));
  }

  /** Send a failed or cancelled file again, at the back of the queue. */
  public retryCreativeAssetUpload(itemId: string): void {
    const item = this.creativeAssetQueue().find((candidate) => candidate.id === itemId);
    if (!item || (item.status !== 'failed' && item.status !== 'cancelled') || !this.creativeAssetQueueFiles.has(itemId)) {
      return;
    }
    this.patchQueuedCreativeAsset(itemId, { status: 'waiting', refusal: null, message: '' });
    this.queueCreativeAssetAttempt(itemId);
  }

  /** Stop a brief's library upload: its file in flight is aborted and every waiting one is marked cancelled, each still retryable. */
  public cancelCreativeAssetUploads(briefId: string): void {
    const items = this.creativeAssetQueue();
    this.creativeAssetQueue.set(
      items.map((item) =>
        item.briefId === briefId && item.status === 'waiting' ? { ...item, status: 'cancelled', message: CREATIVE_ASSET_CANCELLED_WAITING_MESSAGE } : item
      )
    );
    if (items.some((item) => item.briefId === briefId && item.status === 'uploading')) {
      this.creativeAssetQueueAbort.next();
    }
  }

  /** Cancel anything of the brief's still running and forget its list. Other briefs' items are untouched. */
  public clearCreativeAssetUploadQueue(briefId: string): void {
    this.cancelCreativeAssetUploads(briefId);
    const [cleared, kept] = this.creativeAssetQueue().reduce<[CreativeAssetQueueItem[], CreativeAssetQueueItem[]]>(
      ([mine, others], item) => (item.briefId === briefId ? [[...mine, item], others] : [mine, [...others, item]]),
      [[], []]
    );
    cleared.forEach((item) => {
      this.creativeAssetQueueFiles.delete(item.id);
      this.creativeAssetQueueAttempts.delete(item.id);
    });
    this.creativeAssetQueue.set(kept);
  }

  /**
   * The brief's stored creative assets, each with the pixel dimensions recorded at upload (absent
   * for an asset stored before they were), plus the library's quota.
   *
   * Logged and rethrown, never defaulted, for the plan's reason below: an empty library is an
   * answer ("nothing stored"), and a failed read rendered as one would tell the Google image slots
   * that a held image had been deleted.
   */
  public listCreativeAssets(projectSlug: string, briefId: string): Observable<CreativeAssetLibrary> {
    return this.http
      .get<CreativeAssetLibrary>('/api/campaigns/brief/creative-assets', { params: new HttpParams().set('project', projectSlug).set('brief_id', briefId) })
      .pipe(
        catchError((error: unknown) => {
          console.error('Failed to load the creative asset library:', error);
          return throwError(() => error);
        })
      );
  }

  /**
   * Which of a brief's stored images fill which platform image slots, and what is still missing.
   *
   * A pure read — nothing is attached to anything, so it is safe to re-run whenever the library or
   * the platform selection changes.
   *
   * `platforms` is APPENDED once per entry (`?platforms=a&platforms=b`), which is the repeatable
   * form campaign-service reads; `HttpParams.set` with a joined string would be read as one
   * platform named "a,b" and silently match nothing. An empty array appends nothing, and absent
   * means every platform the service publishes slot rules for.
   *
   * The response's `platforms` is what the service actually planned for, NOT an echo of the
   * request: a platform with no published slot rules is dropped rather than refused, so a caller
   * must compare the two before telling an operator their library is ready.
   */
  public getCreativeAssetPlan(projectSlug: string, briefId: string, platforms: string[] = []): Observable<CreativeAssetPlan> {
    const params = platforms.reduce(
      (carry, platform) => carry.append('platforms', platform),
      new HttpParams().set('project', projectSlug).set('brief_id', briefId)
    );
    // Logged and rethrown, never defaulted: a plan with no gaps is exactly how a launch-ready
    // library reads, so a defaulted empty plan would state the opposite of what happened. The
    // caller renders the failure as such (frontend-checklist §13).
    return this.http.get<CreativeAssetPlan>('/api/campaigns/brief/creative-assets/plan', { params }).pipe(
      catchError((error: unknown) => {
        console.error('Failed to load the creative asset plan:', error);
        return throwError(() => error);
      })
    );
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

  public getLinkedInMonitorData(
    projectSlug: string,
    accountKey: string,
    days: number = 30,
    accountSource: MonitorAccountSource | null = null
  ): Observable<LinkedInMonitorResponse> {
    return this.http.get<LinkedInMonitorResponse>('/api/campaigns/linkedin/monitor', {
      params: { project: projectSlug, days, accountKey, ...this.monitorAccountSource(accountSource) },
    });
  }

  public getRedditAccounts(projectSlug: string): Observable<RedditAccountOption[]> {
    return this.http.get<RedditAccountOption[]>('/api/campaigns/reddit/accounts', { params: { project: projectSlug } });
  }

  public getRedditMonitorData(
    projectSlug: string,
    accountKey: string,
    days: number = 30,
    accountSource: MonitorAccountSource | null = null
  ): Observable<RedditMonitorResponse> {
    return this.http.get<RedditMonitorResponse>('/api/campaigns/reddit/monitor', {
      params: { project: projectSlug, days, accountKey, ...this.monitorAccountSource(accountSource) },
    });
  }

  public getMetaAccounts(projectSlug: string): Observable<MetaAccountOption[]> {
    return this.http.get<MetaAccountOption[]>('/api/campaigns/meta/accounts', { params: { project: projectSlug } });
  }

  /**
   * The Google Ads accounts the project's connection can reach, from campaign-service's account
   * discovery. 404 while the server's monitor cutover flag is off, and a 403 for a non-root caller:
   * with no connection of its own, the project is answered from the LF's shared account.
   */
  public getGoogleAdsAccounts(projectSlug: string): Observable<GoogleAdsAccountOption[]> {
    return this.http.get<GoogleAdsAccountOption[]>('/api/campaigns/google/accounts', { params: { project: projectSlug } });
  }

  /**
   * Whether X creation is open on this deployment, with no brief — the Plan picker's answer before
   * one exists. `project` is not read by the answer, which is deployment-wide; it is what lets the
   * campaign-manager guard authorise a project-scoped caller, which refuses an unscoped request.
   */
  public getTwitterCreateCapability(projectSlug: string): Observable<TwitterCreateCapability> {
    return this.http.get<TwitterCreateCapability>('/api/campaigns/twitter/create-capability', { params: { project: projectSlug } });
  }

  /**
   * Which X ad account an X create will use, and the accounts the connection's credential reaches
   * (LFXV2-3319). 404 while X creation is off on the server, and a 403 for a non-root caller: with
   * no X connection of its own, the project is answered from the LF's shared credential.
   */
  public getTwitterAdsAccounts(projectSlug: string): Observable<TwitterAdsAccountsResult> {
    return this.http.get<TwitterAdsAccountsResult>('/api/campaigns/twitter/accounts', { params: { project: projectSlug } });
  }

  /**
   * Search Google's geo target table for the Implement tab's location picker (campaign-service #411).
   * 404 while the server's geo-search flag is off. `targetTypes` repeats on the query string; an
   * omitted option is left off rather than sent empty, so upstream's own default applies.
   */
  public searchGoogleAdsGeoTargets(
    projectSlug: string,
    query: string,
    options: GoogleAdsGeoTargetSearchOptions = {}
  ): Observable<GoogleAdsGeoTargetSearchResult> {
    // `strictHttpParams`, because the query is user-typed text: Angular's default codec leaves `+`
    // unescaped and Express reads it back as a space, so `St. Kitts + Nevis` would search for
    // something else.
    let params = strictHttpParams().set('project', projectSlug).set('q', query);
    if (options.countryCode) params = params.set('countryCode', options.countryCode);
    for (const targetType of options.targetTypes ?? []) params = params.append('targetTypes', targetType);
    if (options.limit !== undefined) params = params.set('limit', String(options.limit));
    return this.http.get<GoogleAdsGeoTargetSearchResult>('/api/campaigns/google/geo-targets', { params });
  }

  public getMetaMonitorData(
    projectSlug: string,
    accountKey: string,
    days: number = 30,
    accountSource: MonitorAccountSource | null = null
  ): Observable<MetaMonitorResponse> {
    return this.http.get<MetaMonitorResponse>('/api/campaigns/meta/monitor', {
      params: { project: projectSlug, days, accountKey, ...this.monitorAccountSource(accountSource) },
    });
  }

  /**
   * Which account each connection-backed Monitor panel offers — the project's OWN connection's — and
   * whether the monitors are served by campaign-service at all. `viaCampaignService: false` (with
   * no platforms) while the server's monitor cutover flag is off: the tab then keeps its legacy
   * account lists.
   */
  public getMonitorConnections(projectSlug: string): Observable<CampaignMonitorConnections> {
    return this.http.get<CampaignMonitorConnections>('/api/campaigns/monitor/connections', { params: { project: projectSlug } });
  }

  /**
   * Microsoft Advertising account monitor, from campaign-service. 404 while the server's monitor
   * cutover flag is off. Report-backed: `metricsAsOf`, `metricsPending` and `metricsWindow*` say how
   * fresh the figures are, and on the first read every campaign is `fetchFailed` while the report builds.
   */
  public getMicrosoftMonitorData(projectSlug: string, accountId: string, days: number = 30): Observable<ReportBackedMonitorResponse> {
    return this.http.get<ReportBackedMonitorResponse>('/api/campaigns/microsoft/monitor', {
      params: { project: projectSlug, days, accountKey: accountId, ...this.monitorAccountSource('connection') },
    });
  }

  /** X (Twitter) Ads account monitor — the Microsoft one's sibling, plus a 409 for an account it cannot monitor. */
  public getTwitterMonitorData(projectSlug: string, accountId: string, days: number = 30): Observable<ReportBackedMonitorResponse> {
    return this.http.get<ReportBackedMonitorResponse>('/api/campaigns/twitter/monitor', {
      params: { project: projectSlug, days, accountKey: accountId, ...this.monitorAccountSource('connection') },
    });
  }

  /** HubSpot email monitor: project-scoped, so no account. 404 while the server's monitor cutover flag is off. */
  public getHubSpotMonitorData(projectSlug: string, days: number = 30): Observable<HubSpotEmailMonitorResponse> {
    return this.http.get<HubSpotEmailMonitorResponse>('/api/campaigns/hubspot/monitor', {
      params: { project: projectSlug, days, ...this.monitorAccountSource('connection') },
    });
  }

  public getKeywords(projectSlug: string, days: number = 30): Observable<KeywordMetricsResponse> {
    return this.http.get<KeywordMetricsResponse>('/api/campaigns/keywords', { params: { project: projectSlug, days } });
  }

  /**
   * Microsoft Advertising keyword performance, from campaign-service's saved reports.
   *
   * Takes a reporting WINDOW rather than a day count: Microsoft has no 14-day window, so a day count
   * would label one window's figures as another's. The rows come from the last FINISHED report, so
   * the response's `metricsAsOf` / `metricsPending` say how fresh they are and must be shown.
   */
  public getMicrosoftKeywords(projectSlug: string, window: MicrosoftKeywordsWindow): Observable<MicrosoftKeywordMetricsResponse> {
    // Logged and rethrown, never defaulted: an empty keyword list would read as "no keywords", and the
    // table states a failed read (or a missing connection) as such (frontend-checklist §13).
    return this.http.get<MicrosoftKeywordMetricsResponse>('/api/campaigns/microsoft/keywords', { params: { project: projectSlug, window } }).pipe(
      catchError((error: unknown) => {
        console.error('Failed to load Microsoft keyword metrics:', error);
        return throwError(() => error);
      })
    );
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
   * Change how much a campaign may spend on its ad platform.
   *
   * The same kind of write as `updateCampaignStatus`, against the same row: a money-affecting
   * change on a third party, addressed per project, with the row's etag sent upstream as
   * `If-Match`. The response carries the row's NEW etag, and the caller must use it for the next
   * write on that row (a budget change or a toggle) — the one it sent is stale once this commits.
   *
   * `budget` is in the AD ACCOUNT's own currency and is sent exactly as given; nothing here
   * converts or rounds it. `budgetType` must name the pacing the campaign already has upstream —
   * the endpoint changes the amount only and answers a mismatch with 409.
   *
   * Errors propagate unhandled. The caller must tell a refusal from a 412 and from an outcome
   * nobody could confirm, and a defaulted response here would erase exactly that difference.
   */
  public updateCampaignBudget(params: CampaignBudgetUpdateParams): Observable<CampaignBudgetUpdateResult> {
    const { projectSlug, briefId, campaignId, budget, budgetType, etag, platform } = params;
    const body: CampaignBudgetUpdateRequest = platform ? { briefId, etag, budget, budgetType, platform } : { briefId, etag, budget, budgetType };
    return this.http.patch<CampaignBudgetUpdateResult>(`/api/campaigns/${encodeURIComponent(campaignId)}/budget`, body, {
      params: new HttpParams().set('project', projectSlug),
    });
  }

  /**
   * Change a campaign's manual max cost-per-click bid on its ad platform.
   *
   * The budget change's sibling, against the same row and validator: the row's etag goes upstream as
   * `If-Match`, and the response carries the row's NEW etag, which the caller must use for the next
   * write on that row. `bid` is in the AD ACCOUNT's own currency and is sent exactly as given.
   *
   * Errors propagate unhandled, for the budget change's reason: the caller must tell a refusal (a 409
   * about the bidding setup included) from a 412 and from an outcome nobody could confirm.
   */
  public updateCampaignBid(params: CampaignBidUpdateParams): Observable<CampaignBidUpdateResult> {
    const { projectSlug, briefId, campaignId, bid, bidType, etag } = params;
    const body: CampaignBidUpdateRequest = { briefId, etag, bid, bidType };
    return this.http.patch<CampaignBidUpdateResult>(`/api/campaigns/${encodeURIComponent(campaignId)}/bid`, body, {
      params: new HttpParams().set('project', projectSlug),
    });
  }

  /**
   * Add negative keywords to one Google Ads, Microsoft Advertising, Reddit or X campaign.
   *
   * NOT atomic and POSITIONAL: `results[i]` answers `negativeKeywords[i]`, each with its own outcome,
   * so the caller zips them onto the list it sent. No etag: nothing is persisted on the row.
   * `revision` is Reddit's, from the keyword-targeting read; it is put in the body only when given,
   * because Google Ads, Microsoft Advertising and X refuse the field whenever it is present.
   */
  public addNegativeKeywords(
    projectSlug: string,
    briefId: string,
    campaignId: string,
    negativeKeywords: CampaignNegativeKeywordInput[],
    revision?: string
  ): Observable<CampaignNegativeKeywordsResult> {
    const body: CampaignNegativeKeywordsRequest = { briefId, negativeKeywords, ...(revision !== undefined && { revision }) };
    return this.http.post<CampaignNegativeKeywordsResult>(`/api/campaigns/${encodeURIComponent(campaignId)}/negative-keywords`, body, {
      params: new HttpParams().set('project', projectSlug),
    });
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

  /**
   * Reads campaign-service's live metrics for ONE campaign on a brief: impressions, clicks, cost (in
   * micro-units: USD on LinkedIn, the ad account's own currency elsewhere; the response names neither) and CTR.
   *
   * Every read reaches the campaign's ad platform. The Optimize tab shows each row's counters from
   * `getBriefMetrics` and calls this only for one row at a time: on Refresh, or for a row the
   * brief-wide read could not measure. `window` is optional and not defaulted, for the reason
   * `getBriefMetrics` gives. A failure is an HTTP error, not a row status: campaign-service's 400
   * means the platform has no metrics read, 409 that the campaign cannot be measured yet (its
   * sentence says why). The error is logged and rethrown; the caller decides what the row shows.
   */
  public getCampaignMetrics(
    projectSlug: string,
    briefId: string,
    campaignId: string,
    window?: CampaignMetricsWindow
  ): Observable<CampaignServiceCampaignMetrics> {
    let params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    if (window !== undefined) {
      params = params.set('window', window);
    }
    return this.http.get<CampaignServiceCampaignMetrics>(`/api/campaigns/${encodeURIComponent(campaignId)}/metrics`, { params }).pipe(
      catchError((error) => {
        console.error('Failed to read campaign live metrics', error);
        return throwError(() => error);
      })
    );
  }

  public lookupHubSpotUtm(projectSlug: string, eventName: string): Observable<HubSpotUtmLookupResult> {
    return this.http.get<HubSpotUtmLookupResult>('/api/campaigns/hubspot/utm', {
      // Declares that THIS bundle understands `found: true` with a null `hs_utm` (a campaign that
      // exists but carries no UTM token). The previous bundle read that as absence and offered
      // Create, so the server withholds the shape unless a client asks for it by name. Sent as a
      // parameter rather than inferred, because during a rolling deploy the only thing that
      // reliably distinguishes the two bundles is what the bundle itself says.
      params: { project: projectSlug, event_name: eventName, tokenless_found: '1' },
    });
  }

  public createHubSpotUtm(projectSlug: string, eventName: string): Observable<HubSpotUtmCreateResult> {
    return this.http.post<HubSpotUtmCreateResult>('/api/campaigns/hubspot/utm/create', {}, { params: { project: projectSlug, event_name: eventName } });
  }

  public executeKeywordActions(projectSlug: string, request: BulkKeywordActionRequest): Observable<BulkKeywordActionResponse> {
    return this.http.post<BulkKeywordActionResponse>('/api/campaigns/keywords/actions', request, { params: { project: projectSlug } });
  }

  // --- Audience Builder ----------------------------------------------------
  //
  // Every method below sends `project` for the reason `loadBrief` does: `requireCampaignManager`
  // scopes authorization on that slug, and a request without it is authorized only for an ED or a
  // root grant — so omitting it would work for the developer who wrote it and 403 for the
  // campaign manager who holds a per-project grant.

  /**
   * Whether the tab can do anything once rendered.
   *
   * The tab itself is gated by `requireCampaignManager` on the server routes, not by this call —
   * so there is no `enabled` flag. `hubspotConfigured: false` means this project has no usable
   * HubSpot connection upstream: the tab still renders, with the degrade banner and every action
   * disabled, because a missing connection is a setup task and not a missing feature.
   */
  public getAudienceCapabilities(projectSlug: string): Observable<AudienceBuilderCapabilities> {
    return this.http.get<AudienceBuilderCapabilities>('/api/campaigns/audience-builder/capabilities', { params: { project: projectSlug } });
  }

  /**
   * Streams list discovery for one event URL.
   *
   * SSE rather than a plain POST because discovery inspects a budgeted batch of HubSpot lists
   * after an LLM extraction pass, and the legacy app's progress ticker is what makes that wait
   * legible. The `event` frame arrives before `discovered`, which is what lets the panel label
   * itself and load suppression lists for the brand without waiting on classification.
   */
  public discoverAudience(projectSlug: string, request: AudienceDiscoverRequest): Observable<SSEEvent<AudienceDiscoverySSEEventType>> {
    const url = `/api/campaigns/audience-builder/discover?project=${encodeURIComponent(projectSlug)}`;
    return this.sse.connect<AudienceDiscoverySSEEventType>(url, {
      method: 'POST',
      body: request,
    });
  }

  /**
   * Typeahead over the portal's contact lists.
   *
   * `HttpParams` rather than an object literal because the query is whatever the user typed.
   */
  public searchAudienceLists(projectSlug: string, query: string): Observable<AudienceListSearchResult[]> {
    const params = new HttpParams().set('project', projectSlug).set('q', query);
    return this.http.get<AudienceListSearchResult[]>('/api/campaigns/audience-builder/lists/search', { params });
  }

  /**
   * The suppression lists worth considering for this event: portfolio-wide hygiene, brand opt-out,
   * and event-specific. Nothing here is pre-applied — the operator chooses, because a wrongly
   * auto-applied exclusion silently shrinks a send.
   *
   * Every filter is optional: the portfolio-wide lists are found by fixed name, so the answer is
   * already useful before discovery has identified the event. `registrantsEvent` (the edition, with
   * its year) adds the current-registrants row. `standardList` is the project's standing standard
   * suppression list, present only once it exists.
   */
  public getAudienceSuppressionLists(projectSlug: string, brandShort = '', eventName = '', registrantsEvent = ''): Observable<AudienceSuppressionListsResult> {
    let params = new HttpParams().set('project', projectSlug);
    if (brandShort !== '') {
      params = params.set('brandShort', brandShort);
    }
    if (eventName !== '') {
      params = params.set('eventName', eventName);
    }
    if (registrantsEvent !== '') {
      params = params.set('registrantsEvent', registrantsEvent);
    }
    return this.http.get<AudienceSuppressionListsResult>('/api/campaigns/audience-builder/suppression-lists', { params });
  }

  /**
   * Past marketing emails for this event, with their recipient lists resolved.
   *
   * The fastest correct answer to "who did we send this to last time" — and the reason a list a
   * previous send used but which no longer exists comes back flagged `missing` rather than
   * silently dropped.
   */
  public getAudienceLastSent(projectSlug: string, eventName: string, brandShort = ''): Observable<AudienceLastSentEmail[]> {
    let params = new HttpParams().set('project', projectSlug).set('eventName', eventName);
    if (brandShort !== '') {
      params = params.set('brandShort', brandShort);
    }
    return this.http.get<AudienceLastSentEmail[]>('/api/campaigns/audience-builder/last-sent', { params });
  }

  /** Master lists already built for this event, newest quarter first. */
  public getAudienceExistingMasterLists(projectSlug: string, eventName: string, brandShort = ''): Observable<AudienceMasterListBrief[]> {
    let params = new HttpParams().set('project', projectSlug).set('eventName', eventName);
    if (brandShort !== '') {
      params = params.set('brandShort', brandShort);
    }
    return this.http.get<AudienceMasterListBrief[]>('/api/campaigns/audience-builder/existing-master-lists', { params });
  }

  /**
   * The de-duplicated size of the selected lists, before anything is created.
   *
   * The result carries `exact`, and the UI must respect it: above the live-count cap the number is
   * a sum that over-counts overlap, so rendering it as a plain total would state a reach the send
   * will not have.
   */
  public previewAudienceCount(projectSlug: string, request: AudiencePreviewCountRequest): Observable<AudiencePreviewCount> {
    return this.http.post<AudiencePreviewCount>('/api/campaigns/audience-builder/preview-count', request, { params: { project: projectSlug } });
  }

  /**
   * Creates the Combined Suppression list and then the master list in HubSpot.
   *
   * **Not idempotent, and not retryable from the UI.** A failure after the suppression list exists
   * answers 502 with an `AudienceComposeMasterPartial` naming that list; the caller must surface it
   * with a link into HubSpot rather than a Retry button, for the same reason already documented on
   * the Send-audience section — offering Retry there invites the duplicate contact list that the
   * partial state exists to prevent.
   */
  public composeAudienceMaster(projectSlug: string, request: AudienceComposeMasterRequest): Observable<AudienceComposeMasterResult> {
    return this.http.post<AudienceComposeMasterResult>('/api/campaigns/audience-builder/compose-master', request, { params: { project: projectSlug } });
  }

  /**
   * Records lists that already exist as the brief's send audience, composing nothing. Safe to
   * retry: no HubSpot list is created on any path.
   */
  public attachExistingAudience(projectSlug: string, request: AudienceAttachExistingRequest): Observable<AudienceAttachExistingResult> {
    return this.http.post<AudienceAttachExistingResult>('/api/campaigns/audience-builder/attach-existing', request, { params: { project: projectSlug } });
  }

  /**
   * Audits one existing list — by id, name, or HubSpot URL — for signal mapping, suppression
   * coverage, and exclusion completeness.
   *
   * `AudienceQaResult` is a union discriminated on `needsDisambiguation`: an ambiguous name comes
   * back as candidates and no verdict, so the caller cannot read a PASS that was never computed.
   */
  public runAudienceQa(projectSlug: string, request: AudienceQaRunRequest): Observable<AudienceQaResult> {
    return this.http.post<AudienceQaResult>('/api/campaigns/audience-builder/qa/run', request, { params: { project: projectSlug } });
  }

  // --- Optimize: campaign-service reads and levers ---------------------------
  //
  // Thin clients over `/api/campaigns/...` (see `campaign-optimize.controller.ts`). Errors
  // propagate unhandled: a caller must tell a refusal from a stale etag (`PRECONDITION_FAILED`)
  // and from an outcome nobody could confirm (`META_AD_SET_STATUS_UNCONFIRMED`,
  // `KEYWORD_TARGETING_REMOVAL_UNCONFIRMED`), which a defaulted response would erase.

  /**
   * One platform's audience demographics for the project's own campaigns. A failure carries a fixed
   * message and a `CAMPAIGN_AUDIENCE_*` code per cause; campaign-service's own text never arrives.
   */
  public getPlatformAudience<P extends CampaignAudiencePlatform>(
    projectSlug: string,
    platform: P,
    window?: string
  ): Observable<CampaignServicePlatformAudienceMap[P]> {
    let params = new HttpParams().set('project', projectSlug);
    if (window) {
      params = params.set('window', window);
    }
    return this.http.get<CampaignServicePlatformAudienceMap[P]>(`/api/campaigns/${this.platformRouteSegment(platform)}/audience`, { params });
  }

  /**
   * Resolve a platform campaign id to campaign-service's campaign and brief. More than one match is
   * possible: the caller must refuse rather than choose.
   */
  public resolvePlatformCampaign(
    projectSlug: string,
    platform: CampaignRefPlatform,
    platformCampaignId: string
  ): Observable<CampaignServiceCampaignResolution> {
    const params = new HttpParams().set('project', projectSlug).set('platformCampaignId', platformCampaignId);
    return this.http.get<CampaignServiceCampaignResolution>(`/api/campaigns/${this.platformRouteSegment(platform)}/campaign-ref`, { params });
  }

  /** Reddit keyword performance (the Microsoft table's shape). Answers 404 until campaign-service serves it. */
  public getRedditKeywords(projectSlug: string, window?: RedditKeywordsWindow): Observable<RedditKeywordMetricsResponse> {
    let params = new HttpParams().set('project', projectSlug);
    if (window) {
      params = params.set('window', window);
    }
    return this.http.get<RedditKeywordMetricsResponse>('/api/campaigns/reddit/keywords', { params });
  }

  /** The campaign's live settings compared with what its row recorded. `unknown` is never a match. */
  public getCampaignSettings(projectSlug: string, briefId: string, campaignId: string): Observable<CampaignServiceSettingsReadback> {
    const params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    return this.http.get<CampaignServiceSettingsReadback>(`/api/campaigns/${encodeURIComponent(campaignId)}/settings`, { params });
  }

  /** A Meta campaign's ad sets and their delivery over `window`. */
  public listMetaAdSets(projectSlug: string, briefId: string, campaignId: string, window?: CampaignMetricsWindow): Observable<CampaignServiceMetaAdSets> {
    let params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    if (window) {
      params = params.set('window', window);
    }
    return this.http.get<CampaignServiceMetaAdSets>(`/api/campaigns/${encodeURIComponent(campaignId)}/meta-ad-sets`, { params });
  }

  /** The ads under one Meta ad set and their delivery over `window`. Read-only: there is no per-ad lever. */
  public listMetaAds(
    projectSlug: string,
    briefId: string,
    campaignId: string,
    adSetId: string,
    window?: CampaignMetricsWindow
  ): Observable<CampaignServiceMetaAds> {
    let params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    if (window) {
      params = params.set('window', window);
    }
    // Logged and rethrown, never defaulted: an empty list would read as "no ads", and the section
    // states a failed read as such.
    return this.http
      .get<CampaignServiceMetaAds>(`/api/campaigns/${encodeURIComponent(campaignId)}/meta-ad-sets/${encodeURIComponent(adSetId)}/ads`, { params })
      .pipe(
        catchError((error: unknown) => {
          console.error('Failed to list Meta ads', error);
          return throwError(() => error);
        })
      );
  }

  /**
   * Pause or resume one Meta ad set. `etag` is the campaign ROW's and goes upstream as `If-Match`;
   * the answer's etag is the row's version, which a pause or resume of the recorded ad set BUMPS,
   * so the caller must adopt it for its next write. `ALREADY_IN_STATE` means nothing was sent.
   */
  public updateMetaAdSetStatus(params: MetaAdSetStatusParams): Observable<CampaignServiceMetaAdSetStatusChange> {
    const { projectSlug, campaignId, adSetId, briefId, status, etag } = params;
    const body: MetaAdSetStatusRequest = { briefId, status, etag };
    return this.http.post<CampaignServiceMetaAdSetStatusChange>(
      `/api/campaigns/${encodeURIComponent(campaignId)}/meta-ad-sets/${encodeURIComponent(adSetId)}/status`,
      body,
      { params: new HttpParams().set('project', projectSlug) }
    );
  }

  /** Bind a campaign that already exists on its ad platform to a brief. Creates nothing upstream. */
  public adoptCampaign(projectSlug: string, request: CampaignAdoptRequest): Observable<CampaignServiceCampaign> {
    return this.http.post<CampaignServiceCampaign>('/api/campaigns/adopt', request, { params: new HttpParams().set('project', projectSlug) });
  }

  /** The approved paid-marketing briefs a campaign can be adopted into. Answers 404 while campaign-service briefs are off. */
  public listAdoptableBriefs(projectSlug: string): Observable<CampaignAdoptableBriefsResponse> {
    return this.http.get<CampaignAdoptableBriefsResponse>('/api/campaigns/briefs', { params: new HttpParams().set('project', projectSlug) });
  }

  /**
   * One campaign row read from campaign-service (not the index), with its CURRENT etag for the next
   * write's `If-Match`, and whether this deployment can pause or resume it.
   */
  public getCampaignRecord(projectSlug: string, briefId: string, campaignId: string): Observable<CampaignRecordResult> {
    const params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    return this.http.get<CampaignRecordResult>(`/api/campaigns/${encodeURIComponent(campaignId)}/record`, { params });
  }

  /** A Reddit or X campaign's keyword targeting. Reddit's `revision` must be sent back with a removal. */
  public getKeywordTargeting(projectSlug: string, briefId: string, campaignId: string): Observable<CampaignServiceKeywordTargeting> {
    const params = new HttpParams().set('project', projectSlug).set('briefId', briefId);
    return this.http.get<CampaignServiceKeywordTargeting>(`/api/campaigns/${encodeURIComponent(campaignId)}/keyword-targeting`, { params });
  }

  /** Remove keywords from a Reddit or X campaign's targeting. POSITIONAL: `results[i]` answers `keywords[i]`. */
  public removeKeywordTargeting(
    projectSlug: string,
    campaignId: string,
    request: KeywordTargetingRemovalsRequest
  ): Observable<CampaignServiceKeywordTargetingRemovals> {
    return this.http.post<CampaignServiceKeywordTargetingRemovals>(`/api/campaigns/${encodeURIComponent(campaignId)}/keyword-targeting/removals`, request, {
      params: new HttpParams().set('project', projectSlug),
    });
  }

  /** The BFF's per-platform route segment for a campaign-service platform id (`meta-ads` -> `meta`). */
  private platformRouteSegment(platform: CampaignAudiencePlatform | CampaignRefPlatform): string {
    return platform.replace(/-ads$/, '');
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

  /**
   * The marker a Monitor-tab read carries: `connection` when its account (or the panel itself) came
   * from the connection path, i.e. a pod with the monitor cutover ON, and `legacy` when it came from
   * a legacy allowlist picker. A pod whose flag disagrees refuses the read with a typed mismatch
   * (`MONITOR_CUTOVER_MISMATCH` / `MONITOR_CUTOVER_LEGACY_MISMATCH`) instead of misserving it; see
   * `MONITOR_ACCOUNT_SOURCE_PARAM`. `null` sends no marker: the Optimize tab's reads, unchanged.
   */
  private monitorAccountSource(source: MonitorAccountSource | null): Record<string, string> {
    return source ? { [MONITOR_ACCOUNT_SOURCE_PARAM]: source === 'connection' ? MONITOR_ACCOUNT_SOURCE_CONNECTION : MONITOR_ACCOUNT_SOURCE_LEGACY } : {};
  }

  /** The upload request both paths share: the file's raw bytes, typed with its own MIME type. */
  private postCreativeAsset(file: Blob, projectSlug: string, briefId: string): Observable<CreativeAssetUploadResult> {
    return this.http.post<CreativeAssetUploadResult>('/api/campaigns/brief/creative-assets', file, {
      params: new HttpParams().set('project', projectSlug).set('brief_id', briefId),
      headers: { 'Content-Type': file.type },
    });
  }

  /**
   * Send one queued file and record its outcome. Re-sent on a transient failure (a 503 from the
   * upload admission, a dropped connection), which is safe because identical bytes return the
   * asset already stored rather than a second copy.
   */
  private queueCreativeAssetAttempt(itemId: string): void {
    const attempt = (this.creativeAssetQueueAttempts.get(itemId) ?? 0) + 1;
    this.creativeAssetQueueAttempts.set(itemId, attempt);
    this.creativeAssetQueueWork.next({ id: itemId, attempt });
  }

  private sendQueuedCreativeAsset(itemId: string, attempt: number): Observable<unknown> {
    return defer(() => {
      const queued = this.creativeAssetQueue().find((item) => item.id === itemId);
      const file = this.creativeAssetQueueFiles.get(itemId);
      // Cancelled, cleared, already sent, or superseded by a Retry since this attempt was queued.
      if (!file || queued?.status !== 'waiting' || this.creativeAssetQueueAttempts.get(itemId) !== attempt) {
        return EMPTY;
      }
      this.patchQueuedCreativeAsset(itemId, { status: 'uploading' });
      return this.postCreativeAsset(file, queued.projectSlug, queued.briefId).pipe(
        // Backed off rather than retried at a fixed beat: a per-platform picker's upload can hold
        // the admission for several seconds, and two quick re-sends would both land inside it.
        retry({
          count: CREATIVE_ASSET_QUEUE_RETRIES,
          delay: (error: unknown, attempt: number) =>
            isTransientHttpError(error) ? timer(CREATIVE_ASSET_QUEUE_RETRY_BASE_MS * 2 ** (attempt - 1)) : throwError(() => error),
        }),
        map((result) => {
          this.creativeAssetQueueFiles.delete(itemId);
          this.patchQueuedCreativeAsset(itemId, {
            status: result.created ? 'uploaded' : 'present',
            message: result.created ? CREATIVE_ASSET_UPLOADED_MESSAGE : CREATIVE_ASSET_PRESENT_MESSAGE,
            assetId: result.id,
          });
        }),
        catchError((error: unknown) => {
          const outcome = this.queuedCreativeAssetFailure(error);
          if (outcome.status === 'refused') {
            console.warn('Creative library upload refused:', queued.name, error);
            this.creativeAssetQueueFiles.delete(itemId);
          } else {
            console.error('Creative library upload failed:', queued.name, error);
          }
          this.patchQueuedCreativeAsset(itemId, outcome);
          return EMPTY;
        }),
        takeUntil(this.creativeAssetQueueAbort),
        finalize(() => {
          if (this.creativeAssetQueue().find((item) => item.id === itemId)?.status === 'uploading') {
            this.patchQueuedCreativeAsset(itemId, { status: 'cancelled', message: CREATIVE_ASSET_CANCELLED_UPLOADING_MESSAGE });
          }
        })
      );
    });
  }

  /** Why a file can never be stored as it is, checked before it is sent; null when it may be sent. */
  private refuseQueuedCreativeAsset(file: File, folder: boolean): { refusal: CreativeAssetQueueRefusal; message: string } | null {
    // `webkitRelativePath` is `folder/name.png` at the top level of a picked folder. Defaulted because
    // an engine without folder picks (and jsdom) leaves it undefined rather than empty.
    if (folder && (file.webkitRelativePath ?? '').split('/').length > 2) {
      return { refusal: 'subfolder', message: CREATIVE_ASSET_SUBFOLDER_MESSAGE };
    }
    if (!isCreativeAssetMimeType(file.type)) {
      return { refusal: 'type', message: CREATIVE_ASSET_WRONG_TYPE_MESSAGE };
    }
    if (file.size > CREATIVE_ASSET_MAX_BYTES) {
      return { refusal: 'size', message: CREATIVE_ASSET_TOO_LARGE_MESSAGE };
    }
    if (file.size === 0) {
      return { refusal: 'other', message: CREATIVE_ASSET_EMPTY_MESSAGE };
    }
    return null;
  }

  /**
   * A refused upload is one no retry can fix — over quota (409), the wrong type (415), too large
   * (413) or otherwise invalid (400). Anything else, including an expired session or a network drop
   * that outlasted the re-sends, is `failed` and keeps its file for Retry.
   */
  private queuedCreativeAssetFailure(error: unknown): Pick<CreativeAssetQueueItem, 'status' | 'refusal' | 'message'> {
    const status = error instanceof HttpErrorResponse && !isTransientHttpError(error) ? error.status : 0;
    if (status === 409) {
      return { status: 'refused', refusal: 'quota', message: CREATIVE_ASSET_QUOTA_MESSAGE };
    }
    if (status === 415) {
      return { status: 'refused', refusal: 'type', message: CREATIVE_ASSET_WRONG_TYPE_MESSAGE };
    }
    if (status === 413) {
      return { status: 'refused', refusal: 'size', message: CREATIVE_ASSET_TOO_LARGE_MESSAGE };
    }
    if (status === 400) {
      return { status: 'refused', refusal: 'other', message: extractErrorMessage(error, CREATIVE_ASSET_REFUSED_FALLBACK_MESSAGE) };
    }
    return { status: 'failed', refusal: null, message: extractErrorMessage(error, CREATIVE_ASSET_FAILED_FALLBACK_MESSAGE) };
  }

  private patchQueuedCreativeAsset(itemId: string, patch: Partial<CreativeAssetQueueItem>): void {
    this.creativeAssetQueue.update((items) => items.map((item) => (item.id === itemId ? { ...item, ...patch } : item)));
  }
}
