// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_ID_REGEX,
  MKTG_RUN_POLL,
  MKTG_RUN_QUESTIONS_ID_REGEX,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_STARTED_RUN_PREFIX,
  MKTG_STARTED_RUN_SCHEMA,
  MKTG_STARTED_RUN_STATE_ORDER,
  MKTG_STARTED_RUN_POLL_WINDOW_MS,
  MKTG_STARTED_RUN_READ_CONCURRENCY,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentAgentKey,
  MktgDocumentLocation,
  MktgDocumentRunProgress,
  MktgReadmeOutcome,
  MktgRunResultResponse,
  MktgStartedRunRecord,
  MktgStoredDocumentRunState,
  MktgStoredStartedRun,
} from '@lfx-one/shared/interfaces';
import { findMktgDocumentType } from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';

import { AuthorizationError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { BrandKitService } from './brand-kit.service';
import { FoundationMessageService } from './foundation-message.service';
import { IcpService } from './icp.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';

/**
 * Durable, session-keyed starts, reconciled on writer-authorized Documents reads.
 * Session bodies stay stable (apart from legacy identity redaction); progress lives in the existing
 * mutable metadata. No tokens, new storage primitive or background worker.
 * The existing recordGeneration path dedupes repeated results. Its known rare
 * concurrent-completion race remains until the versioning storage change lands.
 */
export class MktgDocumentRunService {
  private readonly store = new ObjectStoreService();
  private readonly projects = new ProjectService();
  private readonly brandKit = new BrandKitService();
  private readonly foundation = new FoundationMessageService();
  private readonly icp = new IcpService();
  private readonly documents = new MktgDocumentStoreService();

  /** Resolve writer-authorized scope and preflight tracking storage before any Guild work. */
  public async resolveProject(req: Request, raw: unknown): Promise<string> {
    if (typeof raw !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(raw.trim())) {
      throw ServiceValidationError.forField('project', 'A single-segment project uid is required to record this run.');
    }
    const project = await this.projects.getProjectById(req, raw.trim(), true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to run its Marketing OS agents.');
    }
    let ready = false;
    let storageFailure: unknown;
    try {
      await this.store.ensureBucket('marketing-os-artifacts', { degradable: true });
      ready = await this.store.readiness('marketing-os-artifacts');
    } catch (error) {
      storageFailure = error;
    }
    if (!ready) {
      logger.warning(req, 'mktg_run_preflight', 'Tracking storage is unavailable; no Guild session will be started', {
        project: project.uid,
        err: storageFailure,
      });
      throw new MicroserviceError('Document run storage is unavailable. Try again later.', 503, 'DOCUMENT_RUN_STORAGE_UNAVAILABLE', {
        service: 'object_store',
        operation: 'mktg_run_preflight',
        originalError: storageFailure instanceof Error ? storageFailure : undefined,
      });
    }
    logger.debug(req, 'mktg_run_preflight', 'Project and tracking store are ready', { project: project.uid });
    return project.uid;
  }

  /** Must succeed before Generate acknowledges the BFF-created session. */
  public async start(
    req: Request,
    project: string,
    agentKey: MktgDocumentAgentKey,
    sessionId: string,
    priorVersion = 0,
    readme?: MktgReadmeOutcome
  ): Promise<void> {
    const type = findMktgDocumentType(agentKey);
    if (!type || type.kind !== 'living' || !sessionId || !Number.isInteger(priorVersion) || priorVersion < 0) {
      throw ServiceValidationError.forField('run', 'Invalid document run.');
    }
    const runId = this.hash(sessionId);
    const key = `${this.prefix(project)}${runId}.json`;
    logger.debug(req, 'mktg_run_start', 'Recording the session start', { project, agent: agentKey, run: runId, prior_version: priorVersion });
    const existing = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const startedAt = new Date().toISOString();
    const record: MktgStartedRunRecord = {
      schema: MKTG_STARTED_RUN_SCHEMA,
      project,
      agentKey,
      documentId: MKTG_LIVING_DOCUMENT_ID,
      runId,
      sessionId,
      startedAt,
      priorVersion,
      readme,
      state: 'writing',
      result: null,
    };
    let body = JSON.stringify(record);
    if (existing) {
      const old = this.parse(req, key, existing.body, existing.metadata, project);
      if (!old || old.record.agentKey !== agentKey || old.record.sessionId !== sessionId) {
        throw ServiceValidationError.forField('run', 'Stored session does not match this run.');
      }
      body = old.body;
    }
    // An explicit new intake renews failed/superseded/in-flight metadata without a newer draft.
    // Completed duplicate acknowledgements remain no-ops unless the prior version advances.
    await this.store.putContentAddressedObject(
      req,
      'marketing-os-artifacts',
      key,
      Buffer.from(body),
      'application/json; charset=utf-8',
      'private',
      {
        state: 'writing',
        'started-at': startedAt,
        'prior-version': String(priorVersion),
      },
      {
        refreshMetadataWhen: (stored) => {
          const previousVersion = Number(stored['prior-version'] ?? 0);
          const newerStart = Date.parse(startedAt) > Date.parse(stored['started-at'] ?? startedAt);
          const renewable =
            stored['state'] === 'failed' ||
            stored['state'] === 'superseded' ||
            (newerStart && (stored['state'] === 'writing' || stored['state'] === 'storing'));
          return priorVersion > previousVersion || (priorVersion === previousVersion && renewable);
        },
      }
    );
  }

  /** The creator's normal result poll may finish a run before a Documents read does. */
  public async recordResult(req: Request, sessionId: string, result: MktgRunResultResponse, projectUid?: string): Promise<void> {
    logger.debug(req, 'mktg_run_record_result', 'Checking the returned session result', {
      ready: result.status === 'ready',
      has_receipt: !!result.persistence?.document,
    });
    if (result.status === 'failed') {
      if (!projectUid || !MKTG_ARTIFACT_PARTITION_REGEX.test(projectUid)) {
        logger.debug(req, 'mktg_run_record_result', 'No valid project scope; returning the failure reply without recording it');
        return;
      }
      // Failure tracking is best effort: revoked access or unavailable storage
      // must not replace the agent's terminal reply with a transport error.
      try {
        const project = await this.projects.getProjectById(req, projectUid, true);
        if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
          logger.warning(req, 'mktg_run_record_result', 'No project writer grant; returning the failure reply without recording it', { project: projectUid });
          return;
        }
        const key = `${this.prefix(project.uid)}${this.hash(sessionId)}.json`;
        const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
        const stored = object ? this.parse(req, key, object.body, object.metadata, project.uid) : null;
        if (!stored) {
          logger.warning(req, 'mktg_run_record_result', 'No tracked run exists; returning the failure reply without recording it', { project: project.uid });
          return;
        }
        if (!this.isTerminal(stored.record.state) && stored.record.state !== 'failed') {
          // Confirm against the tracked prior draft, not the creator's gate.
          const confirmed = await this.result(req, stored.record);
          if (confirmed.status === 'failed') {
            await this.mark(req, stored, 'failed', undefined, undefined, true);
          }
        }
      } catch (error) {
        logger.warning(req, 'mktg_run_record_result', 'Could not record the failed run; returning the agent reply', { project: projectUid, err: error });
      }
      return;
    }
    const receipt = result.persistence;
    if (!receipt?.document) {
      return;
    }
    const key = `${this.prefix(receipt.project)}${this.hash(sessionId)}.json`;
    const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const stored = object ? this.parse(req, key, object.body, object.metadata, receipt.project) : null;
    logger.debug(req, 'mktg_run_record_result', 'Checking the existing revision receipt', { project: receipt.project, run: this.hash(sessionId) });
    if (stored && !this.isTerminal(stored.record.state) && this.fresh(stored.record, result)) {
      await this.mark(req, stored, 'completed', receipt.document);
    }
  }

  /** Caller has already resolved and writer-authorized project; sessions come only from stored records. */
  public async reconcile(req: Request, project: string, agentKey?: string, documentId?: string, poll = false): Promise<MktgDocumentRunProgress[]> {
    logger.debug(req, 'mktg_run_reconcile', 'Checking recorded document runs', { project, agent: agentKey, document: documentId, poll });
    const listed = await this.store.listObjects(req, 'marketing-os-artifacts', this.prefix(project));
    const storedRuns: MktgStoredStartedRun[] = [];
    for (let offset = 0; offset < listed.length; offset += MKTG_STARTED_RUN_READ_CONCURRENCY) {
      const batch = listed.slice(offset, offset + MKTG_STARTED_RUN_READ_CONCURRENCY);
      const fetched = await Promise.all(
        batch.map(async (entry) => {
          const modifiedAt = entry.lastModified?.getTime();
          // Timer reads are bounded; navigation reads discover unfinished sessions of any age.
          if (poll && (modifiedAt === undefined || !Number.isFinite(modifiedAt) || Date.now() - modifiedAt > MKTG_STARTED_RUN_POLL_WINDOW_MS)) {
            return null;
          }
          const metadata = await this.store.headObject(req, 'marketing-os-artifacts', entry.key);
          if (metadata === null || metadata['state'] === 'completed' || metadata['state'] === 'superseded') {
            return null;
          }
          const object = await this.store.getObject(req, 'marketing-os-artifacts', entry.key);
          const stored = object ? this.parse(req, entry.key, object.body, object.metadata, project) : null;
          // Keys identify project/session, not agent; reject other agents before any Guild check.
          if (
            !stored ||
            this.isTerminal(stored.record.state) ||
            (agentKey && stored.record.agentKey !== agentKey) ||
            (documentId && stored.record.documentId !== documentId)
          ) {
            return null;
          }
          return stored;
        })
      );
      for (const stored of fetched) {
        if (stored) {
          storedRuns.push(stored);
        }
      }
    }
    // Finish active work before deciding whether a prior failure is superseded.
    storedRuns.sort((a, b) => Number(a.record.state === 'failed') - Number(b.record.state === 'failed'));
    const runs: MktgDocumentRunProgress[] = [];
    for (const stored of storedRuns) {
      let current = stored.record;
      let failureText: string | undefined;
      if (current.state === 'failed') {
        const type = findMktgDocumentType(current.agentKey);
        const document = type ? await this.documents.getDocument(req, project, type, current.documentId) : null;
        const createdAt = document?.revisions[0]?.createdAt;
        if (createdAt && Date.parse(createdAt) > Date.parse(current.retryAt ?? current.startedAt)) {
          current = await this.mark(req, stored, 'superseded');
        } else if (current.failedWithoutDocument) {
          // Full text belongs in the private session, not size-limited S3 metadata.
          // A failed run does not timer-poll; navigation/retry reads it once.
          try {
            const result = await this.result(req, current);
            failureText = result.status === 'failed' ? result.failureText : undefined;
          } catch (error) {
            logger.warning(req, 'mktg_run_reconcile', 'Could not read the failed run reply', { project, run: current.runId, err: error });
          }
        }
      } else {
        let result: MktgRunResultResponse | undefined;
        try {
          result = await this.result(req, current);
        } catch (error) {
          logger.warning(req, 'mktg_run_reconcile', 'Could not check the stored run; the next read may retry it', { project, run: current.runId, err: error });
        }
        const expired = Date.now() - Date.parse(current.retryAt ?? current.startedAt) > MKTG_RUN_POLL.timeoutMs;
        if (result && this.fresh(current, result)) {
          const location = result.persistence?.document;
          let state: MktgStoredDocumentRunState = 'storing';
          if (location) {
            state = 'completed';
          } else if (expired) {
            state = 'failed';
          }
          if (state !== current.state) {
            current = await this.mark(req, stored, state, location);
          }
        } else if (result?.status === 'failed') {
          failureText = result.failureText;
          current = await this.mark(req, stored, 'failed', undefined, undefined, true);
        } else if (expired && !(result?.status === 'questions' && result.questionsId !== current.answeredQuestionsId)) {
          // A deliberate questions pause does not spend the writing deadline.
          // Check Guild first; both unresolved writing and ready-but-unpersisted storing are bounded.
          current = await this.mark(req, stored, 'failed');
        }
      }
      if (current.state !== 'completed' && current.state !== 'superseded') {
        // Explicit projection: session ids and capabilities never enter the response.
        runs.push({
          runId: current.runId,
          project,
          agentKey: current.agentKey,
          documentId: current.documentId,
          startedAt: current.startedAt,
          state: current.state,
          ...(failureText !== undefined && { failureText }),
        });
      }
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Explicit retry only checks the stored session again; it cannot create a Guild session. */
  public async retry(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<void> {
    if (!MKTG_STARTED_RUN_ID_REGEX.test(runId)) {
      throw ServiceValidationError.forField('runId', 'Invalid run id.');
    }
    logger.debug(req, 'mktg_run_retry', 'Checking a recorded run for explicit retry', { project, run: runId });
    const key = `${this.prefix(project)}${runId}.json`;
    const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const stored = object ? this.parse(req, key, object.body, object.metadata, project) : null;
    if (!stored || stored.record.agentKey !== agentKey || stored.record.documentId !== documentId) {
      throw new ResourceNotFoundError('Marketing OS run', runId);
    }
    if (stored.record.state === 'failed') {
      logger.debug(req, 'mktg_run_retry', 'Retrying the recorded session, not starting generation', { project, run: runId });
      await this.mark(req, stored, 'writing', undefined, new Date().toISOString());
    }
  }

  /** Best-effort budget renewal AFTER answers were delivered; never invite a duplicate send on tracking failure. */
  public async resumeAfterQuestions(req: Request, project: string, sessionId: string, questionsId?: string): Promise<void> {
    try {
      if (questionsId !== undefined && (typeof questionsId !== 'string' || !MKTG_RUN_QUESTIONS_ID_REGEX.test(questionsId))) {
        throw ServiceValidationError.forField('questionsId', 'Invalid questions block.');
      }
      const key = `${this.prefix(project)}${this.hash(sessionId)}.json`;
      const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
      const stored = object ? this.parse(req, key, object.body, object.metadata, project) : null;
      if (!stored || stored.record.agentKey !== 'foundation-message') {
        logger.warning(req, 'mktg_run_answers_resume', 'Answers delivered but no matching tracked run exists; no budget was changed', { project });
        return;
      }
      if (stored.record.state === 'writing' || stored.record.state === 'failed') {
        await this.mark(req, stored, 'writing', undefined, new Date().toISOString(), false, questionsId);
      }
    } catch (error) {
      logger.warning(req, 'mktg_run_answers_resume', 'Answers delivered but tracking could not be renewed; do not resend them', { project, err: error });
    }
  }

  /** Messaging freshness comes from finalize order, not its resettable draft counter. */
  private fresh(run: MktgStartedRunRecord, result: MktgRunResultResponse): boolean {
    return result.status === 'ready' && (run.agentKey === 'foundation-message' || (result.version ?? 0) > run.priorVersion);
  }

  private async result(req: Request, record: MktgStartedRunRecord): Promise<MktgRunResultResponse> {
    const args: [Request, string, string, MktgReadmeOutcome | undefined, number] = [req, record.sessionId, record.project, record.readme, record.priorVersion];
    switch (record.agentKey) {
      case 'brand-kit':
        return this.brandKit.getResult(...args);
      case 'foundation-message':
        return this.foundation.getResult(...args);
      case 'icp':
        return this.icp.getResult(...args);
      default:
        throw ServiceValidationError.forField('agentKey', 'No live result flow exists for this stored run type.');
    }
  }

  private async mark(
    req: Request,
    stored: MktgStoredStartedRun,
    state: MktgStoredDocumentRunState,
    result?: MktgDocumentLocation,
    retryAt = stored.record.retryAt,
    failedWithoutDocument = false,
    answeredQuestionsId = stored.record.answeredQuestionsId
  ): Promise<MktgStartedRunRecord> {
    if (state === stored.record.state && retryAt === stored.record.retryAt) {
      return stored.record;
    }
    logger.debug(req, 'mktg_run_mark', 'Advancing recorded run state', { project: stored.record.project, run: stored.record.runId, state });
    const written = await this.store.putContentAddressedObject(
      req,
      'marketing-os-artifacts',
      stored.key,
      Buffer.from(stored.body),
      'application/json; charset=utf-8',
      'private',
      {
        state,
        'started-at': stored.record.startedAt,
        'prior-version': String(stored.record.priorVersion),
        ...(result && { 'revision-id': result.revisionId }),
        ...(retryAt && { 'retry-at': retryAt }),
        ...(failedWithoutDocument && { 'failure-reason': 'no-document' }),
        ...(answeredQuestionsId && { 'answered-questions-id': answeredQuestionsId }),
      },
      { refreshMetadataWhen: (metadata) => this.canAdvance(metadata, stored.record, state, retryAt) }
    );
    const fresh = await this.store.getObject(req, 'marketing-os-artifacts', stored.key);
    const current = fresh ? this.parse(req, stored.key, fresh.body, fresh.metadata, stored.record.project) : null;
    if (!current) {
      throw new ResourceNotFoundError('Marketing OS run', stored.record.runId);
    }
    if (written && (this.isTerminal(current.record.state) || current.record.state === 'failed')) {
      logger.info(req, 'mktg_run_state', 'Recorded run became terminal', {
        project: current.record.project,
        run: current.record.runId,
        state: current.record.state,
      });
    }
    return current.record;
  }

  private parse(req: Request, key: string, body: string, metadata: Record<string, string>, project: string): MktgStoredStartedRun | null {
    try {
      const record = JSON.parse(body) as MktgStartedRunRecord & { startedBy?: unknown };
      // Never carry the retired identity field into a future write of a legacy development record.
      const hasLegacyIdentity = Object.hasOwn(record, 'startedBy');
      delete record.startedBy;
      const startedAt = metadata['started-at'] ?? record.startedAt;
      const priorVersion = Number(metadata['prior-version'] ?? record.priorVersion);
      const state = metadata['state'] ?? record.state;
      if (
        record.schema !== MKTG_STARTED_RUN_SCHEMA ||
        record.project !== project ||
        !findMktgDocumentType(record.agentKey) ||
        record.documentId !== MKTG_LIVING_DOCUMENT_ID ||
        typeof record.sessionId !== 'string' ||
        !record.sessionId ||
        record.runId !== this.hash(record.sessionId) ||
        key !== `${this.prefix(project)}${record.runId}.json` ||
        Number.isNaN(Date.parse(startedAt)) ||
        !Number.isInteger(priorVersion) ||
        priorVersion < 0 ||
        !Object.hasOwn(MKTG_STARTED_RUN_STATE_ORDER, state) ||
        (metadata['retry-at'] !== undefined && Number.isNaN(Date.parse(metadata['retry-at']))) ||
        (metadata['answered-questions-id'] !== undefined && !MKTG_RUN_QUESTIONS_ID_REGEX.test(metadata['answered-questions-id']))
      ) {
        logger.warning(req, 'mktg_run_read', 'Ignoring invalid started-run data or namespace', { project, key });
        return null;
      }
      const revisionId = metadata['revision-id'];
      const result = revisionId && MKTG_REVISION_ID_REGEX.test(revisionId) ? { agentKey: record.agentKey, documentId: record.documentId, revisionId } : null;
      if (state === 'completed' && !result) {
        return null;
      }
      return {
        key,
        body: hasLegacyIdentity ? JSON.stringify(record) : body,
        record: {
          ...record,
          startedAt,
          priorVersion,
          state: state as MktgStoredDocumentRunState,
          result,
          retryAt: metadata['retry-at'],
          answeredQuestionsId: metadata['answered-questions-id'],
          failedWithoutDocument: state === 'failed' && metadata['failure-reason'] === 'no-document',
        },
      };
    } catch {
      logger.warning(req, 'mktg_run_read', 'Ignoring malformed started-run record', { key });
      return null;
    }
  }

  private isTerminal(state: MktgStoredDocumentRunState): boolean {
    return state === 'completed' || state === 'superseded';
  }

  /** Best-effort monotonic metadata guard; not a new atomic-write guarantee. */
  private canAdvance(metadata: Record<string, string>, record: MktgStartedRunRecord, state: MktgStoredDocumentRunState, retryAt?: string): boolean {
    const current = (metadata['state'] ?? record.state) as MktgStoredDocumentRunState;
    if (
      !Object.hasOwn(MKTG_STARTED_RUN_STATE_ORDER, current) ||
      this.isTerminal(current) ||
      Number(metadata['prior-version'] ?? record.priorVersion) !== record.priorVersion ||
      (metadata['started-at'] ?? record.startedAt) !== record.startedAt
    ) {
      return false;
    }
    const previousRetry = metadata['retry-at'] === undefined ? 0 : Date.parse(metadata['retry-at']);
    const nextRetry = retryAt === undefined ? 0 : Date.parse(retryAt);
    if (!Number.isFinite(previousRetry) || !Number.isFinite(nextRetry) || nextRetry < previousRetry) {
      return false;
    }
    if (nextRetry > previousRetry) {
      return (current === 'failed' || current === 'writing') && state === 'writing';
    }
    return MKTG_STARTED_RUN_STATE_ORDER[state] > MKTG_STARTED_RUN_STATE_ORDER[current];
  }

  private prefix(project: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      throw ServiceValidationError.forField('project', 'A validated project uid is required.');
    }
    return `${MKTG_STARTED_RUN_PREFIX}/${project}/`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
