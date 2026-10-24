// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';
import { AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { MktgAccessService } from '../services/mktg-access.service';
import { ProjectService } from '../services/project.service';

export class MktgAccessController {
  private readonly projects = new ProjectService();
  private readonly access = new MktgAccessService(this.projects);

  public async read(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'mktg_access_read';
    const start = logger.startOperation(req, operation, {});
    try {
      const projectUid = req.query['project'];
      if (typeof projectUid !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid))
        throw ServiceValidationError.forField('project', 'project is required and must be a single-segment project uid.');
      const project = await this.resolveAccessProject(req, projectUid, operation);
      const response = await this.access.read(req, project);
      logger.success(req, operation, start, { project, writers: response.writers.length });
      res.json(response);
    } catch (error) {
      return next(error);
    }
  }

  /** Independent of Requests so this child can merge alone. */
  private async resolveAccessProject(req: Request, projectUid: string, operation: string): Promise<string> {
    const project = await this.projects.getProjectById(req, projectUid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid))
      throw new AuthorizationError('You need write access to this project to see its Marketing access.', {
        operation,
        service: 'mktg_access_controller',
        path: req.path,
      });
    return project.uid;
  }
}
