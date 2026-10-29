// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_TYPES,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_ID_REGEX,
  MKTG_RUN_POLL,
  MKTG_RUN_QUESTIONS_ID_REGEX,
  MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_STARTED_RUN_PREFIX,
  MKTG_STARTED_RUN_SCHEMA,
  MKTG_STARTED_RUN_STATE_ORDER,
  MKTG_STARTED_RUN_POLL_WINDOW_MS,
  MKTG_STARTED_RUN_READ_CONCURRENCY,
  MKTG_STARTED_RUN_DISCOVERY_LIMIT,
  MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT,
  MKTG_STARTED_RUN_CACHE_STABLE_MS,
  MKTG_STARTED_RUN_FAILURE_BYTES,
  MKTG_STARTED_RUN_ATTEMPT_HISTORY_BYTES,
  BRAND_KIT_INTAKE,
  FOUNDATION_MESSAGE_INTAKE,
  BOILERPLATES_INTAKE,
  FAQ_INTAKE,
  ICP_INTAKE,
  LINKEDIN_POST_INTAKE,
  MEMBER_360_API,
  LINKEDIN_SOURCE_MAX_WORDS,
} from '@lfx-one/shared/constants';
import {
  MktgDocumentAgentKey,
  MktgDocumentType,
  MktgDocumentDetailResponse,
  MktgDocumentRunSnapshot,
  MktgDocumentRunProgress,
  MktgDocumentRunCoverage,
  MktgRunResultResponse,
  MktgStartedRunRecord,
  MktgDocumentRedraftContext,
  MktgStoredDocumentRunState,
  MktgStoredStartedRun,
  MktgGenerationAttribution,
  MktgOneOffRunContext,
  MktgDocumentRunStartOptions,
  MktgRunActivity,
  MktgRunPendingQuestions,
  ObjectStoreListEntry,
  MktgActiveRunStartOptions,
} from '@lfx-one/shared/interfaces';
import { MKTG_RUN_ACTIVE, MKTG_RUN_CLOSED, MKTG_RUN_ANSWERED } from '@lfx-one/shared/constants/mktg-run.constants';
import { isMktgRunPendingQuestions, mktgRunClaimAnswers } from '@lfx-one/shared/utils/mktg-document-store.utils';
import {
  mktgDocumentLocationOfReceipt,
  findMktgRunIntake,
  mktgRunProgress,
  matchesMktgRunProgress,
  isMktgRunClosed,
  isMktgRunTerminal,
  isMktgRunAttemptId,
  mktgRunIdFromKey,
  mktgRunRenewAt,
  normalizeLinkedinShareAnswers,
  isMktgRunFailureReason,
} from '@lfx-one/shared/utils';
import { Request } from 'express';
import { createHash } from 'node:crypto';
import { AuthenticationError, AuthorizationError, ConflictError, MicroserviceError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getEffectiveSub, isImpersonating } from '../utils/auth-helper';
import { buildMktgRunDocumentId } from '../utils/mktg-document-store.util';
import { classifyTransientStorageError } from '../utils/transient-storage-error.util';
import { LinkedinPostService } from './linkedin-post.service';
import { Member360Service } from './member-360.service';
import { BrandKitService } from './brand-kit.service';
import { BoilerplatesService } from './boilerplates.service';
import { FoundationMessageService } from './foundation-message.service';
import { FaqService } from './faq.service';
import { IcpService } from './icp.service';
import { GuildService } from './guild.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';
import { MktgDocumentRedraftContextService } from './mktg-document-redraft-context.service';
import { MktgDocumentCommentsService } from './mktg-document-comments.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';

/** Private session-keyed starts and question turns; the terminal cache is disposable. */
export class MktgDocumentRunService {
  private static readonly terminalCache = new Map<string, { stamp: number; progress: MktgDocumentRunProgress | null }>();
  private readonly store = new ObjectStoreService();
  private readonly projects = new ProjectService();
  private readonly guild = new GuildService();
  private readonly redrafts = new MktgDocumentRedraftContextService();
  private readonly comments = new MktgDocumentCommentsService();
  private readonly authors = new MktgDocumentAuthorService();

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

  public async resolveCatalogProject(req: Request, agentId: string, project: unknown): Promise<string | undefined> {
    return this.catalogDocumentType(agentId) ? this.resolveProject(req, project) : undefined;
  }

  public async startForCatalogAgent(req: Request, agentId: string, project: string, sessionId: string, priorVersion = 0, turnId = 'initial'): Promise<string> {
    const type = this.catalogDocumentType(agentId);
    if (!type) throw ServiceValidationError.forField('agentId', 'No registered document intake for this agent.');
    return this.start(req, project, type.agentKey, sessionId, priorVersion, turnId);
  }

  /** Owner proof and project authorization precede this pre-send check; no private session facts are returned. */
  public async assertRunOpen(req: Request, project: string, agentId: string, sessionId: string): Promise<void> {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.catalogAgentId === agentId && !!findMktgRunIntake(entry.agentKey, true));
    if (!type) return;
    const runId = this.hash(sessionId);
    const stored = await this.read(req, project, `${this.prefix(project)}${runId}.json`);
    if (stored && (stored.record.agentKey !== type.agentKey || stored.record.sessionId !== sessionId)) {
      throw ServiceValidationError.forField('run', 'Stored session does not match this run.');
    }
    this.assertNotRetired(stored?.record.state);
    if (type.kind === 'run' && stored && (!stored.record.creatorSubject || stored.record.creatorSubject !== getEffectiveSub(req))) {
      throw new AuthorizationError('Only the writer who started this run can continue it.');
    }
    await this.assertSingleActiveRun(req, project, type.agentKey, { continuingRunId: runId });
  }

  /** Controllers call this before creating any Guild session, not after its accepted ACK. */
  public async assertSingleActiveCatalogRun(req: Request, project: string, agentId: string, discard?: unknown): Promise<void> {
    const type = this.catalogDocumentType(agentId);
    if (type) await this.assertSingleActiveRun(req, project, type.agentKey, { discard });
  }

  public async assertSingleActiveOneOffRun(req: Request, project: string, agentId: string, discard?: unknown): Promise<void> {
    await this.assertSingleActiveRun(req, project, this.oneOffType(agentId).agentKey, { discard });
  }

  /** A stale discard is another conflict, never permission to close a different run. */
  public async assertSingleActiveRun(req: Request, project: string, agentKey: MktgDocumentAgentKey, options: MktgActiveRunStartOptions = {}): Promise<void> {
    if (options.discard !== undefined && (typeof options.discard !== 'string' || !MKTG_STARTED_RUN_ID_REGEX.test(options.discard))) {
      throw ServiceValidationError.forField('discard', 'Select a valid active run to discard.');
    }
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
    if (!type) throw ServiceValidationError.forField('agentKey', 'No registered document type.');
    // Unlike the bounded navigation scan, a start must check the whole project listing.
    const entries = await this.discover(req, project, undefined, true);
    const active: MktgStoredStartedRun[] = [];
    for (let offset = 0; offset < entries.length; offset += MKTG_STARTED_RUN_READ_CONCURRENCY) {
      const batch = await Promise.all(
        entries.slice(offset, offset + MKTG_STARTED_RUN_READ_CONCURRENCY).map(async (entry) => {
          try {
            const cached = this.cached(entry.key);
            if (cached?.stamp === (entry.lastModified?.getTime() ?? 0) && cached.progress === null) return null;
            const metadata = await this.store.headObject(req, 'marketing-os-artifacts', entry.key);
            if (!metadata) return null;
            if (isMktgRunClosed(metadata['state'] as MktgStoredDocumentRunState)) this.remember(entry, null);
            if (isMktgRunTerminal(metadata['state'] as MktgStoredDocumentRunState)) return null;
            const stored = await this.read(req, project, entry.key);
            return stored && !isMktgRunTerminal(stored.record.state) && this.inSlot(req, stored.record, type, options) ? stored : null;
          } catch (err) {
            logger.warning(req, 'mktg_run_start', 'Active-run check could not read a record; skipping it', { project, key: entry.key, err });
            return null;
          }
        })
      );
      active.push(...batch.filter((stored): stored is MktgStoredStartedRun => stored !== null && stored.record.runId !== options.continuingRunId));
    }
    for (const stored of active.filter((entry) => entry.record.runId === options.discard)) {
      await this.settleRedraft(
        req,
        stored.record,
        { status: 'failed', failureText: 'This send was discarded.' },
        await this.redrafts.forSession(req, stored.record.sessionId)
      );
      const closed = await this.mark(req, stored, 'discarded');
      if (closed.state !== 'discarded' && !isMktgRunTerminal(closed.state)) {
        throw await this.activeRunConflict(req, closed, type);
      }
      if (closed.state === 'discarded') void this.guild.interruptSession(req, stored.record.sessionId);
    }
    // Legacy duplicate records require separate confirmations; never discard an unselected run.
    const conflict = active.find((stored) => stored.record.runId !== options.discard);
    if (conflict) {
      throw await this.activeRunConflict(req, conflict.record, type);
    }
  }

  /** After owner/writer checks, select captured context over the controller's validated typed fallback and reuse Documents completion. */
  public async ownedOneOffResult(
    req: Request,
    project: string,
    agentId: string,
    sessionId: string,
    fallback: MktgOneOffRunContext
  ): Promise<MktgRunResultResponse> {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run' && entry.catalogAgentId === agentId);
    const creatorSubject = getEffectiveSub(req);
    if (!type || !creatorSubject) throw new AuthorizationError('This run does not belong to this requester and project.');
    let stored: MktgStoredStartedRun | null = null;
    try {
      stored = await this.read(req, project, `${this.prefix(project)}${this.hash(sessionId)}.json`);
    } catch (error) {
      const classification = classifyTransientStorageError(error);
      if (!classification.transient || error instanceof AuthorizationError || error instanceof ServiceValidationError) throw error;
      logger.warning(req, 'mktg_owned_run_read', 'Tracking read unavailable; using the creator result contract for this poll', {
        project,
        status: classification.status,
        code: classification.code,
      });
    }
    if (stored && (stored.record.agentKey !== type.agentKey || stored.record.sessionId !== sessionId || stored.record.creatorSubject !== creatorSubject))
      throw new AuthorizationError('This run does not belong to this requester and project.');
    const record: MktgStartedRunRecord = stored?.record ?? {
      schema: MKTG_STARTED_RUN_SCHEMA,
      project,
      agentKey: type.agentKey,
      sessionId,
      runId: this.hash(sessionId),
      documentId: this.documentId(type.agentKey, sessionId),
      creatorSubject,
      oneOff: { ...fallback, initializeProfile: !isImpersonating(req) },
      startedAt: new Date().toISOString(),
      priorVersion: 0,
      state: 'writing',
      result: null,
    };
    const result = await this.result(req, record);
    // Reuse the authorized record/result; mark still confirms the metadata winner after writing.
    if (stored && !isMktgRunClosed(stored.record.state)) {
      try {
        await this.advanceResult(req, stored, result);
      } catch (err) {
        logger.warning(req, 'mktg_run_record_result', 'Result returned; tracking may retry on a Documents read', { project, err });
      }
    }
    return result;
  }

  /** Dedicated forms submit first; the saved session, not a browser capability, owns completion. */
  public async startForOneOff(req: Request, agentId: string, project: string, sessionId: string, context?: MktgOneOffRunContext): Promise<string> {
    return this.start(req, project, this.oneOffType(agentId).agentKey, sessionId, 0, 'initial', { oneOff: context ?? {} });
  }

  /**
   * Retain accepted turn IDs across sequential replay; a full ledger rejects a new turn, never evicts history.
   * Concurrent ACKs and state transitions still use HEAD/check/PUT, not cross-writer CAS. A stale update can
   * replace a completed receipt; conditional metadata transitions are a separately tracked storage follow-up.
   */
  public async start(
    req: Request,
    project: string,
    agentKey: MktgDocumentAgentKey,
    sessionId: string,
    priorVersion = 0,
    attemptId = 'initial',
    options: MktgDocumentRunStartOptions = {}
  ): Promise<string> {
    const { oneOff, basedOnId } = options;
    if (
      !findMktgRunIntake(agentKey, true) ||
      !sessionId ||
      !Number.isInteger(priorVersion) ||
      priorVersion < 0 ||
      !isMktgRunAttemptId(attemptId) ||
      (oneOff !== undefined && !this.validContext(oneOff)) ||
      (basedOnId !== undefined && !MKTG_REVISION_ID_REGEX.test(basedOnId))
    ) {
      throw ServiceValidationError.forField('run', 'Invalid document run.');
    }
    const runId = this.hash(sessionId);
    const key = `${this.prefix(project)}${runId}.json`;
    const existing = await this.read(req, project, key);
    if (existing && (existing.record.agentKey !== agentKey || existing.record.sessionId !== sessionId)) {
      throw ServiceValidationError.forField('run', 'Stored session does not match this run.');
    }
    this.assertNotRetired(existing?.record.state);
    const accepted = existing?.record.acceptedAttemptIds ?? [];
    if (accepted.includes(attemptId)) return runId;
    const history = [...accepted, attemptId].join(',');
    if (history.length > MKTG_STARTED_RUN_ATTEMPT_HISTORY_BYTES) {
      throw ServiceValidationError.forField('run', 'This session has reached its tracked turn limit. Start a new session.');
    }
    const now = new Date().toISOString();
    const record: MktgStartedRunRecord = {
      schema: MKTG_STARTED_RUN_SCHEMA,
      project,
      agentKey,
      documentId: this.documentId(agentKey, sessionId),
      runId,
      sessionId,
      creatorSubject: getEffectiveSub(req) ?? null,
      ...(oneOff && { oneOff: { ...oneOff, initializeProfile: !isImpersonating(req) } }),
      startedAt: now,
      priorVersion,
      attemptId,
      state: 'writing',
      result: null,
    };
    const priorRevision = existing?.record.result?.revisionId ?? existing?.record.priorRevisionId ?? basedOnId;
    const written = await this.put(
      req,
      key,
      existing?.body ?? JSON.stringify(record),
      {
        state: 'writing',
        'started-at': existing?.record.startedAt ?? now,
        'prior-version': String(priorVersion),
        'attempt-id': attemptId,
        'attempt-history': history,
        'retry-at': now,
        ...(priorRevision && { 'prior-revision-id': priorRevision }),
      },
      (metadata) => {
        const current = this.acceptedAttempts(metadata, metadata['attempt-id'] ?? 'initial');
        return (
          metadata['state'] !== 'discarded' &&
          metadata['state'] !== 'superseded' &&
          !current.includes(attemptId) &&
          [...current, attemptId].join(',').length <= MKTG_STARTED_RUN_ATTEMPT_HISTORY_BYTES
        );
      }
    );
    if (!written) {
      const winner = await this.read(req, project, key);
      this.assertNotRetired(winner?.record.state);
      if (
        !winner ||
        winner.record.agentKey !== agentKey ||
        winner.record.sessionId !== sessionId ||
        !winner.record.acceptedAttemptIds?.includes(attemptId) ||
        ((winner.record.attemptId ?? 'initial') === attemptId && winner.record.priorVersion !== priorVersion)
      ) {
        throw new MicroserviceError('The run could not be recorded.', 503, 'DOCUMENT_RUN_STORAGE_UNAVAILABLE', {
          operation: 'mktg_run_start',
          service: 'object_store',
        });
      }
    }
    if (written) void this.retireOlderRuns(req, record, key);
    return runId;
  }

  public async recordResult(req: Request, sessionId: string, result: MktgRunResultResponse, project?: string): Promise<void> {
    if (result.status !== 'ready' && result.status !== 'questions' && result.status !== 'failed' && result.status !== 'refused') {
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

  /** A valid agent result remains usable when its tracking refresh cannot be recorded. */
  public async recordResultBestEffort(req: Request, sessionId: string, result: MktgRunResultResponse, project?: string): Promise<void> {
    try {
      await this.recordResult(req, sessionId, result, project);
    } catch (err) {
      logger.warning(req, 'mktg_run_record_result', 'Result returned; tracking may retry on a Documents read', { err });
    }
  }

  /** Lists keys in full, then bounds discovery work. Cached terminal values never contain session capabilities. */
  public async reconcile(
    req: Request,
    project: string,
    agentKey?: string,
    documentId?: string,
    poll = false,
    coverage?: MktgDocumentRunCoverage
  ): Promise<MktgDocumentRunProgress[]> {
    const entries = await this.discover(req, project, coverage);
    const runs: MktgDocumentRunProgress[] = [];
    for (let offset = 0; offset < entries.length; offset += MKTG_STARTED_RUN_READ_CONCURRENCY) {
      const batch = await Promise.all(
        entries.slice(offset, offset + MKTG_STARTED_RUN_READ_CONCURRENCY).map(async (entry) => {
          const stamp = entry.lastModified?.getTime() ?? 0;
          let stored: MktgStoredStartedRun | null = null;
          let knownUnfinished = false;
          try {
            const cached = this.cached(entry.key);
            if (cached?.stamp === stamp) {
              return matchesMktgRunProgress(cached.progress, agentKey, documentId);
            }
            MktgDocumentRunService.terminalCache.delete(entry.key);
            const metadata = await this.store.headObject(req, 'marketing-os-artifacts', entry.key);
            if (!metadata) {
              return null;
            }
            if (isMktgRunClosed(metadata['state'] as MktgStoredDocumentRunState)) {
              this.remember(entry, null);
              return null;
            }
            knownUnfinished = Object.hasOwn(MKTG_STARTED_RUN_STATE_ORDER, metadata['state']);
            if (poll && (!stamp || Date.now() - stamp > MKTG_STARTED_RUN_POLL_WINDOW_MS)) {
              this.skip(entry, coverage, knownUnfinished);
              return null;
            }
            stored = await this.read(req, project, entry.key);
            if (
              !stored ||
              isMktgRunClosed(stored.record.state) ||
              (agentKey && stored.record.agentKey !== agentKey) ||
              (documentId && stored.record.documentId !== documentId)
            ) {
              return null;
            }
            let record = stored.record;
            let fullReply: string | undefined;
            let activity: MktgRunActivity[] | undefined;
            // Failed is terminal for automatic reconciliation. Only an explicit detail refresh or creator poll rechecks it.
            if (record.state !== 'failed') {
              const result = await this.result(req, record);
              record = await this.advanceResult(req, stored, result);
              fullReply = result.failureText ?? result.reply;
              activity = record.creatorSubject && getEffectiveSub(req) === record.creatorSubject ? result.activity : undefined;
            }
            if (isMktgRunTerminal(record.state)) {
              this.remember(entry, mktgRunProgress(record));
            }
            return this.publicProgress(req, record, record.state === 'failed' ? fullReply : undefined, activity);
          } catch (error) {
            logger.warning(req, 'mktg_run_reconcile', 'One run could not be checked; retaining its last known state', { project, key: entry.key, err: error });
            this.skip(entry, coverage, knownUnfinished);
            if (coverage) coverage.lookupFailed = true;
            return stored ? this.publicProgress(req, stored.record) : null;
          }
        })
      );
      runs.push(...batch.filter((run): run is MktgDocumentRunProgress => run !== null));
    }
    return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** One public detail policy for navigation and retry; stale run selectors cannot hide a stored document. */
  public async detailWithProgress(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    readDetail: MktgDocumentDetailResponse | null | (() => Promise<MktgDocumentDetailResponse | null>),
    progress: MktgDocumentRunSnapshot,
    poll = false,
    refreshRunId?: string,
    selectedRunId?: string
  ): Promise<(MktgDocumentDetailResponse & MktgDocumentRunSnapshot) | null> {
    if (refreshRunId !== undefined && (poll || !MKTG_STARTED_RUN_ID_REGEX.test(refreshRunId))) {
      throw ServiceValidationError.forField('refreshRun', 'Refresh must name one run on an explicit detail read.');
    }
    const snapshot: MktgDocumentRunSnapshot = { runs: [...progress.runs], ...(progress.progressUnavailable && { progressUnavailable: true }) };
    if (refreshRunId) {
      try {
        const refreshed = await this.refreshFailure(req, project, type.agentKey, documentId, refreshRunId);
        snapshot.runs = snapshot.runs.filter((run) => run.runId !== refreshRunId);
        if (refreshed) snapshot.runs.unshift(refreshed);
      } catch (err) {
        if (err instanceof ServiceValidationError || err instanceof AuthorizationError) throw err;
        snapshot.progressUnavailable = true;
        logger[err instanceof ResourceNotFoundError ? 'debug' : 'warning'](
          req,
          'mktg_run_failure_detail',
          'Selected failure could not be refreshed; stored document and progress retained',
          {
            project,
            run: refreshRunId,
            err,
          }
        );
      }
    }
    if (selectedRunId) {
      try {
        const selected = await this.selectedProgress(
          req,
          project,
          type.agentKey,
          documentId,
          selectedRunId,
          snapshot.runs.find((run) => run.runId === selectedRunId)
        );
        snapshot.runs = snapshot.runs.filter((run) => run.runId !== selectedRunId);
        if (selected) {
          const replacement =
            selected.state === 'discarded' || selected.state === 'superseded'
              ? snapshot.runs.find(
                  (run) => run.agentKey === type.agentKey && run.documentId === documentId && Date.parse(run.startedAt) > Date.parse(selected.startedAt)
                )
              : undefined;
          snapshot.runs.unshift({ ...selected, ...(replacement && { replacedBy: replacement.runId }) });
        }
      } catch (err) {
        if (err instanceof ServiceValidationError || err instanceof AuthorizationError) throw err;
        if (!(err instanceof ResourceNotFoundError)) {
          snapshot.progressUnavailable = true;
          logger.warning(req, 'mktg_run_selected_detail', 'Selected run progress could not be read', { project, run: selectedRunId, err });
        }
      }
    }
    const detail = typeof readDetail === 'function' ? await readDetail() : readDetail;
    if (!detail && !snapshot.runs.length && !poll && !snapshot.progressUnavailable) return null;
    return { ...(detail ?? { project, type, documentId, revisions: [], approvedCurrent: null }), ...snapshot };
  }

  /** Materialize private retained IDs into validated rows; no coverage IDs/counts or session capabilities escape. */
  public async readProgress(req: Request, project: string, agentKey?: string, documentId?: string, poll = false): Promise<MktgDocumentRunSnapshot> {
    this.prefix(project); // Validate caller input outside the storage-failure boundary.
    const coverage: MktgDocumentRunCoverage = { uncheckedCount: 0, retainedRunIds: [] };
    let observed: MktgDocumentRunProgress[];
    try {
      observed = await this.reconcile(req, project, agentKey, documentId, poll, coverage);
    } catch (err) {
      logger.warning(req, 'mktg_run_progress_read', 'Tracking discovery unavailable; stored documents remain independently readable', { project, err });
      return { runs: [], progressUnavailable: true };
    }
    const rows = new Map(observed.map((run) => [run.runId, run]));
    let staleWindow = false;
    for (let offset = 0; offset < coverage.retainedRunIds.length; offset += MKTG_STARTED_RUN_READ_CONCURRENCY) {
      await Promise.all(
        coverage.retainedRunIds.slice(offset, offset + MKTG_STARTED_RUN_READ_CONCURRENCY).map(async (id) => {
          if (rows.has(id)) return;
          try {
            const key = `${this.prefix(project)}${id}.json`;
            const cached = this.cached(key);
            if (cached) {
              const row = matchesMktgRunProgress(cached.progress, agentKey, documentId);
              if (row) {
                rows.set(id, row);
                staleWindow ||= poll && (row.state === 'writing' || row.state === 'storing') && Date.now() - cached.stamp >= MKTG_STARTED_RUN_POLL_WINDOW_MS;
              }
              return;
            }
            const stored = await this.read(req, project, key);
            const row = stored && matchesMktgRunProgress(await this.publicProgress(req, stored.record), agentKey, documentId);
            if (row && stored) {
              rows.set(id, row);
              staleWindow ||=
                poll &&
                (row.state === 'writing' || row.state === 'storing') &&
                Date.now() - Date.parse(stored.record.retryAt ?? stored.record.startedAt) >= MKTG_STARTED_RUN_POLL_WINDOW_MS;
            }
          } catch (err) {
            coverage.lookupFailed = true;
            logger.warning(req, 'mktg_run_retained_read', 'One retained run could not be read; other rows remain available', { project, run: id, err });
          }
        })
      );
    }
    return {
      runs: [...rows.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      ...((coverage.lookupFailed || staleWindow) && { progressUnavailable: true }),
    };
  }

  /** Raw scoped closure marker; only the selected HTTP progress path enriches display-name attribution. */
  public async readClosedProgress(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<MktgDocumentRunProgress | null> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    return this.closedMarker(stored.record);
  }

  /** The Documents transport invokes this once for a selected failed run on detail navigation, never a timer/list read. */
  public async refreshFailure(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<MktgDocumentRunProgress | null> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    if (stored.record.state !== 'failed') {
      return this.publicProgress(req, stored.record);
    }
    const result = await this.result(req, stored.record);
    const record = await this.advanceResult(req, stored, result);
    return this.publicProgress(req, record, result.failureText ?? result.reply);
  }

  /** Server-only creator ACK repair; confirmed absence is uncertain, never permission to create again. */
  public async knownRedraftSession(
    req: Request,
    project: string,
    agentKey: string,
    documentId: string,
    runId: string,
    requestId: string,
    creator: string
  ): Promise<string | null> {
    if (!MKTG_STARTED_RUN_ID_REGEX.test(runId) || !isMktgRunAttemptId(requestId)) throw ServiceValidationError.forField('run', 'Invalid redraft binding.');
    const stored = await this.read(req, project, `${this.prefix(project)}${runId}.json`);
    if (!stored) return null;
    if (
      stored.record.agentKey !== agentKey ||
      stored.record.documentId !== documentId ||
      stored.record.attemptId !== requestId ||
      stored.record.creatorSubject !== creator
    ) {
      throw new AuthorizationError('The recorded session does not match this creator and redraft request.');
    }
    return stored.record.sessionId;
  }

  public async retry(req: Request, project: string, agentKey: string, documentId: string, runId: string): Promise<void> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    if (stored.record.state === 'failed') {
      await this.assertSingleActiveRun(req, project, stored.record.agentKey, {
        documentId: stored.record.documentId,
        creatorSubject: stored.record.creatorSubject,
      });
      await this.mark(req, stored, 'writing', mktgRunRenewAt(stored.record, Date.now()), undefined, stored.record.answeredQuestionsId, 0);
    }
  }

  /** Resolve the private session only after canonical project-writer authorization; public IDs cannot select another partition. */
  public async questionsForAnswers(req: Request, rawProject: unknown, runId: string, questionsId: string, creatorOnly = false): Promise<MktgStartedRunRecord> {
    if (!MKTG_STARTED_RUN_ID_REGEX.test(runId)) throw ServiceValidationError.forField('runId', 'A valid opaque run id is required.');
    const requestedProject = typeof rawProject === 'string' ? rawProject.trim() : '';
    const project = await this.resolveProject(req, requestedProject);
    if (project !== requestedProject) throw new AuthorizationError('You need write access to this project to answer its run.');
    const stored = await this.read(req, project, `${this.prefix(project)}${runId}.json`);
    if (!stored) throw new ResourceNotFoundError('Marketing OS run', runId);
    const run = stored.record;
    if (
      MKTG_DOCUMENT_TYPES.find((type) => type.agentKey === run.agentKey)?.kind !== 'living' &&
      (!creatorOnly || !run.creatorSubject || run.creatorSubject !== getEffectiveSub(req))
    )
      throw new AuthorizationError('Only the writer who started this run can answer it.');
    if (run.state !== 'questions' || run.pendingQuestions?.questionsId !== questionsId || run.answeredQuestionsId === questionsId)
      throw await this.answeredConflict(req, run, questionsId);
    return run;
  }

  /** Commit the exact questions-to-writing transition before any Guild send. Only one ETag can win. */
  public async claimAnswers(req: Request, project: string, runId: string, questionsId: string, creatorOnly = false): Promise<MktgStartedRunRecord> {
    await this.questionsForAnswers(req, project, runId, questionsId, creatorOnly);
    const stored = await this.read(req, project, `${this.prefix(project)}${runId}.json`);
    if (!stored) throw new ResourceNotFoundError('Marketing OS run', runId);
    const subject = getEffectiveSub(req);
    if (!subject) throw new AuthenticationError('A signed-in writer subject is required to answer.');
    const claim = mktgRunClaimAnswers(stored.record, questionsId, subject, new Date().toISOString());
    if (!claim) throw await this.answeredConflict(req, stored.record, questionsId);
    if (!stored.etag) throw ServiceValidationError.forField('run', 'The run has no conditional-write token. Refresh before answering.');
    const written = await this.store.putConditionalObject(
      req,
      'marketing-os-artifacts',
      stored.key,
      {
        body: Buffer.from(JSON.stringify(claim)),
        contentType: 'application/json; charset=utf-8',
        cacheControl: 'private',
        ifMatch: stored.etag,
        metadata: {
          ...stored.metadata,
          state: 'writing',
          'answered-questions-id': questionsId,
          'retry-at': claim.retryAt ?? claim.startedAt,
          'persist-retries': '0',
        },
      },
      true
    );
    MktgDocumentRunService.terminalCache.delete(stored.key);
    if (!written) {
      const winner = await this.read(req, project, stored.key);
      throw await this.answeredConflict(req, winner?.record ?? stored.record, questionsId);
    }
    logger.info(req, 'mktg_run_answers_claim', 'Claimed the waiting questions turn', { project, run: runId });
    return claim;
  }

  /** Creator-token endpoints select only their catalog agent's session, then use the same writer CAS. */
  public async claimSessionAnswers(req: Request, project: string, sessionId: string, questionsId: string, agentId: string): Promise<void> {
    const run = await this.questionsForAnswers(req, project, this.hash(sessionId), questionsId, true);
    if (run.sessionId !== sessionId || findMktgRunIntake(run.agentKey, true)?.agentId !== agentId)
      throw new AuthorizationError('The recorded run does not match this agent session.');
    await this.claimAnswers(req, project, run.runId, questionsId, true);
  }

  /** Caller validates before sending answers; invalid internal input is DEBUG, never a storage WARN. */
  public async resumeAfterQuestions(req: Request, project: string, sessionId: string, questionsId?: string): Promise<void> {
    if (questionsId !== undefined && !MKTG_RUN_QUESTIONS_ID_REGEX.test(questionsId)) {
      logger.debug(req, 'mktg_run_answers_resume', 'Invalid questions id; budget unchanged', { project });
      return;
    }
    try {
      const stored = await this.read(req, project, `${this.prefix(project)}${this.hash(sessionId)}.json`);
      if (stored && !isMktgRunTerminal(stored.record.state) && findMktgRunIntake(stored.record.agentKey, true)?.endpoints.answers) {
        await this.mark(req, stored, 'writing', mktgRunRenewAt(stored.record, Date.now()), undefined, questionsId, 0);
      }
    } catch (error) {
      logger.warning(req, 'mktg_run_answers_resume', 'Answers accepted; tracking renewal failed, do not resend', { project, err: error });
    }
  }

  /** Attribution is resolved only after writer authorization; an unavailable name never exposes a subject. */
  private async answeredConflict(req: Request, run: MktgStartedRunRecord, questionsId: string): Promise<ConflictError> {
    const answeredBy = await this.displayName(req, run.answeredBy);
    return new ConflictError(answeredBy ? `Already answered by ${answeredBy}` : 'Already answered', MKTG_RUN_ANSWERED, {
      details: { runId: run.runId, questionsId, answeredBy, answeredAt: run.answeredAt ?? null },
    });
  }

  private async displayName(req: Request, subject?: string): Promise<string | null> {
    if (!subject) return null;
    const name = (await this.authors.resolveAuthor(req, subject))?.name?.trim();
    return name && !/[|@]/.test(name) && name !== subject ? name : null;
  }

  /** Questions are project-writer data, never inferred from creator identity or a caller-provided capability. */
  private async publicProgress(
    req: Request,
    run: MktgStartedRunRecord,
    reply = run.failureText,
    activity?: MktgRunActivity[]
  ): Promise<MktgDocumentRunProgress | null> {
    let writer = false;
    if (run.state === 'questions' && run.pendingQuestions && MKTG_DOCUMENT_TYPES.some((type) => type.agentKey === run.agentKey && type.kind === 'living')) {
      try {
        const project = await this.projects.getProjectById(req, run.project, true);
        writer = project.writer === true && project.uid === run.project;
      } catch (err) {
        logger.warning(req, 'mktg_run_questions_access', 'Questions omitted because writer access could not be verified', { project: run.project, err });
      }
    }
    return mktgRunProgress(run, reply, activity, getEffectiveSub(req) ?? undefined, writer);
  }

  /** Retirement cannot delay or fail the durable ACK; every asynchronous failure is isolated. */
  private async retireOlderRuns(req: Request, record: MktgStartedRunRecord, key: string): Promise<void> {
    const project = record.project;
    try {
      const entries = (await this.discover(req, project)).filter((entry) => entry.key !== key);
      for (let offset = 0; offset < entries.length; offset += MKTG_STARTED_RUN_READ_CONCURRENCY) {
        await Promise.all(
          entries.slice(offset, offset + MKTG_STARTED_RUN_READ_CONCURRENCY).map(async (entry) => {
            try {
              const cached = this.cached(entry.key);
              if (cached?.stamp === (entry.lastModified?.getTime() ?? 0) && cached.progress === null) return;
              const metadata = await this.store.headObject(req, 'marketing-os-artifacts', entry.key);
              if (!metadata) return;
              if (isMktgRunClosed(metadata['state'] as MktgStoredDocumentRunState)) {
                this.remember(entry, null);
                return;
              }
              const older = await this.read(req, project, entry.key);
              const olderAt = older ? Date.parse(older.record.retryAt ?? older.record.startedAt) : NaN;
              const currentAt = Date.parse(record.startedAt);
              if (
                older &&
                !isMktgRunClosed(older.record.state) &&
                older.record.agentKey === record.agentKey &&
                older.record.documentId === record.documentId &&
                (olderAt < currentAt || (olderAt === currentAt && older.record.runId < record.runId))
              ) {
                await this.settleRedraft(
                  req,
                  older.record,
                  { status: 'failed', failureText: 'A newer run superseded this send.' },
                  await this.redrafts.forSession(req, older.record.sessionId)
                );
                await this.mark(req, older, 'superseded');
              }
            } catch (err) {
              logger.warning(req, 'mktg_run_supersede', 'Older run could not be retired; other runs remain readable', { project, key: entry.key, err });
            }
          })
        );
      }
    } catch (err) {
      logger.warning(req, 'mktg_run_supersede', 'Run recorded; best-effort retirement discovery could not be completed', { project, run: record.runId, err });
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
    const context = await this.redrafts.forSession(req, run.sessionId);
    if (context && (result.status === 'questions' || run.state === 'questions')) {
      const failureText = 'The agent asked questions on a comments-only redraft.';
      await this.settleRedraft(req, run, { status: 'failed', failureText }, context);
      return this.mark(req, stored, 'failed', run.retryAt, undefined, run.answeredQuestionsId, run.persistRetries, failureText);
    }
    if (result.status === 'ready' || result.status === 'failed' || result.status === 'refused') await this.settleRedraft(req, run, result, context);
    if (result.status === 'ready') {
      if (location && result.persistence?.project === run.project && location.agentKey === run.agentKey && location.documentId === run.documentId) {
        return this.mark(req, stored, 'completed', run.retryAt, location.revisionId);
      }
      if (run.state === 'failed') {
        return run;
      }
      const retries = run.state === 'storing' ? (run.persistRetries ?? 0) + 1 : 0;
      if (retries < MKTG_RUN_PERSIST_RETRY_MAX_ATTEMPTS) return this.mark(req, stored, 'storing', run.retryAt, undefined, run.answeredQuestionsId, retries);
      const failureText = 'The asset was generated but its revision could not be stored. Retry checks it again.';
      await this.settleRedraft(req, run, { status: 'failed', failureText }, context);
      return this.mark(req, stored, 'failed', run.retryAt, undefined, run.answeredQuestionsId, retries, failureText);
    }
    if (run.state === 'failed') {
      return run;
    }
    if (result.status === 'failed' || result.status === 'refused') {
      return this.mark(
        req,
        stored,
        'failed',
        run.retryAt,
        undefined,
        run.answeredQuestionsId,
        run.persistRetries,
        result.failureText ?? result.reply ?? '',
        result.failureReason
      );
    }
    // Member 360 pauses and writing stay open until Guild reports a session end, not a local clock.
    const member360Run = findMktgRunIntake(run.agentKey, true)?.endpoints.result === `${MEMBER_360_API}/result`;
    const unsupportedPause = !findMktgRunIntake(run.agentKey, true)?.endpoints.answers && (run.state === 'questions' || result.status === 'questions');
    if (!member360Run && unsupportedPause && Date.now() - Date.parse(run.retryAt ?? run.startedAt) > MKTG_RUN_POLL.timeoutMs) {
      return this.mark(
        req,
        stored,
        'failed',
        run.retryAt,
        undefined,
        run.answeredQuestionsId,
        0,
        result.failureText ?? run.failureText ?? 'The agent needs more input than this version can give it; run it again.'
      );
    }
    if (result.status === 'questions' && (!result.questionsId || result.questionsId !== run.answeredQuestionsId)) {
      const candidate = {
        questionsId: result.questionsId,
        questions: result.questions,
        askedAt: run.pendingQuestions && run.pendingQuestions.questionsId === result.questionsId ? run.pendingQuestions.askedAt : new Date().toISOString(),
      };
      const pending = isMktgRunPendingQuestions(candidate) ? candidate : null;
      if (run.state === 'questions' && JSON.stringify(run.pendingQuestions ?? null) === JSON.stringify(pending)) return run;
      return this.mark(req, stored, 'questions', run.retryAt, undefined, run.answeredQuestionsId, 0, result.failureText, run.failureReason, pending);
    }
    if (run.state === 'questions' || (run.state === 'storing' && !staleReceipt)) {
      return run;
    }
    const deadlineReason = staleReceipt
      ? 'The run produced no new revision before its writing deadline.'
      : 'The run did not finish before its writing deadline.';
    if (member360Run || Date.now() - Date.parse(run.retryAt ?? run.startedAt) <= MKTG_RUN_POLL.timeoutMs) return run;
    await this.settleRedraft(req, run, { status: 'failed', failureText: deadlineReason }, context);
    return this.mark(req, stored, 'failed', run.retryAt, undefined, run.answeredQuestionsId, 0, deadlineReason);
  }

  private async settleRedraft(
    req: Request,
    run: MktgStartedRunRecord,
    result: MktgRunResultResponse,
    context: MktgDocumentRedraftContext | null
  ): Promise<void> {
    if (!context) return;
    this.redrafts.assertScope(context, run.project, run.agentKey);
    if (context.requestId !== run.attemptId) throw ServiceValidationError.forField('run', 'The redraft attempt changed.');
    await this.comments.settle(req, context, result);
  }

  private async result(req: Request, record: MktgStartedRunRecord): Promise<MktgRunResultResponse> {
    const result = await this.agentResult(req, record);
    const endpoint = findMktgRunIntake(record.agentKey, true)?.endpoints.result;
    // Member 360 ends only when Guild ends its session (member360TerminalResult); the settled-error
    // overlay never applies to it, as the controller (#4267) and the deadline branch already hold.
    if (endpoint === `${MEMBER_360_API}/result`) return result;
    const outcome = await this.guild.resolveRunOutcome(req, record.sessionId, result, endpoint);
    return outcome.status === 'failed' && outcome.failure ? { ...outcome, failureText: outcome.failure.reason } : outcome;
  }

  private async agentResult(req: Request, record: MktgStartedRunRecord): Promise<MktgRunResultResponse> {
    const attribution: MktgGenerationAttribution = { creatorSubject: record.creatorSubject ?? null };
    switch (findMktgRunIntake(record.agentKey, true)?.endpoints.result) {
      case BRAND_KIT_INTAKE.endpoints.result:
        return new BrandKitService(attribution).getResult(req, record.sessionId, record.project);
      case FOUNDATION_MESSAGE_INTAKE.endpoints.result:
        return new FoundationMessageService(attribution).getResult(req, record.sessionId, record.project);
      case BOILERPLATES_INTAKE.endpoints.result:
        return new BoilerplatesService(attribution).getResult(req, record.sessionId, record.project);
      case FAQ_INTAKE.endpoints.result:
        return new FaqService(attribution).getResult(req, record.sessionId, record.project);
      case ICP_INTAKE.endpoints.result:
        return new IcpService(attribution).getResult(req, record.sessionId, record.project);
      case LINKEDIN_POST_INTAKE.endpoints.result:
        return new LinkedinPostService(attribution, !!record.creatorSubject && record.oneOff?.initializeProfile === true).result(
          req,
          record.creatorSubject ?? '',
          record.sessionId,
          record.project,
          record.oneOff?.answers,
          record.oneOff?.sourceWords
        );
      case `${MEMBER_360_API}/result`: {
        const result = await new Member360Service(attribution).result(req, record.sessionId, record.project);
        return Member360Service.toRunResult(result);
      }
      default:
        throw ServiceValidationError.forField('agentKey', 'No registered result endpoint for this run.');
    }
  }

  /** Fence stale result polls with the same record version used by answer claims; start admission remains separate. */
  private async mark(
    req: Request,
    stored: MktgStoredStartedRun,
    state: MktgStoredDocumentRunState,
    retryAt = stored.record.retryAt,
    revisionId?: string,
    questionsId = stored.record.answeredQuestionsId,
    persistRetries = stored.record.persistRetries,
    failureText = stored.record.failureText,
    failureReason = stored.record.failureReason,
    pendingQuestions: MktgRunPendingQuestions | null = state === 'questions' ? (stored.record.pendingQuestions ?? null) : null
  ): Promise<MktgStartedRunRecord> {
    const run = stored.record;
    const closedAt = state === 'discarded' || state === 'superseded' ? new Date().toISOString() : undefined;
    const discardedBySubject = state === 'discarded' ? getEffectiveSub(req) : null;
    const turn = state === 'questions' ? pendingQuestions : null;
    // State must change the bytes/ETag too: metadata-only replacements can retain an S3 ETag.
    const body = JSON.stringify({
      ...run,
      state,
      retryAt,
      answeredQuestionsId: questionsId,
      persistRetries,
      failureText,
      failureReason,
      pendingQuestions: turn ?? undefined,
    });
    const written = await this.put(
      req,
      stored.key,
      body,
      {
        state,
        ...(closedAt && { 'closed-at': closedAt }),
        ...(discardedBySubject && { 'closed-by': discardedBySubject }),
        'started-at': run.startedAt,
        'prior-version': String(run.priorVersion),
        'attempt-id': run.attemptId ?? 'initial',
        'attempt-history': (run.acceptedAttemptIds ?? [run.attemptId ?? 'initial']).join(','),
        ...(retryAt && { 'retry-at': retryAt }),
        ...(revisionId && { 'revision-id': revisionId }),
        ...(run.priorRevisionId && { 'prior-revision-id': run.priorRevisionId }),
        ...(questionsId && { 'answered-questions-id': questionsId }),
        ...(persistRetries !== undefined && { 'persist-retries': String(persistRetries) }),
        ...(failureText !== undefined && { 'failure-text': this.snapshot(failureText) }),
        ...(isMktgRunFailureReason(failureReason) && { 'failure-reason': failureReason }),
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
          (state === 'storing' && current === state && (persistRetries ?? 0) > Number(metadata['persist-retries'] ?? 0)) ||
          (state === 'questions' && current === state && JSON.stringify(run.pendingQuestions ?? null) !== JSON.stringify(pendingQuestions))
        );
      },
      stored
    );
    if (written && isMktgRunTerminal(state)) {
      logger.info(req, 'mktg_run_mark', 'Recorded terminal run state', { project: run.project, run: run.runId, state });
      if (state === 'discarded') {
        logger.info(req, 'mktg_run_discard', 'Active run discarded before a new start', {
          project: run.project,
          runId: run.runId,
          documentId: run.documentId,
          agentKey: run.agentKey,
          discardedBySubject,
          creatorSubject: run.creatorSubject ?? null,
          self: !!discardedBySubject && discardedBySubject === run.creatorSubject,
          at: closedAt,
        });
      }
    }
    const current = await this.read(req, run.project, stored.key);
    if (!current) {
      throw new ResourceNotFoundError('Marketing OS run', run.runId);
    }
    return current.record;
  }

  private async put(
    req: Request,
    key: string,
    body: string,
    metadata: Record<string, string>,
    refreshMetadataWhen: (value: Record<string, string>) => boolean,
    snapshot?: MktgStoredStartedRun
  ): Promise<boolean> {
    MktgDocumentRunService.terminalCache.delete(key);
    if (snapshot) {
      if (!snapshot.etag) throw ServiceValidationError.forField('run', 'The run has no conditional-write token.');
      if (!refreshMetadataWhen(snapshot.metadata)) return false;
      const currentMetadata = await this.store.headObject(req, 'marketing-os-artifacts', key);
      if (!currentMetadata || !refreshMetadataWhen(currentMetadata)) return false;
      return this.store.putConditionalObject(
        req,
        'marketing-os-artifacts',
        key,
        {
          body: Buffer.from(body),
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'private',
          metadata,
          ifMatch: snapshot.etag,
        },
        true
      );
    }
    return this.store.putContentAddressedObject(req, 'marketing-os-artifacts', key, Buffer.from(body), 'application/json; charset=utf-8', 'private', metadata, {
      refreshMetadataWhen,
    });
  }
  private acceptedAttempts(metadata: Record<string, string>, attemptId: string): string[] {
    const history = metadata['attempt-history'] ?? attemptId;
    const ids = history.split(',');
    if (history.length > MKTG_STARTED_RUN_ATTEMPT_HISTORY_BYTES || !ids.every(isMktgRunAttemptId) || !ids.includes(attemptId)) {
      throw ServiceValidationError.forField('run', 'Invalid stored run.');
    }
    return ids;
  }
  private async discover(req: Request, project: string, coverage?: MktgDocumentRunCoverage, all = false): Promise<ObjectStoreListEntry[]> {
    const prefix = this.prefix(project);
    const entries = (await this.store.listObjects(req, 'marketing-os-artifacts', prefix))
      .filter((entry) => entry.key.startsWith(prefix) && entry.key.endsWith('.json') && MKTG_STARTED_RUN_ID_REGEX.test(mktgRunIdFromKey(entry.key)))
      .sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));
    if (coverage) {
      for (const entry of entries.slice(MKTG_STARTED_RUN_DISCOVERY_LIMIT)) {
        const cached = this.cached(entry.key);
        if (cached?.stamp === (entry.lastModified?.getTime() ?? 0)) {
          if (cached.progress !== null) {
            this.skip(entry, coverage, true);
          }
        } else {
          this.skip(entry, coverage);
        }
      }
    }
    return all ? entries : entries.slice(0, MKTG_STARTED_RUN_DISCOVERY_LIMIT);
  }
  private skip(entry: ObjectStoreListEntry, coverage?: MktgDocumentRunCoverage, knownUnfinished = false): void {
    if (!coverage) {
      return;
    }
    coverage.uncheckedCount++;
    const id = mktgRunIdFromKey(entry.key);
    if (
      knownUnfinished &&
      coverage.retainedRunIds.length < MKTG_STARTED_RUN_DISCOVERY_LIMIT + MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT &&
      !coverage.retainedRunIds.includes(id)
    ) {
      coverage.retainedRunIds.push(id);
    }
  }
  private cached(key: string) {
    const cache = MktgDocumentRunService.terminalCache;
    const entry = cache.get(key);
    if (entry?.progress?.agentKey === 'linkedin-post') {
      cache.delete(key);
      return undefined;
    }
    if (entry) {
      cache.delete(key);
      cache.set(key, entry);
    }
    return entry;
  }

  private remember(entry: ObjectStoreListEntry, progress: MktgDocumentRunProgress | null): void {
    // Creator-only LinkedIn replies must be projected per reader, never from the shared terminal cache.
    if (progress?.agentKey === 'linkedin-post') {
      MktgDocumentRunService.terminalCache.delete(entry.key);
      return;
    }
    const stamp = entry.lastModified?.getTime() ?? 0;
    // S3 timestamps have second precision: never memoize the still-current write second.
    if (!stamp || Date.now() - stamp < MKTG_STARTED_RUN_CACHE_STABLE_MS) {
      return;
    }
    const cache = MktgDocumentRunService.terminalCache;
    cache.delete(entry.key);
    cache.set(entry.key, { stamp, progress });
    while (cache.size > MKTG_STARTED_RUN_TERMINAL_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) {
        cache.delete(oldest);
      }
    }
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
        (record.pendingQuestions !== undefined && !isMktgRunPendingQuestions(record.pendingQuestions)) ||
        (record.answeredBy !== undefined && (typeof record.answeredBy !== 'string' || !record.answeredBy.trim())) ||
        (record.answeredAt !== undefined && (typeof record.answeredAt !== 'string' || !Number.isFinite(Date.parse(record.answeredAt)))) ||
        record.project !== project ||
        !findMktgRunIntake(record.agentKey, true) ||
        record.documentId !== this.documentId(record.agentKey, record.sessionId) ||
        (record.oneOff !== undefined && !this.validContext(record.oneOff)) ||
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
        etag: object.etag,
        metadata: m,
        record: {
          ...record,
          creatorSubject: typeof record.creatorSubject === 'string' && record.creatorSubject.trim() ? record.creatorSubject : null,
          state: state as MktgStoredDocumentRunState,
          closedAt: m['closed-at'],
          closedBySubject: m['closed-by'] || undefined,
          startedAt,
          priorVersion,
          attemptId,
          acceptedAttemptIds: this.acceptedAttempts(m, attemptId),
          retryAt: m['retry-at'],
          answeredQuestionsId: m['answered-questions-id'],
          pendingQuestions: state === 'questions' ? record.pendingQuestions : undefined,
          priorRevisionId: m['prior-revision-id'],
          persistRetries: Number(m['persist-retries'] ?? 0),
          failureText: m['failure-text'] === undefined ? undefined : Buffer.from(m['failure-text'], 'base64').toString('utf8'),
          failureReason: isMktgRunFailureReason(m['failure-reason']) ? m['failure-reason'] : undefined,
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
  private validContext(context: MktgOneOffRunContext): boolean {
    return (
      !!context &&
      typeof context === 'object' &&
      !Array.isArray(context) &&
      (context.initializeProfile === undefined || typeof context.initializeProfile === 'boolean') &&
      (context.sourceWords === undefined ||
        (Number.isInteger(context.sourceWords) && context.sourceWords >= 0 && context.sourceWords <= LINKEDIN_SOURCE_MAX_WORDS)) &&
      (context.answers === undefined || normalizeLinkedinShareAnswers(context.answers) !== null)
    );
  }

  private documentId(agentKey: string, sessionId: string): string {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.agentKey === agentKey);
    return type?.kind === 'run' ? buildMktgRunDocumentId(sessionId) : MKTG_LIVING_DOCUMENT_ID;
  }

  private async activeRunConflict(req: Request, record: MktgStartedRunRecord, type: MktgDocumentType): Promise<ConflictError> {
    const startedByViewer = record.creatorSubject === getEffectiveSub(req);
    const author = startedByViewer ? null : await this.authors.resolveAuthor(req, record.creatorSubject, 'mktg_run_start');
    const startedBy = author?.name ?? 'Another writer';
    const itemLabel = type.itemLabel.replace(/\s+run$/i, '');
    const clientMessage = type.kind === 'run' || startedByViewer ? `Your ${itemLabel} run is in progress.` : `${startedBy}'s ${itemLabel} run is in progress.`;
    return new ConflictError(`A ${itemLabel} run is already in progress.`, MKTG_RUN_ACTIVE, {
      operation: 'mktg_run_start',
      service: 'object_store',
      clientMessage,
      details: {
        activeRunId: record.runId,
        state: record.state,
        agentKey: record.agentKey,
        documentId: record.documentId,
        startedBy,
        startedByViewer,
        startedAt: record.startedAt,
      },
    });
  }

  /** Explicit selections are independent of the discovery window; known rows avoid a duplicate Guild read. */
  private async selectedProgress(
    req: Request,
    project: string,
    agentKey: string,
    documentId: string,
    runId: string,
    known?: MktgDocumentRunProgress
  ): Promise<MktgDocumentRunProgress | null> {
    const stored = await this.selected(req, project, agentKey, documentId, runId);
    const closed = await this.closedProgress(req, stored.record);
    if (closed) return closed;
    if (stored.record.state === 'completed') return null;
    if (known) return known;
    if (stored.record.state === 'failed') return this.publicProgress(req, stored.record);
    const result = await this.result(req, stored.record);
    const record = await this.advanceResult(req, stored, result);
    const concurrentlyClosed = await this.closedProgress(req, record);
    if (concurrentlyClosed) return concurrentlyClosed;
    const latest = await this.selected(req, project, agentKey, documentId, runId);
    const closedDuringResult = await this.closedProgress(req, latest.record);
    if (closedDuringResult) return closedDuringResult;
    const activity = record.creatorSubject && record.creatorSubject === getEffectiveSub(req) ? result.activity : undefined;
    return this.publicProgress(req, record, record.state === 'failed' ? (result.failureText ?? result.reply) : undefined, activity);
  }

  private closedMarker(record: MktgStartedRunRecord): MktgDocumentRunProgress | null {
    if (!isMktgRunClosed(record.state)) return null;
    return mktgRunProgress(record, undefined, undefined, undefined, false, true);
  }

  private async closedProgress(req: Request, record: MktgStartedRunRecord): Promise<MktgDocumentRunProgress | null> {
    const progress = this.closedMarker(record);
    if (!progress || record.state === 'completed') return progress;
    return { ...progress, closedBy: await this.displayName(req, record.closedBySubject) };
  }

  private assertNotRetired(state?: MktgStoredDocumentRunState): void {
    if (state === 'discarded' || state === 'superseded') {
      throw new ConflictError('This run was closed. Open Documents to choose the current run.', MKTG_RUN_CLOSED, {
        operation: 'mktg_run_start',
        service: 'object_store',
      });
    }
  }

  private inSlot(req: Request, record: MktgStartedRunRecord, type: MktgDocumentType, options: MktgActiveRunStartOptions): boolean {
    if (record.agentKey !== type.agentKey) return false;
    if (type.kind === 'run') {
      const slotOwner = options.creatorSubject !== undefined ? options.creatorSubject : getEffectiveSub(req);
      return record.creatorSubject === slotOwner;
    }
    return record.documentId === (options.documentId ?? MKTG_LIVING_DOCUMENT_ID);
  }

  private oneOffType(agentId: string): MktgDocumentType {
    const type = MKTG_DOCUMENT_TYPES.find((entry) => entry.kind === 'run' && entry.catalogAgentId === agentId && !!findMktgRunIntake(entry.agentKey, true));
    if (!type) throw ServiceValidationError.forField('agentId', 'No tracked one-off intake for this agent.');
    return type;
  }

  private catalogDocumentType(agentId: string): MktgDocumentType | undefined {
    return MKTG_DOCUMENT_TYPES.find((type) => type.kind === 'living' && type.catalogAgentId === agentId && !!findMktgRunIntake(type.agentKey));
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
