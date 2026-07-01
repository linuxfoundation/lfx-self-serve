// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import type {
  BulkKeywordActionRequest,
  CampaignBriefRefineRequest,
  CampaignBriefRequest,
  CampaignPlatform,
  CampaignSSEEventType,
  CampaignStatusUpdateRequest,
  CampaignToggleStatus,
  FlushableResponse,
} from '@lfx-one/shared/interfaces';
import { VALID_CAMPAIGN_TOGGLE_STATUSES } from '@lfx-one/shared/constants';

import { META_ACCOUNTS, REDDIT_ACCOUNTS } from '../constants';
import { ServiceValidationError } from '../errors';
import { CampaignMetricsService, LinkedInMetricsService, MetaMetricsService, RedditMetricsService } from '../services/campaign-metrics.service';
import { validateScrapeUrl } from '../helpers/url-validation';
import { getLinkedInConfig } from '../services/linkedin-ads.service';
import { CampaignProxyService } from '../services/campaign-proxy.service';
import { logger } from '../services/logger.service';
import { addShutdownHook, isShuttingDown } from '../utils/shutdown';

/** Platforms that support the campaign status toggle endpoint. */
const SUPPORTED_STATUS_PLATFORMS: ReadonlySet<CampaignPlatform> = new Set<CampaignPlatform>(['meta-ads', 'reddit-ads']);

const NUMERIC_ID_RE = /^\d+$/;

export class CampaignController {
  private readonly proxyService = new CampaignProxyService();
  private readonly metricsService = new CampaignMetricsService();
  private readonly linkedInMetricsService = new LinkedInMetricsService();
  private readonly redditMetricsService = new RedditMetricsService();
  private readonly metaMetricsService = new MetaMetricsService();
  private readonly activeStreams = new Set<Response>();

  public constructor() {
    addShutdownHook(() => this.closeAllStreams());
  }

  public async generateBrief(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    const body = req.body as CampaignBriefRequest;

    if (!body.url || typeof body.url !== 'string' || !body.url.trim()) {
      const validationError = ServiceValidationError.forField('url', 'url is required', {
        operation: 'campaign_generate_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    try {
      await validateScrapeUrl(body.url);
    } catch (error) {
      const validationError = ServiceValidationError.forField('url', error instanceof Error ? error.message : 'Invalid URL', {
        operation: 'campaign_generate_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_generate_brief', {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const abortController = new AbortController();
    let clientDisconnected = false;

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
      abortController.abort();
    });

    const sendEvent = (type: CampaignSSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      for await (const event of this.proxyService.streamBrief(req, body, abortController.signal)) {
        if (clientDisconnected) return;
        sendEvent(event.type, event.data);
      }

      logger.success(req, 'campaign_generate_brief', startTime, {});
    } catch (error) {
      if (clientDisconnected) return;
      logger.error(req, 'campaign_generate_brief', startTime, error, {});
      sendEvent('error', 'Brief generation failed. Please try again.');
    } finally {
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  public async refineBrief(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (isShuttingDown()) {
      res.status(503).json({ status: 'shutting_down' });
      return;
    }

    const body = req.body as CampaignBriefRefineRequest;

    if (!body.feedback || typeof body.feedback !== 'string' || !body.feedback.trim()) {
      const validationError = ServiceValidationError.forField('feedback', 'feedback is required', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const MAX_FEEDBACK_LENGTH = 2000;
    if (body.feedback.trim().length > MAX_FEEDBACK_LENGTH) {
      _next(
        ServiceValidationError.forField('feedback', `feedback must be ${MAX_FEEDBACK_LENGTH} characters or fewer`, {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!body.currentCopy || typeof body.currentCopy !== 'object' || Array.isArray(body.currentCopy)) {
      const validationError = ServiceValidationError.forField('currentCopy', 'currentCopy is required', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const MAX_COPY_JSON_LENGTH = 50_000;
    if (JSON.stringify(body.currentCopy).length > MAX_COPY_JSON_LENGTH) {
      _next(
        ServiceValidationError.forField('currentCopy', 'currentCopy payload too large', {
          operation: 'campaign_refine_brief',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!body.currentKeywords || !Array.isArray(body.currentKeywords) || body.currentKeywords.length === 0) {
      const validationError = ServiceValidationError.forField('currentKeywords', 'currentKeywords must be a non-empty array', {
        operation: 'campaign_refine_brief',
        service: 'campaign_controller',
        path: req.path,
      });
      _next(validationError);
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_refine_brief', {});

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Content-Encoding', 'identity');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.socket?.setNoDelay(true);

    const abortController = new AbortController();
    let clientDisconnected = false;

    this.activeStreams.add(res);
    res.on('close', () => {
      clientDisconnected = true;
      this.activeStreams.delete(res);
      abortController.abort();
    });

    const sendEvent = (type: CampaignSSEEventType, data: unknown): void => {
      if (clientDisconnected || isShuttingDown()) return;
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as FlushableResponse).flush?.();
    };

    try {
      let hadError = false;
      for await (const event of this.proxyService.streamRefinedBrief(req, body, abortController.signal)) {
        if (clientDisconnected) return;
        if (event.type === 'error') hadError = true;
        sendEvent(event.type, event.data);
      }

      if (hadError) {
        logger.warning(req, 'campaign_refine_brief', 'Refine stream completed with error event', {});
      } else {
        logger.success(req, 'campaign_refine_brief', startTime, {});
      }
    } catch (error) {
      if (clientDisconnected) return;
      logger.error(req, 'campaign_refine_brief', startTime, error, {});
      sendEvent('error', 'Brief refinement failed. Please try again.');
    } finally {
      this.activeStreams.delete(res);
      if (!clientDisconnected) {
        res.end();
      }
    }
  }

  public async createCampaign(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'campaign_create', {});

    try {
      const result = await this.proxyService.createCampaign(req, req.body);
      logger.success(req, 'campaign_create', startTime, { jobId: result.jobId });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async getJobStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const jobId = req.params['jobId'];

    if (!jobId) {
      next(ServiceValidationError.forField('jobId', 'jobId is required', { operation: 'campaign_job_status', service: 'campaign_controller' }));
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_job_status', { jobId });

    try {
      const status = await this.proxyService.getJobStatus(req, jobId);
      logger.success(req, 'campaign_job_status', startTime, { jobId, status: status.status });
      res.json(status);
    } catch (error) {
      next(error);
    }
  }

  public async getMonitorData(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_monitor', { days });

    try {
      const data = await this.metricsService.getMonitorData(req, days);
      logger.success(req, 'campaign_monitor', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  public async getKeywords(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_keywords', { days });

    try {
      const data = await this.metricsService.getKeywords(req, days);
      logger.success(req, 'campaign_keywords', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  public async lookupHubSpotUtm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawEventName = req.query['event_name'];
    const eventName = typeof rawEventName === 'string' ? rawEventName : undefined;
    if (!eventName) {
      next(ServiceValidationError.forField('event_name', 'event_name is required', { operation: 'hubspot_utm_lookup', service: 'campaign_controller' }));
      return;
    }

    const startTime = logger.startOperation(req, 'hubspot_utm_lookup', { eventName });

    try {
      const result = await this.proxyService.lookupHubSpotUtm(req, eventName);
      logger.success(req, 'hubspot_utm_lookup', startTime, { found: result.found });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async createHubSpotUtm(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawEventName = req.query['event_name'];
    const eventName = typeof rawEventName === 'string' ? rawEventName : undefined;
    if (!eventName) {
      next(ServiceValidationError.forField('event_name', 'event_name is required', { operation: 'hubspot_utm_create', service: 'campaign_controller' }));
      return;
    }

    const startTime = logger.startOperation(req, 'hubspot_utm_create', { eventName });

    try {
      const result = await this.proxyService.createHubSpotUtm(req, eventName);
      logger.success(req, 'hubspot_utm_create', startTime, { created: result.created });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public getLinkedInAccounts(_req: Request, res: Response): void {
    const config = getLinkedInConfig();
    // Return default account first so clients defaulting to accounts[0] honour the configured default.
    const sorted = [
      ...config.accounts.filter((a) => a.accountId === config.defaultAccountId),
      ...config.accounts.filter((a) => a.accountId !== config.defaultAccountId),
    ];
    res.json(sorted);
  }

  public async getLinkedInMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const config = getLinkedInConfig();
    const account = config.accounts.find((a) => a.accountId === rawKey) ?? config.accounts[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid LinkedIn account key', {
          operation: 'linkedin_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'linkedin_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.linkedInMetricsService.getLinkedInMonitorData(req, accountId, days);
      logger.success(req, 'linkedin_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'linkedin_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public async getAudience(req: Request, res: Response, next: NextFunction): Promise<void> {
    const days = Number(req.query['days']) || 14;
    const startTime = logger.startOperation(req, 'campaign_audience', { days });

    try {
      const data = await this.metricsService.getAudience(req, days);
      logger.success(req, 'campaign_audience', startTime, {});
      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  public async executeKeywordActions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const body = req.body as BulkKeywordActionRequest;

    if (!body.keywords || !Array.isArray(body.keywords) || body.keywords.length === 0) {
      next(ServiceValidationError.forField('keywords', 'keywords array is required', { operation: 'keyword_actions', service: 'campaign_controller' }));
      return;
    }

    if (!body.action || !['pause', 'remove'].includes(body.action)) {
      next(ServiceValidationError.forField('action', 'action must be "pause" or "remove"', { operation: 'keyword_actions', service: 'campaign_controller' }));
      return;
    }

    for (const kw of body.keywords) {
      if (!kw || typeof kw !== 'object' || !kw.campaignId || !kw.adGroupId || !kw.criterionId) {
        next(
          ServiceValidationError.forField('keywords', 'each keyword must include campaignId, adGroupId, and criterionId', {
            operation: 'keyword_actions',
            service: 'campaign_controller',
          })
        );
        return;
      }
    }

    const startTime = logger.startOperation(req, 'keyword_actions', { action: body.action, count: body.keywords.length });

    try {
      const result = await this.proxyService.executeKeywordActions(req, body);
      logger.success(req, 'keyword_actions', startTime, { succeeded: result.succeeded, failed: result.failed });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public getRedditAccounts(_req: Request, res: Response): void {
    const accounts = REDDIT_ACCOUNTS.map((a) => ({ key: a.accountId, label: a.label }));
    res.json(accounts);
  }

  public async getRedditMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const account = rawKey ? REDDIT_ACCOUNTS.find((a) => a.accountId === rawKey) : REDDIT_ACCOUNTS[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid Reddit account key', {
          operation: 'reddit_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'reddit_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.redditMetricsService.getRedditMonitorData(req, accountId, days);
      logger.success(req, 'reddit_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'reddit_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public getMetaAccounts(_req: Request, res: Response): void {
    const accounts = META_ACCOUNTS.map((a) => ({ key: a.accountId, label: a.label }));
    res.json(accounts);
  }

  public async getMetaMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
    const rawDays = String(req.query['days'] ?? '30');
    const parsedDays = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    const days = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 7), 90) : 30;
    const rawKey = String(req.query['accountKey'] ?? '');
    const account = rawKey ? META_ACCOUNTS.find((a) => a.accountId === rawKey) : META_ACCOUNTS[0];
    if (!account) {
      next(
        ServiceValidationError.forField('accountKey', 'Invalid Meta account key', {
          operation: 'meta_monitor',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    const accountId = account.accountId;
    const startTime = logger.startOperation(req, 'meta_monitor', { days, accountKey: rawKey });

    try {
      const data = await this.metaMetricsService.getMonitorData(req, accountId, days);
      logger.success(req, 'meta_monitor', startTime, { campaigns: data.campaigns.length });
      res.json(data);
    } catch (error) {
      logger.error(req, 'meta_monitor', startTime, error, { days, accountKey: rawKey });
      next(error);
    }
  }

  public async updateCampaignStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    const campaignId = req.params['campaignId'];

    if (!campaignId) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId route parameter is required', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }
    if (!NUMERIC_ID_RE.test(campaignId)) {
      next(
        ServiceValidationError.forField('campaignId', 'campaignId must be a numeric string', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
          path: req.path,
        })
      );
      return;
    }

    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      next(
        ServiceValidationError.forField('body', 'request body must be a JSON object', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const body = req.body as Partial<CampaignStatusUpdateRequest>;

    if (!body.platform || !SUPPORTED_STATUS_PLATFORMS.has(body.platform)) {
      next(
        ServiceValidationError.forField('platform', `platform must be one of: ${[...SUPPORTED_STATUS_PLATFORMS].join(', ')}`, {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }
    if (!body.status || !VALID_CAMPAIGN_TOGGLE_STATUSES.has(body.status as CampaignToggleStatus)) {
      next(
        ServiceValidationError.forField('status', 'status must be ACTIVE or PAUSED', {
          operation: 'campaign_status_update',
          service: 'campaign_controller',
        })
      );
      return;
    }

    const startTime = logger.startOperation(req, 'campaign_status_update', { campaignId, platform: body.platform, status: body.status });

    try {
      const result = await this.proxyService.updateCampaignStatus(req, campaignId, {
        platform: body.platform,
        status: body.status as CampaignToggleStatus,
        accountId: typeof body.accountId === 'string' ? body.accountId : undefined,
      });
      logger.success(req, 'campaign_status_update', startTime, { campaignId, newStatus: result.newStatus });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

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
              logger.debug(undefined, 'campaign_sse_shutdown_timeout', 'SSE stream close timed out; force-closing', {});
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
                logger.debug(undefined, 'campaign_sse_shutdown_close', 'Stream already closed during shutdown', { err: error });
              } else {
                logger.warning(undefined, 'campaign_sse_shutdown_close', 'Unexpected error closing SSE stream', { err: error });
              }
              finish();
            }
          })
      )
    );
  }
}
