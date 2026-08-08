// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CreatePublicationRequest, UpdatePublicationRequest } from '@lfx-one/shared/interfaces';
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
   * GET /api/projects/:projectUid/newsletter-publications
   */
  public async listPublications(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_publications_list', { project_uid: projectUid });

    try {
      const result = await this.publicationsService.listPublications(req, projectUid);
      logger.success(req, 'newsletter_publications_list', startTime, { count: result.publications.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/projects/:projectUid/newsletter-publications
   */
  public async createPublication(req: Request, res: Response, next: NextFunction): Promise<void> {
    const projectUid = this.requireProjectUid(req);
    const startTime = logger.startOperation(req, 'newsletter_publication_create', { project_uid: projectUid });

    try {
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
    const projectUid = this.requireProjectUid(req);
    const publicationUid = this.requirePublicationUid(req);
    const startTime = logger.startOperation(req, 'newsletter_publication_get', { project_uid: projectUid, publication_id: publicationUid });

    try {
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
    const projectUid = this.requireProjectUid(req);
    const publicationUid = this.requirePublicationUid(req);
    const startTime = logger.startOperation(req, 'newsletter_publication_update', { project_uid: projectUid, publication_id: publicationUid });

    try {
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

    // At least one field should be present for an update
    if (Object.keys(payload).length === 0) {
      fieldErrors['payload'] = 'At least one field is required for update';
    }

    if (payload.name !== undefined && (typeof payload.name !== 'string' || payload.name.trim().length === 0)) {
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
