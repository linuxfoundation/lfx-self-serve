// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatePublicationRequest, NewsletterPublicationListParams, UpdatePublicationRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { NewsletterPublicationsService } from '../services/newsletter-publications.service';

/**
 * Newsletter publications controller — thin HTTP boundary in front of NewsletterPublicationsService.
 *
 * All routes are project-scoped: `projectUid` arrives as `:projectUid` in the
 * mount path. The Go newsletter-service owns publication persistence; Express
 * just validates the request shape and proxies through.
 */
export class NewsletterPublicationsController {
  private publicationsService: NewsletterPublicationsService = new NewsletterPublicationsService();

  /**
   * GET /api/projects/:projectUid/newsletter-publications?page_token=...&page_size=...
   *
   * The upstream list is paginated and caps the page size, so the pagination
   * parameters are forwarded and `next_page_token` is passed back unchanged.
   */
  public async listPublications(req: Request, res: Response, next: NextFunction): Promise<void> {
    // require* runs inside the try so a bad path param reaches next(error) rather
    // than rejecting the handler promise (Express 4 does not catch that).
    const startTime = logger.startOperation(req, 'newsletter_publications_list', { project_uid: req.params['projectUid'] });

    try {
      const projectUid = this.requireProjectUid(req);
      const params: NewsletterPublicationListParams = {
        page_token: req.query['page_token'] ? String(req.query['page_token']) : undefined,
        page_size: this.parsePageSize(req),
      };
      const result = await this.publicationsService.listPublications(req, projectUid, params);
      logger.success(req, 'newsletter_publications_list', startTime, {
        count: result.publications.length,
        has_more: !!result.next_page_token,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletter-publications
   */
  public async createPublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_publication_create', { project_uid: req.params['projectUid'] });

    try {
      const projectUid = this.requireProjectUid(req);
      const payload = req.body as CreatePublicationRequest;
      this.validateCreatePublicationPayload(payload, req.path, 'newsletter_publication_create');

      const publication = await this.publicationsService.createPublication(req, projectUid, payload);
      logger.success(req, 'newsletter_publication_create', startTime, { publication_id: publication.id, version: publication.version });
      res.status(201).json(publication);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/projects/:projectUid/newsletter-publications/:publicationUid
   */
  public async getPublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_publication_get', {
      project_uid: req.params['projectUid'],
      publication_id: req.params['publicationUid'],
    });

    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const publication = await this.publicationsService.getPublication(req, projectUid, publicationUid);
      logger.success(req, 'newsletter_publication_get', startTime, { publication_id: publication.id, version: publication.version });
      res.json(publication);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/projects/:projectUid/newsletter-publications/:publicationUid
   */
  public async updatePublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'newsletter_publication_update', {
      project_uid: req.params['projectUid'],
      publication_id: req.params['publicationUid'],
    });

    try {
      const projectUid = this.requireProjectUid(req);
      const publicationUid = this.requirePublicationUid(req);
      const version = parseIfMatch(req);
      const payload = req.body as UpdatePublicationRequest;
      this.validateUpdatePublicationPayload(payload, req.path, 'newsletter_publication_update');

      const publication = await this.publicationsService.updatePublication(req, projectUid, publicationUid, version, payload);
      logger.success(req, 'newsletter_publication_update', startTime, { publication_id: publication.id, version: publication.version });
      res.json(publication);
    } catch (error) {
      next(error);
    }
  }

  private requireProjectUid(req: Request): string {
    const projectUid = String(req.params['projectUid'] || '').trim();
    if (!projectUid) {
      throw ServiceValidationError.forField('projectUid', 'projectUid path parameter is required', {
        operation: 'newsletter_publications_controller',
        service: 'newsletter_publications_controller',
        path: req.path,
      });
    }
    return projectUid;
  }

  /**
   * Read an optional page_size query parameter. Undefined means the caller did
   * not ask for a size, so the upstream default applies. A value that is not a
   * positive integer is rejected here rather than forwarded.
   */
  private parsePageSize(req: Request): number | undefined {
    const raw = req.query['page_size'];
    if (raw === undefined || String(raw).trim() === '') {
      return undefined;
    }
    const pageSize = Number(String(raw).trim());
    if (!Number.isInteger(pageSize) || pageSize < 1) {
      throw ServiceValidationError.forField('page_size', 'page_size must be a positive integer', {
        operation: 'newsletter_publications_list',
        service: 'newsletter_publications_controller',
        path: req.path,
      });
    }
    return pageSize;
  }

  private requirePublicationUid(req: Request): string {
    const publicationUid = String(req.params['publicationUid'] || '').trim();
    if (!publicationUid) {
      throw ServiceValidationError.forField('publicationUid', 'publicationUid path parameter is required', {
        operation: 'newsletter_publications_controller',
        service: 'newsletter_publications_controller',
        path: req.path,
      });
    }
    return publicationUid;
  }

  private validateCreatePublicationPayload(payload: CreatePublicationRequest, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    if (!payload?.slug || typeof payload.slug !== 'string' || payload.slug.trim().length === 0) {
      fieldErrors['slug'] = 'slug is required';
    }

    if (!payload?.name || typeof payload.name !== 'string' || payload.name.trim().length === 0) {
      fieldErrors['name'] = 'name is required';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_publications_controller',
        path,
      });
    }
  }

  private validateUpdatePublicationPayload(payload: UpdatePublicationRequest, path: string, operation: string): void {
    const fieldErrors: Record<string, string> = {};

    // A JSON `null` (or non-object) body must be a 400, not a 500 from
    // Object.keys(null) / property access below. Coerce to an empty object so an
    // empty payload falls through to the "at least one field" error.
    const p = payload && typeof payload === 'object' ? payload : ({} as UpdatePublicationRequest);

    // At least one field should be present for an update
    if (Object.keys(p).length === 0) {
      fieldErrors['payload'] = 'At least one field is required for update';
    }

    if (p.name !== undefined && (typeof p.name !== 'string' || p.name.trim().length === 0)) {
      fieldErrors['name'] = 'name must be a non-empty string';
    }

    if (Object.keys(fieldErrors).length > 0) {
      throw ServiceValidationError.fromFieldErrors(fieldErrors, 'Validation failed', {
        operation,
        service: 'newsletter_publications_controller',
        path,
      });
    }
  }
}

/**
 * Parse the If-Match header into a version integer. Used by update routes
 * for optimistic concurrency control.
 */
function parseIfMatch(req: Request): number {
  const raw = (req.header('If-Match') || '').trim();
  if (!raw) {
    throw ServiceValidationError.forField('If-Match', 'If-Match header is required', {
      operation: 'newsletter_publications_if_match',
      service: 'newsletter_publications_controller',
      path: req.path,
    });
  }
  const cleaned = raw.replace(/^W\//i, '').replace(/^"|"$/g, '');
  const version = Number(cleaned);
  if (!Number.isFinite(version) || !Number.isInteger(version) || version < 1) {
    throw ServiceValidationError.forField('If-Match', 'If-Match must be a positive integer version', {
      operation: 'newsletter_publications_if_match',
      service: 'newsletter_publications_controller',
      path: req.path,
    });
  }
  return version;
}
