// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  BOILERPLATES_INTAKE,
  BRAND_KIT_INTAKE,
  FAQ_INTAKE,
  MKTG_AGENTS,
  MKTG_AGENT_INTAKES,
  MKTG_KIT_FRAMEWORK_AGENT_ID,
  MKTG_KIT_FRAMEWORK_KEY,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REBUILD_KEY_PREFIX,
  MKTG_REBUILD_TTL_MS,
} from '@lfx-one/shared/constants';
import {
  MktgRebuildAdvanceRequest,
  MktgRebuildRecord,
  MktgRebuildRequest,
  MktgRebuildResponse,
  MktgRebuildStoredStep,
  MktgRevisionRef,
  MktgRunAnswer,
  Project,
} from '@lfx-one/shared/interfaces';
import {
  findMktgDocumentType,
  mktgRebuildDocumentTypes,
  readMktgFrameworkRef,
  validateBoilerplatesAnswers,
  validateBoilerplatesIntakeAnswers,
  validateBrandKitAnswers,
  validateBrandKitIntakeAnswers,
  validateFaqAnswers,
  validateFaqIntakeAnswers,
} from '@lfx-one/shared/utils';
import { Request } from 'express';
import { randomUUID } from 'node:crypto';

import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  MicroserviceError,
  PreconditionFailedError,
  ResourceNotFoundError,
  ServiceValidationError,
} from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { createSessionOwnerToken, verifySessionOwnerToken } from '../utils/mktg-session-token.util';
import { BoilerplatesService } from './boilerplates.service';
import { BrandKitService } from './brand-kit.service';
import { FaqService } from './faq.service';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ObjectStoreService } from './object-store.service';

/** Durable, browser-driven sequencing. No background worker or in-process run state. */
export class MktgRebuildService {
  private readonly store = new ObjectStoreService();
  private readonly documents = new MktgDocumentStoreService();
  private readonly boilerplates = new BoilerplatesService();
  private readonly faq = new FaqService();
  private readonly brandKit = new BrandKitService();

  public async start(req: Request, project: Project, frameworkRevisionId: string): Promise<MktgRebuildResponse> {
    this.owner(req);
    const listing = await this.documents.listDocuments(req, project.uid, [MKTG_KIT_FRAMEWORK_KEY, ...mktgRebuildDocumentTypes().map((type) => type.agentKey)]);
    const framework = listing.approvedFramework;
    if (!framework || framework.revisionId !== frameworkRevisionId) throw this.changedFramework();
    const types = mktgRebuildDocumentTypes().filter(
      (type) => listing.groups.find((group) => group.type.agentKey === type.agentKey)?.documents[0]?.needsRebuild
    );
    if (!types.length) throw new ConflictError('Nothing needs rebuilding. Reload the family.', 'MKTG_NOTHING_STALE');
    // Validate every step's required project prefill before any Guild side effect.
    const bytes = await this.frameworkBytes(req, project.uid, framework);
    for (const type of types) this.intake(project, type.catalogAgentId ?? '', bytes);
    const record: MktgRebuildRecord = {
      project: project.uid,
      chainId: randomUUID(),
      createdAt: new Date().toISOString(),
      framework,
      status: 'running',
      steps: types.map((type) => ({ agentId: type.catalogAgentId ?? '', agentKey: type.agentKey, status: 'queued', activity: [] })),
    };
    if (!(await this.store.putPrivateObjectIfAbsent(req, 'marketing-os-artifacts', this.key(record), this.input(record))))
      throw new PreconditionFailedError('A rebuild with this identifier already exists. Try again.');
    return this.advance(req, project, { ...this.response(req, record), stepIndex: 0 });
  }

  public async advance(req: Request, project: Project, request: MktgRebuildAdvanceRequest): Promise<MktgRebuildResponse> {
    return this.withChain(req, project, request, async (record) => {
      if (record.status === 'complete' || record.status === 'failed') return;
      const index = record.steps.findIndex((step) => step.status !== 'draft');
      const step = record.steps[index];
      if (!step || request.stepIndex !== index) throw new ConflictError('The rebuild step changed. Reload its progress.', 'MKTG_REBUILD_STEP_CHANGED');
      if (step.status === 'questions') {
        if (request.questionsId !== step.questionsId) throw new ConflictError('The questions changed. Reload their answers.', 'MKTG_REBUILD_QUESTIONS_CHANGED');
        const answers = this.answers(step, request.answers);
        if (!step.sessionId) throw this.invalidRecord();
        const handle = this.handle(step.agentId);
        try {
          await this.answer(req, step, answers, handle);
          step.answeredQuestionsId = step.questionsId;
          delete step.questions;
          delete step.questionsId;
          step.status = 'running';
          record.status = 'running';
        } catch (err) {
          this.fail(req, record, step, err);
        }
      } else if (step.status === 'queued') {
        try {
          const bytes = await this.frameworkBytes(req, project.uid, record.framework);
          const answers = this.intake(project, step.agentId, bytes);
          const handle = this.handle(step.agentId);
          if (step.agentId === BOILERPLATES_INTAKE.agentId)
            step.sessionId = await this.boilerplates.startGeneration(req, answers, project.uid, handle, record.framework);
          else if (step.agentId === FAQ_INTAKE.agentId)
            step.sessionId = await this.faq.startGeneration(req, answers, [], project.uid, handle, record.framework);
          else if (step.agentId === BRAND_KIT_INTAKE.agentId)
            step.sessionId = await this.brandKit.startGeneration(req, answers, [], project.uid, handle, record.framework);
          else throw this.invalidRecord();
          step.status = 'running';
        } catch (err) {
          this.fail(req, record, step, err);
        }
      }
      // A duplicate advance while this same step runs has no side effects.
    });
  }

  public async result(req: Request, project: Project, request: MktgRebuildRequest): Promise<MktgRebuildResponse> {
    return this.withChain(req, project, request, async (record) => {
      if (record.status !== 'running') return;
      const step = record.steps.find((entry) => entry.status !== 'draft');
      if (!step || step.status !== 'running' || !step.sessionId) return;
      try {
        const result = await this.poll(req, step, project.uid);
        step.activity = result.activity ?? [];
        if (result.status === 'refused') {
          step.status = 'failed';
          step.message = result.reply || 'The agent declined this rebuild.';
          record.status = 'failed';
        } else if (result.status === 'questions' && result.questionsId !== step.answeredQuestionsId) {
          step.status = 'questions';
          step.questions = result.questions;
          step.questionsId = result.questionsId;
          record.status = 'questions';
        } else if (result.status === 'ready' && result.persistence) {
          // Never start the next agent before the previous Draft is actually committed.
          step.status = 'draft';
          step.persistence = result.persistence;
          if (record.steps.every((entry) => entry.status === 'draft')) record.status = 'complete';
        }
      } catch (err) {
        // Guild wraps transport/timeouts as 502/504. Only this read/persist poll is retryable;
        // never blindly retry starting a session or sending an answers turn.
        if (err instanceof MicroserviceError && (err.statusCode === 0 || err.statusCode === 408 || err.statusCode === 429 || err.statusCode >= 500))
          logger.warning(req, 'mktg_rebuild_poll', 'Transient poll failure; the same step remains running for the next bounded poll', {
            agent: step.agentId,
            err,
          });
        else this.fail(req, record, step, err);
      }
    });
  }

  private async frameworkBytes(req: Request, project: string, reference: MktgRevisionRef): Promise<string> {
    const type = findMktgDocumentType(MKTG_KIT_FRAMEWORK_KEY);
    if (!type) throw this.invalidRecord();
    const selected = await this.documents.readExportRevision(req, project, type, MKTG_LIVING_DOCUMENT_ID, reference);
    if (!selected || selected.revision.record.bundle.format !== 'json') throw this.changedFramework();
    return selected.revision.record.bundle.markdown;
  }

  private intake(project: Project, agentId: string, framework: string): Record<string, string> {
    const intake = MKTG_AGENT_INTAKES[agentId];
    if (!intake) throw this.invalidRecord();
    const answers: Record<string, string> = {};
    for (const field of intake.fields) {
      let value = '';
      switch (field.prefill) {
        case 'project-name':
          value = project.name ?? '';
          break;
        case 'website-url':
          value = project.website_url ?? '';
          break;
        case 'project-description':
          value = project.description ?? '';
          break;
        case 'repository-url':
          value = project.repository_url ?? '';
          break;
      }
      value = value.trim();
      if (field.oneLine) value = value.replace(/\s+/g, ' ');
      if (value) answers[field.key] = value;
    }
    for (const attachment of intake.attachments ?? []) if (attachment.sourceAgentId === MKTG_KIT_FRAMEWORK_AGENT_ID) answers[attachment.answerKey] = framework;
    const validation = agentId === BOILERPLATES_INTAKE.agentId ? validateBoilerplatesIntakeAnswers(answers) : this.otherIntakeValidation(agentId, answers);
    if (!validation.valid)
      throw ServiceValidationError.forField('project', `Update the project's required source fields before rebuilding: ${validation.errors.join('; ')}`);
    return answers;
  }

  private otherIntakeValidation(agentId: string, answers: Record<string, string>) {
    if (agentId === FAQ_INTAKE.agentId) return validateFaqIntakeAnswers(answers);
    if (agentId === BRAND_KIT_INTAKE.agentId) return validateBrandKitIntakeAnswers(answers);
    throw this.invalidRecord();
  }

  private answers(step: MktgRebuildStoredStep, raw: unknown): MktgRunAnswer[] {
    let validation;
    if (step.agentId === BOILERPLATES_INTAKE.agentId) validation = validateBoilerplatesAnswers(raw);
    else if (step.agentId === FAQ_INTAKE.agentId) validation = validateFaqAnswers(raw);
    else validation = validateBrandKitAnswers(raw);
    if (!validation.valid) throw ServiceValidationError.forField('answers', validation.errors.join('; '));
    const answers = raw as MktgRunAnswer[];
    const keys = step.questions?.map((question) => question.key) ?? [];
    if (answers.length !== keys.length || answers.some((answer) => !keys.includes(answer.key)))
      throw ServiceValidationError.forField('answers', 'Answer every question in this turn, and only those questions.');
    return answers.map((answer) => ({ key: answer.key, text: answer.text.trim(), origin: answer.origin }));
  }

  private handle(agentId: string): string {
    const agent = MKTG_AGENTS.find((entry) => entry.id === agentId && entry.status === 'active');
    if (!agent || agent.status !== 'active' || !agent.guildAgentHandle)
      throw new ConflictError('This rebuild agent is not available.', 'MKTG_REBUILD_AGENT_UNAVAILABLE');
    return agent.guildAgentHandle;
  }

  private poll(req: Request, step: MktgRebuildStoredStep, project: string) {
    const session = step.sessionId ?? '';
    if (step.agentId === BOILERPLATES_INTAKE.agentId) return this.boilerplates.getResult(req, session, project);
    if (step.agentId === FAQ_INTAKE.agentId) return this.faq.getResult(req, session, project);
    return this.brandKit.getResult(req, session, project);
  }

  private answer(req: Request, step: MktgRebuildStoredStep, answers: MktgRunAnswer[], handle: string) {
    const session = step.sessionId ?? '';
    if (step.agentId === BOILERPLATES_INTAKE.agentId) return this.boilerplates.sendAnswers(req, session, answers, handle);
    if (step.agentId === FAQ_INTAKE.agentId) return this.faq.sendAnswers(req, session, answers, handle);
    return this.brandKit.sendAnswers(req, session, answers, handle);
  }

  /** Claim with CAS BEFORE any Guild call; another tab/pod cannot start or answer twice. */
  private async withChain(
    req: Request,
    project: Project,
    request: MktgRebuildRequest,
    work: (record: MktgRebuildRecord) => Promise<void>
  ): Promise<MktgRebuildResponse> {
    const owner = this.owner(req);
    if (!verifySessionOwnerToken(request.ownerToken, owner, this.binding(project.uid, request.chainId)))
      throw new AuthorizationError('This rebuild belongs to another session.');
    const key = this.key({ project: project.uid, chainId: request.chainId });
    const saved = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
    if (!saved) throw new ResourceNotFoundError('Rebuild', request.chainId);
    const record = this.read(saved.body, project.uid, request.chainId);
    if (record.operationId)
      throw new ConflictError(
        'A rebuild operation is in progress or was interrupted. Do not resubmit it; reload the family to inspect saved Drafts.',
        'MKTG_REBUILD_IN_FLIGHT'
      );
    if (!saved.etag) throw this.invalidRecord();
    record.operationId = randomUUID();
    if (!(await this.store.putConditionalObject(req, 'marketing-os-artifacts', key, { ...this.input(record), ifMatch: saved.etag }, true)))
      throw new PreconditionFailedError('Rebuild progress changed. Reload it.');
    try {
      await work(record);
    } catch (error) {
      // Validation failures before a side effect release the claim but retain the turn.
      await this.finish(req, record);
      throw error;
    }
    await this.finish(req, record);
    return this.response(req, record);
  }

  private async finish(req: Request, record: MktgRebuildRecord): Promise<void> {
    const key = this.key(record);
    const saved = await this.store.getPrivateObject(req, 'marketing-os-artifacts', key);
    if (!saved?.etag || JSON.parse(saved.body).operationId !== record.operationId)
      throw new PreconditionFailedError('Rebuild ownership changed. Reload the family.');
    delete record.operationId;
    if (!(await this.store.putConditionalObject(req, 'marketing-os-artifacts', key, { ...this.input(record), ifMatch: saved.etag }, true)))
      throw new PreconditionFailedError('Rebuild progress could not be saved. Reload the family.');
  }

  private read(body: string, project: string, chainId: string): MktgRebuildRecord {
    let record: MktgRebuildRecord;
    try {
      record = JSON.parse(body);
    } catch {
      throw this.invalidRecord();
    }
    const types = mktgRebuildDocumentTypes();
    if (
      !record ||
      record.project !== project ||
      record.chainId !== chainId ||
      !readMktgFrameworkRef(record.framework) ||
      !Array.isArray(record.steps) ||
      !record.steps.length ||
      record.steps.some((step) => !types.some((type) => type.agentKey === step.agentKey && type.catalogAgentId === step.agentId))
    )
      throw this.invalidRecord();
    const created = Date.parse(record.createdAt);
    if (!Number.isFinite(created) || Date.now() - created > MKTG_REBUILD_TTL_MS)
      throw new ConflictError('This rebuild expired. Reload the family to inspect its Drafts.', 'MKTG_REBUILD_EXPIRED');
    return record;
  }

  private response(req: Request, record: MktgRebuildRecord): MktgRebuildResponse {
    return {
      project: record.project,
      chainId: record.chainId,
      framework: record.framework,
      status: record.status,
      ownerToken: createSessionOwnerToken(this.owner(req), this.binding(record.project, record.chainId)),
      steps: record.steps.map((step) => ({
        agentId: step.agentId,
        agentKey: step.agentKey,
        status: step.status,
        activity: step.activity,
        ...(step.questions && { questions: step.questions, questionsId: step.questionsId }),
        ...(step.persistence && { persistence: step.persistence }),
        ...(step.message && { message: step.message }),
      })),
    };
  }

  private owner(req: Request): string {
    const owner = getEffectiveSub(req);
    if (!owner) throw new AuthenticationError('Could not identify the requesting user.');
    return owner;
  }
  private binding(project: string, chainId: string): string {
    return `rebuild:${project}:${chainId}`;
  }
  private key(record: { project: string; chainId: string }): string {
    return `${MKTG_REBUILD_KEY_PREFIX}/${record.project}/${record.chainId}.json`;
  }
  private input(record: MktgRebuildRecord) {
    return { body: Buffer.from(JSON.stringify(record)), contentType: 'application/json; charset=utf-8', cacheControl: 'private, no-store' };
  }
  private changedFramework(): ConflictError {
    return new ConflictError('The approved framework changed. Reload before rebuilding.', 'MKTG_APPROVED_CURRENT_CHANGED');
  }
  private invalidRecord(): MicroserviceError {
    return new MicroserviceError('Rebuild progress is unreadable.', 502, 'MKTG_REBUILD_UNREADABLE');
  }
  private fail(req: Request, record: MktgRebuildRecord, step: MktgRebuildStoredStep, err: unknown): void {
    logger.warning(req, 'mktg_rebuild_step', 'Rebuild stopped; earlier Drafts are retained', { agent: step.agentId, err });
    step.status = 'failed';
    step.message = 'This rebuild step failed. Earlier Drafts are saved. Reload the family before trying again.';
    if (err instanceof ConflictError)
      step.message =
        err.code === 'MKTG_APPROVED_CURRENT_CHANGED'
          ? 'The approved framework changed. Earlier Drafts are saved. Reload the family before rebuilding again.'
          : err.message;
    record.status = 'failed';
  }
}
