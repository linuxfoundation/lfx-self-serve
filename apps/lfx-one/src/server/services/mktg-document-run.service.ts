// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_ID_REGEX,
  MKTG_RUN_POLL,
  MKTG_RUN_QUESTIONS_ID_REGEX,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_STARTED_RUN_PREFIX,
  MKTG_STARTED_RUN_SCHEMA,
  MKTG_STARTED_RUN_STATE_ORDER,
  MKTG_STARTED_RUN_FAILURE_BYTES,
  BRAND_KIT_INTAKE,
  FOUNDATION_MESSAGE_INTAKE,
  BOILERPLATES_INTAKE,
  FAQ_INTAKE,
  ICP_INTAKE,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentAgentKey,
  MktgDocumentRunProgress,
  MktgRunResultResponse,
  MktgStartedRunRecord,
  MktgStoredDocumentRunState,
  MktgStoredStartedRun,
} from '@lfx-one/shared/interfaces';
import {
  mktgDocumentLocationOfReceipt,
  findMktgRunIntake,
  mktgRunProgress,
  isMktgRunClosed,
  isMktgRunTerminal,
  isMktgRunAttemptId,
  mktgRunRenewAt,
} from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { BrandKitService } from './brand-kit.service';
import { BoilerplatesService } from './boilerplates.service';
import { FoundationMessageService } from './foundation-message.service';
import { FaqService } from './faq.service';
import { IcpService } from './icp.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';

/** Private session-keyed starts backed by existing document-store metadata operations. */
export class MktgDocumentRunService {
  private readonly store = new ObjectStoreService();
  private readonly projects = new ProjectService();
  private readonly brandKit = new BrandKitService();
  private readonly boilerplates = new BoilerplatesService();
  private readonly foundation = new FoundationMessageService();
  private readonly faq = new FaqService();
  private readonly icp = new IcpService();

  public async resolveProject(req: Request, raw: unknown): Promise<string> {
    const uid = typeof raw === 'string' ? raw.trim() : '';
    this.prefix(uid);
    const project = await this.projects.getProjectById(req, uid, true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to run this project’s agents.');
    }
    let ready = false;
    let failure: unknown;
    try {
      await this.store.ensureBucket('marketing-os-artifacts', { degradable: true });
      ready = await this.store.readiness('marketing-os-artifacts');
    } catch (error) {
      failure = error;
    }
    if (!ready) {
      logger.warning(req, 'mktg_run_preflight', 'Tracking storage unavailable; no generation will be started', { project: project.uid, err: failure });
      throw new MicroserviceError('Document run storage is unavailable. Try again later.', 503, 'DOCUMENT_RUN_STORAGE_UNAVAILABLE', {
        operation: 'mktg_run_preflight',
        service: 'object_store',
        originalError: failure instanceof Error ? failure : undefined,
      });
    }
    return project.uid;
  }

  /** Opaque turn ids dedupe ACKs. Concurrent same-session ACK ordering is a documented caller limitation. */
  public async start(
    req: Request,
    project: string,
    agentKey: MktgDocumentAgentKey,
    sessionId: string,
    priorVersion = 0,
    attemptId = 'initial'
  ): Promise<string> {
    if (!findMktgRunIntake(agentKey) || !sessionId || !Number.isInteger(priorVersion) || priorVersion < 0 || !isMktgRunAttemptId(attemptId)) {
      throw ServiceValidationError.forField('run', 'Invalid document run.');
    }
    const runId = this.hash(sessionId);
    const key = `${this.prefix(project)}${runId}.json`;
    const existing = await this.read(req, project, key);
    if (existing && (existing.record.agentKey !== agentKey || existing.record.sessionId !== sessionId)) {
      throw ServiceValidationError.forField('run', 'Stored session does not match this run.');
    }
    const now = new Date().toISOString();
    const record: MktgStartedRunRecord = {
      schema: MKTG_STARTED_RUN_SCHEMA,
      project,
      agentKey,
      documentId: MKTG_LIVING_DOCUMENT_ID,
      runId,
      sessionId,
      startedAt: now,
      priorVersion,
      attemptId,
      state: 'writing',
      result: null,
    };
    const priorRevision = existing?.record.result?.revisionId ?? existing?.record.priorRevisionId;
    const written = await this.put(
      req,
      key,
      existing?.body ?? JSON.stringify(record),
      {
        state: 'writing',
        'started-at': existing?.record.startedAt ?? now,
        'prior-version': String(priorVersion),
        'attempt-id': attemptId,
        'retry-at': now,
        ...(priorRevision && { 'prior-revision-id': priorRevision }),
      },
      (metadata) => (metadata['attempt-id'] ?? 'initial') !== attemptId
    );
    if (!written && !existing) {
      throw new MicroserviceError('The run could not be recorded.', 503, 'DOCUMENT_RUN_STORAGE_UNAVAILABLE', {
        operation: 'mktg_run_start',
        service: 'object_store',
      });
    }
    return runId;
  }

  public async recordResult(req: Request, sessionId: string, result: MktgRunResultResponse, project?: string): Promise<void> {
    if (result.status !== 'ready' && result.status !== 'failed' && result.status !== 'refused') {
      return;
    }
    const partition = result.persistence?.project ?? project;
    if (!partition || !MKTG_ARTIFACT_PARTITION_REGEX.test(partition)) {
      return;
    }
    const authorized = await this.projects.getProjectById(req, partition, true);
    if (!authorized.writer || authorized.uid !== partition) {
      return;
    }
    const stored = await this.read(req, partition, `${this.prefix(partition)}${this.hash(sessionId)}.json`);
    if (stored && !isMktgRunClosed(stored.record.state)) {
      await this.advanceResult(req, stored, await this.result(req, stored.record));
    }
  }

  /** The Documents transport invokes this once for a selected failed run on detail navigation, never a timer/list read. */
  public async refreshFailure(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<MktgDocumentRunProgress | null> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    if (stored.record.state !== 'failed') {
      return mktgRunProgress(stored.record);
    }
    try {
      const result = await this.result(req, stored.record);
      const record = await this.advanceResult(req, stored, result);
      return mktgRunProgress(record, result.failureText ?? result.reply);
    } catch (error) {
      logger.warning(req, 'mktg_run_failure_refresh', 'Failure detail could not be refreshed', { project, run: runId, err: error });
      return mktgRunProgress(stored.record);
    }
  }

  public async retry(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<void> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    if (stored.record.state === 'failed') {
      await this.mark(req, stored, 'writing', mktgRunRenewAt(stored.record, Date.now()), undefined, stored.record.answeredQuestionsId, 0);
    }
  }

  /** Caller validates before sending answers; invalid internal input is DEBUG, never a storage WARN. */
  public async resumeAfterQuestions(req: Request, project: string, sessionId: string, questionsId?: string): Promise<void> {
    if (questionsId !== undefined && !MKTG_RUN_QUESTIONS_ID_REGEX.test(questionsId)) {
      logger.debug(req, 'mktg_run_answers_resume', 'Invalid questions id; budget unchanged', { project });
      return;
    }
    try {
      const stored = await this.read(req, project, `${this.prefix(project)}${this.hash(sessionId)}.json`);
      if (stored && !isMktgRunTerminal(stored.record.state) && findMktgRunIntake(stored.record.agentKey)?.endpoints.answers) {
        await this.mark(req, stored, 'writing', mktgRunRenewAt(stored.record, Date.now()), undefined, questionsId, 0);
      }
    } catch (error) {
      logger.warning(req, 'mktg_run_answers_resume', 'Answers accepted; tracking renewal failed, do not resend', { project, err: error });
    }
  }

  private async advanceResult(req: Request, stored: MktgStoredStartedRun, result: MktgRunResultResponse): Promise<MktgStartedRunRecord> {
    const run = stored.record;
    const location = mktgDocumentLocationOfReceipt(result.persistence);
    // A deduplicated prior receipt is not proof of this turn: spend its writing deadline, not a persistence budget.
    const staleReceipt = result.status === 'ready' && location !== undefined && location.revisionId === run.priorRevisionId;
    if (staleReceipt) {
      result = { status: 'pending' };
    }
    if (result.status === 'ready') {
      if (location && result.persistence?.project === run.project && location.agentKey === run.agentKey && location.documentId === run.documentId) {
        return this.mark(req, stored, 'completed', run.retryAt, location.revisionId);
      }
      if (run.state === 'failed') {
        return run;
      }
      const retries = run.state === 'storing' ? (run.persistRetries ?? 0) + 1 : 0;
      return retries >= MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS
        ? this.mark(
            req,
            stored,
            'failed',
            run.retryAt,
            undefined,
            run.answeredQuestionsId,
            retries,
            'The asset was generated but its revision could not be stored. Retry checks it again.'
          )
        : this.mark(req, stored, 'storing', run.retryAt, undefined, run.answeredQuestionsId, retries);
    }
    if (run.state === 'failed') {
      return run;
    }
    if (result.status === 'failed' || result.status === 'refused') {
      return this.mark(req, stored, 'failed', run.retryAt, undefined, run.answeredQuestionsId, run.persistRetries, result.failureText ?? result.reply ?? '');
    }
    if (result.status === 'questions' && result.questionsId !== run.answeredQuestionsId) {
      return run.state === 'questions' ? run : this.mark(req, stored, 'questions');
    }
    if (run.state === 'questions' || (run.state === 'storing' && !staleReceipt)) {
      return run;
    }
    const deadlineReason = staleReceipt
      ? 'The run produced no new revision before its writing deadline.'
      : 'The run did not finish before its writing deadline.';
    return Date.now() - Date.parse(run.retryAt ?? run.startedAt) > MKTG_RUN_POLL.timeoutMs
      ? this.mark(req, stored, 'failed', run.retryAt, undefined, run.answeredQuestionsId, 0, deadlineReason)
      : run;
  }

  private result(req: Request, record: MktgStartedRunRecord): Promise<MktgRunResultResponse> {
    switch (findMktgRunIntake(record.agentKey)?.endpoints.result) {
      case BRAND_KIT_INTAKE.endpoints.result:
        return this.brandKit.getResult(req, record.sessionId, record.project);
      case FOUNDATION_MESSAGE_INTAKE.endpoints.result:
        return this.foundation.getResult(req, record.sessionId, record.project);
      case BOILERPLATES_INTAKE.endpoints.result:
        return this.boilerplates.getResult(req, record.sessionId, record.project);
      case FAQ_INTAKE.endpoints.result:
        return this.faq.getResult(req, record.sessionId, record.project);
      case ICP_INTAKE.endpoints.result:
        return this.icp.getResult(req, record.sessionId, record.project);
      default:
        throw ServiceValidationError.forField('agentKey', 'No registered result endpoint for this run.');
    }
  }

  private async mark(
    req: Request,
    stored: MktgStoredStartedRun,
    state: MktgStoredDocumentRunState,
    retryAt = stored.record.retryAt,
    revisionId?: string,
    questionsId = stored.record.answeredQuestionsId,
    persistRetries = stored.record.persistRetries,
    failureText = stored.record.failureText
  ): Promise<MktgStartedRunRecord> {
    const run = stored.record;
    const written = await this.put(
      req,
      stored.key,
      stored.body,
      {
        state,
        'started-at': run.startedAt,
        'prior-version': String(run.priorVersion),
        'attempt-id': run.attemptId ?? 'initial',
        ...(retryAt && { 'retry-at': retryAt }),
        ...(revisionId && { 'revision-id': revisionId }),
        ...(run.priorRevisionId && { 'prior-revision-id': run.priorRevisionId }),
        ...(questionsId && { 'answered-questions-id': questionsId }),
        ...(persistRetries !== undefined && { 'persist-retries': String(persistRetries) }),
        ...(failureText !== undefined && { 'failure-text': this.snapshot(failureText) }),
      },
      (metadata) => {
        const current = metadata['state'] as MktgStoredDocumentRunState;
        if (isMktgRunClosed(current) || (metadata['attempt-id'] ?? 'initial') !== (run.attemptId ?? 'initial') || metadata['retry-at'] !== run.retryAt) {
          return false;
        }
        if (Date.parse(retryAt ?? '') > Date.parse(run.retryAt ?? run.startedAt)) {
          return state === 'writing';
        }
        return (
          MKTG_STARTED_RUN_STATE_ORDER[state] > (MKTG_STARTED_RUN_STATE_ORDER[current] ?? -1) ||
          (state === 'storing' && current === state && (persistRetries ?? 0) > Number(metadata['persist-retries'] ?? 0))
        );
      }
    );
    if (written && isMktgRunTerminal(state)) {
      logger.info(req, 'mktg_run_mark', 'Recorded terminal run state', { project: run.project, run: run.runId, state });
    }
    const current = await this.read(req, run.project, stored.key);
    if (!current) {
      throw new ResourceNotFoundError('Marketing OS run', run.runId);
    }
    return current.record;
  }

  private put(
    req: Request,
    key: string,
    body: string,
    metadata: Record<string, string>,
    refreshMetadataWhen: (value: Record<string, string>) => boolean
  ): Promise<boolean> {
    return this.store.putContentAddressedObject(req, 'marketing-os-artifacts', key, Buffer.from(body), 'application/json; charset=utf-8', 'private', metadata, {
      refreshMetadataWhen,
    });
  }
  private snapshot(text: string): string {
    let value = '';
    for (const char of text) {
      if (Buffer.byteLength(value + char) > MKTG_STARTED_RUN_FAILURE_BYTES) {
        break;
      }
      value += char;
    }
    return Buffer.from(value).toString('base64');
  }
  private async selected(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<MktgStoredStartedRun> {
    if (!MKTG_STARTED_RUN_ID_REGEX.test(runId)) {
      throw ServiceValidationError.forField('runId', 'Invalid run id.');
    }
    const stored = await this.read(req, project, `${this.prefix(project)}${runId}.json`);
    if (!stored || stored.record.agentKey !== agentKey || stored.record.documentId !== documentId) {
      throw new ResourceNotFoundError('Marketing OS run', runId);
    }
    return stored;
  }
  private async read(req: Request, project: string, key: string): Promise<MktgStoredStartedRun | null> {
    const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
    if (!object) {
      return null;
    }
    try {
      const record = JSON.parse(object.body) as MktgStartedRunRecord;
      const m = object.metadata;
      const state = m['state'] ?? record.state;
      const startedAt = m['started-at'] ?? record.startedAt;
      const priorVersion = Number(m['prior-version'] ?? record.priorVersion);
      const attemptId = m['attempt-id'] ?? record.attemptId ?? 'initial';
      if (
        record.schema !== MKTG_STARTED_RUN_SCHEMA ||
        record.project !== project ||
        !findMktgRunIntake(record.agentKey) ||
        record.documentId !== MKTG_LIVING_DOCUMENT_ID ||
        typeof record.sessionId !== 'string' ||
        !record.sessionId ||
        record.runId !== this.hash(record.sessionId) ||
        key !== `${this.prefix(project)}${record.runId}.json` ||
        !Number.isFinite(Date.parse(startedAt)) ||
        !Number.isInteger(priorVersion) ||
        priorVersion < 0 ||
        !Object.hasOwn(MKTG_STARTED_RUN_STATE_ORDER, state) ||
        !isMktgRunAttemptId(attemptId) ||
        (m['retry-at'] !== undefined && !Number.isFinite(Date.parse(m['retry-at'])))
      ) {
        throw ServiceValidationError.forField('run', 'Invalid stored run.');
      }
      const revisionId = m['revision-id'];
      if (state === 'completed' && (!revisionId || !MKTG_REVISION_ID_REGEX.test(revisionId))) {
        return null;
      }
      return {
        key,
        body: object.body,
        record: {
          ...record,
          state: state as MktgStoredDocumentRunState,
          startedAt,
          priorVersion,
          attemptId,
          retryAt: m['retry-at'],
          answeredQuestionsId: m['answered-questions-id'],
          priorRevisionId: m['prior-revision-id'],
          persistRetries: Number(m['persist-retries'] ?? 0),
          failureText: m['failure-text'] === undefined ? undefined : Buffer.from(m['failure-text'], 'base64').toString('utf8'),
          result: revisionId ? { agentKey: record.agentKey, documentId: record.documentId, revisionId } : null,
        },
      };
    } catch {
      // Parser errors may quote private session bytes; emit a sanitized repository error instead.
      logger.warning(req, 'mktg_run_read', 'Ignoring invalid started run', {
        project,
        key,
        err: ServiceValidationError.forField('run', 'Invalid stored run.'),
      });
      return null;
    }
  }
  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
  private prefix(project: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      throw ServiceValidationError.forField('project', 'A single-segment project uid is required.');
    }
    return `${MKTG_STARTED_RUN_PREFIX}/${project}/`;
  }
}
