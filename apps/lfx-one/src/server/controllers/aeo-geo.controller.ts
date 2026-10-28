// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '@lfx-one/shared/constants/mktg-run.constants';

import { AEO_GEO_INTAKE, MKTG_AGENTS, MKTG_ARTIFACT_PARTITION_REGEX, MKTG_DOCUMENT_ID_REGEX } from '@lfx-one/shared/constants';
import { Project } from '@lfx-one/shared/interfaces';
import { isAeoGeoAnswers, validateAeoGeoIntakeAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { AeoGeoService } from '../services/aeo-geo.service';
import { logger } from '../services/logger.service';
import { GuildService } from '../services/guild.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveUsername } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

/** Authenticated, writer-entitled form-only run endpoints. Handles always come from the catalog. */
export class AeoGeoController {
  private readonly service = new AeoGeoService();
  private readonly guild = new GuildService();
  private readonly projects = new ProjectService();

  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'aeo_geo_generate';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const { answers, feedback, priorVersion, project } = req.body ?? {};
      const validation = validateAeoGeoIntakeAnswers(answers);
      if (!validation.valid) {
        throw ServiceValidationError.forField('answers', validation.errors.join('; '), { operation });
      }
      if (feedback !== undefined || priorVersion !== undefined) {
        throw ServiceValidationError.forField('feedback', 'Every audit is a new run; reports cannot be revised.', { operation });
      }
      const scope = await this.writableProject(req, project);
      const handle = this.agentHandle();
      const result = await this.service.startGeneration(
        req,
        {
          ...(answers as Record<string, string>),
          project_name: scope.name,
          project_uid: scope.uid,
        },
        handle
      );
      logger.success(req, operation, start, { session_created: true });
      res.json({ ...result, ownerToken: createSessionOwnerToken(user, `aeo-geo:${scope.uid}:${result.sessionId}`) });
    } catch (error) {
      next(error);
    }
  }

  public async result(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'aeo_geo_result';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const { sessionId, ownerToken, project } = req.body ?? {};
      if (typeof sessionId !== 'string' || !sessionId.trim()) {
        throw ServiceValidationError.forField('sessionId', 'sessionId must be a non-empty string', { operation });
      }
      const partition = await this.writableProject(req, project);
      if (!verifySessionOwnerToken(typeof ownerToken === 'string' ? ownerToken : undefined, user, `aeo-geo:${partition.uid}:${sessionId.trim()}`)) {
        throw new AuthorizationError('You do not have permission to read this session.', { operation });
      }
      const result = await this.guild.resolveRunOutcome(req, sessionId.trim(), await this.service.getResult(req, sessionId.trim(), partition.uid));
      logger.success(req, operation, start, { status: result.status });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  public async answers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'aeo_geo_answers';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const { sessionId, ownerToken, project, documentId, answers } = req.body ?? {};
      if (typeof sessionId !== 'string' || !sessionId.trim() || typeof documentId !== 'string' || !MKTG_DOCUMENT_ID_REGEX.test(documentId)) {
        throw ServiceValidationError.forField('sessionId', 'A valid audit session and document are required.', { operation });
      }
      const scope = await this.writableProject(req, project);
      if (!verifySessionOwnerToken(typeof ownerToken === 'string' ? ownerToken : undefined, user, `aeo-geo:${scope.uid}:${sessionId.trim()}`)) {
        throw new AuthorizationError('You do not have permission to answer this session.', { operation });
      }
      if (!isAeoGeoAnswers(answers)) {
        throw ServiceValidationError.forField('answers', MKTG_ANSWERS_INCOMPLETE_MESSAGE, { operation });
      }
      const result = await this.service.sendAnswers(req, sessionId.trim(), documentId, scope.uid, answers, this.agentHandle());
      logger.success(req, operation, start, { answers: answers.length });
      res.json({ success: true, status: result.status });
    } catch (error) {
      next(error);
    }
  }

  private agentHandle(): string {
    const agent = MKTG_AGENTS.find((entry) => entry.id === AEO_GEO_INTAKE.agentId);
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) {
      throw ServiceValidationError.forField('agentId', 'The AEO/GEO agent is not available.');
    }
    return agent.guildAgentHandle;
  }

  private requireUser(req: Request): string {
    const user = getEffectiveUsername(req);
    if (!user) {
      throw new AuthenticationError('Could not identify the requesting user.');
    }
    return user;
  }

  private async writableProject(req: Request, value: unknown): Promise<Project> {
    if (typeof value !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(value.trim())) {
      throw ServiceValidationError.forField('project', 'Select a valid project before running an audit.');
    }
    const project = await this.projects.getProjectById(req, value.trim(), true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to run an audit.');
    }
    return project;
  }
}
