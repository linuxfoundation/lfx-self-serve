// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_RAW_CONTENT_MAX_LENGTH, NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH } from '@lfx-one/shared/constants';
import {
  CreateNewsletterRequest,
  GenerateNewsletterRequest,
  NewsletterListParams,
  NewsletterRecipientCountPayload,
  NewsletterStatus,
  NewsletterTestSendPayload,
  UpdateNewsletterRequest,
} from '@lfx-one/shared/interfaces';
import { isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { AiService } from '../services/ai.service';
import { logger } from '../services/logger.service';
import { NewsletterService } from '../services/newsletter.service';

const SUBJECT_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 100_000;
const COMMITTEE_LIMIT = 50;
const CONTEXT_NAME_MAX_LENGTH = 200;

/**
 * Newsletter controller — thin HTTP boundary in front of NewsletterService.
 *
 * All routes are project-scoped: `projectUid` arrives as `:projectUid` in the
 * mount path. The Go newsletter-service owns recipient resolution, email
 * dispatch, and analytics aggregation; Express just validates the request
 * shape and proxies through.
 */
export class NewsletterController {
  private newsletterService: NewsletterService = new NewsletterService();
  private aiService: AiService = new AiService();

  /**
   * POST /api/projects/:projectUid/newsletters/recipient-count
   */
  public async getRecipientCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_recipient_count', {
      project_uid: projectUid,
      committee_count: Array.isArray(req.body?.committee_uids) ? req.body.committee_uids.length : 0,
    });

    try {
      const payload = req.body as NewsletterRecipientCountPayload;
      this.validateCommitteeUids(payload?.committee_uids, req.path, 'newsletter_recipient_count');
      const result = await this.newsletterService.recipientCount(req, projectUid, payload);
      logger.success(req, 'newsletter_recipient_count', startTime, { count: result.count });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletters/recipients
   */
  public async getRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_recipients', {
      project_uid: projectUid,
      committee_count: Array.isArray(req.body?.committee_uids) ? req.body.committee_uids.length : 0,
    });

    try {
      const payload = req.body as NewsletterRecipientCountPayload;
      this.validateCommitteeUids(payload?.committee_uids, req.path, 'newsletter_recipients');
      const result = await this.newsletterService.recipients(req, projectUid, payload);
      logger.success(req, 'newsletter_recipients', startTime, { count: result.recipients.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletters/test-send
   *
   * Test sends do not require an ed_reply_email (the rendered envelope omits
   * the compliance footer for test sends). The Go service still validates the
   * field shape if it's present.
   */
  public async testSend(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_test_send', { project_uid: projectUid });

    try {
      const payload = req.body as NewsletterTestSendPayload;
      this.validateTestSendPayload(payload, req.path, 'newsletter_test_send');
      const result = await this.newsletterService.testSend(req, projectUid, payload);
      // PII (recipient email) intentionally omitted from log metadata.
      logger.success(req, 'newsletter_test_send', startTime, {});
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/projects/:projectUid/newsletters?status=...&page_token=...
   */
  public async listNewsletters(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_list', {
      project_uid: projectUid,
      status: req.query['status'],
    });

    try {
      const statusParam = req.query['status'] ? String(req.query['status']) : undefined;
      const pageToken = req.query['page_token'] ? String(req.query['page_token']) : undefined;

      if (statusParam && statusParam !== 'draft' && statusParam !== 'sending' && statusParam !== 'sent') {
        throw ServiceValidationError.forField('status', "status must be 'draft', 'sending', or 'sent'", {
          operation: 'newsletter_list',
          service: 'newsletter_controller',
          path: req.path,
        });
      }

      const params: NewsletterListParams = {
        status: statusParam as NewsletterStatus | undefined,
        page_token: pageToken,
      };
      const result = await this.newsletterService.listNewsletters(req, projectUid, params);

      logger.success(req, 'newsletter_list', startTime, {
        count: result.newsletters.length,
        has_more: !!result.next_page_token,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletters
   */
  public async createNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_create', { project_uid: projectUid });

    try {
      const payload = req.body as CreateNewsletterRequest;
      this.validateCommonPayload(payload, req.path, 'newsletter_create');
      this.validateCommitteeUids(payload.committee_uids, req.path, 'newsletter_create');

      const newsletter = await this.newsletterService.createNewsletter(req, projectUid, payload);
      logger.success(req, 'newsletter_create', startTime, { newsletter_id: newsletter.id, version: newsletter.version });
      res.status(201).json(newsletter);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/projects/:projectUid/newsletters/:newsletterUid
   */
  public async getNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const newsletterUid = this.requireNewsletterUid(req);
    const startTime = logger.startOperation(req, 'newsletter_get', { project_uid: projectUid, newsletter_id: newsletterUid });

    try {
      const newsletter = await this.newsletterService.getNewsletter(req, projectUid, newsletterUid);
      logger.success(req, 'newsletter_get', startTime, { newsletter_id: newsletter.id, version: newsletter.version });
      res.json(newsletter);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/projects/:projectUid/newsletters/:newsletterUid
   */
  public async updateNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const newsletterUid = this.requireNewsletterUid(req);
    const startTime = logger.startOperation(req, 'newsletter_update', { project_uid: projectUid, newsletter_id: newsletterUid });

    try {
      const version = parseIfMatch(req);
      const payload = req.body as UpdateNewsletterRequest;
      this.validateCommonPayload(payload, req.path, 'newsletter_update');
      this.validateCommitteeUids(payload.committee_uids, req.path, 'newsletter_update');

      const newsletter = await this.newsletterService.updateNewsletter(req, projectUid, newsletterUid, version, payload);
      logger.success(req, 'newsletter_update', startTime, { newsletter_id: newsletter.id, version: newsletter.version });
      res.json(newsletter);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/projects/:projectUid/newsletters/:newsletterUid
   */
  public async deleteNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const newsletterUid = this.requireNewsletterUid(req);
    const startTime = logger.startOperation(req, 'newsletter_delete', { project_uid: projectUid, newsletter_id: newsletterUid });

    try {
      await this.newsletterService.deleteNewsletter(req, projectUid, newsletterUid);
      logger.success(req, 'newsletter_delete', startTime, { newsletter_id: newsletterUid });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletters/:newsletterUid/send
   *
   * Owns the full send pipeline in the Go service: recipient resolution
   * (NATS → committee-service), email-chrome rendering, per-recipient fan-out
   * (NATS → email-service), and status transition. Express just proxies the
   * If-Match version through.
   */
  public async sendNewsletter(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const newsletterUid = this.requireNewsletterUid(req);
    const startTime = logger.startOperation(req, 'newsletter_send', { project_uid: projectUid, newsletter_id: newsletterUid });

    try {
      const version = parseIfMatch(req);
      const result = await this.newsletterService.sendNewsletter(req, projectUid, newsletterUid, version);
      logger.success(req, 'newsletter_send', startTime, {
        newsletter_id: newsletterUid,
        group_id: result.group_id,
        total_recipients: result.total_recipients,
        sent: result.sent,
        failed: result.failed,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/projects/:projectUid/newsletters/:newsletterUid/analytics
   */
  public async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const newsletterUid = this.requireNewsletterUid(req);
    const startTime = logger.startOperation(req, 'newsletter_analytics', { project_uid: projectUid, newsletter_id: newsletterUid });

    try {
      const analytics = await this.newsletterService.getAnalytics(req, projectUid, newsletterUid);
      logger.success(req, 'newsletter_analytics', startTime, {
        newsletter_id: newsletterUid,
        unique_opens: analytics.unique_opens,
        total_opens: analytics.total_opens,
      });
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/projects/:projectUid/newsletters/opt-outs
   */
  public async listOptOuts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_opt_outs_list', { project_uid: projectUid });

    try {
      const result = await this.newsletterService.listOptOuts(req, projectUid);
      logger.success(req, 'newsletter_opt_outs_list', startTime, { count: result.opt_outs.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/projects/:projectUid/newsletters/opt-outs/:optOutId
   */
  public async deleteOptOut(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const optOutId = this.requireOptOutId(req);
    const startTime = logger.startOperation(req, 'newsletter_opt_out_delete', { project_uid: projectUid, opt_out_id: optOutId });

    try {
      await this.newsletterService.deleteOptOut(req, projectUid, optOutId);
      logger.success(req, 'newsletter_opt_out_delete', startTime, { opt_out_id: optOutId });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletters/generate
   *
   * AI-assisted body generation. Doesn't touch the Go newsletter-service —
   * stays on the LiteLLM proxy path. Authorization is the global auth
   * middleware + rate limiting; a per-project writer check is a follow-up.
   */
  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    // The AI generation route lives under /api/projects/:projectUid/newsletters/generate
    // so the path param is part of the contract. Validate it here for consistency
    // with the other handlers even though the LiteLLM call doesn't consume it
    // today — a per-project writer check is a planned follow-up.
    this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_generate', {
      has_prompt_override: !!req.body?.systemPromptOverride,
    });

    try {
      const payload = req.body as GenerateNewsletterRequest;
      const fieldErrors: Record<string, string> = {};

      if (!payload?.rawContent || typeof payload.rawContent !== 'string' || payload.rawContent.trim().length === 0) {
        fieldErrors['rawContent'] = 'rawContent is required';
      } else if (payload.rawContent.length > NEWSLETTER_RAW_CONTENT_MAX_LENGTH) {
        fieldErrors['rawContent'] = `rawContent must be ${NEWSLETTER_RAW_CONTENT_MAX_LENGTH} characters or fewer`;
      }

      // contextType / contextName are kept on the GenerateNewsletterRequest
      // because the AI prompt template references them (Foundation vs Project
      // tonal cues). They drive nothing else now.
      if (!payload?.contextType || (payload.contextType !== 'project' && payload.contextType !== 'foundation')) {
        fieldErrors['contextType'] = "contextType must be 'foundation' or 'project'";
      }

      if (!payload?.contextName || typeof payload.contextName !== 'string' || payload.contextName.trim().length === 0) {
        fieldErrors['contextName'] = 'contextName is required';
      } else if (payload.contextName.length > CONTEXT_NAME_MAX_LENGTH) {
        fieldErrors['contextName'] = `contextName must be ${CONTEXT_NAME_MAX_LENGTH} characters or fewer`;
      }

      if (payload?.systemPromptOverride !== undefined) {
        if (typeof payload.systemPromptOverride !== 'string') {
          fieldErrors['systemPromptOverride'] = 'systemPromptOverride must be a string';
        } else if (payload.systemPromptOverride.length > NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH) {
          fieldErrors['systemPromptOverride'] = `systemPromptOverride must be ${NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH} characters or fewer`;
        }
      }

      if (Object.keys(fieldErrors).length > 0) {
        throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
          operation: 'newsletter_generate',
          service: 'newsletter_controller',
          path: req.path,
        });
      }

      const result = await this.aiService.generateNewsletter(req, {
        rawContent: payload.rawContent,
        contextType: payload.contextType,
        contextName: payload.contextName,
        systemPromptOverride: payload.systemPromptOverride,
      });

      logger.success(req, 'newsletter_generate', startTime, {
        subject_length: result.subject.length,
        body_html_length: result.bodyHtml.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  private requireProjectUid(req: Request): string {
    const projectUid = String(req.params['projectUid'] || '').trim();
    if (!projectUid) {
      throw ServiceValidationError.forField('projectUid', 'projectUid path parameter is required', {
        operation: 'newsletter_controller',
        service: 'newsletter_controller',
        path: req.path,
      });
    }
    return projectUid;
  }

  private requireNewsletterUid(req: Request): string {
    const newsletterUid = String(req.params['newsletterUid'] || '').trim();
    if (!newsletterUid) {
      throw ServiceValidationError.forField('newsletterUid', 'newsletterUid path parameter is required', {
        operation: 'newsletter_controller',
        service: 'newsletter_controller',
        path: req.path,
      });
    }
    return newsletterUid;
  }

  private requireOptOutId(req: Request): string {
    const optOutId = String(req.params['optOutId'] || '').trim();
    // Opt-out ids are always UUIDs; rejecting anything else keeps arbitrary
    // strings out of the upstream path this value is interpolated into.
    if (!isUuid(optOutId)) {
      throw ServiceValidationError.forField('optOutId', 'optOutId path parameter must be a UUID', {
        operation: 'newsletter_controller',
        service: 'newsletter_controller',
        path: req.path,
      });
    }
    return optOutId;
  }

  private validateCommonPayload(payload: { subject?: string; body_html?: string; ed_reply_email?: string }, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!payload?.subject || typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
      fieldErrors['subject'] = 'Subject is required';
    } else if (payload.subject.length > SUBJECT_MAX_LENGTH) {
      fieldErrors['subject'] = `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.body_html || typeof payload.body_html !== 'string' || payload.body_html.trim().length === 0) {
      fieldErrors['body_html'] = 'Body is required';
    } else if (payload.body_html.length > BODY_MAX_LENGTH) {
      fieldErrors['body_html'] = `Body must be ${BODY_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.ed_reply_email || typeof payload.ed_reply_email !== 'string' || !payload.ed_reply_email.includes('@')) {
      fieldErrors['ed_reply_email'] = 'A valid ed_reply_email is required';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_controller',
        path,
      });
    }
  }

  private validateTestSendPayload(payload: NewsletterTestSendPayload, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!payload?.subject || typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
      fieldErrors['subject'] = 'Subject is required';
    } else if (payload.subject.length > SUBJECT_MAX_LENGTH) {
      fieldErrors['subject'] = `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.body_html || typeof payload.body_html !== 'string' || payload.body_html.trim().length === 0) {
      fieldErrors['body_html'] = 'Body is required';
    } else if (payload.body_html.length > BODY_MAX_LENGTH) {
      fieldErrors['body_html'] = `Body must be ${BODY_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.to_email || typeof payload.to_email !== 'string' || !payload.to_email.includes('@')) {
      fieldErrors['to_email'] = 'A valid to_email is required';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_controller',
        path,
      });
    }
  }

  private validateCommitteeUids(uids: unknown, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!Array.isArray(uids)) {
      fieldErrors['committee_uids'] = 'committee_uids must be an array of strings';
    } else if (uids.length === 0) {
      fieldErrors['committee_uids'] = 'committee_uids must contain at least one UID';
    } else if (uids.length > COMMITTEE_LIMIT) {
      fieldErrors['committee_uids'] = `committee_uids must contain at most ${COMMITTEE_LIMIT} UIDs`;
    } else if (!uids.every((uid) => typeof uid === 'string' && uid.length > 0)) {
      fieldErrors['committee_uids'] = 'committee_uids must contain non-empty strings';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_controller',
        path,
      });
    }
  }
}

/**
 * Parse the If-Match header into a version integer. Used by update/send routes
 * for optimistic concurrency control.
 */
function parseIfMatch(req: Request): number {
  const raw = (req.header('If-Match') || '').trim();
  if (!raw) {
    throw ServiceValidationError.forField('If-Match', 'If-Match header is required', {
      operation: 'newsletter_if_match',
      service: 'newsletter_controller',
      path: req.path,
    });
  }
  const cleaned = raw.replace(/^W\//i, '').replace(/^"|"$/g, '');
  const version = Number(cleaned);
  if (!Number.isFinite(version) || !Number.isInteger(version) || version < 1) {
    throw ServiceValidationError.forField('If-Match', 'If-Match must be a positive integer version', {
      operation: 'newsletter_if_match',
      service: 'newsletter_controller',
      path: req.path,
    });
  }
  return version;
}
