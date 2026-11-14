// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED,
  CAMPAIGN_AUDIENCE_CONFLICT_CODE,
  CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE,
  CAMPAIGN_AUDIENCE_FAILED_MESSAGE,
  CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE,
  CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE,
  CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE,
  CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE,
  CAMPAIGN_AUDIENCE_WINDOWS,
  CAMPAIGN_ETAG_REQUIRED_CODE,
  CAMPAIGN_ETAG_REQUIRED_MESSAGE,
  CAMPAIGN_ETAG_STALE_CODE,
  CAMPAIGN_ETAG_STALE_MESSAGE,
  isValidCampaignRefId,
  KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE,
  KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_OUTCOME,
  META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED,
  META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE,
  META_AD_SET_PAUSE_RECORD_UNCONFIRMED_MARKER,
  META_AD_SET_STATUS_UNCONFIRMED_OUTCOME,
} from '@lfx-one/shared/constants';
import type {
  CampaignAdoptableBrief,
  CampaignAdoptPlatform,
  CampaignAudiencePlatform,
  CampaignLeverUnconfirmedOutcome,
  CampaignMetricsWindow,
  CampaignRefPlatform,
  CampaignServiceBriefIndexDoc,
  CampaignServiceCampaign,
  CampaignServiceCampaignResolution,
  CampaignServiceCampaignTarget,
  CampaignServiceKeywordTargeting,
  CampaignServiceKeywordTargetingRemovalResult,
  CampaignServiceKeywordTargetingRemovals,
  CampaignServiceMetaAds,
  CampaignServiceMetaAdSets,
  CampaignServiceMetaAdSetStatusChange,
  CampaignServicePlatformAudienceMap,
  CampaignServiceRedditKeywords,
  CampaignServiceSettingsReadback,
  KeywordTargetingRemovalItem,
  MetaAdSetStatus,
  QueryServiceResponse,
  RedditKeywordsWindow,
} from '@lfx-one/shared/interfaces';
import { withAdoptedMarker } from '@lfx-one/shared/utils/campaign-optimize.utils';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { ServiceValidationError } from '../errors/service-validation.error';
import { getCodeForStatus } from '../helpers/http-status.helper';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { encodePathSegment } from '../helpers/url-validation';
import { upstreamAnswered } from './campaign-keyword-actions';
import { asUnconfirmedWriteFailure, readEtag } from './campaign-service.service';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * Proxies the Optimize tab's campaign-service reads and levers that the BFF did not reach before:
 * per-platform audience reads, campaign-ref resolves, the Reddit keyword read, the campaign
 * settings readback, Meta ad sets (list and status) and their ads (list), keyword targeting (read and remove, Reddit
 * and X) and campaign adoption.
 *
 * Kept apart from `CampaignServiceClient` so it can grow without colliding with the monitor
 * cutover's edits there; it reuses that client's ETag and unconfirmed-write helpers rather than
 * restating them. Every call runs on the caller's own bearer token. Every path segment is encoded
 * with `encodePathSegment`; a body is always the SIXTH argument of the proxy call, after an
 * explicit `undefined` query, because a body passed one position early is sent as a query string.
 */
export class CampaignOptimizeService {
  private readonly microserviceProxy = new MicroserviceProxyService();

  /**
   * One platform's audience demographics for the project's OWN campaigns.
   *
   * `platform` is the campaign-service path segment and comes from the BFF route, never from the
   * request; it is still checked against the table so a caller bug cannot address another route.
   * The window is a QUERY parameter, omitted when the caller names none so upstream applies its own
   * default. Upstream fails the whole read when any one breakdown fails, so there is no partial arm.
   *
   * A failure is answered with a fixed message per status (`asAudienceReadFailure`), never with
   * campaign-service's own sentence.
   */
  public async getPlatformAudience<P extends CampaignAudiencePlatform>(
    req: Request,
    projectSlug: string,
    platform: P,
    window?: string
  ): Promise<CampaignServicePlatformAudienceMap[P]> {
    if (projectSlug === '') {
      throw ServiceValidationError.forField('project', 'An audience read requires the project it is scoped to.', {
        operation: 'get_platform_audience',
        service: 'campaign_optimize_service',
      });
    }
    if (!Object.prototype.hasOwnProperty.call(CAMPAIGN_AUDIENCE_WINDOWS, platform)) {
      throw ServiceValidationError.forField('platform', 'This platform has no audience read.', {
        operation: 'get_platform_audience',
        service: 'campaign_optimize_service',
      });
    }
    logger.debug(req, 'get_platform_audience', 'Reading audience demographics from campaign-service', { platform, window });
    try {
      return await this.microserviceProxy.proxyRequest<CampaignServicePlatformAudienceMap[P]>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        `/projects/${encodePathSegment(projectSlug)}/${platform}/audience`,
        'GET',
        window ? { window } : undefined
      );
    } catch (error) {
      // An answered 400 or 409 each becomes ONE fixed message although campaign-service means
      // several things by it (400: switched off, an inactive connection, no ad account; 409: another
      // or no recorded account, a malformed stored id, too many campaigns) and its error carries no
      // `reason` for any of them. Its own sentence is kept in the log (bounded, scrubbed like every
      // log field, never sent to the browser) so the cause stays diagnosable.
      if (error instanceof MicroserviceError && (error.statusCode === 400 || error.statusCode === 409) && upstreamAnswered(error)) {
        const upstreamMessage = (error.errorBody as { message?: unknown } | undefined)?.message;
        logger.debug(req, 'get_platform_audience', `campaign-service refused the audience read with ${error.statusCode}; answering a fixed message`, {
          status: error.statusCode,
          platform,
          window,
          upstream_message: typeof upstreamMessage === 'string' ? upstreamMessage.slice(0, CAMPAIGN_AUDIENCE_LOGGED_UPSTREAM_MESSAGE_MAX_LENGTH) : undefined,
        });
      }
      throw asAudienceReadFailure(error, 'get_platform_audience');
    }
  }

  /**
   * Resolve one platform campaign id to campaign-service's own campaign and brief, as
   * `CampaignServiceClient.resolveMicrosoftAdsCampaign` does for Microsoft: the bridge from a
   * platform-keyed row (a keyword, an ad set) to the UUID-keyed levers. An unowned id is a 200 with
   * an empty `matches`, and MORE THAN ONE match is reachable (a re-pointed connection), so the
   * caller must check `match_count` and refuse rather than choose.
   *
   * The id is a QUERY parameter (fifth argument) and is checked against the platform's id rule first.
   */
  public async resolvePlatformCampaign(
    req: Request,
    projectSlug: string,
    platform: CampaignRefPlatform,
    platformCampaignId: string
  ): Promise<CampaignServiceCampaignResolution> {
    if (projectSlug === '' || !isValidCampaignRefId(platform, platformCampaignId)) {
      throw ServiceValidationError.forField('platformCampaignId', 'A campaign reference lookup requires the project and a valid platform campaign id.', {
        operation: 'resolve_platform_campaign',
        service: 'campaign_optimize_service',
      });
    }
    return this.microserviceProxy.proxyRequest<CampaignServiceCampaignResolution>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodePathSegment(projectSlug)}/${platform}/campaign-ref`,
      'GET',
      { platform_campaign_id: platformCampaignId }
    );
  }

  /**
   * Reddit keyword performance for the project's OWN campaigns (`get-reddit-ads-keywords`,
   * campaign-service #331): the top 50 (campaign, keyword) rows by impressions, read live and
   * read-only. The window is a QUERY parameter, omitted when the caller names none so upstream
   * applies `last_30_days`.
   */
  public async getRedditAdsKeywords(req: Request, projectSlug: string, window?: RedditKeywordsWindow): Promise<CampaignServiceRedditKeywords> {
    if (projectSlug === '') {
      throw ServiceValidationError.forField('project', 'A keyword read requires the project it is scoped to.', {
        operation: 'get_reddit_ads_keywords',
        service: 'campaign_optimize_service',
      });
    }
    return this.microserviceProxy.proxyRequest<CampaignServiceRedditKeywords>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodePathSegment(projectSlug)}/reddit-ads/keywords`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * One campaign row read from campaign-service itself, with its CURRENT ETag (header first, body
   * second, as `adoptCampaign` takes it). Used where the asynchronous index could lag a write the
   * caller needs to see at once: a campaign adopted a moment ago, or a validator for `If-Match`.
   */
  public async getCampaign(req: Request, ref: CampaignServiceCampaignTarget): Promise<CampaignServiceCampaign> {
    logger.debug(req, 'get_campaign', 'Reading campaign row from campaign-service', { campaign_id: ref.campaignId });
    const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceCampaign>(req, 'LFX_V2_CAMPAIGN_SERVICE', campaignPath(ref), 'GET');
    // `adopted` is kept only as a literal `true`: the act dialog withholds Resume on it.
    return withAdoptedMarker({ ...response.data, etag: readEtag(response) ?? response.data.etag });
  }

  /**
   * The campaign's current configuration on its platform, compared field by field with what the
   * row recorded. A pure read upstream: nothing is written to the platform or the row.
   */
  public async getCampaignSettings(req: Request, ref: CampaignServiceCampaignTarget): Promise<CampaignServiceSettingsReadback> {
    logger.debug(req, 'get_campaign_settings', 'Reading campaign settings from campaign-service', { campaign_id: ref.campaignId });
    return this.microserviceProxy.proxyRequest<CampaignServiceSettingsReadback>(req, 'LFX_V2_CAMPAIGN_SERVICE', `${campaignPath(ref)}/settings`, 'GET');
  }

  /** A Meta campaign's ad sets with their delivery over `window`, read live. */
  public async listMetaAdSets(req: Request, ref: CampaignServiceCampaignTarget, window?: CampaignMetricsWindow): Promise<CampaignServiceMetaAdSets> {
    logger.debug(req, 'list_meta_ad_sets', 'Reading Meta ad sets from campaign-service', { campaign_id: ref.campaignId, window });
    return this.microserviceProxy.proxyRequest<CampaignServiceMetaAdSets>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${campaignPath(ref)}/meta-ad-sets`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * The ads under ONE ad set of a Meta campaign with their delivery over `window`, read live.
   * Strictly read-only upstream: there is no per-ad pause or edit. `truncated` says the listing
   * passed its page cap; delivery is never truncated.
   */
  public async listMetaAds(
    req: Request,
    params: CampaignServiceCampaignTarget & { adSetId: string },
    window?: CampaignMetricsWindow
  ): Promise<CampaignServiceMetaAds> {
    logger.debug(req, 'list_meta_ads', 'Reading Meta ads of an ad set from campaign-service', {
      campaign_id: params.campaignId,
      ad_set_id: params.adSetId,
      window,
    });
    return this.microserviceProxy.proxyRequest<CampaignServiceMetaAds>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${campaignPath(params)}/meta-ad-sets/${encodePathSegment(params.adSetId)}/ads`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * Pause or resume ONE ad set of a Meta campaign.
   *
   * A dispatching write on a live paid campaign, guarded like the campaign status toggle: `If-Match`
   * carries the campaign ROW's ETag (upstream answers 428 without it and 412 when it is stale). The
   * ETag in the answer is taken off the response header, which the contract guarantees, as for the
   * toggle. It is the row's version UNCHANGED for most changes, but a NEW one when the call wrote or
   * cleared the recorded ad set's deliberate-pause record, so the caller must always adopt it.
   *
   * Failures are classified by `asLeverFailure`: 412/428 get their own codes and fixed messages; a
   * 503 that says the change is unconfirmed, and any failure nobody answered, become
   * `META_AD_SET_STATUS_UNCONFIRMED`; a 409 (including "the status WAS changed on Meta, but the
   * campaign changed meanwhile") passes through with campaign-service's own fixed sentence. Before
   * that, an answered 503 saying the status changed but its deliberate-pause RECORD "could not be
   * confirmed" becomes `META_AD_SET_PAUSE_RECORD_UNCONFIRMED`, so the UI asks for
   * `deliberately_paused` to be re-read rather than showing it as a definite failure.
   */
  public async updateMetaAdSetStatus(
    req: Request,
    params: CampaignServiceCampaignTarget & { adSetId: string; status: MetaAdSetStatus; etag: string }
  ): Promise<CampaignServiceMetaAdSetStatusChange> {
    const path = `${campaignPath(params)}/meta-ad-sets/${encodePathSegment(params.adSetId)}/status`;
    logger.debug(req, 'update_meta_ad_set_status', 'Sending ad set status change to campaign-service', {
      campaign_id: params.campaignId,
      ad_set_id: params.adSetId,
      status: params.status,
    });

    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceMetaAdSetStatusChange>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'POST',
        undefined,
        { status: params.status },
        { 'If-Match': params.etag }
      );
      return { ...response.data, etag: readEtag(response) ?? response.data.etag };
    } catch (error) {
      const failure = asLeverFailure(error, 'update_meta_ad_set_status', META_AD_SET_STATUS_UNCONFIRMED_OUTCOME);
      if (failure === error && error instanceof MicroserviceError && error.statusCode === 503 && upstreamAnswered(error)) {
        const upstreamMessage = (error.errorBody as { message?: unknown } | undefined)?.message;
        if (typeof upstreamMessage === 'string' && META_AD_SET_PAUSE_RECORD_UNCONFIRMED_MARKER.test(upstreamMessage)) {
          throw rewrap(error, 'update_meta_ad_set_status', META_AD_SET_PAUSE_RECORD_UNCONFIRMED_CODE, META_AD_SET_PAUSE_RECORD_OUTCOME_UNCONFIRMED);
        }
      }
      throw failure;
    }
  }

  /**
   * Bind a campaign that already exists on its ad platform to a brief. Nothing is created on the
   * platform; upstream reads the campaign under the project's own connection and writes the row.
   * Answers 201 with the new row and its ETag (header).
   *
   * Upstream's refusals (400 malformed or unsupported, 404 proven absent, 409 already bound or a
   * foreign account, 503 not verifiable) pass through with its fixed sentences. A failure nobody
   * answered may still have written the row, so it is reported as `CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED`.
   */
  public async adoptCampaign(
    req: Request,
    params: { projectSlug: string; briefId: string; platform: CampaignAdoptPlatform; platformCampaignId: string }
  ): Promise<CampaignServiceCampaign> {
    const path = `/projects/${encodePathSegment(params.projectSlug)}/briefs/${encodePathSegment(params.briefId)}/campaigns/adopt`;
    logger.debug(req, 'adopt_campaign', 'Sending campaign adoption to campaign-service', {
      brief_id: params.briefId,
      platform: params.platform,
    });

    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceCampaign>(req, 'LFX_V2_CAMPAIGN_SERVICE', path, 'POST', undefined, {
        platform: params.platform,
        platform_campaign_id: params.platformCampaignId,
      });
      return { ...response.data, etag: readEtag(response) ?? response.data.etag };
    } catch (error) {
      throw asUnconfirmedWriteFailure(error, 'adopt_campaign', CAMPAIGN_ADOPT_OUTCOME_UNCONFIRMED);
    }
  }

  /**
   * The project's briefs a campaign can be ADOPTED into: approved, paid-marketing, from the Query
   * Service (campaign-service exposes no brief list; `campaign_brief` is indexed instead).
   *
   * Filtered HERE, not with a query filter: an index filter on `status` is unverified, and a filter
   * that silently matched nothing would read as "no approved briefs".
   *
   * `delivery_type` follows campaign-service's index contract (`BriefDoc`,
   * `internal/infrastructure/indexer/contract.go`): a document indexed before the field existed keeps
   * its old shape, and an ABSENT field means "written before the widening", which for every such row
   * is paid-marketing with an empty stage. Email briefs exist only after the widening and always
   * publish `delivery_type` (the field has no `omitempty`). So an absent value or `'paid-marketing'` is
   * offered, and `'email'` or any other explicit value is not. `adopt-campaign` itself refuses a brief
   * of the wrong channel with 400.
   */
  public async listAdoptableBriefs(req: Request, projectSlug: string): Promise<CampaignAdoptableBrief[]> {
    if (projectSlug === '') {
      throw ServiceValidationError.forField('project', 'A brief list requires the project it is scoped to.', {
        operation: 'list_adoptable_briefs',
        service: 'campaign_optimize_service',
      });
    }
    const docs = await fetchAllQueryResources<CampaignServiceBriefIndexDoc>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<CampaignServiceBriefIndexDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'campaign_brief',
          parent: `project:${projectSlug}`,
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );
    const briefs = docs
      .filter(
        (d) => typeof d?.id === 'string' && d.id !== '' && d.status === 'approved' && (d.delivery_type === undefined || d.delivery_type === 'paid-marketing')
      )
      .map((d) => ({
        id: d.id,
        eventSlug: typeof d.event_slug === 'string' ? d.event_slug : '',
        programType: typeof d.program_type === 'string' ? d.program_type : '',
        platforms: Array.isArray(d.platforms) ? d.platforms.filter((p): p is string => typeof p === 'string') : [],
      }));
    logger.debug(req, 'list_adoptable_briefs', 'Filtered indexed briefs to approved paid briefs', { indexed: docs.length, adoptable: briefs.length });
    return briefs;
  }

  /** The positive keywords of a Reddit ad group or X line item, read live. Any other platform is upstream's 400. */
  public async getKeywordTargeting(req: Request, ref: CampaignServiceCampaignTarget): Promise<CampaignServiceKeywordTargeting> {
    logger.debug(req, 'get_keyword_targeting', 'Reading keyword targeting from campaign-service', { campaign_id: ref.campaignId });
    return this.microserviceProxy.proxyRequest<CampaignServiceKeywordTargeting>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${campaignPath(ref)}/keyword-targeting`,
      'GET'
    );
  }

  /**
   * Remove keywords from a Reddit or X campaign's keyword targeting.
   *
   * No `If-Match`: upstream persists nothing for this lever. Reddit instead requires the `revision`
   * the read returned and refuses (409) when the targeting changed since. The answer is POSITIONAL
   * (`results[i]` answers `keywords[i]`); one that cannot be read that way (another campaign's id, a
   * different number of results, or ANY entry naming a different keyword or criterion than the one
   * sent at its index) is refused as unconfirmed rather than passed on, because the removals may have
   * happened and nothing in such a body says which. Checking only the count would let a reordered or
   * substituted set show a keyword that was not removed as APPLIED.
   */
  public async removeKeywordTargeting(
    req: Request,
    params: CampaignServiceCampaignTarget & { keywords: KeywordTargetingRemovalItem[]; revision?: string }
  ): Promise<CampaignServiceKeywordTargetingRemovals> {
    const path = `${campaignPath(params)}/keyword-targeting/removals`;
    const body: { keywords: { keyword?: string; criterion_id?: string }[]; revision?: string } = {
      keywords: params.keywords.map((item) => (item.criterionId !== undefined ? { criterion_id: item.criterionId } : { keyword: item.keyword })),
    };
    if (params.revision !== undefined) {
      body.revision = params.revision;
    }
    logger.debug(req, 'remove_keyword_targeting', 'Sending keyword targeting removals to campaign-service', {
      campaign_id: params.campaignId,
      count: params.keywords.length,
    });

    let response: CampaignServiceKeywordTargetingRemovals;
    try {
      response = await this.microserviceProxy.proxyRequest<CampaignServiceKeywordTargetingRemovals>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'POST',
        undefined,
        body
      );
    } catch (error) {
      throw asLeverFailure(error, 'remove_keyword_targeting', KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_OUTCOME);
    }

    const readable = response?.campaign_id === params.campaignId && Array.isArray(response.results) && response.results.length === params.keywords.length;
    // Every entry, not just the count. Compared exactly: campaign-service echoes each keyword and
    // criterion id as requested (it never trims or case-folds them), so any difference is a mismatch.
    const mismatchedIndex = readable ? response.results.findIndex((entry, i) => !answersRemovalItem(entry, params.keywords[i])) : -1;
    if (!readable || mismatchedIndex !== -1) {
      logger.warning(req, 'remove_keyword_targeting', 'Upstream answered with a result set that cannot be read positionally', {
        campaign_id: params.campaignId,
        echoed_campaign_id: response?.campaign_id,
        requested: params.keywords.length,
        returned: Array.isArray(response?.results) ? response.results.length : null,
        mismatched_index: mismatchedIndex === -1 ? null : mismatchedIndex,
      });
      throw new MicroserviceError('Keyword targeting removal confirmation did not match the request', 502, KEYWORD_TARGETING_REMOVAL_UNCONFIRMED_CODE, {
        operation: 'remove_keyword_targeting',
        service: 'campaign_optimize_service',
        path,
        clientMessage: KEYWORD_TARGETING_REMOVAL_OUTCOME_UNCONFIRMED,
      });
    }
    return response;
  }
}

/**
 * Whether a removal result names the item sent at its index, compared on the field the REQUEST
 * used: the same criterion id on X, the same keyword on Reddit. The other field is not required to
 * be absent. campaign-service's `keyword-targeting-removal-result` declares both as optional and
 * neither as exclusive; today the X adapter fills only `criterion_id` and the Reddit adapter only
 * `keyword`, but an X result that also echoed the keyword text would still answer its criterion,
 * and refusing it would turn every successful removal into a 502. A non-object entry names nothing.
 */
function answersRemovalItem(entry: CampaignServiceKeywordTargetingRemovalResult | null | undefined, sent: KeywordTargetingRemovalItem): boolean {
  if (!entry || typeof entry !== 'object') {
    return false;
  }
  if (sent.criterionId !== undefined) {
    return entry.criterion_id === sent.criterionId;
  }
  return entry.keyword === sent.keyword;
}

/** `/projects/{p}/briefs/{b}/campaigns/{c}`, every segment encoded. */
function campaignPath(ref: CampaignServiceCampaignTarget): string {
  return `/projects/${encodePathSegment(ref.projectSlug)}/briefs/${encodePathSegment(ref.briefId)}/campaigns/${encodePathSegment(ref.campaignId)}`;
}

/**
 * The error a failed lever write should surface, so the UI can branch on `code` alone.
 *
 * - An ANSWERED 412 (stale ETag) or 428 (no ETag) gets its own code and a fixed "nothing was
 *   changed" message; `getCodeForStatus` would otherwise collapse both to `CLIENT_ERROR`. Only
 *   campaign-service's own answer (its JSON error envelope, `upstreamAnswered`) proves the write was
 *   refused before dispatch, so these are mapped inside the answered branch.
 * - An ANSWERED 503 whose message matches the lever's unconfirmed marker gets the lever's
 *   UNCONFIRMED code and message. campaign-service answers 503 for both a definite and an
 *   unconfirmed failure and tells them apart only in the message (see `campaign-keyword-actions.ts`).
 * - A failure nobody answered (transport, timeout, a gateway 5xx, 408) may have reached the platform,
 *   so it is UNCONFIRMED too. So is an unanswered 412 or 428: a gateway or proxy page carrying that
 *   status says nothing about whether campaign-service dispatched the write, and calling it a
 *   definite no-op could invite a duplicate change. Any other unanswered 4xx never reached the
 *   service and passes through.
 * - Every other answer, a definite 503 included, passes through with campaign-service's own fixed
 *   sentence; its service code never puts platform text in a client message.
 *
 * `message` keeps the original cause for the log; only the client-facing text is replaced.
 */
export function asLeverFailure(error: unknown, operation: string, unconfirmed: CampaignLeverUnconfirmedOutcome): unknown {
  if (!(error instanceof MicroserviceError)) {
    return error;
  }
  if (upstreamAnswered(error)) {
    if (error.statusCode === 412) {
      return rewrap(error, operation, CAMPAIGN_ETAG_STALE_CODE, CAMPAIGN_ETAG_STALE_MESSAGE);
    }
    if (error.statusCode === 428) {
      return rewrap(error, operation, CAMPAIGN_ETAG_REQUIRED_CODE, CAMPAIGN_ETAG_REQUIRED_MESSAGE);
    }
    const upstreamMessage = (error.errorBody as { message?: unknown } | undefined)?.message;
    if (error.statusCode === 503 && typeof upstreamMessage === 'string' && unconfirmed.marker.test(upstreamMessage)) {
      return rewrap(error, operation, unconfirmed.code, unconfirmed.message);
    }
    return error;
  }
  const unansweredMayHaveDispatched = error.statusCode === 408 || error.statusCode === 412 || error.statusCode === 428;
  if (error.statusCode >= 400 && error.statusCode < 500 && !unansweredMayHaveDispatched) {
    return error;
  }
  return rewrap(error, operation, unconfirmed.code, unconfirmed.message);
}

/**
 * The error a failed audience read should surface: a fixed message per status, so campaign-service's
 * own sentence never reaches the browser and the UI can branch on `code` alone.
 *
 * Only campaign-service's own answer (`upstreamAnswered`) earns a specific code: 404 is "no
 * connection for the platform", 409 campaigns that cannot be read together (campaign-service's
 * `conflict-error` carries no `reason` on these reads, so the message names every cause), 503 a
 * read the platform did not confirm (rate-limited, unreachable, partial), and 400 a read switched
 * off in this environment, or a connection that is inactive or has no ad account. Everything else, answered or
 * not (an auth refusal, a server error, a gateway page, a transport failure), keeps its status and
 * the code that status maps to, with a generic message.
 */
export function asAudienceReadFailure(error: unknown, operation: string): unknown {
  if (!(error instanceof MicroserviceError)) {
    return error;
  }
  if (upstreamAnswered(error)) {
    switch (error.statusCode) {
      case 404:
        return rewrap(error, operation, CAMPAIGN_AUDIENCE_NO_CONNECTION_CODE, CAMPAIGN_AUDIENCE_NO_CONNECTION_MESSAGE);
      case 409:
        return rewrap(error, operation, CAMPAIGN_AUDIENCE_CONFLICT_CODE, CAMPAIGN_AUDIENCE_CONFLICT_MESSAGE);
      case 503:
        return rewrap(error, operation, CAMPAIGN_AUDIENCE_UNAVAILABLE_CODE, CAMPAIGN_AUDIENCE_UNAVAILABLE_MESSAGE);
      case 400:
        return rewrap(error, operation, CAMPAIGN_AUDIENCE_NOT_ENABLED_CODE, CAMPAIGN_AUDIENCE_NOT_ENABLED_MESSAGE);
    }
  }
  return rewrap(error, operation, getCodeForStatus(error.statusCode), CAMPAIGN_AUDIENCE_FAILED_MESSAGE);
}

function rewrap(error: MicroserviceError, operation: string, code: string, clientMessage: string): MicroserviceError {
  return new MicroserviceError(error.message, error.statusCode, code, {
    operation,
    service: error.service,
    path: error.path,
    errorBody: error.errorBody,
    originalMessage: error.originalMessage,
    originalError: error,
    transportFailure: error.transportFailure,
    clientMessage,
  });
}
