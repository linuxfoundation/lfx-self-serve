// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_LIVING_DOCUMENT_ID,
  MKTG_REVISION_ID_REGEX,
  MKTG_RUN_POLL,
  MKTG_STARTED_RUN_ID_REGEX,
  MKTG_STARTED_RUN_PREFIX,
  MKTG_STARTED_RUN_SCHEMA,
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

import { AuthorizationError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { BrandKitService } from './brand-kit.service';
import { FoundationMessageService } from './foundation-message.service';
import { IcpService } from './icp.service';
import { logger } from './logger.service';
import { ObjectStoreService } from './object-store.service';
import { ProjectService } from './project.service';

/**
 * Durable, session-keyed starts, reconciled on writer-authorized Documents reads.
 * Body bytes stay immutable; progress/completion live in the store's existing
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

  /** Shape-gate before the authenticated project lookup, then use only its resolved uid. */
  public async resolveProject(req: Request, raw: unknown): Promise<string> {
    if (typeof raw !== 'string' || !MKTG_ARTIFACT_PARTITION_REGEX.test(raw.trim())) {
      throw ServiceValidationError.forField('project', 'A single-segment project uid is required to record this run.');
    }
    const project = await this.projects.getProjectById(req, raw.trim(), true);
    if (!project.writer || !MKTG_ARTIFACT_PARTITION_REGEX.test(project.uid)) {
      throw new AuthorizationError('You need write access to this project to run its Marketing OS agents.');
    }
    return project.uid;
  }

  /** Must succeed before Generate acknowledges the BFF-created session. */
  public async start(
    req: Request,
    project: string,
    agentKey: MktgDocumentAgentKey,
    sessionId: string,
    starter: string,
    priorVersion = 0,
    readme?: MktgReadmeOutcome
  ): Promise<void> {
    const type = findMktgDocumentType(agentKey);
    if (!type || type.kind !== 'living' || !sessionId || !Number.isInteger(priorVersion) || priorVersion < 0) {
      throw ServiceValidationError.forField('run', 'Invalid document run.');
    }
    const runId = this.hash(sessionId);
    const key = `${this.prefix(project)}${runId}.json`;
    const existing = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const startedAt = new Date().toISOString();
    const record: MktgStartedRunRecord = {
      schema: MKTG_STARTED_RUN_SCHEMA,
      project,
      agentKey,
      documentId: MKTG_LIVING_DOCUMENT_ID,
      runId,
      sessionId,
      startedBy: this.hash(starter),
      startedAt,
      priorVersion,
      readme,
      state: 'writing',
      result: null,
    };
    if (existing) {
      const old = this.parse(key, existing.body, existing.metadata, project);
      if (!old || old.record.agentKey !== agentKey || old.record.sessionId !== sessionId) {
        throw ServiceValidationError.forField('run', 'Stored session does not match this run.');
      }
    }
    // Reused-session intake reruns advance labels, not the immutable session body.
    await this.store.putContentAddressedObject(
      req,
      'marketing-os-artifacts',
      key,
      Buffer.from(existing?.body ?? JSON.stringify(record)),
      'application/json; charset=utf-8',
      'private',
      {
        state: 'writing',
        'started-at': startedAt,
        'prior-version': String(priorVersion),
      },
      { refreshMetadataWhen: (stored) => priorVersion > Number(stored['prior-version'] ?? 0) }
    );
  }

  /** The creator's normal result poll may finish a run before a Documents read does. */
  public async recordResult(req: Request, sessionId: string, result: MktgRunResultResponse): Promise<void> {
    const receipt = result.persistence;
    if (!receipt?.document) {
      return;
    }
    const key = `${this.prefix(receipt.project)}${this.hash(sessionId)}.json`;
    const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const stored = object ? this.parse(key, object.body, object.metadata, receipt.project) : null;
    if (stored && stored.record.state !== 'completed' && (result.version ?? 0) > stored.record.priorVersion) {
      await this.mark(req, stored, 'completed', receipt.document);
    }
  }

  /** Caller has already resolved and writer-authorized project; sessions come only from stored records. */
  public async reconcile(req: Request, project: string, agentKey?: string, documentId?: string): Promise<MktgDocumentRunProgress[]> {
    const listed = await this.store.listObjects(req, 'marketing-os-artifacts', this.prefix(project));
    const runs: MktgDocumentRunProgress[] = [];
    for (const entry of listed) {
      const object = await this.store.getObject(req, 'marketing-os-artifacts', entry.key);
      const stored = object ? this.parse(entry.key, object.body, object.metadata, project) : null;
      if (
        !stored ||
        stored.record.state === 'completed' ||
        (agentKey && stored.record.agentKey !== agentKey) ||
        (documentId && stored.record.documentId !== documentId)
      ) {
        continue;
      }
      let current = stored.record;
      if (current.state !== 'failed') {
        try {
          const result = await this.result(req, current);
          if (result.status === 'ready' && (result.version ?? 0) > current.priorVersion) {
            const location = result.persistence?.document;
            current = await this.mark(req, stored, location ? 'completed' : 'storing', location);
          } else if (Date.now() - Date.parse(current.retryAt ?? current.startedAt) > MKTG_RUN_POLL.timeoutMs) {
            // Check Guild before timing out: an old run may already have finished while nobody was looking.
            current = await this.mark(req, stored, 'failed');
          }
        } catch (error) {
          logger.warning(req, 'mktg_run_reconcile', 'Could not check the stored run; keeping it available for the next read', {
            project,
            run: current.runId,
            err: error,
          });
          if (Date.now() - Date.parse(current.retryAt ?? current.startedAt) > MKTG_RUN_POLL.timeoutMs) {
            current = await this.mark(req, stored, 'failed');
          }
        }
      }
      if (current.state !== 'completed') {
        // Explicit projection: session id, starter identity and capabilities never enter the response.
        runs.push({
          runId: current.runId,
          project,
          agentKey: current.agentKey,
          documentId: current.documentId,
          startedAt: current.startedAt,
          state: current.state,
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
    const key = `${this.prefix(project)}${runId}.json`;
    const object = await this.store.getObject(req, 'marketing-os-artifacts', key);
    const stored = object ? this.parse(key, object.body, object.metadata, project) : null;
    if (!stored || stored.record.agentKey !== agentKey || stored.record.documentId !== documentId) {
      throw new ResourceNotFoundError('Marketing OS run', runId);
    }
    if (stored.record.state === 'failed') {
      await this.mark(req, stored, 'writing', undefined, new Date().toISOString());
    }
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
        throw new Error('No live result flow for the stored run type.');
    }
  }

  private async mark(
    req: Request,
    stored: MktgStoredStartedRun,
    state: MktgStoredDocumentRunState,
    result?: MktgDocumentLocation,
    retryAt = stored.record.retryAt
  ): Promise<MktgStartedRunRecord> {
    await this.store.putContentAddressedObject(
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
      },
      { refreshMetadataWhen: (metadata) => Number(metadata['prior-version'] ?? 0) === stored.record.priorVersion && metadata['state'] !== 'completed' }
    );
    const fresh = await this.store.getObject(req, 'marketing-os-artifacts', stored.key);
    const current = fresh ? this.parse(stored.key, fresh.body, fresh.metadata, stored.record.project) : null;
    if (!current) {
      throw new Error('Started run disappeared during its state update.');
    }
    return current.record;
  }

  private parse(key: string, body: string, metadata: Record<string, string>, project: string): MktgStoredStartedRun | null {
    try {
      const record = JSON.parse(body) as MktgStartedRunRecord;
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
        !['writing', 'storing', 'failed', 'completed'].includes(state)
      ) {
        return null;
      }
      const revisionId = metadata['revision-id'];
      const result = revisionId && MKTG_REVISION_ID_REGEX.test(revisionId) ? { agentKey: record.agentKey, documentId: record.documentId, revisionId } : null;
      if (state === 'completed' && !result) {
        return null;
      }
      return { key, body, record: { ...record, startedAt, priorVersion, state: state as MktgStoredDocumentRunState, result, retryAt: metadata['retry-at'] } };
    } catch (error) {
      logger.warning(undefined, 'mktg_run_read', 'Ignoring malformed started-run record', { err: error });
      return null;
    }
  }

  private prefix(project: string): string {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) {
      throw new Error('Validated project uid required.');
    }
    return `${MKTG_STARTED_RUN_PREFIX}/${project}/`;
  }

  private hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
