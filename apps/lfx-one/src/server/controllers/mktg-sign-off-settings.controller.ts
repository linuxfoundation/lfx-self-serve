// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import type { MktgProjectRoles, MktgProjectSignOffSettingsResponse } from '@lfx-one/shared/interfaces';
import type { NextFunction, Request, Response } from 'express';

import { AuthorizationError, ConflictError, ServiceValidationError } from '../errors';
import { isImpersonating } from '../utils/auth-helper';
import { logger } from '../services/logger.service';
import { MktgProjectRolesService } from '../services/mktg-project-roles.service';
import { MktgSignOffSettingsService } from '../services/mktg-sign-off-settings.service';
import { ProjectService } from '../services/project.service';

/** Project writer boundary for both reads and writes; no subject or version token crosses HTTP. */
export class MktgSignOffSettingsController {
  private readonly projects = new ProjectService();
  private readonly settings = new MktgSignOffSettingsService();
  private readonly roles = new MktgProjectRolesService();

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
      const snapshot = await this.settings.readSnapshot(req, resolved.uid);
      const roles = await this.roles.rolesOf(req, resolved.uid);
      const enable = this.enableState(roles);
      if (change && mode === 'two-role' && !enable.canEnable)
        throw new ConflictError(enable.reason ?? 'Sign-off cannot be enabled.', 'MKTG_SIGN_OFF_CANNOT_ENABLE');
      let record = snapshot.record;
      if (change && (mode === 'single-writer' || mode === 'two-role')) record = await this.settings.write(req, resolved.uid, mode, snapshot);
      const response: MktgProjectSignOffSettingsResponse = {
        mode: record?.mode ?? 'single-writer',
        roles: { ed: roles.ed ? { name: roles.ed.name } : null, tocChair: roles.tocChair ? { name: roles.tocChair.name } : null },
        ...enable,
      };
      res.setHeader('Cache-Control', 'private, no-store');
      logger.success(req, operation, started, {});
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  private enableState(roles: MktgProjectRoles): Pick<MktgProjectSignOffSettingsResponse, 'canEnable' | 'reason'> {
    if (!roles.ed?.subject) return { canEnable: false, reason: 'The executive director role could not be resolved.' };
    if (!roles.tocChair?.subject) return { canEnable: false, reason: 'No TOC chair is visible to you, or the role could not be resolved.' };
    if (this.approversCanWriteProject() !== true) return { canEnable: false, reason: 'Approver access policy is awaiting confirmation.' };
    return { canEnable: true };
  }

  /** B6 intentionally UNIMPLEMENTED: no inferred grants, new FGA checks or role policy before its ruling. */
  private approversCanWriteProject(): boolean | null {
    return null;
  }
}
