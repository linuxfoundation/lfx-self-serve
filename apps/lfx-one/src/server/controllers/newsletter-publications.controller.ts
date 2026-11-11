// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  NEWSLETTER_MAX_COMMITTEES,
  NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH,
  NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH,
  NEWSLETTER_STATUSES,
} from '@lfx-one/shared/constants';
import { NewsletterCreateFields, NewsletterListParams, NewsletterPublicationRequest, NewsletterStatus } from '@lfx-one/shared/interfaces';
import { isNewsletterReplyToAddress, isUuid } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { validateNewsletterEditionPayload } from '../helpers/newsletter-edition-payload.helper';
import { parseNewsletterIfMatch } from '../helpers/newsletter-if-match.helper';
import { logger } from '../services/logger.service';
import { NewsletterMemberBenefitService } from '../services/newsletter-member-benefit.service';
import { NewsletterPublicationsService } from '../services/newsletter-publications.service';

const SERVICE = 'newsletter_publications_controller';

/**
 * Thin HTTP boundary in front of lfx-v2-newsletter-service publications. It checks the request
 * shape and forwards the caller's token; the service owns the publication rules.
 */
export class NewsletterPublicationsController {
  private publicationsService: NewsletterPublicationsService = new NewsletterPublicationsService();
  private memberBenefitService: NewsletterMemberBenefitService = new NewsletterMemberBenefitService();

  /** GET /api/projects/:projectUid/newsletter-publications?page_token=... */
  public async listPublications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const startTime = logger.startOperation(req, 'newsletter_publication_list', { project_uid: projectUid });
      const result = await this.publicationsService.listPublications(req, projectUid, this.pageToken(req));
      logger.success(req, 'newsletter_publication_list', startTime, { count: result.publications?.length ?? 0, has_more: !!result.next_page_token });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/projects/:projectUid/newsletter-publications */
  public async createPublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const startTime = logger.startOperation(req, 'newsletter_publication_create', { project_uid: projectUid });
      const payload = this.validatePublicationPayload(req, 'newsletter_publication_create');
      const publication = await this.publicationsService.createPublication(req, projectUid, payload);
      logger.success(req, 'newsletter_publication_create', startTime, { publication_id: publication.id, version: publication.version });
      res.status(201).json(publication);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/projects/:projectUid/newsletter-publications/:publicationUid */
  public async getPublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const startTime = logger.startOperation(req, 'newsletter_publication_get', { project_uid: projectUid, publication_id: publicationUid });
      const publication = await this.publicationsService.getPublication(req, projectUid, publicationUid);
      logger.success(req, 'newsletter_publication_get', startTime, { publication_id: publication.id, version: publication.version });
      res.json(publication);
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/projects/:projectUid/newsletter-publications/:publicationUid (requires If-Match) */
  public async updatePublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const startTime = logger.startOperation(req, 'newsletter_publication_update', { project_uid: projectUid, publication_id: publicationUid });
      const version = parseNewsletterIfMatch(req, 'newsletter_publication_if_match', SERVICE);
      const payload = this.validatePublicationPayload(req, 'newsletter_publication_update');
      const publication = await this.publicationsService.updatePublication(req, projectUid, publicationUid, version, payload);
      logger.success(req, 'newsletter_publication_update', startTime, { publication_id: publication.id, version: publication.version });
      res.json(publication);
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/projects/:projectUid/newsletter-publications/:publicationUid/editions?status=...&page_token=... */
  public async listEditions(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const startTime = logger.startOperation(req, 'newsletter_edition_list', { project_uid: projectUid, publication_id: publicationUid });
      const params: NewsletterListParams = { status: this.editionStatus(req), page_token: this.pageToken(req) };
      // The gateway already requires auditor_guard here. The rows carry drafts and body_html, so the
      // BFF also runs the project list's publisher check, keeping the two lists on one rule (#3469).
      await this.memberBenefitService.assertPublisherRead(req, projectUid);
      const result = await this.publicationsService.listEditions(req, projectUid, publicationUid, params);
      logger.success(req, 'newsletter_edition_list', startTime, { count: result.newsletters?.length ?? 0, has_more: !!result.next_page_token });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/projects/:projectUid/newsletter-publications/:publicationUid/editions */
  public async createEdition(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const startTime = logger.startOperation(req, 'newsletter_edition_create', { project_uid: projectUid, publication_id: publicationUid });
      const payload = req.body as (Partial<NewsletterCreateFields> & { publication_uid?: string }) | null;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw ServiceValidationError.forField('body', 'Request body must be a JSON object', this.errorContext(req, 'newsletter_edition_create'));
      }
      if (payload.publication_uid !== undefined && payload.publication_uid !== publicationUid) {
        throw ServiceValidationError.forField('publication_uid', 'publication_uid must match the path', this.errorContext(req, 'newsletter_edition_create'));
      }
      validateNewsletterEditionPayload(payload, this.errorContext(req, 'newsletter_edition_create'));
      const edition = await this.publicationsService.createEdition(req, projectUid, publicationUid, payload);
      logger.success(req, 'newsletter_edition_create', startTime, { newsletter_id: edition.id, version: edition.version });
      res.status(201).json(edition);
    } catch (error) {
      next(error);
    }
  }

  private requireProjectUid(req: Request): string {
    const projectUid = String(req.params['projectUid'] || '').trim();
    if (!projectUid) {
      throw ServiceValidationError.forField('projectUid', 'projectUid path parameter is required', this.errorContext(req, SERVICE));
    }
    return projectUid;
  }

  private requirePublicationUid(req: Request): string {
    const publicationUid = String(req.params['publicationUid'] || '').trim();
    if (!isUuid(publicationUid)) {
      throw ServiceValidationError.forField('publicationUid', 'publicationUid path parameter must be a UUID', this.errorContext(req, SERVICE));
    }
    return publicationUid;
  }

  private pageToken(req: Request): string | undefined {
    return req.query['page_token'] ? String(req.query['page_token']) : undefined;
  }

  private editionStatus(req: Request): NewsletterStatus | undefined {
    const status = req.query['status'] ? String(req.query['status']) : undefined;
    if (status && !NEWSLETTER_STATUSES.includes(status)) {
      throw ServiceValidationError.forField(
        'status',
        "status must be 'draft', 'sending', 'scheduled', or 'sent'",
        this.errorContext(req, 'newsletter_edition_list')
      );
    }
    return status as NewsletterStatus | undefined;
  }

  private validatePublicationPayload(req: Request, operation: string): NewsletterPublicationRequest {
    const payload = req.body as NewsletterPublicationRequest | null;
    const fieldErrors: Record<string, string> = {};

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw ServiceValidationError.forField('body', 'Request body must be a JSON object', this.errorContext(req, operation));
    }
    // Trimmed and counted by code point, the way the service counts.
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      fieldErrors['name'] = 'name is required';
    } else if ([...payload.name.trim()].length > NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH) {
      fieldErrors['name'] = `name must be ${NEWSLETTER_PUBLICATION_NAME_MAX_LENGTH} characters or fewer`;
    }
    if (payload.template_key !== undefined && typeof payload.template_key !== 'string') {
      fieldErrors['template_key'] = 'template_key must be a string';
    }
    if (
      payload.from_name !== undefined &&
      (typeof payload.from_name !== 'string' || [...payload.from_name.trim()].length > NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH)
    ) {
      fieldErrors['from_name'] = `from_name must be a string of ${NEWSLETTER_PUBLICATION_FROM_NAME_MAX_LENGTH} characters or fewer`;
    }
    // The service trims reply_to_email and stores a blank one as no override, so only a nonblank
    // value is checked.
    const replyTo: unknown = payload.reply_to_email;
    if (replyTo !== undefined && (typeof replyTo !== 'string' || (replyTo.trim() !== '' && !isNewsletterReplyToAddress(replyTo.trim())))) {
      fieldErrors['reply_to_email'] = 'reply_to_email must be a plain ASCII email address with at most 64 characters before the @';
    }
    const committeeError = this.committeeUidsError(payload.committee_uids);
    if (committeeError) {
      fieldErrors['committee_uids'] = committeeError;
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', this.errorContext(req, operation));
    }
    return payload;
  }

  private committeeUidsError(value: unknown): string | null {
    if (value === undefined) return null;
    if (!Array.isArray(value) || value.length > NEWSLETTER_MAX_COMMITTEES || !value.every((uid) => typeof uid === 'string' && uid.trim().length > 0)) {
      return `committee_uids must be an array of at most ${NEWSLETTER_MAX_COMMITTEES} non-empty strings`;
    }
    return null;
  }

  private errorContext(req: Request, operation: string): { operation: string; service: string; path: string } {
    return { operation, service: SERVICE, path: req.path };
  }
}
