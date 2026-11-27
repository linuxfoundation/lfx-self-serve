// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ANSWERS_INCOMPLETE_MESSAGE, MKTG_RUN_QUESTIONS_ID_REGEX } from '@lfx-one/shared/constants/mktg-run.constants';

import { AEO_GEO_INTAKE, AEO_GEO_QUESTION_KEY_PREFIX, MKTG_AGENTS, MKTG_ARTIFACT_PARTITION_REGEX, MKTG_DOCUMENT_ID_REGEX } from '@lfx-one/shared/constants';
import { MktgRunAnswer, Project } from '@lfx-one/shared/interfaces';
import { isAeoGeoSubmittedAnswers, validateAeoGeoIntakeAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { AeoGeoService } from '../services/aeo-geo.service';
import { logger } from '../services/logger.service';
import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

/**
 * Authenticated, writer-entitled form-only run endpoints. Handles always come from the catalog.
 * Every audit is a tracked one-off run: one active run per creator and project, and the first answer to a questions turn wins.
 */
export class AeoGeoController {
  private readonly service = new AeoGeoService();
  private readonly runs = new MktgDocumentRunService();
  private readonly projects = new ProjectService();

  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'aeo_geo_generate';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const { answers, feedback, priorVersion, project, discard } = req.body ?? {};
      const validation = validateAeoGeoIntakeAnswers(answers);
      if (!validation.valid) {
        throw ServiceValidationError.forField('answers', validation.errors.join('; '), { operation });
      }
      if (feedback !== undefined || priorVersion !== undefined) {
        throw ServiceValidationError.forField('feedback', 'Every audit is a new run; reports cannot be revised.', { operation });
      }
      const scope = await this.writableProject(req, project);
      const handle = this.agentHandle();
      // Tracking storage and the creator's active slot are checked before any Guild session exists.
      await this.runs.resolveProject(req, scope.uid);
      await this.runs.assertSingleActiveOneOffRun(req, scope.uid, AEO_GEO_INTAKE.agentId, discard);
      const result = await this.service.startGeneration(
        req,
        {
          ...(answers as Record<string, string>),
          project_name: scope.name,
          project_uid: scope.uid,
        },
        handle
      );
      const runId = await this.runs.startForOneOff(req, AEO_GEO_INTAKE.agentId, scope.uid, result.sessionId);
      logger.success(req, operation, start, { session_created: true });
      res.json({ ...result, runId, ownerToken: createSessionOwnerToken(user, `aeo-geo:${scope.uid}:${result.sessionId}`) });
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
      // The tracker reads the same audit result and Guild outcome, and records the state every other read relies on.
      const result = await this.runs.ownedOneOffResult(req, partition.uid, AEO_GEO_INTAKE.agentId, sessionId.trim(), {});
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
      const { sessionId, ownerToken, project, documentId, questionsId, answers } = req.body ?? {};
      if (typeof sessionId !== 'string' || !sessionId.trim() || typeof documentId !== 'string' || !MKTG_DOCUMENT_ID_REGEX.test(documentId)) {
        throw ServiceValidationError.forField('sessionId', 'A valid audit session and document are required.', { operation });
      }
      const scope = await this.writableProject(req, project);
      if (!verifySessionOwnerToken(typeof ownerToken === 'string' ? ownerToken : undefined, user, `aeo-geo:${scope.uid}:${sessionId.trim()}`)) {
        throw new AuthorizationError('You do not have permission to answer this session.', { operation });
      }
      if (typeof questionsId !== 'string' || !MKTG_RUN_QUESTIONS_ID_REGEX.test(questionsId) || !isAeoGeoSubmittedAnswers(answers)) {
        throw ServiceValidationError.forField('answers', MKTG_ANSWERS_INCOMPLETE_MESSAGE, { operation });
      }
      this.agentHandle(); // Refuses the answers once the catalog no longer lists the agent as active.
      const session = sessionId.trim();
      await this.runs.assertRunOpen(req, scope.uid, AEO_GEO_INTAKE.agentId, session);
      const message = await this.service.prepareAnswers(req, session, documentId, scope.uid, questionsId, answers);
      // Only one request can claim this questions turn; every other one gets 409 MKTG_RUN_ANSWERED and sends nothing.
      const claimed: MktgRunAnswer[] = answers.map((answer) => ({
        key: `${AEO_GEO_QUESTION_KEY_PREFIX}${answer.id}`,
        text: answer.text,
        origin: answer.origin,
      }));
      await this.runs.claimSessionAnswers(req, scope.uid, session, questionsId, AEO_GEO_INTAKE.agentId, claimed);
      if (message !== null) await this.service.deliverAnswers(req, session, message, answers.length);
      logger.success(req, operation, start, { answers: answers.length });
      res.json({ success: true, status: 'pending' });
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

  /** The owner token keeps the username it has always been bound to; the run tracker binds the run to the effective subject. */
  private requireUser(req: Request): string {
    const user = getEffectiveUsername(req);
    if (!user || !getEffectiveSub(req)) {
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
