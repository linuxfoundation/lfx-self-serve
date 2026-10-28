// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_ANSWERS_INCOMPLETE_MESSAGE } from '@lfx-one/shared/constants/mktg-run.constants';

import { MEMBER_360_MAX_BYTES, MEMBER_360_MAX_TRACKERS, MKTG_ARTIFACT_PARTITION_REGEX } from '@lfx-one/shared/constants';
import { Member360Session } from '@lfx-one/shared/interfaces';
import { member360GenerateSchema, member360AnswersSchema } from '@lfx-one/shared/server';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { logger } from '../services/logger.service';
import { Member360Service } from '../services/member-360.service';
import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

export class Member360Controller {
  private readonly service = new Member360Service();
  private readonly runs = new MktgDocumentRunService();

  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'member_360_generate';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = getEffectiveSub(req);
      if (!user) throw new AuthenticationError('Sign in to run Member 360.', { operation, service: 'member_360' });
      const parsed = member360GenerateSchema.safeParse(req.body);
      if (!parsed.success || Buffer.byteLength(JSON.stringify(req.body)) > MEMBER_360_MAX_BYTES) {
        throw this.invalid('body', `Use the Member 360 form with a project, window and at most ${MEMBER_360_MAX_TRACKERS} trackers.`);
      }
      const project = await this.runs.resolveProject(req, parsed.data.project);
      const { discard, ...input } = parsed.data;
      await this.runs.assertSingleActiveOneOffRun(req, project, 'member-360', discard);
      const { sessionId, documentId } = await this.service.start(req, input);
      const runId = await this.runs.startForOneOff(req, 'member-360', project, sessionId);
      // Domain-separate this token from chat AND bind it to the entitled
      // project, preventing a session from being replayed into another partition.
      const response: Member360Session = {
        sessionId,
        ownerToken: createSessionOwnerToken(user, `member-360:${parsed.data.project}:${sessionId}`),
        documentId,
        runId,
      };
      logger.success(req, operation, start, {});
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  public async result(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'member_360_result';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = getEffectiveSub(req);
      if (!user) throw new AuthenticationError('Sign in to see this run.', { operation, service: 'member_360' });
      const { sessionId, ownerToken, project } = (req.body ?? {}) as Record<string, unknown>;
      if (
        typeof sessionId !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(sessionId) ||
        typeof project !== 'string' ||
        !MKTG_ARTIFACT_PARTITION_REGEX.test(project)
      ) {
        throw this.invalid('sessionId', 'A session and project are required.');
      }
      if (typeof ownerToken !== 'string' || !verifySessionOwnerToken(ownerToken, user, `member-360:${project}:${sessionId}`)) {
        throw new AuthorizationError('This run belongs to another user or project.', { operation, service: 'member_360' });
      }
      // Member 360's terminal utils require a session end, not the shared settled-error overlay.
      const response = await this.service.result(req, sessionId, project);
      await this.runs.recordResultBestEffort(req, sessionId, Member360Service.toRunResult(response), project);
      logger.success(req, operation, start, { status: response.status });
      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  public async answers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'member_360_answers';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = getEffectiveSub(req);
      if (!user) throw new AuthenticationError('Sign in to answer this run.', { operation, service: 'member_360' });
      const parsed = member360AnswersSchema.safeParse(req.body);
      if (!parsed.success) throw this.invalid('answers', MKTG_ANSWERS_INCOMPLETE_MESSAGE);
      const { project, sessionId, ownerToken, questionsId } = parsed.data;
      if (!verifySessionOwnerToken(ownerToken, user, `member-360:${project}:${sessionId}`)) {
        throw new AuthorizationError('This run belongs to another user or project.', { operation, service: 'member_360' });
      }
      const projectUid = await this.runs.resolveProject(req, project);
      await this.service.sendAnswers(req, parsed.data);
      await this.runs.resumeAfterQuestions(req, projectUid, sessionId, questionsId);
      logger.success(req, operation, start, { count: parsed.data.answers.length });
      res.set('Cache-Control', 'private, no-store').json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  private invalid(field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message, { operation: 'member_360', service: 'member_360' });
  }
}
