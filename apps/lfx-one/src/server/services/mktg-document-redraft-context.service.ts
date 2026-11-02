// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { MKTG_REDRAFT_CONTEXT_MAX_BYTES, MKTG_REDRAFT_CONTEXT_PREFIX, MKTG_REDRAFT_CONTEXT_SCHEMA, MKTG_STARTED_RUN_ID_REGEX } from '@lfx-one/shared/constants';
import type { MktgDocumentRedraftContext } from '@lfx-one/shared/interfaces';
// Pure Node service: avoid the Angular-dependent utils barrel.
import { readMktgRedraftContext } from '@lfx-one/shared/utils/mktg-document-redraft.utils';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { AuthorizationError, ConflictError, MicroserviceError, ServiceValidationError } from '../errors';
import { ObjectStoreService } from './object-store.service';

/** Immutable contract context only. No session/token persistence, LIST, progress state or worker. */
export class MktgDocumentRedraftContextService {
  private readonly store = new ObjectStoreService();

  public static runId(sessionId: string): string {
    if (typeof sessionId !== 'string' || !sessionId.trim()) throw ServiceValidationError.forField('sessionId', 'A recorded session is required.');
    return createHash('sha256').update(sessionId).digest('hex');
  }

  public async create(req: Request, sessionId: string, input: Omit<MktgDocumentRedraftContext, 'runId' | 'schema'>): Promise<MktgDocumentRedraftContext> {
    const context = readMktgRedraftContext({ ...input, schema: MKTG_REDRAFT_CONTEXT_SCHEMA, runId: MktgDocumentRedraftContextService.runId(sessionId) });
    if (!context) throw ServiceValidationError.forField('redraft', 'Invalid redraft contract context.');
    const body = Buffer.from(this.serialize(context));
    if (body.byteLength > MKTG_REDRAFT_CONTEXT_MAX_BYTES) throw ServiceValidationError.forField('redraft', 'The frozen redraft context is too large.');
    const written = await this.store.putConditionalObject(req, 'marketing-os-artifacts', this.key(context.runId), {
      body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'private, no-store',
      ifNoneMatch: '*',
    });
    if (!written) {
      const existing = await this.forSession(req, sessionId);
      if (!existing || this.serialize(existing) !== body.toString('utf8')) {
        throw new ConflictError('A different redraft context is already bound to this run.', 'MKTG_REDRAFT_CONTEXT_CONFLICT');
      }
    }
    return context;
  }

  /** Lookup by the authoritative session hash, NEVER under a caller-chosen project prefix. */
  public async forSession(req: Request, sessionId: string): Promise<MktgDocumentRedraftContext | null> {
    return this.forRun(req, MktgDocumentRedraftContextService.runId(sessionId));
  }

  public async forRun(req: Request, runId: string): Promise<MktgDocumentRedraftContext | null> {
    if (typeof runId !== 'string' || !MKTG_STARTED_RUN_ID_REGEX.test(runId)) throw ServiceValidationError.forField('runId', 'Invalid redraft reference.');
    const object = await this.store.getObject(req, 'marketing-os-artifacts', this.key(runId));
    if (!object) return null; // The store returns null only for confirmed absence; failures propagate.
    if (Buffer.byteLength(object.body) > MKTG_REDRAFT_CONTEXT_MAX_BYTES) throw this.corrupt();
    let parsed: unknown;
    try {
      parsed = JSON.parse(object.body);
    } catch {
      throw this.corrupt();
    }
    const context = readMktgRedraftContext(parsed);
    if (!context || context.runId !== runId) throw this.corrupt();
    return context;
  }

  /** The caller resolves writer authorization/canonical UID first; a mismatch is never a Generate fallback. */
  public assertScope(context: MktgDocumentRedraftContext, project: string | undefined, agentKey: string): void {
    if (!project || context.project !== project || context.agentKey !== agentKey) {
      throw new AuthorizationError('The redraft session does not belong to this authorized project and agent.');
    }
  }

  private key(runId: string): string {
    return `${MKTG_REDRAFT_CONTEXT_PREFIX}/${runId}.json`;
  }
  private corrupt(): MicroserviceError {
    return new MicroserviceError('Stored redraft context is unreadable.', 502, 'MKTG_REDRAFT_CONTEXT_CORRUPT');
  }
  private serialize(context: MktgDocumentRedraftContext): string {
    return JSON.stringify({
      schema: context.schema,
      runId: context.runId,
      project: context.project,
      agentKey: context.agentKey,
      documentId: context.documentId,
      requestId: context.requestId,
      basedOnId: context.basedOnId,
      priorVersion: context.priorVersion,
      projectName: context.projectName,
      comments: context.comments.map(({ id, anchor, text, createdAt }) => ({
        id,
        anchor: { kind: anchor.kind, key: anchor.key, ...(anchor.passage !== undefined && { passage: anchor.passage }) },
        text,
        createdAt,
      })),
    });
  }
}
