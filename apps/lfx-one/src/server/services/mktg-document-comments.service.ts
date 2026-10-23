// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  MKTG_DOCUMENT_COMMENTS_PREFIX,
  MKTG_DOCUMENT_COMMENTS_SCHEMA,
  MKTG_DOCUMENT_COMMENT_LIMITS,
  MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS,
  MKTG_DOCUMENT_COMMENT_ID_REGEX,
  MKTG_DOCUMENT_COMMENT_MAX_CHARS,
  MKTG_DOCUMENT_COMMENT_MAX_THREADS,
  MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES,
  MKTG_DOCUMENT_COMMENT_STATUSES,
  MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES,
  MKTG_DOCUMENT_READ_CONCURRENCY,
  MKTG_DOCUMENT_WRITE_ATTEMPTS,
  MKTG_REVISION_ID_REGEX,
  MKTG_STARTED_RUN_ID_REGEX,
} from '@lfx-one/shared/constants';
import type {
  MktgAddDocumentCommentRequest,
  MktgCommentAgentKey,
  MktgDocumentCommentAnchorKind,
  MktgDocumentCommentsRecord,
  MktgDocumentCommentsResponse,
  MktgDocumentCommentsSnapshot,
  MktgDocumentType,
  MktgRevisionResponse,
  MktgStoredDocumentComment,
  MktgDocumentCommentsMutation,
  MktgRedraftReservation,
  MktgDocumentCommentSubmission,
} from '@lfx-one/shared/interfaces';
import { MKTG_REDRAFT_SUBMISSION_KEYS } from '@lfx-one/shared/constants/mktg-document-redraft.constants';
import { readMktgRedraftRequest } from '@lfx-one/shared/utils/mktg-document-redraft.utils';
import { isMktgDocumentCommentAnchor, readMktgDocumentCommentField, validateMktgDocumentCommentBatch } from '@lfx-one/shared/utils';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthenticationError, ConflictError, MicroserviceError, PreconditionFailedError, ResourceNotFoundError, ServiceValidationError } from '../errors';
import { logger } from './logger.service';
import { MktgDocumentStoreService } from './mktg-document-store.service';
import { ObjectStoreService } from './object-store.service';
import { MktgDocumentAuthorService } from './mktg-document-author.service';

/** Writer authorization and canonical project resolution are the existing Documents controller's boundary. */
export class MktgDocumentCommentsService {
  private readonly store = new ObjectStoreService();
  private readonly authors = new MktgDocumentAuthorService();
  private readonly documents = new MktgDocumentStoreService(undefined, this.authors);

  public async list(req: Request, project: string, type: MktgDocumentType, documentId: string, revisionId: string): Promise<MktgDocumentCommentsResponse> {
    const agentKey = this.commentAgent(type);
    await this.requireRevision(req, project, type, documentId, revisionId);
    const snapshot = await this.read(req, project, agentKey, documentId);
    return this.project(req, snapshot.record, revisionId);
  }

  public async add(req: Request, project: string, type: MktgDocumentType, documentId: string, raw: unknown): Promise<MktgDocumentCommentsResponse> {
    const agentKey = this.commentAgent(type);
    const input = this.input(raw);
    const revision = await this.requireRevision(req, project, type, documentId, input.revisionId);
    const anchor = { ...input.anchor };
    const source = this.source(revision, agentKey);
    if (!isMktgDocumentCommentAnchor(agentKey, source, anchor)) throw this.invalid('anchor', 'The field is not in this stored asset.');
    if (agentKey === 'brand-kit') {
      const field = readMktgDocumentCommentField(source, anchor.key);
      // A logo ref, colour value, type sample or voice line is prose, not its field path.
      if (!field || typeof field.value !== 'string' || !field.value.trim()) throw this.invalid('anchor', 'Choose a text or value field of the kit.');
      Object.assign(anchor, { passage: field.value });
    }
    const authorId = this.authors.captureAuthorId(req);
    const thread: MktgStoredDocumentComment = {
      id: randomUUID(),
      clientRequestId: input.clientRequestId,
      anchor,
      revisionId: input.revisionId,
      authorId,
      text: input.text,
      createdAt: new Date().toISOString(),
      status: 'open',
      sentInRun: null,
      resultRevisionId: null,
      resolution: null,
    };
    const stored = await this.change(req, project, agentKey, documentId, (record) => {
      const duplicate = record.threads.find((entry) => entry.clientRequestId === input.clientRequestId);
      if (duplicate) {
        if (
          duplicate.authorId !== authorId ||
          duplicate.revisionId !== input.revisionId ||
          duplicate.anchor.key !== anchor.key ||
          duplicate.text !== input.text
        ) {
          throw new ConflictError('This comment request was already used for a different comment.', 'MKTG_COMMENT_REQUEST_CONFLICT');
        }
        return { record: null, result: record };
      }
      if (record.threads.length >= MKTG_DOCUMENT_COMMENT_MAX_THREADS) throw this.invalid('comments', 'The comment history is full; no comments were removed.');
      const next = { ...record, threads: [...record.threads, thread] };
      return { record: next, result: next };
    });
    logger.debug(req, 'mktg_document_comment_add', 'Stored a field comment', { agent: agentKey });
    return this.project(req, stored, input.revisionId);
  }

  /** Only a fresh committed reservation may invoke Guild. Preflight may read/render, NEVER mutate or send; CAS can repeat it. */
  public async reserve(
    req: Request,
    project: string,
    type: MktgDocumentType,
    documentId: string,
    raw: unknown,
    preflight?: (comments: MktgRedraftReservation['comments']) => void | Promise<void>
  ): Promise<MktgRedraftReservation> {
    const agent = this.commentAgent(type);
    const actor = this.creator(req);
    const input = readMktgRedraftRequest(raw);
    if (!input) throw this.invalid('redraft', 'A revision, unique comment IDs and opaque request ID are required.');
    const view = await this.requireRevision(req, project, type, documentId, input.revisionId);
    const source = this.source(view, agent);
    const now = new Date().toISOString();
    return this.change<MktgRedraftReservation>(req, project, agent, documentId, async (record) => {
      const existing = record.submissions.find((entry) => entry.id === input.clientRequestId);
      if (existing) {
        if (
          existing.requestedBy !== actor ||
          existing.baseRevisionId !== input.revisionId ||
          JSON.stringify(existing.commentIds) !== JSON.stringify(input.commentIds)
        ) {
          throw new ConflictError('This send request is already bound to different inputs or a different creator.', 'MKTG_REDRAFT_REQUEST_CONFLICT');
        }
        return { record: null, result: { submission: existing, comments: this.frozen(record, existing), fresh: false } };
      }
      if (
        record.submissions.some(
          (entry) => entry.state !== 'failed' && entry.state !== 'completed' && entry.commentIds.some((id) => input.commentIds.includes(id))
        )
      ) {
        throw new ConflictError('Some comments are already reserved for another send.', 'MKTG_REDRAFT_COMMENTS_BUSY');
      }
      const selected = input.commentIds.map((id) => record.threads.find((entry) => entry.id === id));
      if (
        selected.some(
          (entry) => !entry || entry.status !== 'open' || entry.revisionId !== input.revisionId || !isMktgDocumentCommentAnchor(agent, source, entry.anchor)
        )
      ) {
        throw this.invalid('commentIds', 'Every comment must be open and anchored to the selected stored revision.');
      }
      const comments = selected.filter((entry): entry is MktgStoredDocumentComment => !!entry);
      if (validateMktgDocumentCommentBatch(agent, comments).length)
        throw this.invalid('commentIds', `This agent accepts 1–${MKTG_DOCUMENT_COMMENT_LIMITS[agent]} comments.`);
      const submission: MktgDocumentCommentSubmission = {
        id: input.clientRequestId,
        requestedBy: actor,
        createdAt: now,
        baseRevisionId: input.revisionId,
        commentIds: [...input.commentIds],
        state: 'reserved',
        runId: null,
        resultRevisionId: null,
      };
      // Reservation is not proof of external acceptance. Threads become sent only when a returned run hash is bound.
      const next: MktgDocumentCommentsRecord = { ...record, submissions: [...record.submissions, submission] };
      const frozen = this.frozen(next, submission);
      await preflight?.(frozen);
      return { record: next, result: { submission, comments: frozen, fresh: true } };
    });
  }

  private creator(req: Request): string {
    const actor = this.authors.captureAuthorId(req);
    if (!actor) throw new AuthenticationError('A signed-in subject is required to own a redraft session.');
    return actor;
  }
  private frozen(record: MktgDocumentCommentsRecord, submission: MktgDocumentCommentSubmission): MktgRedraftReservation['comments'] {
    return submission.commentIds.map((id) => {
      const entry = record.threads.find((thread) => thread.id === id && thread.revisionId === submission.baseRevisionId);
      if (!entry) throw this.corrupt();
      return { id: entry.id, anchor: { ...entry.anchor }, text: entry.text, createdAt: entry.createdAt };
    });
  }
  private async change<T>(
    req: Request,
    project: string,
    agent: MktgCommentAgentKey,
    documentId: string,
    apply: (record: MktgDocumentCommentsRecord) => MktgDocumentCommentsMutation<T> | Promise<MktgDocumentCommentsMutation<T>>
  ): Promise<T> {
    for (let attempt = 0; attempt < MKTG_DOCUMENT_WRITE_ATTEMPTS; attempt++) {
      const snapshot = await this.read(req, project, agent, documentId);
      const mutation = await apply(snapshot.record);
      if (!mutation.record) return mutation.result;
      const body = Buffer.from(JSON.stringify(mutation.record));
      if (body.byteLength > MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES) throw this.invalid('comments', 'The comment history is full; no comments were removed.');
      if (
        await this.store.putConditionalObject(req, 'marketing-os-artifacts', this.key(project, agent, documentId), {
          body,
          contentType: 'application/json; charset=utf-8',
          cacheControl: 'private, no-store',
          ...(snapshot.etag ? { ifMatch: snapshot.etag } : { ifNoneMatch: '*' as const }),
        })
      )
        return mutation.result;
    }
    throw new PreconditionFailedError('The comments changed while saving. Try again.');
  }

  private commentAgent(type: MktgDocumentType): MktgCommentAgentKey {
    if (type.kind !== 'living' || !Object.hasOwn(MKTG_DOCUMENT_COMMENT_LIMITS, type.agentKey)) {
      throw this.invalid('agentKey', 'This asset does not support field comments.');
    }
    return type.agentKey as MktgCommentAgentKey;
  }

  private input(raw: unknown): MktgAddDocumentCommentRequest {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw this.invalid('body', 'A comment request is required.');
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['project', 'revisionId', 'anchor', 'text', 'clientRequestId'].includes(key))) {
      throw this.invalid('body', 'Only the comment fields are accepted.');
    }
    const anchor = body['anchor'];
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) || Object.keys(anchor).some((key) => !['kind', 'key'].includes(key))) {
      throw this.invalid('anchor', 'An anchor kind and key are required.');
    }
    const value = anchor as Record<string, unknown>;
    if (!(MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS as readonly string[]).includes(String(value['kind'])) || typeof value['key'] !== 'string')
      throw this.invalid('anchor', 'An anchor kind and key are required.');
    if (typeof body['text'] !== 'string' || !body['text'].trim() || body['text'].length > MKTG_DOCUMENT_COMMENT_MAX_CHARS) {
      throw this.invalid('text', 'A comment must contain text within the allowed length.');
    }
    if (typeof body['clientRequestId'] !== 'string' || !MKTG_DOCUMENT_COMMENT_ID_REGEX.test(body['clientRequestId'])) {
      throw this.invalid('clientRequestId', 'A bounded opaque request id is required.');
    }
    // The controller validates revision/project shape before authorization; preserve text verbatim.
    return {
      project: String(body['project']),
      revisionId: String(body['revisionId']),
      anchor: { kind: value['kind'] as MktgDocumentCommentAnchorKind, key: value['key'] },
      text: body['text'],
      clientRequestId: body['clientRequestId'],
    };
  }

  private async requireRevision(req: Request, project: string, type: MktgDocumentType, documentId: string, revisionId: string): Promise<MktgRevisionResponse> {
    const revision = await this.documents.getRevision(req, project, type, documentId, revisionId);
    if (!revision) throw new ResourceNotFoundError('Marketing OS document revision', revisionId);
    return revision;
  }

  private source(revision: MktgRevisionResponse, agentKey: MktgCommentAgentKey): unknown {
    if (agentKey === 'brand-kit') return { kit: revision.sidecar?.['kit'], chapters: revision.sidecar?.['chapters'] };
    if (revision.revision.format !== 'json') throw this.invalid('revisionId', 'This revision has no structured asset fields.');
    try {
      return JSON.parse(revision.markdown) as unknown;
    } catch {
      throw this.invalid('revisionId', 'This revision has no readable structured asset.');
    }
  }

  private key(project: string, agentKey: MktgCommentAgentKey, documentId: string): string {
    return `${MKTG_DOCUMENT_COMMENTS_PREFIX}/${project}/${agentKey}/${documentId}.json`;
  }

  private async read(req: Request, project: string, agentKey: MktgCommentAgentKey, documentId: string): Promise<MktgDocumentCommentsSnapshot> {
    const object = await this.store.getObject(req, 'marketing-os-artifacts', this.key(project, agentKey, documentId));
    if (!object) return { record: { schema: MKTG_DOCUMENT_COMMENTS_SCHEMA, project, agentKey, documentId, threads: [], submissions: [] } };
    if (!object.etag || Buffer.byteLength(object.body) > MKTG_DOCUMENT_COMMENT_STORE_MAX_BYTES) throw this.corrupt();
    let value: MktgDocumentCommentsRecord;
    try {
      value = JSON.parse(object.body) as MktgDocumentCommentsRecord;
    } catch {
      throw this.corrupt();
    }
    if (
      !value ||
      value.schema !== MKTG_DOCUMENT_COMMENTS_SCHEMA ||
      value.project !== project ||
      value.agentKey !== agentKey ||
      value.documentId !== documentId ||
      !Array.isArray(value.threads) ||
      value.threads.length > MKTG_DOCUMENT_COMMENT_MAX_THREADS ||
      !value.threads.every((entry) => this.validThread(entry)) ||
      new Set(value.threads.map((entry) => entry.id)).size !== value.threads.length ||
      new Set(value.threads.map((entry) => entry.clientRequestId)).size !== value.threads.length ||
      !Array.isArray(value.submissions) ||
      !value.submissions.every((entry) => this.validSubmission(entry, agentKey))
    )
      throw this.corrupt();
    return { record: value, etag: object.etag };
  }

  private validSubmission(value: MktgDocumentCommentSubmission, agent: MktgCommentAgentKey): boolean {
    return (
      !!value &&
      Object.keys(value).every((key) => (MKTG_REDRAFT_SUBMISSION_KEYS as readonly string[]).includes(key)) &&
      typeof value.id === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.id) &&
      typeof value.requestedBy === 'string' &&
      !!value.requestedBy.trim() &&
      typeof value.createdAt === 'string' &&
      Number.isFinite(Date.parse(value.createdAt)) &&
      typeof value.baseRevisionId === 'string' &&
      MKTG_REVISION_ID_REGEX.test(value.baseRevisionId) &&
      Array.isArray(value.commentIds) &&
      value.commentIds.length > 0 &&
      value.commentIds.length <= MKTG_DOCUMENT_COMMENT_LIMITS[agent] &&
      value.commentIds.every((id) => typeof id === 'string' && MKTG_DOCUMENT_COMMENT_ID_REGEX.test(id)) &&
      new Set(value.commentIds).size === value.commentIds.length &&
      (MKTG_DOCUMENT_COMMENT_SUBMISSION_STATES as readonly string[]).includes(value.state) &&
      (value.runId === null || (typeof value.runId === 'string' && MKTG_STARTED_RUN_ID_REGEX.test(value.runId))) &&
      (value.resultRevisionId === null || (typeof value.resultRevisionId === 'string' && MKTG_REVISION_ID_REGEX.test(value.resultRevisionId)))
    );
  }

  private validThread(value: MktgStoredDocumentComment): boolean {
    return (
      !!value &&
      typeof value.id === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.id) &&
      typeof value.clientRequestId === 'string' &&
      MKTG_DOCUMENT_COMMENT_ID_REGEX.test(value.clientRequestId) &&
      typeof value.revisionId === 'string' &&
      MKTG_REVISION_ID_REGEX.test(value.revisionId) &&
      !!value.anchor &&
      (MKTG_DOCUMENT_COMMENT_ANCHOR_KINDS as readonly string[]).includes(value.anchor.kind) &&
      typeof value.anchor.key === 'string' &&
      (value.anchor.passage === undefined || typeof value.anchor.passage === 'string') &&
      (value.authorId === null || typeof value.authorId === 'string') &&
      typeof value.text === 'string' &&
      value.text.length <= MKTG_DOCUMENT_COMMENT_MAX_CHARS &&
      typeof value.createdAt === 'string' &&
      !Number.isNaN(Date.parse(value.createdAt)) &&
      (MKTG_DOCUMENT_COMMENT_STATUSES as readonly string[]).includes(value.status) &&
      (value.sentInRun === null || (typeof value.sentInRun === 'string' && MKTG_STARTED_RUN_ID_REGEX.test(value.sentInRun))) &&
      (value.resultRevisionId === null || (typeof value.resultRevisionId === 'string' && MKTG_REVISION_ID_REGEX.test(value.resultRevisionId))) &&
      (value.resolution === null || typeof value.resolution === 'string')
    );
  }

  /** Explicit projection: never spread a private thread, even when stored data has extra fields. */
  private async project(req: Request, record: MktgDocumentCommentsRecord, revisionId: string): Promise<MktgDocumentCommentsResponse> {
    const selected = record.threads.filter((entry) => entry.revisionId === revisionId || entry.resultRevisionId === revisionId);
    const threads: MktgDocumentCommentsResponse['threads'] = [];
    for (let offset = 0; offset < selected.length; offset += MKTG_DOCUMENT_READ_CONCURRENCY) {
      threads.push(
        ...(await Promise.all(
          selected.slice(offset, offset + MKTG_DOCUMENT_READ_CONCURRENCY).map(async (entry) => {
            const author = await this.authors.resolveAuthor(req, entry.authorId, 'mktg_document_comment_author', 'Comment author lookup unavailable');
            return {
              id: entry.id,
              anchor: { kind: entry.anchor.kind, key: entry.anchor.key, ...(entry.anchor.passage !== undefined && { passage: entry.anchor.passage }) },
              revisionId: entry.revisionId,
              author,
              text: entry.text,
              createdAt: entry.createdAt,
              status: entry.status,
              sentInRun: entry.sentInRun,
              resultRevisionId: entry.resultRevisionId,
              resolution: entry.resolution,
            };
          })
        ))
      );
    }
    return { revisionId, threads };
  }

  private invalid(field: string, message: string): ServiceValidationError {
    return ServiceValidationError.forField(field, message);
  }
  private corrupt(): MicroserviceError {
    return new MicroserviceError('Stored comments are unreadable; no data was overwritten.', 502, 'MKTG_COMMENTS_CORRUPT');
  }
}
