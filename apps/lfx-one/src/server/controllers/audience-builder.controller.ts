// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import type {
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

/** Default number of past sends returned when the caller does not ask for a specific count. */
const LAST_SENT_DEFAULT_LIMIT = 3;

/** A `ServiceValidationError` carrying this controller's context. */
function invalid(req: Request, operation: string, field: string, message: string): ServiceValidationError {
  return ServiceValidationError.forField(field, message, {
    operation,
    service: 'audience_builder_controller',
    path: req.path,
  });
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
  if (value.some((entry) => typeof entry !== 'string')) return null;
  return value.map((entry) => (entry as string).trim()).filter(Boolean);
}

/**
 * Audience Builder endpoints, every one a proxy to lfx-v2-campaign-service.
 *
 * Separate from `CampaignController` rather than added to it: that class is 1700 lines of
 * paid-ad and brief plumbing, and this feature shares no state with it. It deliberately does NOT
 * touch `buildAudience` / `getAudience` — those resolve the SEND audience by brief id, which is a
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
      // Both params are optional: the portfolio-wide hygiene lists are found by fixed name, and
      // the brand and event tiers only add to them. An empty answer is a real answer.
      const lists = await this.audienceBuilder.getSuppressionLists(req, projectSlug, queryString(req, 'brandShort'), queryString(req, 'eventName'));

      logger.success(req, 'audience_suppression_lists', startTime, { count: lists.length });
      res.json(lists);
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

    const excludeListIds = stringArray(body.excludeListIds ?? []);

    if (!excludeListIds) {
      next(invalid(req, 'audience_compose_master', 'excludeListIds', 'excludeListIds must be an array of strings'));
      return;
    }

    const startTime = logger.startOperation(req, 'audience_compose_master', { lists: listIds.length, excluded: excludeListIds.length });

    try {
      const result = await this.audienceBuilder.composeMaster(req, projectSlug, { ...body, listIds, excludeListIds });

      logger.success(req, 'audience_compose_master', startTime, { masterListId: result.master.listId });
      res.json(result);
    } catch (error) {
      if (error instanceof AudienceComposePartialError) {
        logger.error(req, 'audience_compose_master', startTime, error, { suppressionListId: error.suppression?.listId });
        const partial: AudienceComposeMasterPartial = { suppression: error.suppression, error: error.message };
        res.status(502).json(partial);
        return;
      }
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
      const result = await this.audienceBuilder.runQa(req, projectSlug, { listRef, targetsEu: body.targetsEu === true, targetsCa: body.targetsCa === true });

      logger.success(req, 'audience_qa_run', startTime, { needsDisambiguation: result.needsDisambiguation });
      res.json(result);
    } catch (error) {
      next(error);
    }
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
                res.write('event: shutdown\ndata: {"reason":"server_shutdown"}\n\n', () => {
                  clearTimeout(timer);
                  res.end(finish);
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
