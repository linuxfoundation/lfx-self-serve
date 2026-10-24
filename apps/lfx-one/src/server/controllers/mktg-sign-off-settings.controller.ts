// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ServiceValidationError } from '../errors';
import { isImpersonating } from '../utils/auth-helper';
import { logger } from '../services/logger.service';
import { MktgSignOffSettingsService } from '../services/mktg-sign-off-settings.service';
import { ProjectService } from '../services/project.service';

/** Project writer boundary for both reads and writes; no subject or version token crosses HTTP. */
export class MktgSignOffSettingsController {
  private readonly projects = new ProjectService();
  private readonly settings = new MktgSignOffSettingsService();

  public getSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.respond(req, res, next, false);
  }
  public updateSettings(req: Request, res: Response, next: NextFunction): Promise<void> {
    return this.respond(req, res, next, true);
  }

  private async respond(req: Request, res: Response, next: NextFunction, change: boolean): Promise<void> {
    if (change && isImpersonating(req)) {
      next(new AuthorizationError('Sign-off settings cannot be changed while impersonating a user'));
      return;
    }
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? (req.body as Record<string, unknown>) : null;
    const mode = body?.['mode'];
    if (change && (!body || Object.keys(body).some((key) => key !== 'project' && key !== 'mode') || (mode !== 'single-writer' && mode !== 'two-role'))) {
      next(ServiceValidationError.forField('body', 'Only project and a valid sign-off mode are accepted.'));
      return;
    }
    const rawProject = change ? body?.['project'] : req.query['project'];
    const project = typeof rawProject === 'string' ? rawProject.trim() : '';
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      next(ServiceValidationError.forField('project', 'A single-segment project uid is required.'));
      return;
    }
    const operation = change ? 'mktg_sign_off_settings_update' : 'mktg_sign_off_settings_get';
    const started = logger.startOperation(req, operation, {});
    try {
      const resolved = await this.projects.getProjectById(req, project, true);
      if (!resolved.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(resolved.uid)) throw new AuthorizationError('Write access to this project is required.');
      const response =
        change && (mode === 'single-writer' || mode === 'two-role')
          ? await this.settings.updateMode(req, resolved.uid, mode)
          : await this.settings.readSettings(req, resolved.uid);
      res.setHeader('Cache-Control', 'private, no-store');
      logger.success(req, operation, started, {});
      res.json(response);
    } catch (error) {
      next(error);
    }
  }
}
