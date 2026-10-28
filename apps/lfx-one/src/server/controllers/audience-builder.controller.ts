// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  AUDIENCE_ATTACH_MAX_LIST_IDS,
  AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH,
  AUDIENCE_CUSTOM_OPERATORS,
  AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH,
  AUDIENCE_REGISTRANTS_EVENT_MAX_LENGTH,
  AUDIENCE_REGISTRANTS_EVENT_MESSAGE,
  AUDIENCE_SPEAKER_SCOPES,
} from '@lfx-one/shared/constants';
import { NextFunction, Request, Response } from 'express';

import type {
  AudienceAttachExistingRequest,
  AudienceCustomAnswer,
  AudienceCustomCriteria,
  AudienceCustomOperator,
  AudienceCustomPropertyFilter,
  AudienceSpeakerScope,
  AudienceComposeMasterPartial,
  AudienceComposeMasterRequest,
  AudienceDiscoverRequest,
  AudienceDiscoverySSEEventType,
  AudiencePreviewCountRequest,
  AudienceQaRunRequest,
  FlushableResponse,
} from '@lfx-one/shared/interfaces';

import { ServiceValidationError } from '../errors';
import { validateScrapeUrl } from '../helpers/url-validation';
import { AudienceBuilderProxyService, AudienceComposePartialError } from '../services/audience-builder-proxy.service';
import { logger } from '../services/logger.service';
import { addShutdownHook, isShuttingDown } from '../utils/shutdown';

/** Highest `limit` `/last-sent` honours; more sends than this is a research task, not a picker. */
const LAST_SENT_MAX_LIMIT = 10;

/**
 * The most list ids one request may carry, and the longest a single one may be.
 *
 * Every id here is forwarded upstream and a 201 audience row is created, so an unbounded array is
 * an unbounded upstream payload reachable by any campaign manager. A HubSpot list id is a short
 * numeric string. The Audience tab checks the same shared bound before offering an action, so only
 * a malformed or hostile body reaches it.
 *
 * Refused rather than truncated: silently dropping ids past the cap would record a send with LESS
 * suppression than the caller asked for, which is the same failure `strictStringArray` refuses a
 * blank entry to avoid.
 */
const MAX_LIST_IDS = AUDIENCE_ATTACH_MAX_LIST_IDS;
const MAX_LIST_ID_LENGTH = 64;

/** Free text forwarded upstream and stored on the audience row, so it needs a ceiling too. */
const MAX_INCLUSION_SUMMARY_LENGTH = AUDIENCE_INCLUSION_SUMMARY_MAX_LENGTH;

/** The refusal for a compose or attach with no suppression list: every send must keep one. */
const MISSING_SUPPRESSION_MESSAGE = 'at least one suppression list is required: every send must keep at least one';

/** Default number of past sends returned when the caller does not ask for a specific count. */
const LAST_SENT_DEFAULT_LIMIT = 3;

/** Bounds on the custom-audience payload, mirroring the upstream design's limits. */
const CUSTOM_REQUEST_MAX_LENGTH = 2000;
const CUSTOM_ANSWER_MAX_LENGTH = 500;
const CUSTOM_QUESTION_ID_MAX_LENGTH = 64;
const CUSTOM_MAX_ANSWERS = 12;
const CUSTOM_MAX_VALUES = 25;
const CUSTOM_MAX_PAGE_VIEW_URLS = 10;
const CUSTOM_VALUE_MAX_LENGTH = 200;
const CUSTOM_MAX_FILTERS = 10;
// Derived from the shared constants the UI offers, so an operator or scope added there is never
// refused here.
const CUSTOM_OPERATORS: readonly AudienceCustomOperator[] = AUDIENCE_CUSTOM_OPERATORS.map((o) => o.value);
const SPEAKER_SCOPES: readonly AudienceSpeakerScope[] = AUDIENCE_SPEAKER_SCOPES.map((s) => s.key);
const PROPERTY_NAME = /^[A-Za-z0-9_]{1,100}$/;

/** A bounded array of trimmed, non-blank strings, or null when the value is not one. */
function valueArray(value: unknown, max = CUSTOM_MAX_VALUES): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) return null;
  if (value.some((entry) => typeof entry !== 'string' || entry.length > CUSTOM_VALUE_MAX_LENGTH)) return null;
  return value.map((entry) => (entry as string).trim()).filter(Boolean);
}

/**
 * Validates a custom-audience criteria object, returning it rebuilt from checked fields or the
 * name of the first invalid field. Rebuilt rather than passed through for the reason compose
 * reconstructs its payload: a mistyped field must not reach a non-idempotent create.
 *
 * Only SHAPE is checked here. Whether the criteria make sense (a gate for location branches, a
 * property the portal defines) is upstream's to decide, because only it can read the portal.
 */
function parseCustomCriteria(raw: unknown): { criteria: AudienceCustomCriteria } | { field: string; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { field: 'criteria', message: 'criteria must be an object' };
  const c = raw as Record<string, unknown>;

  const arrays: Record<'cities' | 'countries' | 'registeredFor' | 'educationTopics' | 'pageViewUrls', string[]> = {
    cities: [],
    countries: [],
    registeredFor: [],
    educationTopics: [],
    pageViewUrls: [],
  };
  for (const field of ['cities', 'countries', 'registeredFor', 'educationTopics', 'pageViewUrls'] as const) {
    // Upstream caps page_view_urls at 10, every other list at 25.
    const max = field === 'pageViewUrls' ? CUSTOM_MAX_PAGE_VIEW_URLS : CUSTOM_MAX_VALUES;
    const parsed = valueArray(c[field], max);
    if (!parsed) return { field, message: `${field} must be an array of at most ${max} strings` };
    arrays[field] = parsed;
  }
  const flags = ['contactLocation', 'eventRegistered', 'educationEnrolled', 'gateEventHistory', 'ambassadors'] as const;
  const badFlag = flags.find((field) => c[field] !== undefined && typeof c[field] !== 'boolean');
  if (badFlag) return { field: badFlag, message: `${badFlag} must be a boolean` };
  const badString = (['gateListId', 'label', 'educationTopicProperty'] as const).find((field) => c[field] !== undefined && typeof c[field] !== 'string');
  if (badString) return { field: badString, message: `${badString} must be a string` };
  if (typeof c['gateListId'] === 'string' && c['gateListId'].trim().length > MAX_LIST_ID_LENGTH) {
    return { field: 'gateListId', message: `gateListId must be at most ${MAX_LIST_ID_LENGTH} characters` };
  }
  if (typeof c['label'] === 'string' && c['label'].trim().length > CUSTOM_VALUE_MAX_LENGTH) {
    // Refused rather than cut: the label names the list, so a silent cut renames it.
    return { field: 'label', message: `label must be at most ${CUSTOM_VALUE_MAX_LENGTH} characters` };
  }

  const filters: AudienceCustomPropertyFilter[] = [];
  if (c['propertyFilters'] !== undefined) {
    if (!Array.isArray(c['propertyFilters']) || c['propertyFilters'].length > CUSTOM_MAX_FILTERS) {
      return { field: 'propertyFilters', message: `propertyFilters must be an array of at most ${CUSTOM_MAX_FILTERS} filters` };
    }
    for (const entry of c['propertyFilters'] as unknown[]) {
      const f = (entry ?? {}) as Record<string, unknown>;
      const values = valueArray(f['values']);
      if (typeof f['property'] !== 'string' || !PROPERTY_NAME.test(f['property'])) {
        return { field: 'propertyFilters', message: 'each filter needs a HubSpot internal property name (letters, digits, underscores)' };
      }
      if (!CUSTOM_OPERATORS.includes(f['operator'] as AudienceCustomOperator)) {
        return { field: 'propertyFilters', message: `operator must be one of ${CUSTOM_OPERATORS.join(', ')}` };
      }
      if (!values) return { field: 'propertyFilters', message: `filter values must be an array of at most ${CUSTOM_MAX_VALUES} strings` };
      filters.push({ property: f['property'], operator: f['operator'] as AudienceCustomOperator, values });
    }
  }

  let speakers: AudienceCustomCriteria['speakers'];
  if (c['speakers'] !== undefined && c['speakers'] !== null) {
    const sp = c['speakers'] as Record<string, unknown>;
    const eventNames = valueArray(sp['eventNames']);
    if (!SPEAKER_SCOPES.includes(sp['scope'] as AudienceSpeakerScope))
      return { field: 'speakers', message: `speakers.scope must be one of ${SPEAKER_SCOPES.join(', ')}` };
    if (sp['listId'] !== undefined && (typeof sp['listId'] !== 'string' || sp['listId'].trim().length > MAX_LIST_ID_LENGTH)) {
      return { field: 'speakers', message: `speakers.listId must be a string of at most ${MAX_LIST_ID_LENGTH} characters` };
    }
    if (!eventNames) return { field: 'speakers', message: 'speakers.eventNames must be an array of strings' };
    speakers = { scope: sp['scope'] as AudienceSpeakerScope, eventNames, ...(sp['listId'] ? { listId: (sp['listId'] as string).trim() } : {}) };
  }

  return {
    criteria: {
      ...arrays,
      contactLocation: c['contactLocation'] === true,
      eventRegistered: c['eventRegistered'] === true,
      educationEnrolled: c['educationEnrolled'] === true,
      gateEventHistory: c['gateEventHistory'] === true,
      ambassadors: c['ambassadors'] === true,
      propertyFilters: filters,
      ...(typeof c['gateListId'] === 'string' && c['gateListId'].trim() ? { gateListId: c['gateListId'].trim() } : {}),
      ...(typeof c['label'] === 'string' && c['label'].trim() ? { label: c['label'].trim() } : {}),
      ...(typeof c['educationTopicProperty'] === 'string' && PROPERTY_NAME.test(c['educationTopicProperty'].trim())
        ? { educationTopicProperty: c['educationTopicProperty'].trim() }
        : {}),
      ...(speakers ? { speakers } : {}),
    },
  };
}

/** A `ServiceValidationError` carrying this controller's context. */
function invalid(req: Request, operation: string, field: string, message: string): ServiceValidationError {
  return ServiceValidationError.forField(field, message, {
    operation,
    service: 'audience_builder_controller',
    path: req.path,
  });
}

/**
 * The `currentRegistrantsEvent` body field: the trimmed edition name, '' when omitted or blank, or
 * null when provided but not a string or too long. A mistyped value is refused rather than
 * dropped: dropping it would send without the registrants suppression the operator ticked.
 */
function parseRegistrantsEvent(value: unknown): string | null {
  if (value === undefined) {
    return '';
  }
  if (typeof value !== 'string' || value.trim().length > AUDIENCE_REGISTRANTS_EVENT_MAX_LENGTH) {
    return null;
  }
  return value.trim();
}

/**
 * The `registrantsEvent` query param, or '' when it is over the limit: a truncated edition would
 * look up a list attach can never create (attach refuses the full name), so no row is better.
 */
function registrantsQuery(value: string): string {
  return value.length > AUDIENCE_REGISTRANTS_EVENT_MAX_LENGTH ? '' : value;
}

/** One trimmed query param, or `''` when absent or repeated. */
function queryString(req: Request, field: string): string {
  const raw = req.query[field];
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * A body field as a clean `string[]`, or `null` when it is not an array of strings.
 *
 * `null` and "empty after trimming" are distinct answers on purpose: the first is a malformed
 * request, the second a legitimately empty selection — and `previewCount` treats an empty
 * selection as an exact zero rather than an error.
 */
function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length > MAX_LIST_IDS) return null;
  if (value.some((entry) => typeof entry !== 'string' || entry.length > MAX_LIST_ID_LENGTH)) return null;
  return value.map((entry) => (entry as string).trim()).filter(Boolean);
}

/**
 * Like {@link stringArray} but REFUSES a blank entry instead of dropping it.
 *
 * For fields where an empty element changes what the request means rather than being noise:
 * upstream rejects a blank exclusion id (`ErrBlankExclusionID`) precisely so a master is never
 * composed without a suppression the caller asked for, and silently filtering it here would
 * make that guard unreachable.
 */
function strictStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  // Bounded in BOTH helpers, not just the reported caller: they carry the same list ids to the
  // same upstream create, so a cap on one leaves the other as the way in.
  if (value.length > MAX_LIST_IDS) return null;
  if (value.some((entry) => typeof entry !== 'string' || entry.length > MAX_LIST_ID_LENGTH)) return null;
  const trimmed = value.map((entry) => (entry as string).trim());
  return trimmed.some((entry) => entry === '') ? null : trimmed;
}

/**
 * Audience Builder endpoints, every one a proxy to lfx-v2-campaign-service.
 *
 * Separate from `CampaignController` rather than added to it: that class is 1700 lines of
 * paid-ad and brief plumbing, and this feature shares no state with it. It deliberately does NOT
 * touch `listAudiences` — that reads the SEND audience rows by brief id, which is a
 * different record from the HubSpot lists this flow explores and composes. The two are
 * cross-linked in the UI, never wired together.
 *
 * Every route is project-scoped, and the project arrives as `?project=<slug>` on all nine —
 * upstream stores HubSpot credentials as per-project encrypted connections, so a request without
 * a project cannot resolve a portal at all. `requireCampaignManager` on the router also scopes
 * authorization on that slug.
 *
 * Authorization is that router middleware, which covers every route here. There is no separate
 * feature gate: `/capabilities` reports whether upstream resolves a usable HubSpot connection for
 * the project, and the client renders the tab in its degraded form when it does not.
 */
export class AudienceBuilderController {
  private readonly activeStreams = new Set<Response>();
  private readonly audienceBuilder: AudienceBuilderProxyService;

  public constructor(audienceBuilder?: AudienceBuilderProxyService) {
    this.audienceBuilder = audienceBuilder ?? new AudienceBuilderProxyService();
    addShutdownHook(() => this.closeAllStreams());
  }

  public async getCapabilities(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_capabilities', 'project', 'project is required'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_capabilities', {});

    try {
      const capabilities = await this.audienceBuilder.getCapabilities(req, projectSlug);

      logger.success(req, 'audience_capabilities', startTime, { hubspotConfigured: capabilities.hubspotConfigured });
      res.json(capabilities);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Streams discovery: the event identity first, then the classified buckets.
   *
   * Upstream's discovery is ONE synchronous request — Goa's HTTP transport has no SSE encoding —
   * so the stream is this handler's own shim: a progress line, then the identity and the buckets
   * unpacked from the single response. The frames are unchanged from when discovery ran locally,
   * so the client is unaffected by where the work happens.
   *
   * Validation runs BEFORE `flushHeaders()` deliberately — `apiErrorHandler` abdicates once
   * `res.headersSent`, so a bad URL rejected after the flush would hang the client instead of
   * failing it. Upstream re-validates the URL through its own SSRF guard; that duplication is
   * also deliberate, since neither side may depend on the other having checked.
   */
  public async discover(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_discover', 'project', 'project is required'));
      return;
    }

    const body = (req.body ?? {}) as AudienceDiscoverRequest;
    const eventUrl = typeof body.eventUrl === 'string' ? body.eventUrl.trim() : '';

    if (!eventUrl) {
      next(invalid(req, 'audience_discover', 'eventUrl', 'eventUrl is required'));
      return;
    }

    try {
      await validateScrapeUrl(eventUrl);
    } catch (error) {
      next(invalid(req, 'audience_discover', 'eventUrl', error instanceof Error ? error.message : 'Invalid URL'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_discover', {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    let clientDisconnected = false;

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
    });

    const sendEvent = (type: AudienceDiscoverySSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      sendEvent('progress', { message: 'Reading the event page and searching the portal…' });

      const { event, result, inspected } = await this.audienceBuilder.discover(req, projectSlug, eventUrl);
      if (clientDisconnected) return;

      // The identity frame goes out FIRST and separately even though it arrived in the same body:
      // the client labels the panel and fetches suppression lists off it, and folding it into
      // `discovered` would make those wait on a classification they do not need.
      if (event) {
        sendEvent('event', event);
      }
      sendEvent('progress', { message: `Classified ${result.lists.length} of ${inspected} inspected lists.`, inspected });
      sendEvent('discovered', result);
      sendEvent('done', { lists: result.lists.length });
      logger.success(req, 'audience_discover', startTime, { lists: result.lists.length, missing: result.missingSignals.length });
    } catch (error) {
      if (clientDisconnected) return;
      // Logged here rather than left to `apiErrorHandler`: this handler owns its own response, so
      // the middleware is never reached.
      logger.error(req, 'audience_discover', startTime, error, {});
      sendEvent('error', 'Audience discovery failed. Please try again.');
    } finally {
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  public async searchLists(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_list_search', 'project', 'project is required'));
      return;
    }

    const query = queryString(req, 'q');

    if (!query) {
      next(invalid(req, 'audience_list_search', 'q', 'q is required'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_list_search', {});

    try {
      const results = await this.audienceBuilder.searchLists(req, projectSlug, query);

      logger.success(req, 'audience_list_search', startTime, { count: results.length });
      res.json(results);
    } catch (error) {
      next(error);
    }
  }

  public async getSuppressionLists(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_suppression_lists', 'project', 'project is required'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_suppression_lists', {});

    try {
      // Every param is optional: the portfolio-wide hygiene lists are found by fixed name, and
      // the brand, event and current-registrants tiers only add to them. An empty answer is a
      // real answer.
      const result = await this.audienceBuilder.getSuppressionLists(
        req,
        projectSlug,
        queryString(req, 'brandShort'),
        queryString(req, 'eventName'),
        registrantsQuery(queryString(req, 'registrantsEvent'))
      );

      logger.success(req, 'audience_suppression_lists', startTime, { count: result.lists.length, standard_list: result.standardList !== undefined });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getLastSent(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_last_sent', 'project', 'project is required'));
      return;
    }

    const eventName = queryString(req, 'eventName');

    if (!eventName) {
      next(invalid(req, 'audience_last_sent', 'eventName', 'eventName is required'));
      return;
    }

    // Clamped here as well as upstream: upstream's `Maximum(10)` REJECTS an over-limit value,
    // and a picker asking for one more row than the contract allows should get ten rows, not a
    // 400 the operator cannot act on.
    const requested = Number(queryString(req, 'limit'));
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(Math.floor(requested), LAST_SENT_MAX_LIMIT) : LAST_SENT_DEFAULT_LIMIT;

    const startTime = logger.startOperation(req, 'audience_last_sent', { limit });

    try {
      const emails = await this.audienceBuilder.getLastSent(req, projectSlug, eventName, queryString(req, 'brandShort'), limit);

      logger.success(req, 'audience_last_sent', startTime, { count: emails.length });
      res.json(emails);
    } catch (error) {
      next(error);
    }
  }

  public async getExistingMasterLists(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_existing_master_lists', 'project', 'project is required'));
      return;
    }

    const eventName = queryString(req, 'eventName');

    if (!eventName) {
      next(invalid(req, 'audience_existing_master_lists', 'eventName', 'eventName is required'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_existing_master_lists', {});

    try {
      const lists = await this.audienceBuilder.getExistingMasterLists(req, projectSlug, queryString(req, 'brandShort'), eventName);

      logger.success(req, 'audience_existing_master_lists', startTime, { count: lists.length });
      res.json(lists);
    } catch (error) {
      next(error);
    }
  }

  public async previewCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_preview_count', 'project', 'project is required'));
      return;
    }

    const body = (req.body ?? {}) as AudiencePreviewCountRequest;
    const listIds = stringArray(body.listIds);

    if (!listIds) {
      next(invalid(req, 'audience_preview_count', 'listIds', 'listIds must be an array of strings'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_preview_count', { lists: listIds.length });

    // An empty selection is answered here rather than upstream: `list_ids` has `MinLength(1)`, so
    // sending none is a 400 — and "no lists selected" is an exact zero, not a malformed request.
    if (!listIds.length) {
      const count = { exact: true, estimate: 0, count: 0, reason: '' };
      logger.success(req, 'audience_preview_count', startTime, count);
      res.json(count);
      return;
    }

    try {
      const count = await this.audienceBuilder.previewCount(req, projectSlug, listIds);

      logger.success(req, 'audience_preview_count', startTime, { exact: count.exact, count: count.count });
      res.json(count);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Creates the Combined Suppression list and then the master list, upstream, in that order.
   *
   * A failure after the suppression list exists is answered with a 502 carrying that list, not a
   * bare error: compose is not idempotent, so an operator who only hears "failed" and clicks
   * again leaves a second suppression list behind. Upstream reports this as its own typed
   * `ComposePartial` 500 for the same reason. Owning the response here is also why this catch
   * logs — `apiErrorHandler` never sees it.
   */
  public async composeMaster(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_compose_master', 'project', 'project is required'));
      return;
    }

    const body = (req.body ?? {}) as AudienceComposeMasterRequest;
    const listIds = stringArray(body.listIds);

    if (!listIds || !listIds.length) {
      next(invalid(req, 'audience_compose_master', 'listIds', 'listIds must be a non-empty array of strings'));
      return;
    }

    // NOT stringArray: its `.filter(Boolean)` drops a blank, which is exactly what upstream
    // refuses. campaign-service rejects a blank exclusion with ErrBlankExclusionID rather than
    // normalising it away, because composing a master with NO suppression when one was asked
    // for is worse than a 400 on a non-idempotent create. Stripping it here made that guard
    // unreachable through the UI and turned the same request into a silent 201.
    // Defaulted only when OMITTED. `?? []` also replaced an explicit `null` before the validator saw
    // it, so a malformed body was read as "exclude nobody" -- the less-suppressed send this
    // validation exists to refuse.
    const excludeListIds = strictStringArray(body.excludeListIds === undefined ? [] : body.excludeListIds);

    // A PROVIDED optional field that is mistyped is a client bug, not an absent field. Dropping
    // it silently changed what the request means on a non-idempotent create — `{ name: {} }`
    // proceeded under an auto-derived name and created a real HubSpot list nobody asked for.
    // `briefId` belongs in this guard more than any other field here. Dropping a mistyped one
    // silently would compose two real HubSpot lists and leave them ATTACHED TO NOTHING, while the
    // operator watches a success banner — and compose is not idempotent, so the correction costs
    // a second master list.
    const mistyped = (['name', 'brandShort', 'eventName', 'briefId', 'currentRegistrantsEvent'] as const).find(
      (field) => body[field] !== undefined && typeof body[field] !== 'string'
    );
    if (mistyped) {
      next(invalid(req, 'audience_compose_master', mistyped, `${mistyped} must be a string when provided`));
      return;
    }
    const composeRegistrants = parseRegistrantsEvent(body.currentRegistrantsEvent);
    if (composeRegistrants === null) {
      next(invalid(req, 'audience_compose_master', 'currentRegistrantsEvent', AUDIENCE_REGISTRANTS_EVENT_MESSAGE));
      return;
    }

    const eventDates = body.eventDates === undefined ? undefined : stringArray(body.eventDates);
    if (body.eventDates !== undefined && !eventDates) {
      next(invalid(req, 'audience_compose_master', 'eventDates', 'eventDates must be an array of strings'));
      return;
    }

    if (!excludeListIds) {
      next(
        invalid(
          req,
          'audience_compose_master',
          'excludeListIds',
          `excludeListIds must be an array of at most ${MAX_LIST_IDS} non-blank strings of at most ${MAX_LIST_ID_LENGTH} characters`
        )
      );
      return;
    }
    // Every send keeps at least one suppression list: the compliance gate the Audience tab shows is
    // enforced HERE, at the server boundary, so a direct API call cannot compose an unsuppressed master.
    if (excludeListIds.length === 0) {
      next(invalid(req, 'audience_compose_master', 'excludeListIds', MISSING_SUPPRESSION_MESSAGE));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_compose_master', { lists: listIds.length, excluded: excludeListIds.length });

    try {
      // Reconstruct the payload from validated fields rather than spreading `body`. The proxy
      // picks named fields, so an EXTRA property never reached the wire — but a MISTYPED one
      // did: `name: {}` is truthy, so it passed the proxy's `request.name ?` guard and was
      // forwarded upstream as an object where a string was declared. Spreading also let the
      // request's type claim these were validated when only listIds/excludeListIds were.
      const result = await this.audienceBuilder.composeMaster(req, projectSlug, {
        listIds,
        excludeListIds,
        ...(typeof body.name === 'string' ? { name: body.name } : {}),
        ...(typeof body.brandShort === 'string' ? { brandShort: body.brandShort } : {}),
        ...(typeof body.eventName === 'string' ? { eventName: body.eventName } : {}),
        ...(eventDates ? { eventDates } : {}),
        ...(composeRegistrants ? { currentRegistrantsEvent: composeRegistrants } : {}),
        // Forwarded only when NON-EMPTY. A blank string passes the string check above and would
        // be sent as an attach request naming no brief, which upstream answers with a 404 after
        // refusing to create anything — a worse outcome than the exploratory compose the caller
        // plainly meant.
        ...(typeof body.briefId === 'string' && body.briefId !== '' ? { briefId: body.briefId } : {}),
      });

      logger.success(req, 'audience_compose_master', startTime, { masterListId: result.master.listId, recorded: result.recorded });
      // 201, matching the upstream contract and the repo's other create controllers: this
      // creates real HubSpot lists, and a 200 describes it as an ordinary read.
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof AudienceComposePartialError) {
        logger.error(req, 'audience_compose_master', startTime, error, {
          suppressionListId: error.suppression?.listId,
          suppressionName: error.suppressionName,
          masterName: error.masterName,
          masterListId: error.master?.listId,
        });
        const partial: AudienceComposeMasterPartial = {
          suppression: error.suppression,
          suppressionName: error.suppressionName,
          masterName: error.masterName,
          master: error.master,
          error: error.message,
        };
        res.status(502).json(partial);
        return;
      }
      next(error);
    }
  }

  /**
   * Records lists that already exist — typically an earlier send's include list and its
   * suppressions — as the brief's send audience, so no new master list has to be composed.
   */
  public async attachExisting(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_attach_existing', 'project', 'project is required'));
      return;
    }

    const body = (req.body ?? {}) as AudienceAttachExistingRequest;
    const briefId = typeof body.briefId === 'string' ? body.briefId.trim() : '';
    const masterListId = typeof body.masterListId === 'string' ? body.masterListId.trim() : '';

    if (!briefId) {
      next(invalid(req, 'audience_attach_existing', 'briefId', 'briefId is required'));
      return;
    }

    // Several existing include lists, sent directly with no master list composed. Strict for the
    // same reason as the suppressions below: a blank id silently dropped would send to fewer
    // lists than the operator chose.
    const includeListIds = body.includeListIds === undefined ? undefined : strictStringArray(body.includeListIds);
    if (body.includeListIds !== undefined && (!includeListIds || !includeListIds.length)) {
      next(
        invalid(
          req,
          'audience_attach_existing',
          'includeListIds',
          `includeListIds must be a non-empty array of at most ${MAX_LIST_IDS} non-blank strings of at most ${MAX_LIST_ID_LENGTH} characters`
        )
      );
      return;
    }
    if (includeListIds && masterListId) {
      next(invalid(req, 'audience_attach_existing', 'includeListIds', 'send either masterListId or includeListIds, not both'));
      return;
    }
    if (!includeListIds && !masterListId) {
      next(invalid(req, 'audience_attach_existing', 'masterListId', 'masterListId or includeListIds is required'));
      return;
    }
    if (masterListId.length > MAX_LIST_ID_LENGTH) {
      next(invalid(req, 'audience_attach_existing', 'masterListId', `masterListId must be at most ${MAX_LIST_ID_LENGTH} characters`));
      return;
    }

    // Strict for the same reason compose is: a blank suppression id silently dropped would send
    // to a list with LESS suppression than the operator chose.
    // Defaulted only when OMITTED, for the reason given at compose: `?? []` read `null` as none.
    const suppressionListIds = strictStringArray(body.suppressionListIds === undefined ? [] : body.suppressionListIds);
    if (!suppressionListIds) {
      next(
        invalid(
          req,
          'audience_attach_existing',
          'suppressionListIds',
          `suppressionListIds must be an array of at most ${MAX_LIST_IDS} non-blank strings of at most ${MAX_LIST_ID_LENGTH} characters`
        )
      );
      return;
    }
    // Same server-side gate as compose: an attach records a send, so it must carry a suppression list.
    if (suppressionListIds.length === 0) {
      next(invalid(req, 'audience_attach_existing', 'suppressionListIds', MISSING_SUPPRESSION_MESSAGE));
      return;
    }
    if (body.inclusionSummary !== undefined && typeof body.inclusionSummary !== 'string') {
      next(invalid(req, 'audience_attach_existing', 'inclusionSummary', 'inclusionSummary must be a string when provided'));
      return;
    }
    if (typeof body.inclusionSummary === 'string' && body.inclusionSummary.length > MAX_INCLUSION_SUMMARY_LENGTH) {
      next(invalid(req, 'audience_attach_existing', 'inclusionSummary', `inclusionSummary must be at most ${MAX_INCLUSION_SUMMARY_LENGTH} characters`));
      return;
    }

    const attachRegistrants = parseRegistrantsEvent(body.currentRegistrantsEvent);
    if (attachRegistrants === null) {
      next(invalid(req, 'audience_attach_existing', 'currentRegistrantsEvent', AUDIENCE_REGISTRANTS_EVENT_MESSAGE));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_attach_existing', {
      includes: includeListIds ? includeListIds.length : 1,
      suppressions: suppressionListIds.length,
    });

    try {
      const result = await this.audienceBuilder.attachExisting(req, projectSlug, {
        briefId,
        ...(includeListIds ? { includeListIds } : { masterListId }),
        suppressionListIds,
        ...(attachRegistrants ? { currentRegistrantsEvent: attachRegistrants } : {}),
        ...(body.inclusionSummary ? { inclusionSummary: body.inclusionSummary } : {}),
      });
      logger.success(req, 'audience_attach_existing', startTime, { masterListId: result.master.listId });
      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  public async runQa(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);

    if (!projectSlug) {
      next(invalid(req, 'audience_qa_run', 'project', 'project is required'));
      return;
    }

    const body = (req.body ?? {}) as AudienceQaRunRequest;
    const listRef = typeof body.listRef === 'string' ? body.listRef.trim() : '';

    if (!listRef) {
      next(invalid(req, 'audience_qa_run', 'listRef', 'listRef is required'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_qa_run', {});

    try {
      const eventName = typeof body.eventName === 'string' ? body.eventName.trim() : '';
      const sendSuppression = body.sendSuppressionListIds === undefined ? [] : stringArray(body.sendSuppressionListIds);
      if (!sendSuppression) {
        next(invalid(req, 'audience_qa_run', 'sendSuppressionListIds', `sendSuppressionListIds must be an array of at most ${MAX_LIST_IDS} list ids`));
        return;
      }
      const result = await this.audienceBuilder.runQa(req, projectSlug, {
        listRef,
        targetsEu: body.targetsEu === true,
        targetsCa: body.targetsCa === true,
        ...(eventName ? { eventName } : {}),
        ...(sendSuppression.length ? { sendSuppressionListIds: sendSuppression } : {}),
      });

      logger.success(req, 'audience_qa_run', startTime, { needsDisambiguation: result.needsDisambiguation });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Free text → draft criteria. Uses a model upstream; creates nothing. */
  public async interpretCustom(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectSlug = this.projectSlug(req);
    if (!projectSlug) {
      next(invalid(req, 'audience_custom_interpret', 'project', 'project is required'));
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const request = typeof body['request'] === 'string' ? body['request'].trim() : '';
    if (!request || request.length > CUSTOM_REQUEST_MAX_LENGTH) {
      next(invalid(req, 'audience_custom_interpret', 'request', `request is required and at most ${CUSTOM_REQUEST_MAX_LENGTH} characters`));
      return;
    }
    const rawAnswers = body['answers'] === undefined ? [] : body['answers'];
    if (!Array.isArray(rawAnswers) || rawAnswers.length > CUSTOM_MAX_ANSWERS) {
      next(invalid(req, 'audience_custom_interpret', 'answers', `answers must be an array of at most ${CUSTOM_MAX_ANSWERS}`));
      return;
    }
    const answers: AudienceCustomAnswer[] = [];
    for (const entry of rawAnswers as unknown[]) {
      const a = (entry ?? {}) as Record<string, unknown>;
      const answer = typeof a['answer'] === 'string' ? a['answer'].trim() : '';
      if (!answer || answer.length > CUSTOM_ANSWER_MAX_LENGTH) {
        next(invalid(req, 'audience_custom_interpret', 'answers', `each answer must be a non-blank string of at most ${CUSTOM_ANSWER_MAX_LENGTH} characters`));
        return;
      }
      // Refused, not cut: a cut question id no longer matches the question upstream asked.
      if (a['questionId'] !== undefined && (typeof a['questionId'] !== 'string' || a['questionId'].length > CUSTOM_QUESTION_ID_MAX_LENGTH)) {
        next(invalid(req, 'audience_custom_interpret', 'answers', `each questionId must be a string of at most ${CUSTOM_QUESTION_ID_MAX_LENGTH} characters`));
        return;
      }
      if (a['question'] !== undefined && (typeof a['question'] !== 'string' || a['question'].length > CUSTOM_ANSWER_MAX_LENGTH)) {
        next(invalid(req, 'audience_custom_interpret', 'answers', `each question must be a string of at most ${CUSTOM_ANSWER_MAX_LENGTH} characters`));
        return;
      }
      answers.push({
        answer,
        ...(typeof a['questionId'] === 'string' ? { questionId: a['questionId'] } : {}),
        ...(typeof a['question'] === 'string' ? { question: a['question'] } : {}),
      });
    }

    // Same SSRF pre-check discover applies: upstream fetches this page server-side.
    const eventUrl = typeof body['eventUrl'] === 'string' ? body['eventUrl'].trim() : '';
    if (eventUrl) {
      try {
        await validateScrapeUrl(eventUrl);
      } catch (error) {
        next(invalid(req, 'audience_custom_interpret', 'eventUrl', error instanceof Error ? error.message : 'Invalid URL'));
        return;
      }
    }

    const startTime = logger.startOperation(req, 'audience_custom_interpret', { answers: answers.length, event: eventUrl !== '' });
    try {
      const result = await this.audienceBuilder.interpretCustom(req, projectSlug, { request, answers, ...(eventUrl ? { eventUrl } : {}) });
      logger.success(req, 'audience_custom_interpret', startTime, { questions: result.questions.length, gateFound: !!result.gate });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Validates criteria against the portal and returns what create would build. Creates nothing. */
  public async previewCustom(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = this.customRequest(req, 'audience_custom_preview', next);
    if (!parsed) return;
    const startTime = logger.startOperation(req, 'audience_custom_preview', {});
    try {
      const result = await this.audienceBuilder.previewCustom(req, parsed.projectSlug, parsed.request);
      logger.success(req, 'audience_custom_preview', startTime, { branches: result.branchCount });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** Creates ONE custom list in HubSpot. Not idempotent; an unconfirmed create is a 502 partial. */
  public async createCustom(req: Request, res: Response, next: NextFunction): Promise<void> {
    const parsed = this.customRequest(req, 'audience_custom_create', next);
    if (!parsed) return;
    const startTime = logger.startOperation(req, 'audience_custom_create', {});
    try {
      const result = await this.audienceBuilder.createCustom(req, parsed.projectSlug, parsed.request);
      logger.success(req, 'audience_custom_create', startTime, { listId: result.listId });
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof AudienceComposePartialError) {
        logger.error(req, 'audience_custom_create', startTime, error, { masterName: error.masterName });
        const partial: AudienceComposeMasterPartial = { masterName: error.masterName, error: error.message };
        res.status(502).json(partial);
        return;
      }
      next(error);
    }
  }

  /** The shared preview/create payload check; calls `next` and returns null when invalid. */
  private customRequest(
    req: Request,
    operation: string,
    next: NextFunction
  ): { projectSlug: string; request: { criteria: AudienceCustomCriteria; name?: string } } | null {
    const projectSlug = this.projectSlug(req);
    if (!projectSlug) {
      next(invalid(req, operation, 'project', 'project is required'));
      return null;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (body['name'] !== undefined && (typeof body['name'] !== 'string' || body['name'].length > AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH)) {
      next(invalid(req, operation, 'name', `name must be a string of at most ${AUDIENCE_CUSTOM_LIST_NAME_MAX_LENGTH} characters`));
      return null;
    }
    const parsed = parseCustomCriteria(body['criteria']);
    if ('field' in parsed) {
      next(invalid(req, operation, parsed.field, parsed.message));
      return null;
    }
    const name = typeof body['name'] === 'string' ? body['name'].trim() : '';
    return { projectSlug, request: { criteria: parsed.criteria, ...(name ? { name } : {}) } };
  }

  /** The project slug every route is scoped to, trimmed; `''` when absent or repeated. */
  private projectSlug(req: Request): string {
    return typeof req.query['project'] === 'string' ? req.query['project'].trim() : '';
  }

  /**
   * Ends every open discovery stream during shutdown.
   *
   * Mirrors `CampaignController.closeAllStreams` — a `shutdown` event so the client can say why
   * the stream stopped, then a bounded wait before the socket is destroyed, because a stalled
   * write must not hold the process open.
   */
  private async closeAllStreams(): Promise<void> {
    const streams = [...this.activeStreams];
    this.activeStreams.clear();
    const STREAM_CLOSE_TIMEOUT_MS = 2_000;

    await Promise.all(
      streams.map(
        (res) =>
          new Promise<void>((resolve) => {
            let done = false;
            const finish = (): void => {
              if (!done) {
                done = true;
                resolve();
              }
            };
            const timer = setTimeout(() => {
              logger.debug(undefined, 'audience_sse_shutdown_timeout', 'SSE stream close timed out; force-closing', {});
              try {
                if (!res.writableEnded) res.end();
              } catch {
                /* already ended */
              }
              res.socket?.destroy();
              finish();
            }, STREAM_CLOSE_TIMEOUT_MS);

            try {
              if (!res.writableEnded) {
                // The timer must outlive the WRITE and be cleared by `end`'s callback: clearing it
                // here left the shutdown unbounded if the socket stalled during `end`. `finish` is
                // idempotent, so whichever of the two fires first wins safely.
                res.write('event: shutdown\ndata: {"reason":"server_shutdown"}\n\n', () => {
                  res.end(() => {
                    clearTimeout(timer);
                    finish();
                  });
                });
              } else {
                clearTimeout(timer);
                finish();
              }
            } catch (error) {
              clearTimeout(timer);
              const isExpected = error instanceof Error && (error.message.includes('write after end') || error.message.includes('Cannot call end'));
              if (isExpected) {
                logger.debug(undefined, 'audience_sse_shutdown_close', 'Stream already closed during shutdown', { err: error });
              } else {
                logger.warning(undefined, 'audience_sse_shutdown_close', 'Unexpected error closing SSE stream', { err: error });
              }
              finish();
            }
          })
      )
    );
  }
}
