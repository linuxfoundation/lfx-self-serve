// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NEWSLETTER_RAW_CONTENT_MAX_LENGTH, NEWSLETTER_SYSTEM_PROMPT_MAX_LENGTH } from '@lfx-one/shared/constants';
import {
  CreateNewsletterDraftRequest,
  GenerateNewsletterRequest,
  NewsletterContextType,
  NewsletterListParams,
  NewsletterRecipientCountPayload,
  NewsletterSendPayload,
  NewsletterStatus,
  NewsletterTestSendPayload,
  UpdateNewsletterDraftRequest,
} from '@lfx-one/shared/interfaces';
import { stripHtml } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { AiService } from '../services/ai.service';
import { EmailServiceClient } from '../services/email-service.client';
import { logger } from '../services/logger.service';
import { NewsletterService } from '../services/newsletter.service';
import { NewsletterServiceClient } from '../services/newsletter-service.client';

const VALID_CONTEXT_TYPES = new Set(['foundation', 'project']);
const SUBJECT_MAX_LENGTH = 200;
const BODY_MAX_LENGTH = 100_000;
const COMMITTEE_LIMIT = 50;
const CONTEXT_NAME_MAX_LENGTH = 200;

export class NewsletterController {
  private newsletterClient: NewsletterServiceClient = new NewsletterServiceClient();
  private emailServiceClient: EmailServiceClient = new EmailServiceClient();
  private newsletterService: NewsletterService = new NewsletterService(this.newsletterClient, this.emailServiceClient);
  private aiService: AiService = new AiService();

  /**
   * POST /api/newsletters/recipient-count
   * Body: { committeeUids: string[] }
   */
  public async getRecipientCount(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_recipient_count', {
      committee_count: Array.isArray(req.body?.committeeUids) ? req.body.committeeUids.length : 0,
    });

    try {
      const payload = req.body as NewsletterRecipientCountPayload;
      this.validateCommitteeUids(payload?.committeeUids, req.path, 'newsletter_recipient_count');

      const recipients = await this.newsletterService.resolveRecipients(req, payload.committeeUids);

      logger.success(req, 'newsletter_recipient_count', startTime, { count: recipients.length });
      res.json({ count: recipients.length });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/recipients
   * Body: { committeeUids: string[] }
   * Returns the deduplicated recipient list (email + firstName) across the committees.
   */
  public async getRecipients(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_recipients', {
      committee_count: Array.isArray(req.body?.committeeUids) ? req.body.committeeUids.length : 0,
    });

    try {
      const payload = req.body as NewsletterRecipientCountPayload;
      this.validateCommitteeUids(payload?.committeeUids, req.path, 'newsletter_recipients');

      const recipients = await this.newsletterService.resolveRecipients(req, payload.committeeUids);

      logger.success(req, 'newsletter_recipients', startTime, { count: recipients.length });
      res.json({ recipients });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/test-send
   * Body: { subject, bodyHtml, toEmail, contextType, contextUid, edReplyEmail }
   *
   * Sends a single preview email via lfx-v2-email-service. No group_id is
   * supplied — test sends auto-generate one server-side and stay out of the
   * newsletter analytics rollup.
   */
  public async testSend(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_test_send', {
      context_type: req.body?.contextType,
      context_uid: req.body?.contextUid,
    });

    try {
      const payload = req.body as NewsletterTestSendPayload;
      this.validateCommonPayload(payload, req.path, 'newsletter_test_send');

      if (!payload.toEmail || typeof payload.toEmail !== 'string' || !payload.toEmail.includes('@')) {
        throw ServiceValidationError.forField('toEmail', 'A valid recipient email is required', {
          operation: 'newsletter_test_send',
          service: 'newsletter_controller',
          path: req.path,
        });
      }

      await this.emailServiceClient.sendEmail(req, {
        to: payload.toEmail,
        subject: payload.subject,
        html: payload.bodyHtml,
        text: stripHtml(payload.bodyHtml),
      });

      // PII (recipient email) intentionally omitted from log metadata.
      logger.success(req, 'newsletter_test_send', startTime, {});
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/send
   * Body: { subject, bodyHtml, committeeUids, contextType, contextUid, edReplyEmail }
   *
   * Ad-hoc send (no prior saved draft). Creates a draft record on the Go
   * newsletter-service, fans out one email per recipient via email-service,
   * then flips the draft to `sent` with the shared group_id.
   */
  public async send(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_send', {
      context_type: req.body?.contextType,
      context_uid: req.body?.contextUid,
      committee_count: Array.isArray(req.body?.committeeUids) ? req.body.committeeUids.length : 0,
    });

    try {
      const payload = req.body as NewsletterSendPayload;
      this.validateCommonPayload(payload, req.path, 'newsletter_send');
      this.validateCommitteeUids(payload.committeeUids, req.path, 'newsletter_send');

      // Build the create-draft request explicitly so we keep type safety even
      // if NewsletterSendPayload and CreateNewsletterDraftRequest diverge.
      const createDraftRequest: CreateNewsletterDraftRequest = {
        contextType: payload.contextType,
        contextUid: payload.contextUid,
        subject: payload.subject,
        bodyHtml: payload.bodyHtml,
        edReplyEmail: payload.edReplyEmail,
        committeeUids: payload.committeeUids,
      };
      const draft = await this.newsletterClient.createDraft(req, createDraftRequest);

      const result = await this.newsletterService.dispatchNewsletter(req, draft, 'newsletter_send');

      logger.success(req, 'newsletter_send', startTime, {
        newsletter_id: draft.id,
        group_id: result.groupId,
        total_recipients: result.totalRecipients,
        sent: result.sent,
        failed: result.failed,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/newsletters/drafts?contextType=...&contextUid=...
   */
  public async listDrafts(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_list_drafts', {
      context_type: req.query['contextType'],
      context_uid: req.query['contextUid'],
    });

    try {
      const contextType = String(req.query['contextType'] || '');
      const contextUid = String(req.query['contextUid'] || '');
      if (!VALID_CONTEXT_TYPES.has(contextType)) {
        throw ServiceValidationError.forField('contextType', "contextType must be 'foundation' or 'project'", {
          operation: 'newsletter_list_drafts',
          service: 'newsletter_controller',
          path: req.path,
        });
      }
      if (!contextUid) {
        throw ServiceValidationError.forField('contextUid', 'contextUid is required', {
          operation: 'newsletter_list_drafts',
          service: 'newsletter_controller',
          path: req.path,
        });
      }
      const result = await this.newsletterClient.listDrafts(req, contextType as NewsletterContextType, contextUid);
      logger.success(req, 'newsletter_list_drafts', startTime, { count: result.drafts.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/drafts
   * Body: CreateNewsletterDraftRequest
   */
  public async createDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_create_draft', {
      context_type: req.body?.contextType,
      context_uid: req.body?.contextUid,
    });

    try {
      const payload = req.body as CreateNewsletterDraftRequest;
      this.validateCommonPayload(payload, req.path, 'newsletter_create_draft');
      this.validateCommitteeUids(payload.committeeUids, req.path, 'newsletter_create_draft');

      const draft = await this.newsletterClient.createDraft(req, payload);
      logger.success(req, 'newsletter_create_draft', startTime, { draft_id: draft.id, version: draft.version });
      res.status(201).json(draft);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/newsletters/drafts/:id
   */
  public async getDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_get_draft', { draft_id: req.params['id'] });

    try {
      const id = String(req.params['id'] || '');
      if (!id) {
        throw ServiceValidationError.forField('id', 'id is required', {
          operation: 'newsletter_get_draft',
          service: 'newsletter_controller',
          path: req.path,
        });
      }
      const draft = await this.newsletterClient.getDraft(req, id);
      logger.success(req, 'newsletter_get_draft', startTime, { draft_id: draft.id, version: draft.version });
      res.json(draft);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/newsletters/drafts/:id
   * Body: UpdateNewsletterDraftRequest
   * Requires If-Match header for optimistic locking.
   */
  public async updateDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_update_draft', { draft_id: req.params['id'] });

    try {
      const id = String(req.params['id'] || '');
      const version = parseIfMatch(req);
      const payload = req.body as UpdateNewsletterDraftRequest;
      this.validateCommonPayloadShallow(payload, req.path, 'newsletter_update_draft');
      this.validateCommitteeUids(payload.committeeUids, req.path, 'newsletter_update_draft');

      const draft = await this.newsletterClient.updateDraft(req, id, version, payload);
      logger.success(req, 'newsletter_update_draft', startTime, { draft_id: draft.id, version: draft.version });
      res.json(draft);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/newsletters/drafts/:id
   */
  public async deleteDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_delete_draft', { draft_id: req.params['id'] });

    try {
      const id = String(req.params['id'] || '');
      await this.newsletterClient.deleteDraft(req, id);
      logger.success(req, 'newsletter_delete_draft', startTime, { draft_id: id });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/drafts/:id/send
   * Requires If-Match header for optimistic locking.
   *
   * Fetches the saved draft, fans out one email per recipient via the
   * email-service, then PATCHes the Go newsletter-service record with the
   * shared group_id and status=sent.
   */
  public async sendDraft(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_send_draft', { draft_id: req.params['id'] });

    try {
      const id = String(req.params['id'] || '');
      const version = parseIfMatch(req);

      const draft = await this.newsletterClient.getDraft(req, id);
      const result = await this.newsletterService.dispatchNewsletter(req, draft, 'newsletter_send_draft', version);

      logger.success(req, 'newsletter_send_draft', startTime, {
        draft_id: id,
        group_id: result.groupId,
        total_recipients: result.totalRecipients,
        sent: result.sent,
        failed: result.failed,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/newsletters?contextType=...&contextUid=...&status=...&pageToken=...
   * Returns drafts and/or sent newsletters for the given context.
   */
  public async listNewsletters(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_list', {
      context_type: req.query['contextType'],
      context_uid: req.query['contextUid'],
      status: req.query['status'],
    });

    try {
      const contextType = String(req.query['contextType'] || '');
      const contextUid = String(req.query['contextUid'] || '');
      const statusParam = req.query['status'] ? String(req.query['status']) : undefined;
      const pageToken = req.query['pageToken'] ? String(req.query['pageToken']) : undefined;

      const fieldErrors: Record<string, string> = {};
      if (!VALID_CONTEXT_TYPES.has(contextType)) {
        fieldErrors['contextType'] = "contextType must be 'foundation' or 'project'";
      }
      if (!contextUid) {
        fieldErrors['contextUid'] = 'contextUid is required';
      }
      if (statusParam && statusParam !== 'draft' && statusParam !== 'sent') {
        fieldErrors['status'] = "status must be 'draft' or 'sent'";
      }
      if (Object.keys(fieldErrors).length > 0) {
        throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
          operation: 'newsletter_list',
          service: 'newsletter_controller',
          path: req.path,
        });
      }

      const params: NewsletterListParams = {
        contextType: contextType as NewsletterContextType,
        contextUid,
        status: statusParam as NewsletterStatus | undefined,
        pageToken,
      };
      const result = await this.newsletterClient.listNewsletters(req, params);
      result.newsletters = await this.newsletterService.enrichListWithEngagement(req, result.newsletters);

      logger.success(req, 'newsletter_list', startTime, {
        count: result.newsletters.length,
        has_more: !!result.nextPageToken,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/newsletters/:id/analytics
   * Returns engagement analytics for a sent newsletter.
   *
   * Source of truth is lfx-v2-email-service: we look up the newsletter to
   * read its `groupId`, then aggregate per-recipient EmailRecipientRecords
   * into the existing NewsletterAnalytics shape so the frontend doesn't have
   * to change.
   */
  public async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_analytics', { newsletter_id: req.params['id'] });

    try {
      const id = String(req.params['id'] || '');
      if (!id) {
        throw ServiceValidationError.forField('id', 'id is required', {
          operation: 'newsletter_analytics',
          service: 'newsletter_controller',
          path: req.path,
        });
      }

      const newsletter = await this.newsletterClient.getDraft(req, id);
      const analytics = await this.newsletterService.getAnalytics(req, newsletter);

      logger.success(req, 'newsletter_analytics', startTime, {
        newsletter_id: id,
        group_id: newsletter.groupId,
        unique_opens: analytics.uniqueOpens,
        total_opens: analytics.totalOpens,
      });
      res.json(analytics);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/newsletters/generate
   * Body: { rawContent, contextType, contextName, systemPromptOverride? }
   */
  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_generate', {
      context_type: req.body?.contextType,
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

      if (!payload?.contextType || !VALID_CONTEXT_TYPES.has(payload.contextType)) {
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

  private validateCommonPayload(
    payload: { subject?: string; bodyHtml?: string; contextType?: string; contextUid?: string; edReplyEmail?: string },
    path: string,
    operation: string
  ): void {
    const fieldErrors: Record<string, string> = {};

    if (!payload?.subject || typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
      fieldErrors['subject'] = 'Subject is required';
    } else if (payload.subject.length > SUBJECT_MAX_LENGTH) {
      fieldErrors['subject'] = `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.bodyHtml || typeof payload.bodyHtml !== 'string' || payload.bodyHtml.trim().length === 0) {
      fieldErrors['bodyHtml'] = 'Body is required';
    } else if (payload.bodyHtml.length > BODY_MAX_LENGTH) {
      fieldErrors['bodyHtml'] = `Body must be ${BODY_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.contextType || !VALID_CONTEXT_TYPES.has(payload.contextType)) {
      fieldErrors['contextType'] = "contextType must be 'foundation' or 'project'";
    }

    if (!payload?.contextUid || typeof payload.contextUid !== 'string') {
      fieldErrors['contextUid'] = 'contextUid is required';
    }

    if (!payload?.edReplyEmail || typeof payload.edReplyEmail !== 'string' || !payload.edReplyEmail.includes('@')) {
      fieldErrors['edReplyEmail'] = 'A valid edReplyEmail is required';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_controller',
        path,
      });
    }
  }

  /**
   * Validate update-draft payloads which omit contextType / contextUid (those
   * are immutable once a draft is created).
   */
  private validateCommonPayloadShallow(payload: { subject?: string; bodyHtml?: string; edReplyEmail?: string }, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!payload?.subject || typeof payload.subject !== 'string' || payload.subject.trim().length === 0) {
      fieldErrors['subject'] = 'Subject is required';
    } else if (payload.subject.length > SUBJECT_MAX_LENGTH) {
      fieldErrors['subject'] = `Subject must be ${SUBJECT_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.bodyHtml || typeof payload.bodyHtml !== 'string' || payload.bodyHtml.trim().length === 0) {
      fieldErrors['bodyHtml'] = 'Body is required';
    } else if (payload.bodyHtml.length > BODY_MAX_LENGTH) {
      fieldErrors['bodyHtml'] = `Body must be ${BODY_MAX_LENGTH} characters or fewer`;
    }

    if (!payload?.edReplyEmail || typeof payload.edReplyEmail !== 'string' || !payload.edReplyEmail.includes('@')) {
      fieldErrors['edReplyEmail'] = 'A valid edReplyEmail is required';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_controller',
        path,
      });
    }
  }

  /**
   * Shared committeeUids validation used by /recipient-count, /recipients,
   * /send, /drafts (create), and /drafts/:id (update).
   */
  private validateCommitteeUids(uids: unknown, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!Array.isArray(uids)) {
      fieldErrors['committeeUids'] = 'committeeUids must be an array of strings';
    } else if (uids.length === 0) {
      fieldErrors['committeeUids'] = 'committeeUids must contain at least one UID';
    } else if (uids.length > COMMITTEE_LIMIT) {
      fieldErrors['committeeUids'] = `committeeUids must contain at most ${COMMITTEE_LIMIT} UIDs`;
    } else if (!uids.every((uid) => typeof uid === 'string' && uid.length > 0)) {
      fieldErrors['committeeUids'] = 'committeeUids must contain non-empty strings';
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
 * Parse the If-Match header into a version integer. Used by update/send draft
 * routes for optimistic concurrency control.
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
