// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  LINKEDIN_POST_INTAKE,
  LINKEDIN_SHARE_LINK_ANSWER_KEY,
  LINKEDIN_SOURCE_MAX_WORDS,
  MKTG_DOCUMENT_ID_REGEX,
  MKTG_AGENTS,
  MKTG_ARTIFACT_PARTITION_REGEX,
} from '@lfx-one/shared/constants';
import { LinkedinProfileInput, Project } from '@lfx-one/shared/interfaces';
import { isLinkedinProfile, isLinkedinSetup, normalizeLinkedinShareAnswers, normalizeLinkedinShareLink, validLinkedinAnswers } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, AuthorizationError, ServiceValidationError } from '../errors';
import { GuildService } from '../services/guild.service';
import { LinkedinPostService } from '../services/linkedin-post.service';
import { LinkedinProfileService } from '../services/linkedin-profile.service';
import { logger } from '../services/logger.service';
import { MktgDocumentStoreService } from '../services/mktg-document-store.service';
import { MktgDocumentRunService } from '../services/mktg-document-run.service';
import { MktgLastIntakeService } from '../services/mktg-last-intake.service';
import { ProjectService } from '../services/project.service';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';

/** Identity from the authenticated session only; every run also requires project writer access. */
export class LinkedinPostController {
  private readonly posts = new LinkedinPostService();
  private readonly guild = new GuildService();
  private readonly profiles = new LinkedinProfileService();
  private readonly projects = new ProjectService();
  private readonly documents = new MktgDocumentStoreService();
  private readonly runs = new MktgDocumentRunService();
  private readonly lastIntake = new MktgLastIntakeService();

  public async getProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'get_linkedin_profile';
    const start = logger.startOperation(req, operation, {});
    try {
      const profile = await this.profiles.read(req, this.requireUser(req));
      logger.success(req, operation, start, { found: !!profile });
      res.set('Cache-Control', 'private, no-store').json({ profile });
    } catch (error) {
      next(error);
    }
  }

  public async saveProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_linkedin_profile';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const body = this.body(req);
      const setup = body['setup'];
      const profile = body['profile'];
      let input: LinkedinProfileInput;
      if (setup !== undefined) {
        if (profile !== undefined || !isLinkedinSetup(setup)) throw ServiceValidationError.forField('setup', 'Send only complete setup answers.');
        input = { setup };
      } else {
        if (!isLinkedinProfile(profile)) throw ServiceValidationError.forField('profile', 'A complete profile with fields up to 4,000 characters is required.');
        input = { profile };
      }
      const saved = await this.profiles.saveFromInput(req, user, input);
      logger.success(req, operation, start, {});
      res.set('Cache-Control', 'private, no-store').json({ profile: saved });
    } catch (error) {
      next(error);
    }
  }

  public async deleteProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'delete_linkedin_profile';
    const start = logger.startOperation(req, operation, {});
    try {
      await this.profiles.delete(req, this.requireUser(req));
      logger.success(req, operation, start, {});
      res.set('Cache-Control', 'private, no-store').status(204).end();
    } catch (error) {
      next(error);
    }
  }

  public async generate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'linkedin_generate';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const body = this.body(req);
      if (Object.keys(body).some((key) => !['answers', 'setup', 'project'].includes(key)))
        throw ServiceValidationError.forField('body', 'Only source, setup and project inputs are accepted.');
      if (!body['answers'] || typeof body['answers'] !== 'object' || Array.isArray(body['answers']))
        throw ServiceValidationError.forField('answers', 'Content source is required.');
      const answers = body['answers'] as Record<string, unknown>;
      if (
        Object.keys(answers).some(
          (key) => !['content_source', 'content_text', 'content_url', 'content_file_name', 'content_file_base64', LINKEDIN_SHARE_LINK_ANSWER_KEY].includes(key)
        )
      )
        throw ServiceValidationError.forField('answers', 'Unexpected content input.');
      const setup = body['setup'];
      if (setup !== undefined && !isLinkedinSetup(setup)) throw ServiceValidationError.forField('setup', 'Complete the required profile fields.');
      const project = await this.writableProject(req, body['project']);
      await this.runs.resolveProject(req, project.uid);
      const result = await this.posts.start(req, user, answers, setup, this.routingHandle(), project);
      const runId = await this.runs.startForOneOff(req, LINKEDIN_POST_INTAKE.agentId, project.uid, result.sessionId, {
        answers: result.answers,
        sourceWords: result.source.words,
      });
      logger.success(req, operation, start, {});
      res.set('Cache-Control', 'private, no-store').json({ ...result, runId, ownerToken: createSessionOwnerToken(user, result.sessionId) });
      // Separate from private run tracking: never delay/fail an accepted Generate for history.
      const scalar: Record<string, string> = {};
      for (const key of LINKEDIN_POST_INTAKE.lastIntakeFields ?? []) {
        if (key === 'content_text' && answers['content_source'] !== 'text') continue;
        if (key === 'content_url' && answers['content_source'] !== 'url') continue;
        const value = answers[key];
        if (typeof value === 'string') scalar[key] = value;
      }
      scalar[LINKEDIN_SHARE_LINK_ANSWER_KEY] = result.answers?.[LINKEDIN_SHARE_LINK_ANSWER_KEY] ?? '';
      void this.lastIntake
        .recordStartBestEffort(req, { project: project.uid, agentId: LINKEDIN_POST_INTAKE.agentId, runId, answers: scalar, documentCount: 0, logoCount: 0 })
        .catch(() => {
          logger.warning(req, 'mktg_last_intake_write', 'Run accepted, but scalar intake history could not be saved');
        });
    } catch (error) {
      next(error);
    }
  }

  public async result(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'linkedin_result';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const body = this.body(req);
      const sessionId = this.ownedSession(user, body);
      const answers = body['answers'] === undefined ? undefined : normalizeLinkedinShareAnswers(body['answers']);
      if (answers === null) throw ServiceValidationError.forField('answers', 'Only a valid link-to-share answer is accepted.');
      const sourceWords = body['sourceWords'] ?? 0;
      if (typeof sourceWords !== 'number' || !Number.isInteger(sourceWords) || sourceWords < 0 || sourceWords > LINKEDIN_SOURCE_MAX_WORDS)
        throw ServiceValidationError.forField('sourceWords', 'Invalid source word count.');
      const project = await this.writableProject(req, body['project']);
      const result = await this.guild.resolveRunOutcome(req, sessionId, await this.posts.result(req, user, sessionId, project.uid, answers, sourceWords));
      await this.runs.recordResultBestEffort(req, sessionId, result, project.uid);
      logger.success(req, operation, start, { status: result.status });
      res.set('Cache-Control', 'private, no-store').json(result);
    } catch (error) {
      next(error);
    }
  }

  /** The same answers body/owner-token protocol as main's run endpoints. */
  public async answer(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'answer_linkedin_questions';
    const start = logger.startOperation(req, operation, {});
    try {
      const user = this.requireUser(req);
      const body = this.body(req);
      if (Object.keys(body).some((key) => !['sessionId', 'ownerToken', 'project', 'questionsId', 'answers'].includes(key)))
        throw ServiceValidationError.forField('body', 'Unexpected answer input.');
      const sessionId = this.ownedSession(user, body);
      const questionsId = body['questionsId'];
      const answers = body['answers'];
      if (typeof questionsId !== 'string' || !/^[a-f0-9]{64}$/.test(questionsId) || !validLinkedinAnswers(answers))
        throw ServiceValidationError.forField('answers', 'Send valid answers to the current questions.');
      const project = await this.writableProject(req, body['project']);
      await this.posts.sendAnswers(req, sessionId, questionsId, answers, this.routingHandle());
      await this.runs.resumeAfterQuestions(req, project.uid, sessionId, questionsId);
      logger.success(req, operation, start, { answers: answers.length });
      res.set('Cache-Control', 'private, no-store').json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  public async saveShareLink(req: Request, res: Response, next: NextFunction): Promise<void> {
    const operation = 'update_linkedin_share_link';
    const start = logger.startOperation(req, operation, {});
    try {
      this.requireUser(req);
      const body = this.body(req);
      const documentId = req.params['documentId'];
      if (typeof documentId !== 'string' || !MKTG_DOCUMENT_ID_REGEX.test(documentId))
        throw ServiceValidationError.forField('documentId', 'Select a run document.');
      if (Object.keys(body).some((key) => !['project', 'share_link'].includes(key)) || typeof body['share_link'] !== 'string')
        throw ServiceValidationError.forField('body', 'Send only project and share_link.');
      const link = normalizeLinkedinShareLink(body['share_link']);
      if (link === null) throw ServiceValidationError.forField('share_link', 'Enter one HTTPS link or leave it empty.');
      const project = await this.writableProject(req, body['project']);
      const result = await this.documents.saveLinkedinShareLink(req, project.uid, documentId, link);
      logger.success(req, operation, start, {});
      res.set('Cache-Control', 'private, no-store').json(result);
    } catch (error) {
      next(error);
    }
  }

  private ownedSession(user: string, body: Record<string, unknown>): string {
    const sessionId = body['sessionId'];
    const ownerToken = body['ownerToken'];
    if (typeof sessionId !== 'string' || !sessionId.trim() || sessionId.length > 200)
      throw ServiceValidationError.forField('sessionId', 'A session id is required.');
    if (!verifySessionOwnerToken(typeof ownerToken === 'string' ? ownerToken : undefined, user, sessionId))
      throw new AuthorizationError('You do not have permission to read this session.');
    return sessionId;
  }

  private routingHandle(): string {
    const agent = MKTG_AGENTS.find((entry) => entry.id === LINKEDIN_POST_INTAKE.agentId);
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle) throw ServiceValidationError.forField('agentId', 'The LinkedIn agent is unavailable.');
    return agent.guildAgentHandle;
  }

  private body(req: Request): Record<string, unknown> {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) throw ServiceValidationError.forField('body', 'A JSON object is required.');
    return req.body as Record<string, unknown>;
  }
  private requireUser(req: Request): string {
    const user = getEffectiveSub(req);
    if (!user) throw new AuthenticationError('Could not identify the requesting user.');
    return user;
  }
  private async writableProject(req: Request, value: unknown): Promise<Project> {
    if (typeof value !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(value)) throw ServiceValidationError.forField('project', 'Select a valid project.');
    const project = await this.projects.getProjectById(req, value, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid))
      throw new AuthorizationError('You need write access to this project to draft a post.');
    return project;
  }
}
