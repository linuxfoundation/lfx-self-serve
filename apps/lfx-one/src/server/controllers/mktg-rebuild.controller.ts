// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX, MKTG_REBUILD_CHAIN_ID_REGEX, MKTG_REBUILD_DOWNSTREAM_KEYS, MKTG_REVISION_ID_REGEX } from '@lfx-one/shared/constants';
import { MktgRebuildAdvanceRequest, MktgRebuildRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgRebuildService } from '../services/mktg-rebuild.service';
import { ProjectService } from '../services/project.service';
import { isImpersonating } from '../utils/auth-helper';

export class MktgRebuildController {
  private readonly rebuild = new MktgRebuildService();
  private readonly projects = new ProjectService();

  public start(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.handle(req, res, next, 'start');
  }
  public advance(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.handle(req, res, next, 'advance');
  }
  public result(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.handle(req, res, next, 'result');
  }

  private async handle(req: Request, res: Response, next: NextFunction, method: 'start' | 'advance' | 'result'): Promise<void> {
    const operation = `mktg_rebuild_${method}`;
    const started = logger.startOperation(req, operation, {});
    try {
      if (isImpersonating(req)) throw new AuthorizationError('Rebuilding is unavailable while impersonating.');
      const body = req.body ?? {};
      const projectUid = body.project;
      if (typeof projectUid !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid))
        throw ServiceValidationError.forField('project', 'Choose a valid project before rebuilding.');
      if (method === 'start') {
        if (typeof body.frameworkRevisionId !== 'string' || !MKTG_REVISION_ID_REGEX.test(body.frameworkRevisionId))
          throw ServiceValidationError.forField('frameworkRevisionId', 'An approved current framework revision is required.');
      } else {
        if (typeof body.chainId !== 'string' || !MKTG_REBUILD_CHAIN_ID_REGEX.test(body.chainId))
          throw ServiceValidationError.forField('chainId', 'A valid rebuild identifier is required.');
        if (typeof body.ownerToken !== 'string' || !/^[a-f0-9]{64}$/.test(body.ownerToken))
          throw ServiceValidationError.forField('ownerToken', 'The rebuild owner token is required.');
        if (method === 'advance' && (!Number.isSafeInteger(body.stepIndex) || body.stepIndex < 0 || body.stepIndex >= MKTG_REBUILD_DOWNSTREAM_KEYS.length))
          throw ServiceValidationError.forField('stepIndex', 'Choose a valid rebuild step.');
      }
      const project = await this.projects.getProjectById(req, projectUid, true);
      if (!project.writer) throw new AuthorizationError('You need write access to this project to rebuild its assets.');
      if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) throw ServiceValidationError.forField('project', 'The resolved project is invalid.');
      let response;
      if (method === 'start') response = await this.rebuild.start(req, project, body.frameworkRevisionId);
      else if (method === 'advance') response = await this.rebuild.advance(req, project, body as MktgRebuildAdvanceRequest);
      else response = await this.rebuild.result(req, project, body as MktgRebuildRequest);
      if (method === 'result') logger.debug(req, operation, 'Read rebuild progress', { status: response.status, steps: response.steps.length });
      else logger.success(req, operation, started, { status: response.status, steps: response.steps.length });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
