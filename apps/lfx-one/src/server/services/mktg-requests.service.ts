// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_ARTIFACT_PARTITION_REGEX,
  MKTG_DOCUMENT_WRITE_ATTEMPTS,
  MKTG_DOCUMENT_READ_CONCURRENCY,
  MKTG_REQUEST_WITHDRAWN_NOTE,
  MKTG_REQUESTS_SCHEMA,
  MKTG_REQUESTS_MAX,
  MKTG_REQUEST_OPEN_STATES,
  MKTG_REQUESTS_STORE_MAX_BYTES,
  MKTG_REQUEST_MAX_STATE_CHANGES,
} from '@lfx-one/shared/constants';
import { mktgCreateRequestSchema, mktgRequestStateSchema, mktgRequestsRecordSchema } from '@lfx-one/shared/server';
import type {
  MktgCreateRequest,
  MktgChangeRequestStateRequest,
  MktgRequest,
  MktgStoredRequest,
  MktgRequestsRecord,
  MktgRequestsResponse,
  MktgRequestsSnapshot,
  MktgRequestsMutation,
  MktgRequestStateChange,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AuthorizationError, ConflictError, MicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { getEffectiveSub } from '../utils/auth-helper';
import { logger } from './logger.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';
import { ObjectStoreService } from './object-store.service';

/** One CAS record per project. No repairs, scans, stored display names or request text in logs. */
export class MktgRequestsService {
  private readonly objects = new ObjectStoreService();
  private readonly authors = new MktgDocumentAuthorService();

  public readCreate(value: unknown): MktgCreateRequest {
    const parsed = mktgCreateRequestSchema.safeParse(value);
    if (!parsed.success) throw ServiceValidationError.forField(String(parsed.error.issues[0]?.path[0] ?? 'body'), 'Invalid request field.');
    return parsed.data;
  }

  public readState(value: unknown): MktgChangeRequestStateRequest {
    const parsed = mktgRequestStateSchema.safeParse(value);
    if (!parsed.success) throw ServiceValidationError.forField(String(parsed.error.issues[0]?.path[0] ?? 'body'), 'Invalid request field.');
    return parsed.data;
  }

  public async list(req: Request, project: string): Promise<MktgRequestsResponse> {
    const { record } = await this.read(req, project);
    const requests: MktgRequest[] = [];
    const sorted = [...record.requests].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    for (let offset = 0; offset < sorted.length; offset += MKTG_DOCUMENT_READ_CONCURRENCY) {
      requests.push(...(await Promise.all(sorted.slice(offset, offset + MKTG_DOCUMENT_READ_CONCURRENCY).map((row) => this.project(req, row)))));
    }
    return { requests, openCount: requests.filter((row) => MKTG_REQUEST_OPEN_STATES.some((state) => state === row.state)).length };
  }

  public async create(req: Request, project: string, value: MktgCreateRequest): Promise<MktgRequest> {
    const body = this.readCreate(value);
    const requestedBy = this.authors.captureAuthorId(req);
    const createdAt = new Date().toISOString();
    const row: MktgStoredRequest = {
      id: randomUUID(),
      clientRequestId: body.clientRequestId,
      kind: body.kind,
      target: body.target,
      text: body.text,
      requestedBy,
      requesterCommittees: [],
      createdAt,
      state: 'open',
      stateChangedAt: createdAt,
      stateChangedBy: requestedBy,
      note: null,
      stateChanges: [],
    };
    const stored = await this.change(req, project, (record) => {
      const existing = record.requests.find((entry) => entry.clientRequestId === body.clientRequestId);
      if (existing) {
        if (
          existing.requestedBy !== requestedBy ||
          existing.kind !== body.kind ||
          existing.text !== body.text ||
          !isDeepStrictEqual(existing.target, body.target)
        )
          throw this.conflict('The submission token was already used for a different request.');
        return { record: null, result: existing };
      }
      if (record.requests.length >= MKTG_REQUESTS_MAX) throw this.conflict('The project has reached its request limit.');
      return { record: { ...record, requests: [...record.requests, row] }, result: row };
    });
    return this.project(req, stored);
  }

  public async changeState(req: Request, project: string, id: string, value: MktgChangeRequestStateRequest): Promise<MktgRequest> {
    const body = this.readState(value);
    const changedBy = this.authors.captureAuthorId(req);
    const state = body.withdraw === true ? 'declined' : body.state;
    const change: MktgRequestStateChange = {
      clientRequestId: body.clientRequestId,
      state,
      note: body.withdraw === true ? MKTG_REQUEST_WITHDRAWN_NOTE : (body.note ?? null),
      ...(body.result ? { result: body.result } : {}),
      withdraw: body.withdraw === true,
      changedBy,
    };
    const stored = await this.change(req, project, (record) => {
      const row = record.requests.find((entry) => entry.id === id);
      if (!row) throw new ResourceNotFoundError('Marketing request', id);
      const receipt = row.stateChanges.find((entry) => entry.clientRequestId === body.clientRequestId);
      if (receipt) {
        if (!isDeepStrictEqual(receipt, change)) throw this.conflict('The state token was already used differently.');
        return { record: null, result: row };
      }
      if (body.withdraw === true) {
        if (!changedBy || row.requestedBy !== changedBy) throw new AuthorizationError('Only the requester can withdraw their own request.');
        if (row.state !== 'open') throw this.conflict('Only an open request can be withdrawn.');
      }
      if (change.result && row.kind === 'change' && (change.result.agentKey !== row.target.agentKey || change.result.documentId !== row.target.documentId))
        throw ServiceValidationError.forField('result', 'A change request result must refer to the requested document.');
      if (change.result && row.kind === 'asset' && row.target.agentKey && change.result.agentKey !== row.target.agentKey)
        throw ServiceValidationError.forField('result', 'An asset request result must use the requested agent.');
      const allowed =
        (row.state === 'open' && ['in-progress', 'done', 'declined'].includes(state)) || (row.state === 'in-progress' && ['done', 'declined'].includes(state));
      if (!allowed) throw this.conflict('This request cannot move to that state.');
      const updated: MktgStoredRequest = {
        ...row,
        state,
        stateChangedAt: new Date().toISOString(),
        stateChangedBy: changedBy,
        note: change.note,
        ...(change.result ? { result: change.result } : {}),
        stateChanges: [...row.stateChanges, change],
      };
      return { record: { ...record, requests: record.requests.map((entry) => (entry.id === id ? updated : entry)) }, result: updated };
    });
    return this.project(req, stored);
  }

  /** Same CAS mutation boundary as the comments ledger; the callback may repeat and must not perform external writes. */
  private async change<T>(req: Request, project: string, apply: (record: MktgRequestsRecord) => MktgRequestsMutation<T>): Promise<T> {
    for (let attempt = 0; attempt < MKTG_DOCUMENT_WRITE_ATTEMPTS; attempt++) {
      const snapshot = await this.read(req, project);
      const mutation = apply(snapshot.record);
      if (!mutation.record || (await this.write(req, project, mutation.record, snapshot.etag))) return mutation.result;
    }
    throw new PreconditionFailedError('Requests changed while saving. Try again.');
  }

  private async read(req: Request, project: string): Promise<MktgRequestsSnapshot> {
    if (!MKTG_ARTIFACT_PARTITION_REGEX.test(project)) throw ServiceValidationError.forField('project', 'Invalid project uid.');
    const object = await this.objects.getObject(req, 'marketing-os-artifacts', `requests/${project}/requests.json`);
    if (!object) return { record: { schema: MKTG_REQUESTS_SCHEMA, project, requests: [] } };
    if (!object.etag || Buffer.byteLength(object.body) > MKTG_REQUESTS_STORE_MAX_BYTES) throw this.corrupt();
    try {
      const value = JSON.parse(object.body) as Partial<MktgRequestsRecord> | null;
      // Reject oversized collections before schema parsing can expand one error per untrusted element.
      if (
        !value ||
        !Array.isArray(value.requests) ||
        value.requests.length > MKTG_REQUESTS_MAX ||
        value.requests.some((row) => !Array.isArray(row?.stateChanges) || row.stateChanges.length > MKTG_REQUEST_MAX_STATE_CHANGES)
      )
        throw this.corrupt();
      const parsed = mktgRequestsRecordSchema.safeParse(value);
      if (parsed.success && parsed.data.project === project) return { record: parsed.data, etag: object.etag };
    } catch {
      /* Never repair malformed JSON by overwriting it. */
    }
    throw this.corrupt();
  }

  private async write(req: Request, project: string, record: MktgRequestsRecord, etag?: string): Promise<boolean> {
    const body = Buffer.from(JSON.stringify(record));
    if (body.byteLength > MKTG_REQUESTS_STORE_MAX_BYTES) throw this.conflict('The project has reached its request storage limit.');
    const written = await this.objects.putConditionalObject(req, 'marketing-os-artifacts', `requests/${project}/requests.json`, {
      body,
      contentType: 'application/json; charset=utf-8',
      cacheControl: 'private, no-store',
      ...(etag ? { ifMatch: etag } : { ifNoneMatch: '*' as const }),
    });
    logger.debug(req, 'mktg_requests_write', 'Request record conditional write', { project, written });
    return written;
  }

  private async project(req: Request, row: MktgStoredRequest): Promise<MktgRequest> {
    // Explicit whitelist prevents receipt tokens or opaque subjects entering a public response.
    const requestedBy = await this.authors.resolveAuthor(req, row.requestedBy, 'mktg_requests_author', 'Request author lookup unavailable');
    const stateChangedBy = await this.authors.resolveAuthor(req, row.stateChangedBy, 'mktg_requests_author', 'Request author lookup unavailable');
    return {
      id: row.id,
      kind: row.kind,
      target: row.target,
      text: row.text,
      requesterCommittees: row.requesterCommittees,
      createdAt: row.createdAt,
      state: row.state,
      stateChangedAt: row.stateChangedAt,
      note: row.note,
      ...(row.result ? { result: row.result } : {}),
      requestedBy,
      stateChangedBy,
      isRequester: !!row.requestedBy && row.requestedBy === getEffectiveSub(req),
      withdrawn: row.stateChanges.at(-1)?.withdraw === true,
    };
  }

  private corrupt(): MicroserviceError {
    return new MicroserviceError('Stored requests are unreadable; no data was overwritten.', 502, 'MKTG_REQUESTS_CORRUPT');
  }

  private conflict(message: string): ConflictError {
    return new ConflictError(message, 'MKTG_REQUEST_CONFLICT');
  }
}
