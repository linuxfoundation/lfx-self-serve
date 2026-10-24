// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_REQUEST_ID_REGEX } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgRequestsService } from '../services/mktg-requests.service';
import { ProjectService } from '../services/project.service';

export class MktgRequestsController {
  private readonly requests = new MktgRequestsService();
  private readonly projects = new ProjectService();

  public async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_requests_list';
    const start = logger.startOperation(req, operation, {});
    try {
      const project = await this.resolveRequestsProject(req, this.readProject(req.query['project']), operation);
      const result = await this.requests.list(req, project);
      logger.success(req, operation, start, { project, count: result.requests.length });
      res.json(result);
    } catch (error) {
      return next(error);
    }
  }

  public async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_requests_create';
    const start = logger.startOperation(req, operation, {});
    try {
      const body = this.requests.readCreate(req.body);
      const project = await this.resolveRequestsProject(req, body.project, operation);
      const result = await this.requests.create(req, project, body);
      logger.success(req, operation, start, { project, requestId: result.id });
      res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  }

  public async changeState(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_requests_change_state';
    const start = logger.startOperation(req, operation, {});
    try {
      const id = req.params['id'];
      if (typeof id !== 'string' || !MKTG_REQUEST_ID_REGEX.test(id)) throw ServiceValidationError.forField('id', 'Invalid request id.');
      const body = this.requests.readState(req.body);
      const project = await this.resolveRequestsProject(req, body.project, operation);
      const result = await this.requests.changeState(req, project, id, body);
      logger.success(req, operation, start, { project, requestId: id });
      res.json(result);
    } catch (error) {
      return next(error);
    }
  }

  private readProject(value: unknown): string {
    if (typeof value !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(value))
      throw ServiceValidationError.forField('project', 'project is required and must be a single-segment project uid.');
    return value;
  }

  /** One entitlement seam to widen later. Storage uses ONLY the server-resolved uid. */
  private async resolveRequestsProject(req: Request, projectUid: string, operation: string): Promise<string> {
    const project = await this.projects.getProjectById(req, projectUid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to use its Marketing requests.', {
        operation,
        service: 'mktg_requests_controller',
        path: req.path,
      });
    }
    return project.uid;
  }
}
